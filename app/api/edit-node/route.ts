import { NextRequest, NextResponse } from 'next/server'
import { resilientChat } from '@/lib/llm-clients'

interface NodeData {
  id: string
  type: string
  label: string
  op?: string
  params?: Record<string, number | string>
}

interface EditNodeRequest {
  instruction: string
  node: NodeData
  fullTree?: Record<string, any>
}

export async function POST(req: NextRequest) {
  try {
    const { instruction, node, fullTree }: EditNodeRequest = await req.json()

    if (!instruction || !node) {
      return NextResponse.json(
        { error: 'Missing instruction or node data' },
        { status: 400 }
      )
    }

    const systemPrompt = `You are a parametric 3D design expert. Given a node from a parametric dependency tree and a natural language instruction, modify ONLY the numeric/string parameter values. Do not change the node type or structure.

Current node:
- Type: ${node.type}
- Operation: ${node.op}
- Label: ${node.label}
- Current params: ${JSON.stringify(node.params)}

Rules:
1. Return ONLY a JSON object with updated parameters
2. Keep parameter keys exactly as they are
3. Use reasonable scaling (e.g., "double" = multiply by 2, "half" = divide by 2)
4. For parameters you don't recognize, leave unchanged
5. Ensure values remain physically realistic (no negative dimensions, reasonable ranges)
6. Apply proportional scaling where it makes sense (e.g., scaling one radius might mean scaling others)

Example: If instruction is "make it twice as tall" and params are {height: 10, radius: 5}
Return: {height: 20, radius: 5}

Only return the JSON object. No explanation, no markdown code blocks.`

    const { text: textContent } = await resilientChat(
      [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: `Instruction: "${instruction}"
          
Full design context: ${JSON.stringify(fullTree || {})}

Return updated params as JSON only:`,
        },
      ],
      {
        maxTokens: 500,
        temperature: 0.2,
        purpose: 'node-editing',
      }
    )

    if (!textContent) {
      return NextResponse.json(
        { error: 'No response from Claude' },
        { status: 500 }
      )
    }

    try {
      // Extract JSON from the response
      const jsonMatch = textContent.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return NextResponse.json(
          { error: 'No JSON found in response', raw: textContent },
          { status: 422 }
        )
      }

      const updatedParams = JSON.parse(jsonMatch[0])
      console.log('[edit-node] Updated params:', updatedParams)
      return NextResponse.json({ params: updatedParams })
    } catch (parseError) {
      return NextResponse.json(
        { error: 'Failed to parse JSON response', raw: textContent },
        { status: 422 }
      )
    }
  } catch (error) {
    console.error('[edit-node] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
