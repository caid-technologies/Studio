import { NextRequest, NextResponse } from 'next/server'
import { resilientChat } from '@/lib/llm-clients'

export async function POST(req: NextRequest) {
  const { tree } = await req.json()

  const { text } = await resilientChat(
    [
      {
        role: 'system',
        content: `You are an expert parametric CAD code generator using Build123d (Python). Given a parametric dependency tree, generate Build123d Python code.

RULES:
1. Always use: from build123d import *
2. Use Algebra mode (NOT builder mode)
3. The final shape MUST be assigned to a variable called result
4. DO NOT include any import for export_stl or any export calls
5. DO NOT include any viewer/show calls
6. DO NOT include if __name__ == "__main__" blocks

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
- Boolean union: shape1 + shape2
- Boolean subtraction: shape1 - shape2
- Boolean intersection: shape1 & shape2
- Fillet: try fillet(edges, radius) with try/except ValueError for safety
- Chamfer: try chamfer(edges, length) with try/except ValueError for safety

POSITIONING:
- Pos(x, y, z) * shape — translate (positional args only)
- Rot(x, y, z) * shape — rotate (positional args only)

IMPORTANT: When using fillet() or chamfer(), always wrap in try/except:
try:
  result = fillet(box.edges(), 2)
except ValueError:
  result = box

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

Brief comments are OK. You have full freedom to use loops, math, and helper functions.`,
      },
      {
        role: 'user',
        content: `Generate Build123d Python code for this parametric design tree:\n${JSON.stringify(tree, null, 2)}\n\nReturn ONLY the Python code, no markdown blocks.`,
      },
    ],
    { maxTokens: 2000, temperature: 0.3, purpose: 'code-generation' }
  )

  let code = text.replace(/```python\n?/g, '').replace(/```\n?/g, '').trim()

  return NextResponse.json({ code })
}
