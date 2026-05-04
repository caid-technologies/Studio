import { NextRequest, NextResponse } from 'next/server'
import { nimVisionChat } from '@/lib/llm-clients'

/**
 * Analyze sketches, photos, or reference images and extract parametric design specifications
 * Uses NVIDIA Nemotron 12B VL (vision-language) with structured output
 */

const SKETCH_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    detected_shape: {
      type: 'string',
      enum: ['cylinder', 'box', 'sphere', 'cone', 'gear', 'bracket', 'enclosure', 'custom'],
      description: 'Primary geometric shape detected',
    },
    estimated_dimensions: {
      type: 'object',
      properties: {
        primary_dim: {
          type: 'number',
          description: 'Main horizontal/length dimension in relative units',
        },
        secondary_dim: {
          type: 'number',
          description: 'Vertical/height dimension in relative units',
        },
        tertiary_dim: {
          type: 'number',
          description: 'Depth/width dimension in relative units',
        },
      },
    },
    features: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Feature name (e.g., hole, boss, pocket)' },
          count: { type: 'integer', description: 'Number of this feature' },
          relative_size: { type: 'number', description: 'Size relative to main dimension (0-1)' },
        },
      },
    },
    symmetry: {
      type: 'string',
      enum: ['none', 'bilateral', 'radial', 'full'],
    },
    surface_finish: {
      type: 'string',
      enum: ['rough', 'smooth', 'textured', 'precision'],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Confidence in the analysis (0-1)',
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Observations and uncertainties',
    },
  },
  required: ['detected_shape', 'confidence'],
  additionalProperties: false,
}

interface SketchAnalysisRequest {
  imageUrl?: string // URL to image
  imageBase64?: string // Base64-encoded image data
  mimeType?: string // 'image/jpeg', 'image/png', 'image/webp'
  context?: string // Optional description to guide analysis
}

export async function POST(req: NextRequest) {
  try {
    const { imageUrl, imageBase64, mimeType = 'image/jpeg', context }: SketchAnalysisRequest =
      await req.json()

    if (!imageUrl && !imageBase64) {
      return NextResponse.json({ error: 'Missing image (URL or base64)' }, { status: 400 })
    }

    console.log('[sketch-analysis] Analyzing image with Nemotron 12B VL')

    // Build content array with image and text
    const contentArray: any[] = []

    // Add image
    if (imageUrl) {
      contentArray.push({
        type: 'image_url',
        image_url: { url: imageUrl },
      })
    } else if (imageBase64) {
      contentArray.push({
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${imageBase64}`,
        },
      })
    }

    // Add text prompt
    contentArray.push({
      type: 'text',
      text: `Analyze this sketch, drawing, or reference image and extract parametric design specifications.

${context ? `Context: ${context}\n\n` : ''}

Identify:
1. The primary geometric shape
2. Estimated proportions (relative dimensions)
3. Detected features (holes, bosses, pockets, ribs, etc.)
4. Symmetry type
5. Surface finish quality
6. Confidence level

Use relative units (if the main dimension is 1.0, express others as fractions).
If unsure about any measurement, note it in the observations.`,
    })

    const response = await nimVisionChat(
      [
        {
          role: 'system',
          content:
            'You are an expert at analyzing sketches and extracting parametric design specifications for 3D modeling.',
        },
        {
          role: 'user',
          content: contentArray,
        },
      ],
      {
        maxTokens: 1024,
        temperature: 0.4,
        guidedJson: SKETCH_ANALYSIS_SCHEMA,
      }
    )

    const textContent = response.choices?.[0]?.message?.content
    if (!textContent) {
      return NextResponse.json({ error: 'No response from vision model' }, { status: 500 })
    }

    let analysis
    try {
      analysis = JSON.parse(textContent)
    } catch {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return NextResponse.json(
          { error: 'Failed to parse vision model response', raw: textContent },
          { status: 422 }
        )
      }
      analysis = JSON.parse(jsonMatch[0])
    }

    console.log('[sketch-analysis] Analysis complete, confidence:', analysis.confidence)

    return NextResponse.json({
      analysis,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[sketch-analysis] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
