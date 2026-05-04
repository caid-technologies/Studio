# Design Intent Representation (DIR) Pipeline

## Overview

The DIR pipeline converts any image into a structured representation that the parametric text pipeline can consume. It implements a 3-stage process: Preprocess → Analyze → Convert.

## Stage 1: Image Preprocessing

**Tool**: sharp (Node.js)

- Resize to max 1024px (preserves aspect ratio)
- Convert to JPEG at 85% quality
- Reduces payload size for VLM API calls
- Extracts original dimensions for aspect ratio calculation

## Stage 2: VLM → DIR Extraction

**Primary**: NVIDIA Nemotron Vision (`nvidia/nemotron-nano-12b-v2-vl`)
**Fallback**: Claude Vision (`claude-sonnet-4-5`)

The VLM receives the preprocessed image and a structured prompt requesting DIR JSON output. The prompt specifies the exact schema and rules for estimation.

### What the VLM Extracts

| Category | Fields | Purpose |
|---|---|---|
| **Family** | 7 parametric families | Template selection |
| **Global** | height_width_ratio, symmetry, orientation, detail_level | Overall shape character |
| **Shape** | taper_ratio, roundness, rectangularity, hollow_likelihood | Cross-section properties |
| **Features** | type, likelihood, count_estimate, direction | Geometric features |
| **Constraints** | symmetry_axis, size_hint_mm | Physical parameters |

## Stage 3: DIR → Deterministic Prompt

Pure template logic — no LLM needed. Maps each DIR field to natural language:

```
DIR: { family: "gear_mechanism", features: [{ type: "teeth", count_estimate: 20 }] }
  ↓
Prompt: "Create a gear mechanism. Include 20 gear teeth evenly distributed."
```

## Why This Architecture

- **Not solving "image → exact CAD"** — extracting enough structure to choose a template and set initial params
- **Deterministic bridge** — the DIR → prompt step uses no LLM, so the LLM only does graph synthesis
- **Iteration refines** — the scoring/iteration loop can improve the initial result
- **Fallback chain** — NVIDIA → Claude → raw text, always produces a result

## Future Improvements

- Client-side CV preprocessing (silhouette extraction, contour analysis)
- Multi-view support for better 3D estimation
- Design blending — merge two DIR representations
