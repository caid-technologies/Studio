# Studio


[Quick Start](#getting-started) · [Architecture](#architecture) · [API Reference](docs/api-reference.md) · [Challenges](CHALLENGES.md) · [Contribution](CONTRIBUTION.md)


---


## Architecture

### Agent Pipeline

```mermaid
flowchart TD
    A["🖊️ User Input\ntext prompt or image"] -> B

    B["Nemotron\nNVIDIA NIM\nIntent Parser\nguided_json constrained decoding\n~$0.0001 / call"] -> C

    C["Claude Logic\nAnthropic\nTree Builder\n3–12 node parametric graph\n~$0.002 / call"] -> D

    D["Claude Code\nAnthropic\nCode Generator\nBuild123d Python with math & loops\n~$0.003 / call"] -> E

    E["Build123d Compiler\nOpenCascade BREP kernel\nPython → Binary STL\nAuto-heals fillet failures\n$0 local execution"] -> F

    F["Scoring Engine\nDeterministic algorithms\nProportion · Symmetry · Features · Params\nDrives iteration loop\n$0 no LLM"] -> G

    G["🎨 Babylon.js Viewport\nReal-time 3D render + STL export"] 

    style B fill:#76b900,color:#fff
    style C fill:#6B46C1,color:#fff
    style D fill:#6B46C1,color:#fff
    style E fill:#EA580C,color:#fff
    style F fill:#0369A1,color:#fff
    style G fill:#1D4ED8,color:#fff
```

### Image-to-Design Pipeline

```mermaid
flowchart LR
    IMG["🖼️ Image / Sketch / Photo"] --> PRE
    PRE["Stage 1.1\nPreprocessing\nsharp: resize 1024px\nJPEG 85%"] --> VLM
    VLM["Stage 2\nVLM Perception\nNVIDIA Nemotron Vision\nor Claude Vision fallback"] --> DIR
    DIR["DIR JSON\nfamily · parameters\nfeatures · symmetry\nconfidence"] --> TMPL
    TMPL["Stage 3\nDeterministic\nPrompt Generation\nzero LLM cost"] --> PIPE
    PIPE["4-Agent\nPipeline"]

    style VLM fill:#76b900,color:#fff
    style TMPL fill:#0369A1,color:#fff
    style PIPE fill:#6B46C1,color:#fff
```

> **Note:** The VLM only handles *perception* (Stage 2). The prompt is assembled deterministically (Stage 3) — no LLM hallucinating geometry specs.

```
                Image
                   │
                   ▼
┌──────────────────────────────────────┐
│  Stage 1.1: Preprocessing (sharp)    │
│  • Resize to max 1024px              │
│  • Convert to JPEG 85%               │
│  • Normalize for VLM consumption     │
└──────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  Stage 2: VLM → DIR Extraction       │
│  • NVIDIA Nemotron Vision (primary)  │
│  • Claude Vision (fallback)          │
│  • Outputs Design Intent JSON:       │
│    - family classification           │
│    - shape parameters                │
│    - feature detection               │
│    - symmetry analysis               │
└──────────────────────────────────────┘
                   │ 
                   ▼
┌──────────────────────────────────────┐
│  Stage 3: DIR → Deterministic Prompt │
│  • No LLM needed — pure templates    │
│  • Family → natural language         │
│  • Features → parameter specs        │
└──────────────────────────────────────┘
                   │ 
                   ▼
            Agent Pipeline

```

### Tech Stack

| Layer | Technology | Purpose |
|:---|:---|:---|
| Framework | Next.js 16, TypeScript, Tailwind CSS | Full-stack app with SSE streaming |
| 3D Viewport | Babylon.js | Real-time STL rendering + camera controls |
| Node Graph | React Flow | Parametric dependency visualization |
| State | Zustand | Single global store |
| Layout | react-resizable-panels | Resizable 4-panel split layout |
| CAD Engine | Build123d + OpenCascade (Python) | BREP geometry → binary STL |
| Intent Parser | NVIDIA Nemotron NIM + `guided_json` | NL → guaranteed-valid structured JSON |
| Tree Builder | Claude Sonnet via resilientChat() | JSON → typed dependency graph |
| Code Generator | Claude Sonnet via resilientChat() | Graph → Build123d Python |
| LLM Fallback | Anthropic → OpenAI → Gemini → OpenRouter | Never fails — 4-provider cascade with cooldown |
| Image Analysis | Nemotron Vision + OpenRouter/OpenAI/Gemini Vision | Image → DIR JSON (multi-provider fallback) |
| Image Preprocessing | sharp | Resize, normalize, JPEG compress |
| Scoring | Hybrid BREP geometry + tree heuristics | Objective quality metrics from real OpenCascade shape data |

---

## Features

### Core Generation
- **Text → CAD**
- **Image → CAD**
- **Dependency Graph**
- **Natural Language Editing**
- **Version History**

### Reliability & Auto-Healing
- **Fillet Auto-Heal** — fillet/chamfer failures auto-retry without fillets; model renders instead of failing
- **4-Provider LLM Fallback** — `resilientChat()` tries Anthropic → OpenAI → Gemini → OpenRouter automatically; dead providers get 60s cooldown
- **3-Level Vision Fallback** — NVIDIA Vision → OpenRouter/OpenAI/Gemini Vision → raw text extraction
- **BREP Geometry Scoring** — real OpenCascade metrics (volume, face count, validity) extracted from compiled shapes, not just tree heuristics
- **`guided_json` Constrained Decoding** — Nemotron physically cannot produce invalid JSON
- **Defensive fillet wrapping** — code generator wraps fillets in `try/except` blocks

### Output & Observability
- **STL Export** — one-click download for 3D printing or CAD import
- **Pipeline Report** — Markdown download with tokens, costs, and timing per agent
- **Score Percentages** — proportion, symmetry, features, params shown as %, with tooltips
- **Cost Transparency** — per-agent token counts and USD cost displayed live
- **Iteration Loop** — Step / Run ×3 / Auto modes targeting a score threshold

---

## Project Structure

```
Studio/
├── app/
│   ├── page.tsx                    # Main layout — viewport, graph, sidebar
│   ├── api/
│   │   ├── generate/route.ts       # SSE pipeline orchestrator (4 agents)
│   │   ├── compile/route.ts        # Build123d Python → STL compiler
│   │   ├── analyze-image/route.ts  # Image → DIR → prompt (Vision pipeline)
│   │   ├── edit-node/route.ts      # NL node editing via Claude
│   │   ├── generate-code/route.ts  # Standalone code gen from tree
│   │   ├── iterate/route.ts        # Iteration loop endpoint
│   │   └── critique/route.ts       # Critique endpoint
├── components/parametric/
│   ├── viewport-3d.tsx             # Babylon.js 3D viewer + STL export
│   ├── node-graph.tsx              # React Flow parametric graph + NL editing
│   ├── prompt-panel.tsx            # Prompt input + image drop + SSE handler
│   └── agent-monitor.tsx           # Agent cards, scores, log, version history
├── lib/
│   ├── store.ts                    # Zustand global state
│   ├── types.ts                    # TypeScript type definitions
│   ├── ai-clients.ts              # Nemotron client + model constants
│   ├── llm-clients.ts             # resilientChat() — 4-provider LLM fallback
│   ├── scoring.ts                  # Hybrid BREP geometry + tree-heuristic scoring
│   └── utils.ts                    # Shared utilities
└── docs/
    ├── architecture.md             # Detailed technical architecture
    ├── dir-pipeline.md             # Image-to-design DIR documentation
    └── api-reference.md            # API endpoint documentation
```

---

## Getting Started

### Prerequisites

| Requirement | Version | Notes |
|:---|:---|:---|
| Node.js | 18+ | |
| pnpm | any | `npm i -g pnpm` |
| Python | 3.8+ | For Build123d server-side compilation |
| build123d | latest | `pip3 install build123d` |

### Setup

```bash
# 1. Clone
git clone https://github.com/roshaninfordham/paragraphai.git studio
cd studio

# 2. Install JS dependencies
pnpm install

# 3. Install Python CAD engine
pip3 install build123d

# 4. Configure environment
cp .env.example .env.local
# Edit .env.local — add your API keys (see below)

# 5. Run
pnpm dev
# Open http://localhost:3000
```

### API Keys

| Variable | Where to get it | Used for |
|:---|:---|:---|
| `NVIDIA_API_KEY` | [build.nvidia.com](https://build.nvidia.com) | Nemotron intent parser + Vision |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Primary LLM for tree builder + code gen |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) | Fallback LLM (GPT-4o) |
| `GOOGLE_GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) | Fallback LLM (Gemini 2.0 Flash) |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) | Last-resort multi-model routing |

---

## Performance & Cost

| Metric | Value |
|:---|:---|
| End-to-end generation time | ~8–15 seconds |
| Cost per generation | ~$0.006 |
| Nemotron intent parse | ~$0.0001 |
| Claude tree build | ~$0.002 |
| Claude code gen | ~$0.003 |
| Compilation + scoring | $0 (local Python) |
| LLM fallback providers | 4 (Anthropic → OpenAI → Gemini → OpenRouter) |
| BREP metrics extracted | ~20 (volume, faces, validity, symmetry, etc.) |
| Build123d primitives | 17 (Box, Cylinder, Sphere, Cone, Torus + boolean ops) |
| DIR geometry families | 7 (revolve, extrude, boxy, cylindrical, gear, bracket, panel) |
| Vision fallback levels | 4 (NVIDIA Vision → OpenRouter → OpenAI → Gemini) |

---

## License

[MIT](LICENSE) © 2026 Caid Technologies
