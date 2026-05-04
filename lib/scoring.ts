import type { DesignTree, ScoreResult } from '@/lib/types'

// ═══════════════════════════════════════════════════════════════════
// Studio Evaluation Agent v3.0
// Two-stage scoring: Quality (spec-agnostic) × SpecMatch (spec-conditioned)
// Overall = QualityGate × (0.7 × SpecMatch + 0.3 × Quality)
// ═══════════════════════════════════════════════════════════════════

export function scoreDesign(
  tree: DesignTree,
  prompt: string,
  geometryMetrics?: any
): ScoreResult {
  const hasMetrics = geometryMetrics && !geometryMetrics.error

  // ── Stage 1: Quality (spec-agnostic) ─────────────────────────────
  const quality = computeQuality(geometryMetrics)

  // ── Stage 2: SpecMatch (spec-conditioned) ────────────────────────
  const targetSpec = extractTargetSpec(tree, prompt)
  const specMatch = computeSpecMatch(targetSpec, tree, prompt, geometryMetrics)

  // ── Quality Gate: binary pass/fail on validity ───────────────────
  // If BREP is invalid, cap at 40%. If zero volume, cap at 30%.
  let qualityGate = 1.0
  if (hasMetrics) {
    if (!geometryMetrics.is_valid) qualityGate = 0.4
    else if (geometryMetrics.volume <= 0) qualityGate = 0.3
  }

  // ── Overall: QualityGate × (0.7 × SpecMatch + 0.3 × Quality) ───
  const rawOverall = 0.7 * specMatch.overall + 0.3 * quality.overall
  const overall = round(qualityGate * rawOverall)

  const breakdown: string[] = []
  if (hasMetrics && !geometryMetrics.is_valid)
    breakdown.push('BREP topology invalid — QualityGate applied (×0.4)')
  if (hasMetrics && geometryMetrics.volume <= 0)
    breakdown.push('Zero volume — degenerate geometry (×0.3)')
  if (quality.overall < 0.6)
    breakdown.push('Quality: ' + quality.issues.join('; '))
  if (specMatch.overall < 0.6)
    breakdown.push('SpecMatch: ' + specMatch.issues.join('; '))

  // Map to the ScoreResult interface
  // proportion = SpecMatch.proportions, symmetry = SpecMatch.symmetry
  // featureCount = SpecMatch.features, parameterRange = Quality.overall
  return {
    overall,
    proportion: round(specMatch.proportions),
    symmetry: round(specMatch.symmetry),
    featureCount: round(specMatch.features),
    parameterRange: round(quality.overall),
    breakdown,
  }
}

// ═══════════════════════════════════════════════════════════════════
// STAGE 1: QUALITY (spec-agnostic)
// Asks: "Is this a valid, well-formed 3D solid?" regardless of intent
// ═══════════════════════════════════════════════════════════════════

interface QualityResult {
  overall: number
  validity: number
  manifold: number
  componentCount: number
  slenderness: number
  complexityBudget: number
  issues: string[]
}

function computeQuality(metrics: any): QualityResult {
  const issues: string[] = []

  if (!metrics || metrics.error) {
    return { overall: 0.65, validity: 0.65, manifold: 0.65, componentCount: 0.8, slenderness: 0.7, complexityBudget: 0.7, issues: ['No BREP metrics — using defaults'] }
  }

  // ── 1. Validity (BRepCheck_Analyzer) ─────────────────────────────
  const validity = metrics.is_valid ? 1.0 : 0.0
  if (!metrics.is_valid) issues.push('BRepCheck failed')

  // ── 2. Manifold/Solid check ──────────────────────────────────────
  // A proper solid has volume > 0 and surface_area > 0
  // face_count should be >= 4 (minimum tetrahedron)
  let manifold = 1.0
  if (metrics.volume <= 0) { manifold = 0.0; issues.push('Zero volume') }
  else if (metrics.surface_area <= 0) { manifold = 0.2; issues.push('Zero surface area') }
  else if (metrics.face_count < 4) { manifold = 0.3; issues.push('Too few faces for a solid') }

  // ── 3. Component count ───────────────────────────────────────────
  // Ideally 1 connected solid. Euler: V - E + F = 2 for genus-0
  // We approximate: if vertex_count and face_count are reasonable
  let componentCount = 1.0
  const eulerChar = (metrics.vertex_count || 0) - (metrics.edge_count || 0) + (metrics.face_count || 0)
  if (eulerChar === 2) componentCount = 1.0  // single genus-0 solid
  else if (eulerChar > 2) { componentCount = 0.7; issues.push('Multiple components detected (Euler=' + eulerChar + ')') }
  else if (eulerChar < 2) { componentCount = 0.8 } // genus > 0 (has holes/tunnels) — acceptable

  // ── 4. Slenderness/Compactness sanity ────────────────────────────
  // Extreme aspect ratios indicate degenerate geometry
  const aspectRatio = metrics.aspect_ratio || 1.0
  let slenderness = 1.0
  if (aspectRatio > 100) { slenderness = 0.2; issues.push('Extreme slenderness: aspect ratio ' + aspectRatio) }
  else if (aspectRatio > 50) { slenderness = 0.4; issues.push('Very high aspect ratio: ' + aspectRatio) }
  else if (aspectRatio > 20) { slenderness = 0.7 }

  // Compactness: sphere=1.0, degenerate→0
  const compactness = metrics.compactness || 0
  if (compactness < 0.01 && metrics.volume > 0) { slenderness = Math.min(slenderness, 0.5); issues.push('Very low compactness') }

  // ── 5. Complexity budget ─────────────────────────────────────────
  // Too many faces = over-tessellated or boolean explosion
  // Too few faces = oversimplified
  let complexityBudget = 1.0
  const fc = metrics.face_count || 0
  if (fc > 500) { complexityBudget = 0.6; issues.push('High face count: ' + fc + ' (possible boolean explosion)') }
  else if (fc > 200) { complexityBudget = 0.8 }
  else if (fc < 4 && metrics.volume > 0) { complexityBudget = 0.4; issues.push('Too few faces: ' + fc) }

  const overall = round(
    validity * 0.30 +
    manifold * 0.25 +
    componentCount * 0.15 +
    slenderness * 0.15 +
    complexityBudget * 0.15
  )

  return { overall, validity, manifold, componentCount, slenderness, complexityBudget, issues }
}

// ═══════════════════════════════════════════════════════════════════
// TARGET SPEC EXTRACTION
// Parses the prompt + tree into a structured specification
// ═══════════════════════════════════════════════════════════════════

interface TargetSpec {
  // Dimension targets (from prompt or tree params)
  targetDims: Record<string, number>  // e.g. { height: 200, diameter: 60 }
  targetRatios: Record<string, number> // e.g. { height_width: 3.3 }

  // Symmetry target
  wantsSymmetry: boolean
  symmetryConfidence: number // 0-1, how strongly symmetry is implied

  // Feature targets
  targetFeatures: string[] // e.g. ['ribs', 'bore', 'teeth']
  featureCounts: Record<string, number> // e.g. { ribs: 12, teeth: 20 }
  textureHint: 'ribbed' | 'smooth' | 'patterned' | 'unknown'

  // Parameter targets
  paramTargets: Record<string, { value: number; min?: number; max?: number; locked?: boolean }>
}

function extractTargetSpec(tree: DesignTree, prompt: string): TargetSpec {
  const lower = prompt.toLowerCase()

  // ── Extract dimension targets from prompt ────────────────────────
  const targetDims: Record<string, number> = {}
  const dimPatterns = [
    { regex: /(\d+\.?\d*)\s*mm\s*(?:height|tall|high)/i, key: 'height' },
    { regex: /height\s*(?:of|:)?\s*(\d+\.?\d*)\s*mm/i, key: 'height' },
    { regex: /(\d+\.?\d*)\s*mm\s*(?:width|wide)/i, key: 'width' },
    { regex: /width\s*(?:of|:)?\s*(\d+\.?\d*)\s*mm/i, key: 'width' },
    { regex: /(\d+\.?\d*)\s*mm\s*(?:diameter|dia)/i, key: 'diameter' },
    { regex: /diameter\s*(?:of|:)?\s*(\d+\.?\d*)\s*mm/i, key: 'diameter' },
    { regex: /(\d+\.?\d*)\s*mm\s*(?:thick|thickness)/i, key: 'thickness' },
    { regex: /thickness\s*(?:of|:)?\s*(\d+\.?\d*)\s*mm/i, key: 'thickness' },
    { regex: /(\d+\.?\d*)\s*mm\s*(?:depth|deep)/i, key: 'depth' },
    { regex: /(\d+\.?\d*)\s*mm\s*(?:bore|hole)/i, key: 'bore_diameter' },
  ]
  for (const p of dimPatterns) {
    const m = prompt.match(p.regex)
    if (m) targetDims[p.key] = parseFloat(m[1])
  }

  // Also extract from tree parameters
  for (const param of Object.values(tree.parameters)) {
    if (param.unit === 'mm' || param.unit === 'count') {
      targetDims[param.key] = param.value
    }
  }

  // ── Compute target ratios ────────────────────────────────────────
  const targetRatios: Record<string, number> = {}
  const h = targetDims.height || targetDims.thickness || targetDims.depth
  const w = targetDims.width || targetDims.diameter
  if (h && w && w > 0) targetRatios['height_width'] = h / w

  // ── Symmetry target ──────────────────────────────────────────────
  const symmetryWords = ['symmetric', 'symmetrical', 'centered', 'balanced', 'uniform', 'round', 'circular', 'cylindrical', 'radial']
  const implicitSymmetry = ['gear', 'vase', 'bottle', 'cylinder', 'sphere', 'torus', 'wheel', 'disc', 'ring', 'flange', 'bearing']
  const explicitSymmetry = symmetryWords.some(w => lower.includes(w))
  const impliedSymmetry = implicitSymmetry.some(w => lower.includes(w))
  const wantsSymmetry = explicitSymmetry || impliedSymmetry
  const symmetryConfidence = explicitSymmetry ? 0.95 : impliedSymmetry ? 0.75 : 0.3

  // ── Feature targets ──────────────────────────────────────────────
  const targetFeatures: string[] = []
  const featureCounts: Record<string, number> = {}

  const featurePatterns: Array<{ regex: RegExp; name: string; countGroup?: number }> = [
    { regex: /(\d+)\s*(?:vertical\s+)?ribs?/i, name: 'ribs', countGroup: 1 },
    { regex: /ribs?\s*(?:count)?\s*(\d+)/i, name: 'ribs', countGroup: 1 },
    { regex: /(\d+)\s*teeth/i, name: 'teeth', countGroup: 1 },
    { regex: /teeth\s*(\d+)/i, name: 'teeth', countGroup: 1 },
    { regex: /(\d+)\s*(?:mounting\s+)?holes?/i, name: 'holes', countGroup: 1 },
    { regex: /holes?\s*(\d+)/i, name: 'holes', countGroup: 1 },
    { regex: /\bbore\b/i, name: 'bore' },
    { regex: /\bfillet/i, name: 'fillet' },
    { regex: /\bchamfer/i, name: 'chamfer' },
    { regex: /\bslots?\b/i, name: 'slots' },
    { regex: /\bventilation/i, name: 'slots' },
    { regex: /\bcutout/i, name: 'cutout' },
    { regex: /\bpattern/i, name: 'pattern' },
  ]

  for (const fp of featurePatterns) {
    const m = prompt.match(fp.regex)
    if (m) {
      if (!targetFeatures.includes(fp.name)) targetFeatures.push(fp.name)
      if (fp.countGroup && m[fp.countGroup]) {
        featureCounts[fp.name] = parseInt(m[fp.countGroup])
      }
    }
  }

  // Also check tree params for counts
  for (const param of Object.values(tree.parameters)) {
    if (/rib|teeth|tooth|hole|segment/i.test(param.key) && param.unit === 'count') {
      const name = /rib/i.test(param.key) ? 'ribs' : /teeth|tooth/i.test(param.key) ? 'teeth' : /hole/i.test(param.key) ? 'holes' : 'segments'
      featureCounts[name] = param.value
      if (!targetFeatures.includes(name)) targetFeatures.push(name)
    }
  }

  // Texture hint
  let textureHint: 'ribbed' | 'smooth' | 'patterned' | 'unknown' = 'unknown'
  if (targetFeatures.includes('ribs') || lower.includes('ribbed') || lower.includes('groov')) textureHint = 'ribbed'
  else if (lower.includes('smooth') || lower.includes('plain')) textureHint = 'smooth'
  else if (targetFeatures.includes('pattern') || lower.includes('repeating')) textureHint = 'patterned'

  // Parameter targets from tree
  const paramTargets: Record<string, { value: number; min?: number; max?: number; locked?: boolean }> = {}
  for (const param of Object.values(tree.parameters)) {
    paramTargets[param.key] = { value: param.value, min: param.min, max: param.max, locked: param.locked }
  }

  return { targetDims, targetRatios, wantsSymmetry, symmetryConfidence, targetFeatures, featureCounts, textureHint, paramTargets }
}

// ═══════════════════════════════════════════════════════════════════
// STAGE 2: SPECMATCH (spec-conditioned)
// Asks: "Does the output match what the user specified?"
// ═══════════════════════════════════════════════════════════════════

interface SpecMatchResult {
  overall: number
  proportions: number
  symmetry: number
  features: number
  paramBounds: number
  issues: string[]
}

function computeSpecMatch(spec: TargetSpec, tree: DesignTree, prompt: string, metrics: any): SpecMatchResult {
  const hasMetrics = metrics && !metrics.error
  const issues: string[] = []

  // ── 1. Proportions to target ─────────────────────────────────────
  let proportions = 0.75 // default when no comparison possible

  if (hasMetrics && metrics.dimensions) {
    const dims = metrics.dimensions as number[]
    const sorted = [...dims].filter(d => d > 0.001).sort((a, b) => b - a)

    if (spec.targetRatios.height_width && sorted.length >= 2) {
      const actualRatio = sorted[0] / sorted[1]
      const targetRatio = spec.targetRatios.height_width

      // Gaussian similarity in log space (ratios are multiplicative)
      const logDev = Math.abs(Math.log(actualRatio) - Math.log(targetRatio))
      proportions = Math.exp(-3 * logDev * logDev)
      if (proportions < 0.5) issues.push('Ratio mismatch: actual=' + actualRatio.toFixed(2) + ' target=' + targetRatio.toFixed(2))
    } else if (sorted.length >= 2) {
      // No target ratio from spec, use design-type heuristics
      const ratio = sorted[0] / sorted[1]
      const lower = prompt.toLowerCase()
      let idealMin = 0.1, idealMax = 6.0
      if (/gear|disc|plate|washer|flange/.test(lower)) { idealMin = 0.05; idealMax = 1.5 }
      if (/vase|bottle|column|tower/.test(lower)) { idealMin = 1.5; idealMax = 8.0 }
      if (/bracket|mount|frame/.test(lower)) { idealMin = 0.3; idealMax = 4.0 }
      proportions = (ratio >= idealMin && ratio <= idealMax) ? 1.0 : Math.max(0.3, Math.exp(-2 * Math.pow(Math.log(ratio / (ratio < idealMin ? idealMin : idealMax)), 2)))
    }
  } else {
    // Fallback: tree-only proportion check
    proportions = treeProportionFallback(tree)
  }

  // ── 2. Symmetry to target ────────────────────────────────────────
  let symmetry = 0.7 // default

  if (hasMetrics) {
    const hint = metrics.symmetry_hint ?? 0.5
    const compactness = metrics.compactness ?? 0
    const faceTypes = metrics.face_types || {}
    const hasRadial = (faceTypes['CYLINDER'] || 0) + (faceTypes['SPHERE'] || 0) + (faceTypes['CONE'] || 0) + (faceTypes['TORUS'] || 0) > 0

    // Compute actual symmetry score from geometry
    let geoSymmetry = 0.4
    if (hasRadial) geoSymmetry += 0.25
    if (hint > 0.9) geoSymmetry += 0.2
    else if (hint > 0.7) geoSymmetry += 0.1
    if (compactness > 0.5) geoSymmetry += 0.1
    geoSymmetry = Math.min(1.0, geoSymmetry)

    if (spec.wantsSymmetry) {
      // Spec requires symmetry: score = how symmetric the result actually is
      // Weighted by confidence in the symmetry requirement
      symmetry = geoSymmetry * spec.symmetryConfidence + (1 - spec.symmetryConfidence) * 0.7
      if (geoSymmetry < 0.5 && spec.symmetryConfidence > 0.7) {
        issues.push('Symmetry required but geometry is asymmetric (hint=' + hint.toFixed(2) + ')')
      }
    } else {
      // No symmetry required: any symmetry is fine, slight bonus for being symmetric
      symmetry = 0.7 + geoSymmetry * 0.3
    }
  } else {
    // Fallback: tree analysis
    const nodeOps = Object.values(tree.nodes).map(n => n.op)
    const hasRadial = nodeOps.some(op => ['cylinder', 'sphere', 'torus', 'cone'].includes(op))
    if (spec.wantsSymmetry && hasRadial) symmetry = 0.95
    else if (spec.wantsSymmetry && !hasRadial) symmetry = 0.4
    else if (hasRadial) symmetry = 0.85
  }

  // ── 3. Features to target ────────────────────────────────────────
  let features = 0.7 // default

  if (spec.targetFeatures.length > 0) {
    let matched = 0
    let total = spec.targetFeatures.length

    if (hasMetrics) {
      const faceTypes = metrics.face_types || {}
      const edgeTypes = metrics.edge_types || {}
      const fc = metrics.face_count || 0

      for (const feat of spec.targetFeatures) {
        switch (feat) {
          case 'holes':
          case 'bore':
            // Holes create cylindrical faces (min 2 per through-hole)
            if ((faceTypes['CYLINDER'] || 0) >= 2) matched++
            else issues.push('Expected ' + feat + ' but no cylindrical faces found')
            break
          case 'ribs':
            // Ribs increase face count and create periodic planar faces
            // "Ribbed" = many PLANE faces relative to other types
            if (fc > 20 && (faceTypes['PLANE'] || 0) > 10) matched++
            else if (spec.textureHint === 'ribbed' && fc > 15) matched++
            else issues.push('Expected ribs but low face complexity (faces=' + fc + ')')
            break
          case 'teeth':
            // Teeth create many faces with periodic structure
            if (fc > 30) matched++
            else issues.push('Expected teeth but face count low (faces=' + fc + ')')
            break
          case 'fillet':
            // Fillets create TORUS or BSPLINE faces
            if ((faceTypes['TORUS'] || 0) > 0 || (faceTypes['BSPLINE'] || 0) > 0) matched++
            else if ((edgeTypes['CIRCLE'] || 0) > 0) matched += 0.5
            else issues.push('Expected fillets but no curved transition faces')
            break
          case 'chamfer':
            // Chamfers create additional PLANE faces at angles
            if ((faceTypes['PLANE'] || 0) > 8) matched++
            else matched += 0.5 // hard to detect, give partial credit
            break
          case 'slots':
          case 'cutout':
            // Slots/cutouts increase face count via boolean subtraction
            if (fc > 12) matched++
            else issues.push('Expected ' + feat + ' but geometry too simple')
            break
          case 'pattern':
            // Patterns = high face count with periodic structure
            if (fc > 20) matched++
            else issues.push('Expected pattern but face count low')
            break
          default:
            matched += 0.5 // unknown feature, give partial credit
        }
      }

      features = total > 0 ? Math.min(1.0, matched / total) : 0.7

      // Bonus for feature count params matching
      for (const [name, targetCount] of Object.entries(spec.featureCounts)) {
        const treeParam = Object.values(tree.parameters).find(p =>
          p.key.toLowerCase().includes(name.substring(0, 4))
        )
        if (treeParam && Math.abs(treeParam.value - targetCount) < 2) {
          features = Math.min(1.0, features + 0.05)
        }
      }

    } else {
      // Fallback: tree node count vs prompt complexity
      const nodeCount = Object.keys(tree.nodes).length
      if (total <= 2 && nodeCount >= 3) features = 0.9
      else if (total <= 2 && nodeCount >= 2) features = 0.8
      else if (total > 2 && nodeCount >= 5) features = 0.9
      else if (total > 2 && nodeCount >= 3) features = 0.7
      else features = 0.5
    }
  } else {
    // No specific features requested — score by general complexity
    if (hasMetrics) {
      const fc = metrics.face_count || 0
      const typeVariety = Object.keys(metrics.face_types || {}).length
      features = Math.min(1.0, 0.5 + Math.log2(Math.max(fc, 1)) / 12 + typeVariety * 0.05)
    } else {
      const nodeCount = Object.keys(tree.nodes).length
      features = nodeCount >= 3 ? 0.85 : nodeCount >= 2 ? 0.7 : 0.5
    }
  }

  // ── 4. Parameter bounds/locks to target ──────────────────────────
  let paramBounds = 0.8 // default
  const params = Object.values(spec.paramTargets)
  if (params.length > 0) {
    let inBounds = 0
    let total = 0
    for (const p of params) {
      total++
      const withinMin = p.min === undefined || p.value >= p.min
      const withinMax = p.max === undefined || p.value <= p.max
      if (withinMin && withinMax) inBounds++
    }
    const boundsRatio = total > 0 ? inBounds / total : 1.0
    const richness = Math.min(params.length / 5, 1.0)
    paramBounds = boundsRatio * 0.75 + richness * 0.25
  }

  const overall = round(
    proportions * 0.30 +
    symmetry * 0.20 +
    features * 0.30 +
    paramBounds * 0.20
  )

  return { overall, proportions, symmetry, features, paramBounds, issues }
}

// ─── Tree-only proportion fallback ────────────────────────────────

function treeProportionFallback(tree: DesignTree): number {
  const params = tree.parameters
  const keys = Object.keys(params)
  const hk = keys.find(k => /height|thickness|tall|depth|z_axis/i.test(k))
  const wk = keys.find(k => /width|diameter|radius|size|length|outer|pitch/i.test(k))
  if (!hk || !wk) return 0.75
  const h = params[hk].value
  const w = params[wk].value
  if (w === 0 || h === 0) return 0.6
  const ratio = h / w
  if (ratio >= 0.1 && ratio <= 6.0) return 1.0
  return Math.max(0.3, Math.exp(-2 * Math.pow(Math.log(ratio < 0.1 ? 0.1 / ratio : ratio / 6.0), 2)))
}

// ─── Helpers ──────────────────────────────────────────────────────

function round(n: number): number { return Math.round(n * 100) / 100 }

// ─── Display Utilities ────────────────────────────────────────────

export function getScoreColor(score: number): string {
  if (score >= 0.85) return 'text-green-400'
  if (score >= 0.65) return 'text-yellow-400'
  return 'text-red-400'
}

export function getScoreLabel(score: number): string {
  if (score >= 0.85) return 'Excellent'
  if (score >= 0.70) return 'Good'
  if (score >= 0.50) return 'Fair'
  return 'Poor'
}

export function getScoreBgColor(score: number): string {
  if (score >= 0.85) return 'bg-green-400/10 border-green-400/30'
  if (score >= 0.65) return 'bg-yellow-400/10 border-yellow-400/30'
  return 'bg-red-400/10 border-red-400/30'
}
