'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { RotateCcw, Maximize, Grid3x3, Eye, EyeOff, Download } from 'lucide-react'
import { useStore } from '@/lib/store'

function parseBinarySTL(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const positions: number[] = [], normals: number[] = [], indices: number[] = []
  if (buffer.byteLength < 84) return { positions, normals, indices }
  const triCount = view.getUint32(80, true)
  let base = 0
  for (let i = 0; i < triCount; i++) {
    const off = 84 + i * 50
    if (off + 48 > buffer.byteLength) break
    const nx = view.getFloat32(off, true), ny = view.getFloat32(off + 4, true), nz = view.getFloat32(off + 8, true)
    for (let v = 0; v < 3; v++) {
      const vo = off + 12 + v * 12
      positions.push(view.getFloat32(vo, true), view.getFloat32(vo + 4, true), view.getFloat32(vo + 8, true))
      normals.push(nx, ny, nz)
    }
    indices.push(base, base + 1, base + 2)
    base += 3
  }
  return { positions, normals, indices }
}

export default function Viewport3D() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<any>(null)
  const sceneRef = useRef<any>(null)
  const meshRef = useRef<any>(null)
  const matRef = useRef<any>(null)
  const gridRef = useRef<any>(null)
  const [sceneReady, setSceneReady] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [showGrid, setShowGrid] = useState(false)
  const [triCount, setTriCount] = useState(0)
  const [dims, setDims] = useState({ x: 0, y: 0, z: 0 })

  const stlBuffer = useStore((s) => s.stlBuffer)
  const phase = useStore((s) => s.phase)

  // Zoom to fit the current mesh
  const zoomToFit = useCallback(() => {
    const scene = sceneRef.current
    const mesh = meshRef.current
    if (!scene || !mesh) return
    const cam = scene.activeCamera as any
    if (!cam) return
    const bb = mesh.getBoundingInfo().boundingBox
    cam.target = bb.centerWorld.clone()
    const sz = bb.maximumWorld.subtract(bb.minimumWorld)
    const mx = Math.max(sz.x, sz.y, sz.z)
    cam.radius = mx * 2.5 || 8
  }, [])

  // Reset camera to default angle
  const resetView = useCallback(() => {
    const scene = sceneRef.current
    if (!scene) return
    const cam = scene.activeCamera as any
    if (!cam) return
    cam.alpha = Math.PI / 4
    cam.beta = Math.PI / 3
    if (meshRef.current) zoomToFit()
    else { cam.radius = 8; cam.target?.copyFromFloats(0, 0, 0) }
  }, [zoomToFit])

  // View presets
  const setView = useCallback((alpha: number, beta: number) => {
    const cam = sceneRef.current?.activeCamera as any
    if (!cam) return
    cam.alpha = alpha
    cam.beta = beta
    zoomToFit()
  }, [zoomToFit])

  // Init Babylon
  useEffect(() => {
    let dead = false, eng: any = null
    async function init() {
      if (!canvasRef.current || dead) return
      const B = await import('@babylonjs/core')
      if (dead) return

      eng = new B.Engine(canvasRef.current, true, { preserveDrawingBuffer: true, stencil: true })
      engineRef.current = eng
      const scene = new B.Scene(eng)
      scene.clearColor = new B.Color4(0.04, 0.04, 0.06, 1)
      sceneRef.current = scene

      const cam = new B.ArcRotateCamera('cam', Math.PI / 4, Math.PI / 3, 8, B.Vector3.Zero(), scene)
      cam.attachControl(canvasRef.current, true)
      cam.wheelPrecision = 20
      cam.minZ = 0.01
      cam.panningSensibility = 100
      cam.pinchPrecision = 50
      cam.lowerRadiusLimit = 0.5
      cam.upperRadiusLimit = 500

      // Lights
      const hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), scene)
      hemi.intensity = 0.6
      hemi.groundColor = new B.Color3(0.1, 0.1, 0.15)
      const dir = new B.DirectionalLight('dir', new B.Vector3(-1, -2, -1), scene)
      dir.intensity = 0.7
      const back = new B.DirectionalLight('back', new B.Vector3(1, 1, 1), scene)
      back.intensity = 0.3

      // Subtle origin axes
      const axisLen = 0.3
      const makeAxis = (pts: number[], col: any) => {
        const l = B.MeshBuilder.CreateLines('ax', { points: [new B.Vector3(pts[0], pts[1], pts[2]), new B.Vector3(pts[3], pts[4], pts[5])] }, scene)
        l.color = col; l.alpha = 0.15; l.isPickable = false
      }
      makeAxis([0,0,0, axisLen,0,0], new B.Color3(1, 0.3, 0.3))
      makeAxis([0,0,0, 0,axisLen,0], new B.Color3(0.3, 1, 0.3))
      makeAxis([0,0,0, 0,0,axisLen], new B.Color3(0.3, 0.3, 1))

      // Grid floor (hidden by default, toggled via showGrid state)
      const g = B.MeshBuilder.CreateGround('grid', { width: 50, height: 50, subdivisions: 25 }, scene)
      const gm = new B.StandardMaterial('gm', scene)
      gm.wireframe = true; gm.alpha = 0.06
      gm.emissiveColor = new B.Color3(0.2, 0.2, 0.25)
      g.material = gm; g.isPickable = false; g.setEnabled(false)
      gridRef.current = g

      eng.runRenderLoop(() => scene.render())

      // Handle resize via ResizeObserver on the container
      if (containerRef.current) {
        const ro = new ResizeObserver(() => eng?.resize())
        ro.observe(containerRef.current)
      }

      if (!dead) { setSceneReady(true) }
    }
    init()
    return () => { dead = true; eng?.dispose() }
  }, [])

  // Render STL
  useEffect(() => {
    if (!stlBuffer || !sceneReady || !sceneRef.current) return
    async function render() {
      const B = await import('@babylonjs/core')
      const scene = sceneRef.current as any

      if (meshRef.current) { meshRef.current.dispose(); meshRef.current = null }

      const { positions, normals, indices } = parseBinarySTL(stlBuffer!)
      if (!positions.length) return

      const mesh = new B.Mesh('design', scene)
      const vd = new B.VertexData()
      vd.positions = positions; vd.normals = normals; vd.indices = indices
      vd.applyToMesh(mesh)

      // Normalize: scale largest dimension to ~5 units for comfortable viewing
      const bb = mesh.getBoundingInfo().boundingBox
      const sz = bb.maximumWorld.subtract(bb.minimumWorld)
      const maxDim = Math.max(sz.x, sz.y, sz.z)
      const originalDims = { x: Math.abs(sz.x), y: Math.abs(sz.y), z: Math.abs(sz.z) }

      if (maxDim > 0) {
        const scale = 5 / maxDim
        mesh.scaling = new B.Vector3(scale, scale, scale)
        mesh.refreshBoundingInfo()
      }

      // Center at origin
      const bb2 = mesh.getBoundingInfo().boundingBox
      const center = bb2.centerWorld
      mesh.position = mesh.position.subtract(center)
      mesh.refreshBoundingInfo()

      // Material
      const mat = new B.StandardMaterial('mat', scene)
      mat.diffuseColor = new B.Color3(0.35, 0.65, 0.85)
      mat.specularColor = new B.Color3(0.4, 0.4, 0.4)
      mat.specularPower = 48
      mat.backFaceCulling = false
      mat.wireframe = wireframe
      mesh.material = mat
      matRef.current = mat
      meshRef.current = mesh

      // Stats
      setTriCount(indices.length / 3)
      setDims({ x: Math.round(originalDims.x * 10) / 10, y: Math.round(originalDims.y * 10) / 10, z: Math.round(originalDims.z * 10) / 10 })

      // Fit camera
      const cam = scene.activeCamera as any
      if (cam) {
        cam.target = new B.Vector3(0, 0, 0)
        cam.radius = 12
        cam.alpha = Math.PI / 4
        cam.beta = Math.PI / 3
      }
    }
    render()
  }, [stlBuffer, sceneReady])

  // Toggle wireframe live
  useEffect(() => {
    if (matRef.current) matRef.current.wireframe = wireframe
  }, [wireframe])

  // Toggle grid live
  useEffect(() => {
    if (gridRef.current) gridRef.current.setEnabled(showGrid)
  }, [showGrid])

  const loading = phase === 'generating-code' || phase === 'compiling' || phase === 'validating'

  const downloadSTL = () => {
    if (!stlBuffer) return
    const blob = new Blob([stlBuffer], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'studio-design.stl'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#0f0f12] min-h-[200px] overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* ── Top-left: Tools ── */}
      <div className="absolute top-2 left-2 flex gap-1 z-10">
        {[
          { icon: <Maximize className="w-3.5 h-3.5" />, onClick: zoomToFit, title: 'Fit to view' },
          { icon: <RotateCcw className="w-3.5 h-3.5" />, onClick: resetView, title: 'Reset camera' },
          { icon: wireframe ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />, onClick: () => setWireframe(!wireframe), title: wireframe ? 'Solid' : 'Wireframe', active: wireframe },
          { icon: <Grid3x3 className="w-3.5 h-3.5" />, onClick: () => setShowGrid(!showGrid), title: showGrid ? 'Hide grid' : 'Show grid', active: showGrid },
        ].map((btn, i) => (
          <button
            key={i}
            onClick={btn.onClick}
            title={btn.title}
            className={`p-1.5 rounded transition-all ${
              btn.active
                ? 'bg-white/15 text-white'
                : 'bg-black/30 text-white/50 hover:text-white hover:bg-black/50'
            }`}
          >
            {btn.icon}
          </button>
        ))}
      </div>

      {/* ── Bottom-left: View presets ── */}
      <div className="absolute bottom-8 left-2 flex gap-1 z-10">
        {[
          { label: 'Front', onClick: () => setView(0, Math.PI / 2) },
          { label: 'Right', onClick: () => setView(Math.PI / 2, Math.PI / 2) },
          { label: 'Top', onClick: () => setView(0, 0.01) },
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={btn.onClick}
            className="px-2 py-1 rounded text-[10px] font-mono bg-black/30 text-white/50 hover:text-white hover:bg-black/50 transition-all"
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* ── Bottom-left: Mesh info ── */}
      {triCount > 0 && (
        <div className="absolute bottom-2 left-2 z-10 text-[9px] font-mono text-white/20">
          {triCount.toLocaleString()} tris · {dims.x}×{dims.y}×{dims.z} mm
        </div>
      )}

      {/* ── Bottom-right: Download ── */}
      {stlBuffer && (
        <button
          onClick={downloadSTL}
          title="Download STL"
          className="absolute bottom-2 right-2 z-10 p-2 rounded bg-black/30 text-white/50 hover:text-white hover:bg-black/50 transition-all"
        >
          <Download className="w-4 h-4" />
        </button>
      )}

      {/* ── Loading spinner ── */}
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 gap-3 z-20">
          <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-blue-300 text-sm">
            {phase === 'generating-code' ? 'Generating code...' : phase === 'compiling' ? 'Compiling geometry...' : 'Processing...'}
          </p>
        </div>
      )}


    </div>
  )
}
