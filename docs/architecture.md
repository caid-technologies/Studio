# Studio — Technical Architecture

## System Overview

Studio uses a 4-agent pipeline architecture where each agent has a specialized role, communicating via Server-Sent Events (SSE) for real-time frontend updates.

## Agent Details

### Agent 1: Nemotron Intent Parser

- **Model**: `nvidia/nvidia-nemotron-nano-9b-v2`
- **API**: NVIDIA NIM (`https://integrate.api.nvidia.com/v1`)
- **Feature**: `guided_json` constrained decoding — forces valid JSON output matching our schema
- **Input**: Natural language prompt
- **Output**: Structured intent JSON with entities, parameters, relationships, design type, goals, constraints
- **Cost**: ~$0.0001 per call

### Agent 2: Claude Logic Tree Builder

- **Model**: `claude-sonnet-4-5-20250929`
- **API**: Anthropic
- **Input**: Intent JSON + original prompt
- **Output**: DesignTree JSON — parametric dependency graph with 3-12 nodes
- **Node types**: cube, sphere, cylinder, cone, torus, union, difference, intersection, translate, rotate, scale, fillet, chamfer, linear_extrude, rotate_extrude, pattern_linear, pattern_polar
- **Cost**: ~$0.003 per call

### Agent 3: Claude Code Generator

- **Model**: `claude-sonnet-4-5-20250929`
- **API**: Anthropic
- **Input**: DesignTree JSON
- **Output**: Build123d Python code (Algebra mode)
- **Capabilities**: Loops, trigonometry, helper functions, involute profiles, polar patterns
- **Includes**: 3 worked examples (spur gear, filleted box, ribbed vase)
- **Cost**: ~$0.003 per call

### Agent 4: Scoring Engine

- **Model**: None — deterministic
- **Input**: DesignTree + original prompt
- **Output**: ScoreResult with proportion, symmetry, features, parameters
- **Weights**: proportion 0.25, symmetry 0.2, features 0.3, parameters 0.25
- **Cost**: $0.00

## Build123d Compiler

- **Engine**: OpenCascade (same kernel as FreeCAD, SolidWorks)
- **Mode**: BREP (Boundary Representation) — real engineering geometry
- **Process**: Write Python temp file → execute with `python3` → read output STL
- **Timeout**: 60 seconds
- **Output**: Binary STL

## Image-to-Design (DIR Pipeline)

Based on the Design Intent Representation architecture:

1. **Preprocessing** (sharp): Resize to 1024px, JPEG compression
2. **VLM Analysis** (NVIDIA Nemotron Vision → Claude fallback): Extract DIR JSON
3. **DIR → Prompt** (deterministic): Template-based conversion, no LLM needed
4. **Standard Pipeline**: DIR prompt feeds into the normal 4-agent flow

### DIR Schema

```json
{
  "family": "gear_mechanism",
  "confidence": 0.85,
  "global": {
    "height_width_ratio": 0.5,
    "symmetry": { "type": "radial", "score": 0.95 },
    "orientation": "upright",
    "detail_level": 0.8
  },
  "shape": {
    "taper_ratio": 1.0,
    "roundness": 0.9,
    "rectangularity": 0.1,
    "hollow_likelihood": 0.3
  },
  "features": [
    { "type": "teeth", "likelihood": 0.95, "count_estimate": 20, "direction": "radial" },
    { "type": "bore", "likelihood": 0.9, "count_estimate": 1, "direction": null }
  ],
  "constraints_suggestions": {
    "prefer_symmetry_axis": "Z",
    "size_hint_mm": { "diameter": 80, "thickness": 10 }
  }
}
```

### Supported Families

| Family | Examples | Key Parameters |
|---|---|---|
| revolve_profile | Vases, bottles | height, diameter, taper, ribs |
| extrude_profile | Plates, brackets | width, height, thickness |
| boxy_enclosure | Cases, housings | length, width, height, wall thickness |
| cylindrical_part | Cylinders, tubes | diameter, height, wall thickness |
| gear_mechanism | Gears, sprockets | teeth, module, bore, thickness |
| bracket_mount | L-brackets, mounts | leg dimensions, holes, fillets |
| panel_pattern | Facades, grilles | panel size, pattern, openings |

## Communication Flow

```
Browser                    Server                      External APIs
  │                          │                              │
  │── POST /api/generate ──▶│                              │
  │                          │── Nemotron (NIM) ──────────▶│
  │◀── SSE: phase=parsing ──│                              │
  │◀── SSE: intent ─────────│◀── structured JSON ─────────│
  │                          │                              │
  │                          │── Claude Logic (Anthropic) ▶│
  │◀── SSE: phase=building ─│                              │
  │◀── SSE: tree ────────────│◀── DesignTree JSON ────────│
  │                          │                              │
  │                          │── Claude Code (Anthropic) ──▶│
  │◀── SSE: phase=generating│                              │
  │◀── SSE: code ────────────│◀── Build123d Python ───────│
  │                          │                              │
  │                          │── Scoring (local) ──────────│
  │◀── SSE: scores ──────────│                              │
  │◀── SSE: phase=done ─────│                              │
  │                          │                              │
  │── POST /api/compile ────▶│                              │
  │                          │── python3 (Build123d) ──────│
  │◀── Binary STL ───────────│                              │
  │                          │                              │
  │── Babylon.js renders ────│                              │
```

## NVIDIA Integration Points

1. **Nemotron Nano 9B** — Intent parsing with `guided_json` constrained decoding
2. **Nemotron Vision 12B VL** — Image analysis for DIR extraction
3. **NIM API** — Cloud-hosted inference via OpenAI-compatible endpoint
4. **guided_json** — Schema-enforced structured output (no parsing failures)
