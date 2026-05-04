// Design Intent Representation (DIR) — structured intermediate format
// between image analysis and the parametric text pipeline

export interface DIRFeature {
  type: string
  likelihood: number
  count_estimate?: number
  direction?: string
}

export interface DesignIntentRepresentation {
  family: 'revolve_profile' | 'extrude_profile' | 'boxy_enclosure' | 'cylindrical_part' | 'panel_pattern' | 'gear_mechanism' | 'bracket_mount' | 'unknown'
  confidence: number
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
  }
}

/**
 * Convert a DIR JSON into a deterministic prompt for the parametric pipeline.
 * No LLM needed — pure template logic.
 */
export function dirToPrompt(dir: DesignIntentRepresentation): string {
  const parts: string[] = []

  // Family mapping to natural language
  const familyNames: Record<string, string> = {
    revolve_profile: 'revolved profile shape (like a vase or bottle)',
    extrude_profile: 'extruded profile shape (like a plate or bracket)',
    boxy_enclosure: 'rectangular enclosure box',
    cylindrical_part: 'cylindrical part',
    panel_pattern: 'flat panel with pattern',
    gear_mechanism: 'gear mechanism',
    bracket_mount: 'mounting bracket',
    unknown: '3D object',
  }

  parts.push(`Create a ${familyNames[dir.family] || dir.family}.`)

  // Dimensions from size hints
  const hints = dir.constraints_suggestions.size_hint_mm
  if (hints.height) parts.push(`Target height: ${hints.height}mm.`)
  if (hints.width) parts.push(`Target width: ${hints.width}mm.`)
  if (hints.diameter) parts.push(`Target diameter: ${hints.diameter}mm.`)
  if (hints.thickness) parts.push(`Thickness: ${hints.thickness}mm.`)

  // Proportions
  if (dir.global.height_width_ratio > 0) {
    parts.push(`Height-to-width ratio approximately ${dir.global.height_width_ratio.toFixed(1)}.`)
  }

  // Symmetry
  if (dir.global.symmetry.score > 0.7) {
    if (dir.global.symmetry.type.includes('radial') || dir.global.symmetry.type.includes('rotational')) {
      parts.push('Radially symmetric around the central axis.')
    } else {
      parts.push('Mirror symmetry should be high.')
    }
  }

  // Shape characteristics
  if (dir.shape.taper_ratio < 0.8 && dir.shape.taper_ratio > 0) {
    parts.push(`Tapers toward the top with taper ratio ~${dir.shape.taper_ratio.toFixed(2)}.`)
  }

  if (dir.shape.hollow_likelihood > 0.5) {
    parts.push('The object appears hollow — include wall thickness and interior cavity.')
  }

  if (dir.shape.roundness > 0.7) {
    parts.push('Predominantly round/circular cross-section.')
  } else if (dir.shape.rectangularity > 0.7) {
    parts.push('Predominantly rectangular/boxy cross-section.')
  }

  // Features
  for (const feat of dir.features) {
    if (feat.likelihood < 0.4) continue

    switch (feat.type) {
      case 'ribs':
        parts.push(`Add ${feat.count_estimate ?? 'several'} ${feat.direction ?? 'vertical'} ribs evenly spaced around the circumference.`)
        break
      case 'teeth':
        parts.push(`Include ${feat.count_estimate ?? 20} gear teeth evenly distributed around the circumference.`)
        break
      case 'holes':
        parts.push(`Add ${feat.count_estimate ?? 4} mounting holes.`)
        break
      case 'bore':
        parts.push('Include a center bore hole.')
        break
      case 'fillet':
        parts.push('Apply fillets to edges for smooth transitions.')
        break
      case 'chamfer':
        parts.push('Apply chamfers to exposed edges.')
        break
      case 'slots':
        parts.push(`Include ${feat.count_estimate ?? 'ventilation'} slots.`)
        break
      case 'pattern':
        parts.push(`Add a repeating ${feat.direction ?? 'surface'} pattern with ~${feat.count_estimate ?? 'multiple'} elements.`)
        break
      default:
        parts.push(`Include ${feat.type} feature.`)
    }
  }

  // Preferred axis
  if (dir.constraints_suggestions.prefer_symmetry_axis) {
    parts.push(`Prefer ${dir.constraints_suggestions.prefer_symmetry_axis}-axis as the primary symmetry axis.`)
  }

  // Detail level guidance
  if (dir.global.detail_level > 0.7) {
    parts.push('The model should be detailed with precise geometry.')
  } else if (dir.global.detail_level < 0.3) {
    parts.push('Keep the geometry simple and clean.')
  }

  return parts.join(' ')
}

/**
 * Parse DIR JSON from VLM output — handles markdown wrapping and partial JSON
 */
export function parseDIR(text: string): DesignIntentRepresentation | null {
  try {
    // Strip markdown code fences if present
    const cleaned = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    const parsed = JSON.parse(cleaned)

    // Validate minimum required fields
    if (!parsed.family || !parsed.global) return null

    return parsed as DesignIntentRepresentation
  } catch {
    return null
  }
}
