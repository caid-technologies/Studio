import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { writeFile, readFile, unlink, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { promisify } from 'util'
import { devLog } from '@/lib/logger'

const execFileAsync = promisify(execFile)

// Find python3 binary
let resolvedPython: string | null | undefined = undefined

async function findPython(): Promise<string> {
  if (resolvedPython) return resolvedPython

  const pythonPath = process.env.PYTHON_PATH
  if (!pythonPath) {
    throw new Error('[compile] PYTHON_PATH environment variable is not set')
  }

  try {
    const { stdout } = await execFileAsync(pythonPath, ['--version'], { timeout: 5000 })
    devLog(`[compile] Using Python at: ${pythonPath} — ${stdout.trim()}`)
    resolvedPython = pythonPath
    return pythonPath
  } catch (err) {
    throw new Error(`[compile] PYTHON_PATH is set to "${pythonPath}" but is not a valid Python binary: ${(err as Error).message}`)
  }
}


// Verify build123d is installed
let build123dVerified = false
async function verifyBuild123d(python: string): Promise<boolean> {
  if (build123dVerified) return true
  try {
    await execFileAsync(python, ['-c', 'import build123d; print("ok")'], { timeout: 10000 })
    devLog('[compile] build123d verified')
    build123dVerified = true
    return true
  } catch (err: any) {
    console.error('[compile] build123d not installed:', err.stderr || err.message)
    return false
  }
}

export async function POST(req: NextRequest) {
  let code: string

  try {
    const body = await req.json()
    code = body.code
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Missing "code" in body' }, { status: 400 })
  }

  devLog(`[compile] Received ${code.length} chars of Build123d code`)
  devLog(`[compile] First 300 chars:\n${code.substring(0, 300)}`)

  const python = await findPython()
  if (!python) {
    return NextResponse.json({ error: 'Python not found. Install Python 3.8+.' }, { status: 501 })
  }

  const hasBuild123d = await verifyBuild123d(python)
  if (!hasBuild123d) {
    return NextResponse.json({
      error: 'build123d not installed. Run: pip3 install build123d',
    }, { status: 501 })
  }

  const id = randomUUID()
  const pyPath = join(tmpdir(), `studio-${id}.py`)
  const stlPath = join(tmpdir(), `studio-${id}.stl`)

  try {
    // Wrap the user code to ensure STL export happens
    // The AI-generated code should define a variable called `result` as the final shape
    // We append export logic that finds the shape and exports it
    const wrappedCode = `
import sys
import os

# User-generated Build123d code
${code}

# ── Auto-export to STL ──────────────────────────────────
from build123d import export_stl, Compound, Part, Solid, Shape

_stl_path = "${stlPath.replace(/\\/g, '/')}"

# Try to find the result shape — check common variable names
_shape = None
for _name in ['result', 'part', 'model', 'final', 'output', 'design']:
    if _name in dir() and _name in locals():
        _obj = locals()[_name]
        if hasattr(_obj, 'part'):
            _shape = _obj.part  # BuildPart context
            break
        elif isinstance(_obj, (Solid, Compound, Shape)):
            _shape = _obj
            break

# If nothing found, check for BuildPart contexts
if _shape is None:
    for _name, _obj in list(locals().items()):
        if _name.startswith('_'):
            continue
        if hasattr(_obj, 'part') and _obj.part is not None:
            _shape = _obj.part
            break
        if isinstance(_obj, (Solid, Compound)):
            _shape = _obj
            break

if _shape is None:
    print("ERROR: No shape found to export. Define a variable called 'result' with your final shape.", file=sys.stderr)
    sys.exit(1)

export_stl(_shape, _stl_path)

# ── Extract geometric metrics for Evaluation Agent ──────────────
import json as _json

_metrics = {}
try:
  # Bounding box dimensions
  _bb = _shape.bounding_box()
  _metrics["bbox_min"] = [round(_bb.min.X, 3), round(_bb.min.Y, 3), round(_bb.min.Z, 3)]
  _metrics["bbox_max"] = [round(_bb.max.X, 3), round(_bb.max.Y, 3), round(_bb.max.Z, 3)]
  _dims = [round(_bb.max.X - _bb.min.X, 3), round(_bb.max.Y - _bb.min.Y, 3), round(_bb.max.Z - _bb.min.Z, 3)]
  _metrics["dimensions"] = _dims
  _metrics["max_dimension"] = round(max(_dims), 3)
  _metrics["min_dimension"] = round(min(d for d in _dims if d > 0.001), 3) if any(d > 0.001 for d in _dims) else 0

  # Volume and surface area (from OpenCascade BREP kernel)
  _metrics["volume"] = round(float(_shape.volume), 4)
  _metrics["surface_area"] = round(float(_shape.area), 4)

  # Topology counts
  _faces = _shape.faces()
  _edges = _shape.edges()
  _vertices = _shape.vertices()
  _metrics["face_count"] = len(_faces)
  _metrics["edge_count"] = len(_edges)
  _metrics["vertex_count"] = len(_vertices)

  # Face type distribution (PLANE, CYLINDER, CONE, SPHERE, TORUS, BSPLINE, etc.)
  _face_types = {}
  for _f in _faces:
    _ft = str(_f.geom_type())
    _face_types[_ft] = _face_types.get(_ft, 0) + 1
  _metrics["face_types"] = _face_types

  # Edge type distribution
  _edge_types = {}
  for _e in _edges:
    _et = str(_e.geom_type())
    _edge_types[_et] = _edge_types.get(_et, 0) + 1
  _metrics["edge_types"] = _edge_types

  # Validity check (OpenCascade BRepCheck_Analyzer)
  _metrics["is_valid"] = bool(_shape.is_valid())

  # Aspect ratios
  if _metrics["min_dimension"] > 0:
    _metrics["aspect_ratio"] = round(_metrics["max_dimension"] / _metrics["min_dimension"], 3)
  else:
    _metrics["aspect_ratio"] = 0

  # Compactness (sphere has max compactness = 1.0)
  if _metrics["volume"] > 0 and _metrics["surface_area"] > 0:
    import math
    _metrics["compactness"] = round((math.pi ** (1/3) * (6 * _metrics["volume"]) ** (2/3)) / _metrics["surface_area"], 4)
  else:
    _metrics["compactness"] = 0

  # Center of mass
  _com = _shape.center()
  _metrics["center_of_mass"] = [round(float(_com.X), 3), round(float(_com.Y), 3), round(float(_com.Z), 3)]

  # Symmetry hint: check if center of mass is near bounding box center
  _bb_center = [round((_bb.min.X + _bb.max.X) / 2, 3), round((_bb.min.Y + _bb.max.Y) / 2, 3), round((_bb.min.Z + _bb.max.Z) / 2, 3)]
  _com_offset = sum(abs(_metrics["center_of_mass"][i] - _bb_center[i]) for i in range(3))
  _metrics["symmetry_hint"] = round(max(0, 1.0 - _com_offset / max(_metrics["max_dimension"], 0.001)), 4)

except Exception as _e:
  _metrics["error"] = str(_e)

# Write metrics as JSON to a sidecar file
_metrics_path = _stl_path.replace('.stl', '.metrics.json')
with open(_metrics_path, 'w') as _mf:
  _mf.write(_json.dumps(_metrics))

print(f"METRICS_JSON:{_json.dumps(_metrics)}")
print(f"Exported STL to {_stl_path}")
`

    await writeFile(pyPath, wrappedCode, 'utf-8')
    devLog(`[compile] Wrote Python file: ${pyPath}`)

    // Run the Python script
    const { stdout, stderr } = await execFileAsync(
      python,
      [pyPath],
      {
        timeout: 60_000,  // Build123d can be slower than OpenSCAD for complex shapes
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      }
    )

    if (stdout) devLog('[compile] stdout:', stdout.trim())
    if (stderr) devLog('[compile] stderr:', stderr.trim())

    // Check if STL was created
    try {
      const stlStat = await stat(stlPath)
      devLog(`[compile] STL file size: ${stlStat.size} bytes`)
    } catch {
      return NextResponse.json({
        error: 'Build123d produced no STL output. Check code for errors.',
        stderr: stderr || undefined,
      }, { status: 422 })
    }

    const stlBuffer = await readFile(stlPath)
    devLog(`[compile] Returning ${stlBuffer.byteLength} bytes of STL`)

    // Extract BREP metrics from Python stdout
    let geometryMetrics = null
    if (stdout) {
      const metricsMatch = stdout.match(/METRICS_JSON:(.+)/)
      if (metricsMatch) {
        try {
          geometryMetrics = JSON.parse(metricsMatch[1])
          devLog('[compile] BREP metrics:', JSON.stringify(geometryMetrics).substring(0, 200))
        } catch {}
      }
    }

    // If we have metrics, return them as a header (STL body stays binary)
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(stlBuffer.byteLength),
    }
    if (geometryMetrics) {
      headers['X-Geometry-Metrics'] = JSON.stringify(geometryMetrics)
    }

    await unlink(pyPath).catch(() => {})
    await unlink(stlPath).catch(() => {})

    return new Response(stlBuffer, {
      status: 200,
      headers,
    })

  } catch (err: any) {
    console.error('[compile] Build123d execution failed:')
    console.error('[compile] stderr:', err.stderr)
    console.error('[compile] message:', err.message)

    const errorMsg = err.stderr || err.message || 'Compilation failed'

    // Auto-heal: fillet/chamfer often fails on invalid topology; strip those calls and retry once
    // so users still get an STL when the rest of the model is valid.
    if (errorMsg.includes('fillet') || errorMsg.includes('chamfer') || errorMsg.includes('Failed creating a fillet') || errorMsg.includes('BRep_API: command not done')) {
      devLog('[compile] Fillet/chamfer error detected — retrying without fillets...')

      try {
        // Remove fillet and chamfer lines from the code
        const healedCode = code
          .split('\n')
          .filter(line => {
            const trimmed = line.trim().toLowerCase()
            return !trimmed.includes('fillet(') && !trimmed.includes('chamfer(') && !trimmed.includes('= fillet(') && !trimmed.includes('= chamfer(')
          })
          .join('\n')

        const healedWrapped = `
import sys
import os

# User-generated Build123d code (auto-healed: fillets/chamfers removed)
${healedCode}

# ── Auto-export to STL ──────────────────────────────────
from build123d import export_stl, Compound, Part, Solid, Shape

_stl_path = "${stlPath.replace(/\\/g, '/')}"

_shape = None
for _name in ['result', 'part', 'model', 'final', 'output', 'design']:
    if _name in dir() and _name in locals():
        _obj = locals()[_name]
        if hasattr(_obj, 'part'):
            _shape = _obj.part
            break
        elif isinstance(_obj, (Solid, Compound, Shape)):
            _shape = _obj
            break

if _shape is None:
    for _name, _obj in list(locals().items()):
        if _name.startswith('_'):
            continue
        if hasattr(_obj, 'part') and _obj.part is not None:
            _shape = _obj.part
            break
        if isinstance(_obj, (Solid, Compound)):
            _shape = _obj
            break

if _shape is None:
    print("ERROR: No shape found to export.", file=sys.stderr)
    sys.exit(1)

export_stl(_shape, _stl_path)

# ── Extract geometric metrics for Evaluation Agent ──────────────
import json as _json

_metrics = {}
try:
  # Bounding box dimensions
  _bb = _shape.bounding_box()
  _metrics["bbox_min"] = [round(_bb.min.X, 3), round(_bb.min.Y, 3), round(_bb.min.Z, 3)]
  _metrics["bbox_max"] = [round(_bb.max.X, 3), round(_bb.max.Y, 3), round(_bb.max.Z, 3)]
  _dims = [round(_bb.max.X - _bb.min.X, 3), round(_bb.max.Y - _bb.min.Y, 3), round(_bb.max.Z - _bb.min.Z, 3)]
  _metrics["dimensions"] = _dims
  _metrics["max_dimension"] = round(max(_dims), 3)
  _metrics["min_dimension"] = round(min(d for d in _dims if d > 0.001), 3) if any(d > 0.001 for d in _dims) else 0

  # Volume and surface area (from OpenCascade BREP kernel)
  _metrics["volume"] = round(float(_shape.volume), 4)
  _metrics["surface_area"] = round(float(_shape.area), 4)

  # Topology counts
  _faces = _shape.faces()
  _edges = _shape.edges()
  _vertices = _shape.vertices()
  _metrics["face_count"] = len(_faces)
  _metrics["edge_count"] = len(_edges)
  _metrics["vertex_count"] = len(_vertices)

  # Face type distribution (PLANE, CYLINDER, CONE, SPHERE, TORUS, BSPLINE, etc.)
  _face_types = {}
  for _f in _faces:
    _ft = str(_f.geom_type())
    _face_types[_ft] = _face_types.get(_ft, 0) + 1
  _metrics["face_types"] = _face_types

  # Edge type distribution
  _edge_types = {}
  for _e in _edges:
    _et = str(_e.geom_type())
    _edge_types[_et] = _edge_types.get(_et, 0) + 1
  _metrics["edge_types"] = _edge_types

  # Validity check (OpenCascade BRepCheck_Analyzer)
  _metrics["is_valid"] = bool(_shape.is_valid())

  # Aspect ratios
  if _metrics["min_dimension"] > 0:
    _metrics["aspect_ratio"] = round(_metrics["max_dimension"] / _metrics["min_dimension"], 3)
  else:
    _metrics["aspect_ratio"] = 0

  # Compactness (sphere has max compactness = 1.0)
  if _metrics["volume"] > 0 and _metrics["surface_area"] > 0:
    import math
    _metrics["compactness"] = round((math.pi ** (1/3) * (6 * _metrics["volume"]) ** (2/3)) / _metrics["surface_area"], 4)
  else:
    _metrics["compactness"] = 0

  # Center of mass
  _com = _shape.center()
  _metrics["center_of_mass"] = [round(float(_com.X), 3), round(float(_com.Y), 3), round(float(_com.Z), 3)]

  # Symmetry hint: check if center of mass is near bounding box center
  _bb_center = [round((_bb.min.X + _bb.max.X) / 2, 3), round((_bb.min.Y + _bb.max.Y) / 2, 3), round((_bb.min.Z + _bb.max.Z) / 2, 3)]
  _com_offset = sum(abs(_metrics["center_of_mass"][i] - _bb_center[i]) for i in range(3))
  _metrics["symmetry_hint"] = round(max(0, 1.0 - _com_offset / max(_metrics["max_dimension"], 0.001)), 4)

except Exception as _e:
  _metrics["error"] = str(_e)

# Write metrics as JSON to a sidecar file
_metrics_path = _stl_path.replace('.stl', '.metrics.json')
with open(_metrics_path, 'w') as _mf:
  _mf.write(_json.dumps(_metrics))

print(f"METRICS_JSON:{_json.dumps(_metrics)}")
print(f"Exported STL to {_stl_path} (auto-healed)")
`

        const healedPyPath = join(tmpdir(), 'studio-healed-' + id + '.py')
        await writeFile(healedPyPath, healedWrapped, 'utf-8')

        const { stdout: hStdout, stderr: hStderr } = await execFileAsync(
          python,
          [healedPyPath],
          {
            timeout: 60_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
          }
        )

        if (hStdout) devLog('[compile] healed stdout:', hStdout.trim())
        if (hStderr) devLog('[compile] healed stderr:', hStderr.trim())

        try {
          await stat(stlPath)
        } catch {
          await unlink(healedPyPath).catch(() => {})
          return NextResponse.json({ error: 'Auto-heal also failed: ' + (hStderr || 'no STL produced') }, { status: 422 })
        }

        const stlBuffer = await readFile(stlPath)
        devLog('[compile] Auto-healed successfully! Returning ' + stlBuffer.byteLength + ' bytes (fillets removed)')

        // Extract BREP metrics from Python stdout
        let geometryMetrics = null
        if (hStdout) {
          const metricsMatch = hStdout.match(/METRICS_JSON:(.+)/)
          if (metricsMatch) {
            try {
              geometryMetrics = JSON.parse(metricsMatch[1])
              devLog('[compile] BREP metrics:', JSON.stringify(geometryMetrics).substring(0, 200))
            } catch {}
          }
        }

        // If we have metrics, return them as a header (STL body stays binary)
        const headers: Record<string, string> = {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(stlBuffer.byteLength),
        }
        if (geometryMetrics) {
          headers['X-Geometry-Metrics'] = JSON.stringify(geometryMetrics)
        }

        await unlink(healedPyPath).catch(() => {})
        await unlink(pyPath).catch(() => {})
        await unlink(stlPath).catch(() => {})

        return new Response(stlBuffer, {
          status: 200,
          headers,
        })
      } catch (healErr: any) {
        console.error('[compile] Auto-heal retry also failed:', healErr.message)
        return NextResponse.json({ error: errorMsg }, { status: 422 })
      }
    }

    return NextResponse.json({ error: errorMsg }, { status: 422 })
  } finally {
    await unlink(pyPath).catch(() => {})
    await unlink(stlPath).catch(() => {})
  }
}
