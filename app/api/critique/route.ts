import { nemotronClient, MODELS } from '@/lib/ai-clients'
import type { ScoreResult } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      scadCode,
      scores,
      prompt,
    }: {
      scadCode: string
      scores: ScoreResult
      prompt: string
    } = body

    const res = await nemotronClient.chat.completions.create({
      model: MODELS.nemotron,
      temperature: 0.3,
      max_tokens: 256,
      messages: [
        {
          role: 'system',
          content:
            'You are a 3D design critic. Give brief actionable feedback. Respond ONLY with valid JSON, no markdown: {"critique":"one clear sentence","suggestions":["action 1","action 2"]}',
        },
        {
          role: 'user',
          content: `Design prompt: "${prompt}"
Scores: overall=${scores.overall}, proportion=${scores.proportion}, symmetry=${scores.symmetry}, features=${scores.featureCount}
OpenSCAD preview:
${scadCode.slice(0, 400)}

Provide critique JSON:`,
        },
      ],
    })

    const text = res.choices[0]?.message?.content ?? ''
    const clean = text.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim()

    let result: { critique: string; suggestions: string[] }
    try {
      result = JSON.parse(clean)
    } catch {
      result = {
        critique: 'Design generated successfully.',
        suggestions: ['Consider adjusting proportions', 'Try adding more detail'],
      }
    }

    return Response.json(result)
  } catch (error) {
    return Response.json({
      critique: 'Critique unavailable.',
      suggestions: [],
    })
  }
}
