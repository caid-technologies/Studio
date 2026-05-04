import { resilientChat } from '@/lib/llm-clients'
import { scoreDesign } from '@/lib/scoring'
import type { DesignTree, EditScript, ScoreResult } from '@/lib/types'

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function stripMarkdown(text: string): string {
  return text.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim()
}

function parseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(stripMarkdown(text)) as T
  } catch {
    return fallback
  }
}

function applyEditScript(
  tree: DesignTree,
  script: EditScript,
  constraints: Record<string, { locked: boolean }>
): DesignTree {
  const updated: DesignTree = {
    ...tree,
    parameters: { ...tree.parameters },
    nodes: { ...tree.nodes },
  }

  for (const edit of script.edits) {
    if (edit.type !== 'SET_PARAM') continue
    if (!edit.key) continue
    if (constraints[edit.key]?.locked) continue
    if (!updated.parameters[edit.key]) continue

    updated.parameters[edit.key] = {
      ...updated.parameters[edit.key],
      value: typeof edit.value === 'number'
        ? edit.value
        : parseFloat(String(edit.value)) || updated.parameters[edit.key].value,
    }
  }

  return updated
}

export async function POST(request: Request) {
  const body = await request.json()
  const {
    tree,
    scores,
    prompt,
    constraints = {},
    iteration,
  }: {
    tree: DesignTree
    scores: ScoreResult
    prompt: string
    constraints: Record<string, { locked: boolean }>
    iteration: number
  } = body

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(new TextEncoder().encode(sseEvent(data)))
      }

      try {

        // ── CLAUDE PLANNER ────────────────────────────────────
        emit({ type: 'phase', phase: 'iterating', iteration })
        emit({
          type: 'agent_log',
          agent: 'Tree Logic',
          message: `Iteration ${iteration}: analyzing scores and planning improvements...`,
        })

        const lockedParams = Object.entries(constraints)
          .filter(([, v]) => v.locked)
          .map(([k]) => k)

        const currentValues = Object.fromEntries(
          Object.entries(tree.parameters).map(([k, v]) => [k, v.value])
        )

        const { text: plannerText, provider: plannerProvider } = await resilientChat(
          [
            {
              role: 'system',
              content: `You are a parametric design optimizer. Propose minimal targeted edits to improve the design score.

Output ONLY this JSON (no markdown, no explanation):
{
  "iteration": 1,
  "edits": [
    {
      "type": "SET_PARAM",
      "key": "parameter_key",
      "value": 220,
      "justification": "brief reason why this improves the score"
    }
  ],
  "why": ["overall reason for these changes"]
}

Rules:
- Propose 1 to 3 edits maximum
- Only use SET_PARAM type
- NEVER modify locked parameters
- Reference specific score values in justifications
- If proportion score is low, adjust height or width parameters
- If symmetry score is low and prompt wants symmetry, add count or pattern parameters
- If feature count is low, note it but do not add nodes (only SET_PARAM allowed)`,
            },
            {
              role: 'user',
              content: `Iteration: ${iteration}
Original prompt: "${prompt}"

Current scores:
- Overall: ${scores.overall}
- Proportion: ${scores.proportion}
- Symmetry: ${scores.symmetry}
- Feature Count: ${scores.featureCount}
- Parameter Range: ${scores.parameterRange}
${scores.breakdown.length > 0 ? `Failures: ${scores.breakdown.join(', ')}` : ''}

Locked parameters (do NOT modify): ${lockedParams.length > 0 ? lockedParams.join(', ') : 'none'}

Current parameter values: ${JSON.stringify(currentValues)}

Propose edits to improve the overall score from ${scores.overall}:`,
            },
          ],
          { maxTokens: 800, purpose: 'iteration-planning' }
        )

        emit({
          type: 'agent_log',
          agent: 'Tree Logic',
          message: `Planner completed via ${plannerProvider}`,
        })

        const editScript = parseJSON<EditScript>(plannerText, {
          iteration,
          edits: [],
          why: ['No improvements found'],
        })

        emit({ type: 'edit_script', data: editScript })
        emit({
          type: 'agent_log',
          agent: 'Tree Logic',
          message: `Proposing ${editScript.edits.length} edit(s): ${editScript.edits.map((e) => `${e.key}=${e.value}`).join(', ')}`,
        })

        // ── APPLY EDITS ───────────────────────────────────────
        const updatedTree = applyEditScript(tree, editScript, constraints)

        // ── REGENERATE CODE ───────────────────────────────────
        emit({
          type: 'agent_log',
          agent: 'Script',
          message: 'Regenerating Build123d from updated parameters...',
        })

        let rawCode: string
        let codeProvider: string
        try {
          const codeResult = await resilientChat(
            [
              {
                role: 'system',
                content: `You are a Build123d Python code generator. Generate clean parametric Build123d code.

Rules:
1. Always use: from build123d import *
2. Use Algebra mode (NOT builder mode)
3. Final shape MUST be assigned to variable called "result"
4. All dimensions should use the parametric values from the tree
5. Do NOT include export_stl or any export calls
6. Do NOT include viewer/show calls or if __name__ blocks
7. Output ONLY valid Python code — no markdown, no backticks`,
              },
              {
                role: 'user',
                content: `Generate Build123d Python code for this updated design tree:
${JSON.stringify(updatedTree, null, 2)}`,
              },
            ],
            { maxTokens: 1500, temperature: 0.3, purpose: 'iteration-code-regen' }
          )
          rawCode = codeResult.text
          codeProvider = codeResult.provider
        } catch {
          rawCode = 'from build123d import *\nresult = Box(10, 10, 10)'
          codeProvider = 'fallback'
        }

        emit({
          type: 'agent_log',
          agent: 'Script',
          message: `Code regen completed via ${codeProvider}`,
        })

        const newCode = rawCode
          .replace(/```[a-z]*\n?/g, '')
          .replace(/```/g, '')
          .trim()

        // ── RESCORE ───────────────────────────────────────────
        const newScores = scoreDesign(updatedTree, prompt)
        const improved = newScores.overall > scores.overall

        emit({ type: 'tree', data: updatedTree })
        emit({ type: 'code', data: newCode })
        emit({ type: 'scores', data: newScores })
        emit({
          type: 'agent_log',
          agent: 'Scoring',
          message: `Score: ${newScores.overall.toFixed(2)} (was ${scores.overall.toFixed(2)}) ${improved ? '↑ improved' : '↓ no improvement'}`,
        })
        emit({ type: 'phase', phase: 'done', iteration })

      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error'
        emit({ type: 'error', message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
