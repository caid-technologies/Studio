import { NextRequest, NextResponse } from 'next/server'
import { nimChat } from '@/lib/llm-clients'
import { devLog } from '@/lib/logger'

/**
 * Parse natural language intent into structured parametric design specification
 * Uses NVIDIA NIM Nemotron with guided_json for guaranteed structured output
 */

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'modify', 'refine', 'combine', 'transform'],
      description: 'What the user wants to do',
    },
    primary_shape: {
      type: 'string',
      enum: ['box', 'sphere', 'cylinder', 'cone', 'torus', 'gear', 'bracket', 'enclosure', 'custom'],
      description: 'The main 3D object type',
    },
    parameters: {
      type: 'object',
      properties: {
        dimension_primary: {
          type: 'number',
          description: 'Main dimension (height, diameter, length) in mm',
        },
        dimension_secondary: {
          type: 'number',
          description: 'Secondary dimension in mm',
        },
        dimension_tertiary: {
          type: 'number',
          description: 'Tertiary dimension in mm',
        },
        tooth_count: {
          type: 'integer',
          description: 'For gears: number of teeth',
        },
        module: {
          type: 'number',
          description: 'For gears: tooth module in mm',
        },
        hole_count: {
          type: 'integer',
          description: 'For brackets/enclosures: number of mounting holes',
        },
        wall_thickness: {
          type: 'number',
          description: 'For hollow objects: wall thickness in mm',
        },
        bevel_radius: {
          type: 'number',
          description: 'For chamfered/filleted edges: radius in mm',
        },
        symmetry: {
          type: 'string',
          enum: ['none', 'bilateral', 'radial', 'full'],
          description: 'Symmetry type',
        },
      },
      additionalProperties: false,
    },
    constraints: {
      type: 'object',
      properties: {
        material: {
          type: 'string',
          description: 'Intended material (e.g., plastic, aluminum, steel)',
        },
        precision: {
          type: 'string',
          enum: ['rough', 'standard', 'tight', 'ultra-precise'],
        },
        aesthetic: {
          type: 'string',
          enum: ['minimalist', 'organic', 'industrial', 'elegant'],
        },
      },
      additionalProperties: false,
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Parser confidence in the interpretation (0-1)',
    },
    clarification_needed: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ambiguities or missing info to clarify',
    },
  },
  required: ['action', 'primary_shape', 'parameters', 'confidence'],
  additionalProperties: false,
}

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json()

    if (!prompt || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Empty prompt' }, { status: 400 })
    }

    devLog('[parse-intent] Input prompt length:', prompt.length)

    // Call NIM with structured output constraint
    const response = await nimChat(
      [
        {
          role: 'system',
          content: `You are a 3D parametric design intent parser. Convert natural language descriptions into structured parametric specifications for OpenSCAD generation.

Guidelines:
1. Extract geometric parameters (dimensions, counts, angles)
2. Infer reasonable defaults (units are always mm)
3. Identify the primary geometric primitive
4. Mark ambiguities that need clarification
5. Set confidence score based on how clearly the intent is specified

For example:
- Input: "Create a spur gear with 20 teeth, 2mm module, 5mm thick, 5mm bore"
- Output: Action=create, shape=gear, params={tooth_count: 20, module: 2, wall_thickness: 5, dimension_tertiary: 5}

Be precise. Extract numbers exactly as stated. If a dimension is implied (e.g., "square box" means all sides equal), apply it consistently.`,
        },
        {
          role: 'user',
          content: `Parse this design intent: "${prompt}"`,
        },
      ],
      {
        model: 'nvidia/nvidia-nemotron-nano-9b-v2',
        temperature: 0.1, // Low temp for precise parsing
        maxTokens: 1024,
        minThinkingTokens: 512,
        maxThinkingTokens: 2048, // Let Nemotron reason about the intent
        guidedJson: INTENT_SCHEMA,
      }
    )

    const textContent = response.choices?.[0]?.message?.content
    if (!textContent) {
      return NextResponse.json(
        { error: 'No response from NIM' },
        { status: 500 }
      )
    }

    let parsedIntent
    try {
      parsedIntent = JSON.parse(textContent)
    } catch {
      // If direct parse fails, try to extract JSON
      const jsonMatch = textContent.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return NextResponse.json(
          { error: 'Failed to parse NIM response', raw: textContent },
          { status: 422 }
        )
      }
      parsedIntent = JSON.parse(jsonMatch[0])
    }

    devLog('[parse-intent] Parsed intent:', JSON.stringify(parsedIntent, null, 2))

    return NextResponse.json({
      intent: parsedIntent,
      thinking: response.choices?.[0]?.message?.reasoning, // If available
    })
  } catch (error) {
    console.error('[parse-intent] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
