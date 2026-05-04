import { NextRequest, NextResponse } from 'next/server'
import { openRouterChat, hybridChat } from '@/lib/llm-clients'

/**
 * Enhanced code generation with agentic reasoning and design knowledge RAG
 * Fetches relevant design templates, reasons about the best approach, then generates code
 */

interface CodeGenRequest {
  designTree: Record<string, any>
  prompt: string
  useVectorSearch?: boolean
}

export async function POST(req: NextRequest) {
  try {
    const { designTree, prompt, useVectorSearch = true }: CodeGenRequest = await req.json()

    if (!designTree || !prompt) {
      return NextResponse.json(
        { error: 'Missing designTree or prompt' },
        { status: 400 }
      )
    }

    console.log('[code-gen-agentic] Starting code generation with thinking')

    // Step 1 (optional): Fetch relevant design templates via vector search
    let designContext = ''
    if (useVectorSearch && process.env.DATABRICKS_HOST && process.env.DATABRICKS_TOKEN) {
      try {
        const primaryShape = designTree.nodes?.[Object.keys(designTree.nodes)[0]]?.op || 'generic'
        console.log('[code-gen-agentic] Searching for templates matching:', primaryShape)

        const searchResponse = await fetch(
          `${req.nextUrl.origin}/api/design-search`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: `${primaryShape} parametric OpenSCAD`,
              category: primaryShape,
              numResults: 3,
            }),
          }
        )

        if (searchResponse.ok) {
          const searchData = await searchResponse.json()
          if (searchData.results?.length > 0) {
            designContext = searchData.results
              .map(
                (t: any) =>
                  `Template: ${t.description}\n${t.scad_template}\nParameters: ${JSON.stringify(t.parameters)}`
              )
              .join('\n\n---\n\n')

            console.log('[code-gen-agentic] Fetched', searchData.results.length, 'design templates')
          }
        }
      } catch (searchError) {
        console.warn('[code-gen-agentic] Design template search failed:', searchError)
        // Continue without templates
      }
    }

    // Step 2: Use NIM with thinking for agentic code reasoning
    const systemPrompt = `You are an expert OpenSCAD programmer specializing in parametric 3D design. 
Your task is to generate production-quality OpenSCAD code from a parametric design specification.

${
  designContext
    ? `You have access to relevant design templates:

${designContext}

Use these templates as references for best practices, but adapt them to the specific requirements.`
    : ''
}

Quality requirements:
1. All parameters are variables at the top of the file
2. Code uses modules for reusable components
3. Include helpful comments explaining complex sections
4. Dimensions are in mm, angles in degrees
5. Code is properly formatted and readable
6. No side effects or unexpected behavior

Generate only the OpenSCAD code. No explanation, no markdown.`

    const response = await hybridChat(
      [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Generate OpenSCAD code for this design:

Design Tree:
${JSON.stringify(designTree, null, 2)}

User Intent:
${prompt}

Output only the OpenSCAD code:`,
        },
      ],
      {
        purpose: 'code-generation',
        useThinking: true,
      }
    )

    const scadCode = response.choices?.[0]?.message?.content || ''
    const thinking = response.choices?.[0]?.message?.reasoning || ''

    console.log('[code-gen-agentic] Generated', scadCode.length, 'characters of OpenSCAD code')

    return NextResponse.json({
      code: scadCode,
      thinking, // For debugging and understanding the reasoning process
      templateCount: designContext.split('---').length - 1,
      length: scadCode.length,
    })
  } catch (error) {
    console.error('[code-gen-agentic] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
