import { nemotronClient, MODELS } from '@/lib/ai-clients'
import { resilientChat } from '@/lib/llm-clients'
import { scoreDesign } from '@/lib/scoring'
import type { DesignTree } from '@/lib/types'

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[a-z]*\n?/g, '')
    .replace(/```/g, '')
    .trim()
}

function parseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(stripMarkdown(text)) as T
  } catch {
    return fallback
  }
}

export async function POST(request: Request) {
  let body: any

  try {
    body = await request.json()
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const prompt: string = body?.prompt ?? ''

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(new TextEncoder().encode(sseEvent(data)))
      }

      try {

        // ── AGENT 1: Nemotron Intent Parser ──────────────────
        emit({ type: 'phase', phase: 'parsing' })
        emit({
          type: 'agent_log',
          agent: 'Nemotron',
          message: 'Starting reasoning process...',
        })

        // Use streaming to capture reasoning_content
        const nemotronStream = await nemotronClient.chat.completions.create({
          model: MODELS.nemotron,
          temperature: 0.6,
          top_p: 0.95,
          max_tokens: 2048,
          stream: true,
          messages: [
            {
              role: 'system',
              content: `/no_think`,
            },
            {
              role: 'user',
              content: `You are the Intent Parser agent for Studio, an AI-native parametric 3D design system. You are Step 1 of a 4-agent pipeline.

PIPELINE:
1. YOU (Nemotron) → Extract structured design intent
2. Claude Logic → Build parametric dependency tree  
3. Claude Code → Generate Build123d Python code
4. Scoring Engine → Score deterministically

YOUR TASK: Convert this natural language prompt into structured JSON.

DESIGN TYPES:
- functional_part (brackets, mounts, enclosures)
- decorative_object (vases, sculptures, ornaments)
- mechanical_part (gears, hinges, joints)
- architectural_element (panels, facades, columns)
- enclosure (boxes, cases, housings)

RULES:
- Extract ALL numeric values with units
- Infer reasonable defaults for missing dimensions
- Keep parameter keys lowercase with underscores
- Always include at least 3 parameters

PROMPT TO PARSE:
"${prompt}"`,
            },
          ],
          extra_body: {
            guided_json: {
              type: "object",
              properties: {
                entities: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                  description: "Primary object names"
                },
                parameters: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      key: { type: "string" },
                      value: { type: "number" },
                      unit: { type: "string" }
                    },
                    required: ["key", "value", "unit"]
                  },
                  minItems: 1,
                  description: "Design parameters with values and units"
                },
                relationships: {
                  type: "array",
                  items: { type: "string" },
                  description: "Spatial relationship descriptions"
                },
                designType: {
                  type: "string",
                  enum: ["functional_part", "decorative_object", "mechanical_part", "architectural_element", "enclosure"],
                  description: "Category of the design"
                },
                qualitative_goals: {
                  type: "array",
                  items: { type: "string" },
                  description: "Qualitative design goals"
                },
                constraints: {
                  type: "array",
                  items: { type: "string" },
                  description: "Specific requirements or constraints"
                }
              },
              required: ["entities", "parameters", "designType"]
            }
          }
        } as any)

        // Collect streaming response
        let intentText = ''
        let reasoningText = ''
        let chunkCount = 0

        for await (const chunk of nemotronStream as AsyncIterable<{
          choices: Array<{
            delta: {
              content?: string
              reasoning_content?: string
            }
          }>
        }>) {
          const reasoning = chunk.choices[0]?.delta?.reasoning_content
          const content = chunk.choices[0]?.delta?.content

          if (reasoning) {
            reasoningText += reasoning
            // Emit reasoning trace every ~100 chars so UI updates smoothly
            if (reasoningText.length % 100 < 20) {
              emit({
                type: 'nemotron_thinking',
                text: reasoningText.slice(-200), // last 200 chars
              })
            }
          }

          if (content) {
            intentText += content
            chunkCount++
          }
        }

        // Emit final reasoning summary
        if (reasoningText) {
          emit({
            type: 'agent_log',
            agent: 'Nemotron',
            message: `Reasoned for ${reasoningText.split(' ').length} words → extracting parameters`,
          })
          emit({
            type: 'nemotron_reasoning_done',
            summary: reasoningText.slice(0, 300),
          })
        }

        const intentResult = parseJSON(intentText.trim(), {
          entities: ['object'],
          parameters: [{ key: 'height', value: 100, unit: 'mm' }],
          relationships: [],
          designType: 'functional_part',
          qualitative_goals: [],
          constraints: [],
        })

        emit({ type: 'agent_done', agent: 'Nemotron', tokens: intentText.split(' ').length * 1.3 | 0, cost: 0.0001 })
        emit({ type: 'intent', data: intentResult })
        emit({
          type: 'agent_log',
          agent: 'Nemotron',
          message: (() => {
            const paramCount = Array.isArray(intentResult.parameters) ? intentResult.parameters.length : Object.keys(intentResult.parameters || {}).length
            const goalCount = Array.isArray(intentResult.qualitative_goals) ? intentResult.qualitative_goals.length : 0
            return `Identified: ${intentResult.designType ?? intentResult.entities?.[0] ?? 'object'} — ${paramCount} parameters, ${goalCount} goals`
          })(),
        })

        // ── AGENT 2: Claude Logic Tree Builder ───────────────
        emit({ type: 'phase', phase: 'building-tree' })
        emit({
          type: 'agent_log',
          agent: 'Tree Logic',
          message: 'Building parametric dependency tree...',
        })

        const { text: treeText, provider: treeProvider } = await resilientChat(
          [
            {
              role: 'system',
              content: `You are a parametric CAD logic tree builder. Convert design intent into a structured dependency tree. Respond with ONLY valid JSON, no markdown, no backticks, no explanation.

The JSON must match this exact structure:
{
  "design_id": "unique-id-string",
  "name": "descriptive name",
  "prompt": "original prompt here",
  "parameters": {
    "height": {"key":"height","value":200,"unit":"mm","min":50,"max":500,"locked":false},
    "radius": {"key":"radius","value":30,"unit":"mm","min":10,"max":200,"locked":false}
  },
  "nodes": {
    "body": {"id":"body","op":"cylinder","label":"Main Body","params":{"h":"height","r":"radius"},"children":[],"depends_on":["height","radius"]},
    "root": {"id":"root","op":"union","label":"Final Shape","params":{},"children":["body"],"depends_on":[]}
  },
  "root_id": "root",
  "created_at": 0
}

Rules:
- 5 to 12 nodes minimum-to-maximum. NEVER produce fewer than 5 nodes. Simple prompts should still have at least 5 nodes (e.g. base shape + at least one feature + boolean operation + positioning + final union). Complex prompts should use 8-12 nodes.
- op must be one of: cube, sphere, cylinder, cone, torus, union, difference, intersection, translate, rotate, scale, fillet, chamfer, linear_extrude, rotate_extrude, pattern_linear, pattern_polar
- depends_on lists parameter keys the node uses
- children lists node IDs that are direct children
- all parameters need realistic min/max bounds
- created_at must be 0 (will be set by server)`,
            },
            {
              role: 'user',
              content: `Design intent: ${JSON.stringify(intentResult)}
Original prompt: "${prompt}"

Generate the DesignTree JSON:`,
            },
          ],
          { maxTokens: 2000, purpose: 'tree-building' }
        )

        emit({
          type: 'agent_log',
          agent: 'Tree Logic',
          message: `Completed via ${treeProvider}`,
        })

        const rawTree = parseJSON<DesignTree>(treeText, {
          design_id: crypto.randomUUID(),
          name: prompt.slice(0, 40),
          prompt,
          parameters: {},
          nodes: {},
          root_id: 'root',
          created_at: Date.now(),
        })

        const designTree: DesignTree = {
          ...rawTree,
          design_id: rawTree.design_id || crypto.randomUUID(),
          created_at: Date.now(),
        }

        emit({ type: 'agent_done', agent: 'Tree Logic', tokens: treeText.length / 4 | 0, cost: 0 })
        emit({ type: 'tree', data: designTree })
        emit({
          type: 'agent_log',
          agent: 'Tree Logic',
          message: `Tree built: ${Object.keys(designTree.nodes).length} nodes, ${Object.keys(designTree.parameters).length} parameters`,
        })

        // ── AGENT 3: Claude Code Generator ───────────────────
        emit({ type: 'phase', phase: 'generating-code' })
        emit({
          type: 'agent_log',
          agent: 'Script',
          message: 'Generating Build123d code from dependency tree...',
        })

        let rawCode: string
        let codeProvider: string
        try {
          const codeResult = await resilientChat(
            [
              {
                role: 'system',
                content: `You are an expert parametric CAD code generator using Build123d (Python). Given a parametric dependency tree, generate Build123d Python code that creates the described 3D model.

RULES:
1. Always use: from build123d import *
2. Use Algebra mode (NOT builder mode) — it's cleaner and more composable
3. The final shape MUST be assigned to a variable called \`result\`
4. All dimensions should use the parametric values from the tree
5. DO NOT include any import for export_stl or any export calls — that is handled automatically
6. DO NOT include any viewer/show calls
7. DO NOT include if __name__ == "__main__" blocks

AVAILABLE BUILD123D PRIMITIVES (positional args ONLY — NEVER use keyword arguments):
- Box(length, width, height) — e.g. Box(80, 60, 10) NOT Box(l=80, w=60, h=10)
- Cylinder(radius, height) — e.g. Cylinder(30, 10) NOT Cylinder(r=30, h=10)
- Sphere(radius) — e.g. Sphere(25)
- Cone(bottom_radius, top_radius, height) — e.g. Cone(20, 10, 30)
- Torus(major_radius, minor_radius) — e.g. Torus(30, 5)

CRITICAL SYNTAX RULES:
- NEVER use keyword arguments for primitives: Cylinder(r=5, h=10) will CRASH. Use Cylinder(5, 10)
- NEVER use .scale() method. Multiply dimensions directly in the constructor instead.
- NEVER use Pos(X=x, Y=y, Z=z). Use Pos(x, y, z) with positional args only.
- NEVER use Rot(X=x, Y=y, Z=z). Use Rot(x, y, z) with positional args only.
- align parameter IS allowed as keyword: Box(10, 10, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))

2D vs 3D DIMENSION RULES (violating these causes "Dimensions of objects to subtract from are inconsistent"):
- NEVER use Circle() as a subtraction target. Circle() is 2D — you CANNOT subtract a 3D Box/Cylinder from it.
- NEVER use BuildSketch() or make_face() as a base for boolean subtraction.
- ALWAYS use 3D primitives (Cylinder, Box, Sphere, Cone, Torus) as the base shape for any subtraction.
- To make a flat disc: use Cylinder(radius, thickness) — this is 3D. Do NOT use Circle(radius).
- FORBIDDEN: base = Circle(12.5); base = base - Box(...)  ← 2D minus 3D = CRASH
- CORRECT:   disc = Cylinder(12.5, 2.5); disc = disc - Box(...)  ← 3D minus 3D = OK

OPERATIONS:
- Fillet: fillet(edges, radius) — e.g. result = fillet(box.edges(), 2)
- Chamfer: chamfer(edges, length) — e.g. result = chamfer(box.edges(), 1)
- Boolean union: shape1 + shape2
- Boolean subtraction: shape1 - shape2
- Boolean intersection: shape1 & shape2
- Extrude: extrude(sketch, amount)
- Revolve: revolve(sketch, axis, arc)

POSITIONING:
- Pos(x, y, z) * shape — translate (positional args only, NOT keyword)
- Rot(x, y, z) * shape — rotate (positional args only, NOT keyword)
- Locations: for loc in GridLocations(x_spacing, y_spacing, x_count, y_count): ...
- PolarLocations(radius, count) — for circular patterns

IMPORTANT: Do NOT use .scale() method or keyword arguments like X=, Y=, Z= in Pos/Rot. Use positional arguments only: Pos(10, 20, 0) not Pos(X=10, Y=20, Z=0). For scaling, multiply dimensions directly in the primitive constructor instead of using a scale operation.

IMPORTANT: The variable MUST be called \`result\`. This is non-negotiable.
Always generate complete, runnable Build123d code. Never use placeholders.
IMPORTANT: When using fillet() or chamfer(), always use try/except to catch failures and fall back to the unfilleted shape. Fillet radii that are too large for small edges will crash. Example: try:\n  result = fillet(box.edges(), 2)\nexcept ValueError:\n  result = box
Output ONLY valid Python code with no markdown and no backticks.
PATTERN AND HOLE RULES:
- When creating patterns of holes, slots, or cutouts: ALWAYS use boolean SUBTRACTION (shape - hole). Do NOT add material — remove it.
- The base solid MUST be a 3D primitive (Cylinder, Box, etc.) created FIRST, BEFORE any subtraction loops. Never subtract from nothing.
- NEVER start with Circle(), BuildSketch(), or make_face() — these are 2D and CANNOT be subtracted from with 3D shapes.
- For a flat disc base, ALWAYS use Cylinder(radius, thickness) — NEVER Circle(radius).
- Cutting tool dimensions MUST be LARGER than the base shape in the cut-through direction. For a disc of thickness T, subtraction box height must be T + 4 or more.
- Cutting tool length MUST exceed the base shape diameter/width so the cut goes fully through.
- After all subtractions, the result MUST still be a valid solid with volume > 0. Do not over-subtract.
- "Holes" means material is REMOVED, not added. Use: base_shape - Pos(x, y, 0) * Cylinder(hole_radius, thickness + 4)

EXAMPLE — Axis-aligned grid lattice disc:
from build123d import *
radius = 25
thickness = 3
slot_width = 2
slot_count = 8
disc = Cylinder(radius, thickness)
for i in range(slot_count):
    offset = -radius + (i + 1) * (2 * radius) / (slot_count + 1)
    slot = Pos(offset, 0, 0) * Box(slot_width, radius * 2 + 4, thickness + 4)
    disc = disc - slot
for i in range(slot_count):
    offset = -radius + (i + 1) * (2 * radius) / (slot_count + 1)
    slot = Pos(0, offset, 0) * Box(radius * 2 + 4, slot_width, thickness + 4)
    disc = disc - slot
result = disc

EXAMPLE — Diagonal crosshatch lattice disc (diamond holes at 45 degrees):
from build123d import *
import math
radius = 12.5
thickness = 2.5
slot_width = 1.5
spacing = 3.5
slot_count = 8
disc = Cylinder(radius, thickness)
cut_length = radius * 3  # MUST be larger than disc diameter
cut_height = thickness + 4  # MUST be larger than disc thickness
# Cut slots at +45 degrees
for i in range(-slot_count, slot_count + 1):
    offset = i * spacing
    slot = Pos(offset * 0.707, -offset * 0.707, 0) * Rot(0, 0, 45) * Box(cut_length, slot_width, cut_height)
    disc = disc - slot
# Cut slots at -45 degrees
for i in range(-slot_count, slot_count + 1):
    offset = i * spacing
    slot = Pos(offset * 0.707, offset * 0.707, 0) * Rot(0, 0, -45) * Box(cut_length, slot_width, cut_height)
    disc = disc - slot
result = disc

Brief comments are OK. You have full freedom to use loops, math, helper functions, and trigonometry to create complex geometry like gear teeth, patterns, organic shapes, and involute profiles. Do not simplify — generate the most accurate geometry possible.

EXAMPLE — Spur gear with involute teeth:
from build123d import *
import math
module = 2
teeth = 20
pitch_r = module * teeth / 2
outer_r = pitch_r + module
root_r = pitch_r - 1.25 * module
thickness = 10
bore_r = 5
# Create gear body
body = Cylinder(outer_r, thickness)
# Subtract root between teeth using polar subtraction
for i in range(teeth):
    angle = i * 360 / teeth
    slot = Pos(0, 0, 0) * Rot(0, 0, angle) * Pos(pitch_r, 0, 0) * Box(module * 1.2, module * 2.5, thickness + 2)
    body = body - slot
# Center bore
body = body - Cylinder(bore_r, thickness + 2)
result = body

EXAMPLE — Box with fillets and holes:
from build123d import *
box = Box(80, 60, 10)
box = fillet(box.edges(), 2)
box = box - Pos(30, 20, 0) * Cylinder(3, 20)
box = box - Pos(-30, -20, 0) * Cylinder(3, 20)
result = box

EXAMPLE — Ribbed vase:
from build123d import *
import math
height = 200
base_r = 30
ribs = 12
body = Cylinder(base_r, height)
for i in range(ribs):
    angle = i * 360 / ribs
    rib = Pos(0, 0, 0) * Rot(0, 0, angle) * Pos(base_r, 0, height/2) * Box(3, 6, height)
    body = body + rib
body = body - Cylinder(base_r - 3, height - 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
result = body`,
              },
              {
                role: 'user',
                content: `Generate Build123d Python code for this design tree:
${JSON.stringify(designTree, null, 2)}`,
              },
            ],
            { maxTokens: 2000, temperature: 0.3, purpose: 'code-generation' }
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
          message: `Completed via ${codeProvider}`,
        })

        let build123dCode = stripMarkdown(rawCode)

        // ── CODE VALIDATION PASS ──────────────────────────────
        // Quick structural check for common boolean subtraction failures
        const hasSubtraction = build123dCode.includes(' - ') || build123dCode.includes('Mode.SUBTRACT')
        const hasBaseShape = /^(disc|body|base|box|cyl|result|shape|part)\s*=\s*(Cylinder|Box|Sphere|Cone|Torus)/m.test(build123dCode)
        const firstSubtractLine = build123dCode.split('\n').findIndex(l => l.includes(' - ') && !l.trimStart().startsWith('#'))
        const firstAssignLine = build123dCode.split('\n').findIndex(l => /^\w+\s*=\s*(Cylinder|Box|Sphere|Cone|Torus)/.test(l.trim()))

        // Check for 2D vs 3D dimension mismatch — Circle/BuildSketch/make_face used as subtraction target
        const has2DBase = /\b(Circle|BuildSketch|make_face|RectangleRounded)\s*\(/.test(build123dCode)
        const subtractsFrom2D = has2DBase && hasSubtraction

        const orderBug = hasSubtraction && (!hasBaseShape || (firstSubtractLine >= 0 && firstAssignLine >= 0 && firstSubtractLine < firstAssignLine))
        const needsFix = orderBug || subtractsFrom2D

        if (needsFix) {
          const reason = subtractsFrom2D
            ? 'Validation: detected 2D shape (Circle/Sketch) used as subtraction target — requesting fix...'
            : 'Validation: detected subtraction before base solid — requesting fix...'
          emit({
            type: 'agent_log',
            agent: 'Script',
            message: reason,
          })

          try {
            const fixResult = await resilientChat(
              [
                {
                  role: 'system',
                  content: `You are a Build123d code reviewer. Review the code below and fix any issues. Return ONLY the corrected Python code, no explanation.

CHECK THESE RULES:
1. Is a base solid (Cylinder, Box, etc.) created BEFORE any boolean subtraction ( - ) operations? If not, move it before.
2. DIMENSION MISMATCH: Is Circle(), BuildSketch(), or make_face() used as a subtraction target? Circle is 2D — you CANNOT subtract a 3D Box from it. Replace Circle(r) with Cylinder(r, thickness) to make it 3D BEFORE any subtraction.
3. Are all subtraction/cutting tool dimensions LARGER than the base shape? For a disc of thickness T, cutting boxes must have height > T+2. For a disc of radius R, cutting boxes must have length > R*2+2.
4. Will the result have non-zero volume after all subtractions? If slots are too close together or too wide, reduce count or width.
5. Does the code use positional args only for Cylinder, Box, etc? No keyword args like r=, h=, l=.
6. Is the final result assigned to a variable called 'result'?
7. Is the code in Algebra mode (no 'with BuildPart()' or 'with BuildSketch()')? If builder mode is used, rewrite in algebra mode using from build123d import *.

If the code is already correct, return it unchanged. Otherwise fix the issues and return corrected code.`,
                },
                {
                  role: 'user',
                  content: build123dCode,
                },
              ],
              { maxTokens: 2000, temperature: 0.1, purpose: 'code-validation' }
            )
            const fixedCode = stripMarkdown(fixResult.text)
            if (fixedCode.includes('result') && fixedCode.includes('from build123d')) {
              build123dCode = fixedCode
              emit({
                type: 'agent_log',
                agent: 'Script',
                message: `Validation fix applied via ${fixResult.provider}`,
              })
            }
          } catch {
            emit({
              type: 'agent_log',
              agent: 'Script',
              message: 'Validation fix skipped (provider unavailable)',
            })
          }
        }

        emit({ type: 'agent_done', agent: 'Script', tokens: rawCode.length / 4 | 0, cost: 0 })
        emit({ type: 'code', data: build123dCode })
        emit({
          type: 'agent_log',
          agent: 'Script',
          message: `Generated ${build123dCode.split('\n').length} lines of Build123d code`,
        })

        // ── SCORING ───────────────────────────────────────────
        emit({ type: 'phase', phase: 'scoring' })

        const scores = scoreDesign(designTree, prompt)

        emit({ type: 'scores', data: scores })
        emit({
          type: 'agent_log',
          agent: 'Evaluation',
          message: `Score: ${scores.overall.toFixed(2)} — proportion:${scores.proportion.toFixed(2)} symmetry:${scores.symmetry.toFixed(2)} features:${scores.featureCount.toFixed(2)}`,
        })

        // ── DONE ──────────────────────────────────────────────
        emit({ type: 'phase', phase: 'done' })

      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error'
        controller.enqueue(
          new TextEncoder().encode(
            sseEvent({ type: 'error', message })
          )
        )
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
