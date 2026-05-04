import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import sharp from 'sharp'
import { devLog, devWarn } from '@/lib/logger'

/* ── Stage 1.1: Image Preprocessing (cofounder spec) ───────────── */

async function preprocessImage(base64: string, mimeType: string): Promise<{ base64: string; mime: string; width: number; height: number }> {
  const buffer = Buffer.from(base64, 'base64')

  // Resize to max 1024px, convert to JPEG for smaller payload
  const processed = await sharp(buffer)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()

  const metadata = await sharp(buffer).metadata()

  return {
    base64: processed.toString('base64'),
    mime: 'image/jpeg',
    width: metadata.width || 0,
    height: metadata.height || 0,
  }
}

/* ── Inlined DIR types ─────────────────────────────────────────── */

interface DIRFeature {
  type: string
  likelihood: number
  count_estimate?: number
  direction?: string
  is_subtractive?: boolean
}

interface DIR {
  family: string
  confidence: number
  construction_strategy?: string
  global: {
    height_width_ratio: number
    symmetry: { type: string; score: number }
    orientation: string
    detail_level: number
  }
  shape: {
    taper_ratio: number
    roundness: number
    rectangularity: number
    hollow_likelihood: number
  }
  features: DIRFeature[]
  constraints_suggestions: {
    prefer_symmetry_axis: string
    size_hint_mm: Record<string, number>
    construction_notes?: string
  }
}

/* ── Inlined parseDIR ──────────────────────────────────────────── */

function parseDIR(text: string): DIR | null {
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!parsed.family || !parsed.global) return null
    return parsed as DIR
  } catch {
    return null
  }
}

/* ── Parse geometric analysis JSON ─────────────────────────────── */

function parseGeoAnalysis(text: string): Record<string, any> | null {
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!parsed.outline) return null
    return parsed
  } catch {
    return null
  }
}

/* ── dirToPrompt — now uses construction_strategy ──────────────── */

function dirToPrompt(dir: DIR, geoAnalysis?: Record<string, any> | null): string {
  const parts: string[] = []

  // If we have a construction strategy from Pass 2, lead with it
  if (dir.construction_strategy) {
    parts.push(dir.construction_strategy)
  } else {
    const fam: Record<string, string> = {
      revolve_profile: 'revolved profile shape (like a vase or bottle)',
      extrude_profile: 'extruded profile shape (like a plate or bracket)',
      boxy_enclosure: 'rectangular enclosure box',
      cylindrical_part: 'cylindrical part',
      panel_pattern: 'flat panel with pattern',
      gear_mechanism: 'gear mechanism',
      bracket_mount: 'mounting bracket',
      unknown: '3D object',
    }
    parts.push('Create a ' + (fam[dir.family] || dir.family) + '.')
  }

  // Dimensions
  const h = dir.constraints_suggestions?.size_hint_mm || {}
  if (h.height) parts.push('Target height: ' + h.height + 'mm.')
  if (h.width) parts.push('Target width: ' + h.width + 'mm.')
  if (h.diameter) parts.push('Target diameter: ' + h.diameter + 'mm.')
  if (h.thickness) parts.push('Thickness: ' + h.thickness + 'mm.')

  if (dir.global?.height_width_ratio > 0)
    parts.push('Height-to-width ratio approximately ' + dir.global.height_width_ratio.toFixed(1) + '.')

  // Symmetry
  if (dir.global?.symmetry?.score > 0.7) {
    if (dir.global.symmetry.type.includes('radial') || dir.global.symmetry.type.includes('rotational'))
      parts.push('Radially symmetric around the central axis.')
    else
      parts.push('Mirror symmetry should be high.')
  }

  // Shape characteristics
  if (dir.shape?.taper_ratio > 0 && dir.shape.taper_ratio < 0.8)
    parts.push('Tapers toward the top with taper ratio ~' + dir.shape.taper_ratio.toFixed(2) + '.')
  if (dir.shape?.hollow_likelihood > 0.5)
    parts.push('The object appears hollow — include wall thickness and interior cavity.')
  if (dir.shape?.roundness > 0.7)
    parts.push('Predominantly round/circular cross-section.')
  else if (dir.shape?.rectangularity > 0.7)
    parts.push('Predominantly rectangular/boxy cross-section.')

  // Features — with subtractive awareness
  for (const f of dir.features || []) {
    if (f.likelihood < 0.4) continue
    const sub = f.is_subtractive ? ' (SUBTRACTIVE — cut/remove material, do NOT add)' : ''
    switch (f.type) {
      case 'ribs': parts.push('Add ' + (f.count_estimate ?? 'several') + ' ' + (f.direction ?? 'vertical') + ' ribs evenly spaced' + sub + '.'); break
      case 'teeth': parts.push('Include ' + (f.count_estimate ?? 20) + ' gear teeth evenly distributed' + sub + '.'); break
      case 'holes': parts.push('Add ' + (f.count_estimate ?? 4) + ' mounting holes' + sub + '.'); break
      case 'bore': parts.push('Include a center bore hole (SUBTRACTIVE).'); break
      case 'fillet': parts.push('Apply fillets to edges.'); break
      case 'chamfer': parts.push('Apply chamfers to exposed edges.'); break
      case 'slots': parts.push('Include ventilation slots' + sub + '.'); break
      case 'pattern': parts.push('Add a repeating ' + (f.direction ?? 'surface') + ' pattern' + sub + '.'); break
      case 'crosshatch':
      case 'grid':
        parts.push('Cut a ' + (f.type) + ' grid pattern through the surface — use boolean SUBTRACTION with a loop of slots in two perpendicular directions' + sub + '.')
        break
      default: parts.push('Include ' + f.type + ' feature' + sub + '.')
    }
  }

  // Construction notes from Pass 2
  if (dir.constraints_suggestions?.construction_notes) {
    parts.push(dir.constraints_suggestions.construction_notes)
  }

  if (dir.constraints_suggestions?.prefer_symmetry_axis)
    parts.push('Prefer ' + dir.constraints_suggestions.prefer_symmetry_axis + '-axis as primary symmetry axis.')
  if (dir.global?.detail_level > 0.7)
    parts.push('The model should be detailed with precise geometry.')

  // If geo analysis detected flat 2D, add extrusion constraint
  if (geoAnalysis) {
    if (geoAnalysis.topology === 'flat_2d' || geoAnalysis.is_3d_drawing === false) {
      parts.push('IMPORTANT: The sketch is a FLAT 2D drawing with no depth cues. Create this as a thin extruded shape — do NOT interpret as a solid 3D primitive like a cylinder or cone.')
    }
    if (geoAnalysis.profile_shape && geoAnalysis.profile_shape !== 'N/A' && geoAnalysis.profile_shape !== 'none') {
      parts.push('The sketch shows a profile/cross-section: ' + geoAnalysis.profile_shape + '. Use this exact profile for revolution or extrusion.')
    }
  }

  return parts.join(' ')
}

/* ═══════════════════════════════════════════════════════════════════
   TWO-PASS PROMPTS — Constrained Geometric Analysis
   ═══════════════════════════════════════════════════════════════════ */

/* ── Pass 1: Geometric Feature Extraction (what's literally drawn) */

const PASS1_GEOMETRIC_EXTRACTION = `You are a geometric feature extractor. Analyze this sketch/image with surgical precision.

DO NOT interpret what the object could be in real life.
DO NOT infer 3D form from context or common sense.
ONLY describe what is literally visible in the image.

Answer these questions exactly and return as JSON only:

{
  "outline": "circle" | "rectangle" | "polygon" | "L-shape" | "T-shape" | "irregular" | "complex",
  "outline_details": "describe the exact boundary shape with approximate proportions",
  "is_3d_drawing": true or false (are there perspective lines, vanishing points, shading, or explicit depth/thickness shown in the drawing?),
  "topology": "flat_2d" | "3d_perspective" | "3d_orthographic" | "isometric" | "unclear",
  "internal_features": [
    {
      "type": "describe what you literally see (e.g. parallel lines, crosshatch grid, concentric circles, radiating spokes, holes, ridges, teeth, slots, curves, text)",
      "orientation": "horizontal" | "vertical" | "diagonal_45" | "diagonal_other" | "radial" | "concentric" | "mixed",
      "count_or_spacing": "describe count or spacing as observed",
      "suggests_depth": true or false,
      "is_subtractive": true or false (does this feature appear to be cut INTO the surface rather than raised above it?)
    }
  ],
  "thickness_cues": {
    "has_thickness": true or false,
    "evidence": "describe what indicates thickness/volume, or 'none visible'"
  },
  "symmetry": ["list all observed symmetry types: radial, bilateral_x, bilateral_y, rotational_N, none"],
  "profile_shape": "if the image shows a side profile or cross-section view, describe the exact outline path. Otherwise 'N/A'",
  "estimated_dimensions_ratio": {
    "width_to_height": 1.0,
    "description": "describe the proportional relationships between major dimensions"
  },
  "drawing_style": "sketch" | "technical_drawing" | "photograph" | "3d_render" | "diagram" | "unknown"
}

CRITICAL RULES:
- Report ONLY what you see. If the image is a flat 2D sketch with no depth cues, topology MUST be "flat_2d".
- Do NOT assume a circle means "cylinder" — a circle drawn flat is just a circle.
- Do NOT assume lines inside a shape mean "ribs" or "structural features" — describe the literal pattern (parallel lines, crosshatch, grid, etc.)
- If there are no perspective cues, vanishing points, or shading that implies 3D, then is_3d_drawing MUST be false.
- Count features carefully — do not estimate, count what you actually see.

Return ONLY the JSON object, no prose, no markdown fences.`

/* ── Pass 2: Constrained DIR locked to Pass 1's geometry ────────── */

function makePass2Prompt(geoAnalysis: Record<string, any>): string {
  return `You are a CAD design interpreter for Build123d (Python parametric CAD). You will receive a geometric analysis extracted from a sketch/image. Your job is to produce a Design Intent Representation (DIR) that EXACTLY matches the observed geometry.

GEOMETRIC ANALYSIS (treat as ground truth — do not deviate from this):
${JSON.stringify(geoAnalysis, null, 2)}

HARD CONSTRAINTS — violating any of these is an error:
- If topology = "flat_2d" and is_3d_drawing = false → output MUST use family "panel_pattern" or "extrude_profile". The object is a thin extruded shape. Do NOT use "cylindrical_part", "revolve_profile", or any solid 3D primitive interpretation.
- If is_3d_drawing = false → do not add any depth, curvature, or 3D form beyond a thin extrusion (thickness = 0.05 * largest dimension, or 2-5mm)
- Every internal feature from the geometric analysis MUST appear in your features array
- No features may be ADDED that are not in the geometric analysis
- If internal features include grid/crosshatch/lattice patterns → mark them as SUBTRACTIVE (is_subtractive: true). These are slots cut through the base shape, not material added on top.
- Respect the exact symmetry types observed
- Match the outline shape precisely
- If drawing_style is "3d_render" or "3d_perspective" or "isometric", THEN you may interpret 3D form
- If the analysis mentions a profile_shape, the object should be created by revolving or extruding that exact profile

Produce a DIR as JSON:
{
  "family": "revolve_profile" | "extrude_profile" | "boxy_enclosure" | "cylindrical_part" | "panel_pattern" | "gear_mechanism" | "bracket_mount" | "unknown",
  "confidence": 0.0 to 1.0,
  "construction_strategy": "Step-by-step plain English instructions for building this in Build123d. Be specific: what base shape, what boolean operations, what patterns. Example: 'Start with a Cylinder(25, 3) as the disc. Then use a loop to subtract Box slots in X direction, then another loop to subtract Box slots in Y direction, creating a crosshatch grid pattern.'",
  "global": {
    "height_width_ratio": number,
    "symmetry": { "type": "mirror_y" | "radial" | "rotational" | "asymmetric", "score": 0.0 to 1.0 },
    "orientation": "upright" | "horizontal" | "angled",
    "detail_level": 0.0 to 1.0
  },
  "shape": {
    "taper_ratio": 0.0 to 1.0 (1.0 = no taper),
    "roundness": 0.0 to 1.0,
    "rectangularity": 0.0 to 1.0,
    "hollow_likelihood": 0.0 to 1.0
  },
  "features": [
    { "type": "ribs"|"teeth"|"holes"|"bore"|"fillet"|"chamfer"|"slots"|"pattern"|"crosshatch"|"grid"|"spokes"|"concentric_rings", "likelihood": 0.0-1.0, "count_estimate": integer or null, "direction": "vertical"|"horizontal"|"radial"|"diagonal"|null, "is_subtractive": true or false }
  ],
  "constraints_suggestions": {
    "prefer_symmetry_axis": "Z"|"Y"|"X",
    "size_hint_mm": { "height": number, "width": number, "diameter": number, "thickness": number },
    "construction_notes": "Specific Build123d construction advice. For patterns: use boolean subtraction loops. For profiles: use make_face() + extrude() or revolve(). For holes: Cylinder + boolean subtract."
  }
}

SELF-CHECK before outputting:
- Does family match the topology from the geometric analysis?
- Are ALL observed features included with correct subtractive/additive marking?
- If topology was flat_2d, is family panel_pattern or extrude_profile?
- Does construction_strategy describe a concrete Build123d plan?

Return ONLY the JSON object, no prose.`
}

/* ── Legacy single-pass DIR prompt (fallback) ──────────────────── */

const DIR_PROMPT = [
  'You are an expert 3D CAD vision analyst. Analyze this image and output a Design Intent Representation (DIR) as JSON.',
  '',
  'Respond with ONLY valid JSON matching this schema — no markdown fences, no explanation:',
  '',
  '{',
  '  "family": "revolve_profile" | "extrude_profile" | "boxy_enclosure" | "cylindrical_part" | "panel_pattern" | "gear_mechanism" | "bracket_mount" | "unknown",',
  '  "confidence": 0.0 to 1.0,',
  '  "global": {',
  '    "height_width_ratio": number,',
  '    "symmetry": { "type": "mirror_y" | "radial" | "rotational" | "asymmetric", "score": 0.0 to 1.0 },',
  '    "orientation": "upright" | "horizontal" | "angled",',
  '    "detail_level": 0.0 to 1.0',
  '  },',
  '  "shape": {',
  '    "taper_ratio": 0.0 to 1.0,',
  '    "roundness": 0.0 to 1.0,',
  '    "rectangularity": 0.0 to 1.0,',
  '    "hollow_likelihood": 0.0 to 1.0',
  '  },',
  '  "features": [',
  '    { "type": "ribs"|"teeth"|"holes"|"bore"|"fillet"|"chamfer"|"slots"|"pattern", "likelihood": 0.0-1.0, "count_estimate": int|null, "direction": "vertical"|"horizontal"|"radial"|null }',
  '  ],',
  '  "constraints_suggestions": {',
  '    "prefer_symmetry_axis": "Z"|"Y"|"X",',
  '    "size_hint_mm": { "height": number, "width": number, "diameter": number, "thickness": number }',
  '  }',
  '}',
  '',
  'RULES:',
  '- Estimate ALL numeric values from visual appearance',
  '- For size_hint_mm estimate real-world mm dimensions',
  '- Include ALL visible features with likelihood scores',
  '- Output ONLY the JSON object',
].join('\n')

/* ═══════════════════════════════════════════════════════════════════
   Generic VLM call — tries NVIDIA → OpenRouter → OpenAI → Gemini
   ═══════════════════════════════════════════════════════════════════ */

interface VLMResult {
  text: string
  model: string
}

async function callVLM(b64: string, mime: string, prompt: string): Promise<VLMResult | null> {
  const imageUrl = 'data:' + mime + ';base64,' + b64

  // Strategy 1: NVIDIA Nemotron Vision
  if (process.env.NVIDIA_API_KEY) {
    try {
      const c = new OpenAI({ baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: process.env.NVIDIA_API_KEY! })
      const r = await c.chat.completions.create({
        model: 'nvidia/nemotron-nano-12b-v2-vl',
        max_tokens: 1500, temperature: 0.2, stream: false,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: prompt },
        ]}],
      } as any)
      const t = r.choices[0]?.message?.content?.trim()
      if (t && t.length > 20) return { text: t, model: 'nvidia/nemotron-nano-12b-v2-vl' }
    } catch (e: any) { devWarn('[analyze-image] NVIDIA fail:', e.message) }
  }

  // Strategy 2: OpenRouter (Claude Sonnet vision)
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
          'X-Title': process.env.APP_NAME || 'Studio',
        },
        body: JSON.stringify({
          model: 'anthropic/claude-sonnet-4',
          max_tokens: 1500, temperature: 0.2, route: 'fallback',
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: prompt },
          ]}],
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const t = data.choices?.[0]?.message?.content?.trim()
        if (t && t.length > 20) return { text: t, model: 'openrouter/claude-sonnet' }
      }
    } catch (e: any) { devWarn('[analyze-image] OpenRouter fail:', e.message) }
  }

  // Strategy 3: OpenAI GPT-4o vision
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 1500, temperature: 0.2,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: prompt },
          ]}],
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const t = data.choices?.[0]?.message?.content?.trim()
        if (t && t.length > 20) return { text: t, model: 'openai/gpt-4o' }
      }
    } catch (e: any) { devWarn('[analyze-image] OpenAI fail:', e.message) }
  }

  // Strategy 4: Google Gemini vision
  if (process.env.GOOGLE_GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GOOGLE_GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [
              { inlineData: { mimeType: mime, data: b64 } },
              { text: prompt },
            ]}],
            generationConfig: { maxOutputTokens: 1500, temperature: 0.2 },
          }),
        }
      )
      if (res.ok) {
        const data = await res.json()
        const t = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
        if (t && t.length > 20) return { text: t, model: 'google/gemini-2.0-flash' }
      }
    } catch (e: any) { devWarn('[analyze-image] Gemini fail:', e.message) }
  }

  return null
}

/* ═══════════════════════════════════════════════════════════════════
   Handler — Two-Pass Constrained Vision Pipeline
   ═══════════════════════════════════════════════════════════════════ */

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType } = await req.json()
    if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

    // Stage 1.1: Preprocess image
    devLog('[analyze-image] Preprocessing image...')
    const img = await preprocessImage(imageBase64, mimeType || 'image/png')
    devLog('[analyze-image] Preprocessed: ' + img.width + 'x' + img.height + ' -> JPEG ' + (img.base64.length / 1024).toFixed(0) + 'KB')

    // ── Pass 1: Geometric Feature Extraction ─────────────────────
    devLog('[analyze-image] Pass 1: Geometric extraction...')
    const pass1Result = await callVLM(img.base64, img.mime, PASS1_GEOMETRIC_EXTRACTION)

    let geoAnalysis: Record<string, any> | null = null
    let pass1Model = 'unknown'

    if (pass1Result) {
      pass1Model = pass1Result.model
      geoAnalysis = parseGeoAnalysis(pass1Result.text)
      if (geoAnalysis) {
        devLog('[analyze-image] Pass 1 OK via ' + pass1Model + ': outline=' + geoAnalysis.outline + ' topology=' + geoAnalysis.topology + ' is_3d=' + geoAnalysis.is_3d_drawing)
      } else {
        devWarn('[analyze-image] Pass 1 JSON parse failed, raw:', pass1Result.text.substring(0, 200))
      }
    } else {
      devWarn('[analyze-image] Pass 1 failed — all VLM providers down')
    }

    // ── Pass 2: Constrained DIR Generation ───────────────────────
    let dir: DIR | null = null
    let pass2Model = 'unknown'

    if (geoAnalysis) {
      // Two-pass: Lock DIR to geometric analysis
      devLog('[analyze-image] Pass 2: Constrained DIR from geometric analysis...')
      const pass2Prompt = makePass2Prompt(geoAnalysis)
      const pass2Result = await callVLM(img.base64, img.mime, pass2Prompt)

      if (pass2Result) {
        pass2Model = pass2Result.model
        dir = parseDIR(pass2Result.text)
        if (dir) {
          devLog('[analyze-image] Pass 2 OK via ' + pass2Model + ': family=' + dir.family + ' conf=' + dir.confidence + ' strategy=' + (dir.construction_strategy?.substring(0, 80) || 'none'))
        } else {
          devWarn('[analyze-image] Pass 2 DIR parse failed, raw:', pass2Result.text.substring(0, 200))
        }
      }
    }

    // ── Fallback: Single-pass legacy if two-pass fails ───────────
    if (!dir) {
      devLog('[analyze-image] Falling back to single-pass DIR extraction...')
      const fallbackResult = await callVLM(img.base64, img.mime, DIR_PROMPT)
      if (fallbackResult) {
        pass2Model = fallbackResult.model
        dir = parseDIR(fallbackResult.text)
      }
    }

    if (!dir) {
      // Last resort: return raw text from Pass 1 if available
      if (pass1Result) {
        return NextResponse.json({
          description: 'Create a 3D object based on the uploaded image. ' + (pass1Result.text.substring(0, 200)),
          dir: null,
          model: pass1Model,
          pass: 'fallback-raw',
        })
      }
      return NextResponse.json({ error: 'All vision analysis attempts failed' }, { status: 500 })
    }

    // ── Convert DIR to constrained prompt ────────────────────────
    const description = dirToPrompt(dir, geoAnalysis)
    const model = pass1Model + ' + ' + pass2Model

    devLog('[analyze-image] Two-pass complete: ' + model)
    devLog('[analyze-image] Derived description length:', description.length)

    return NextResponse.json({
      description,
      dir,
      model,
      geoAnalysis, // expose for debugging in agent logs
      pass: geoAnalysis ? 'two-pass' : 'single-pass',
    })
  } catch (e: any) {
    console.error('[analyze-image] Error:', e.message)
    return NextResponse.json({ error: e.message || 'Image analysis failed' }, { status: 500 })
  }
}
