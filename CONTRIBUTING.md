# Contributing to Studio

## Quick Start

1. Clone the repo
2. Copy `.env.example` to `.env.local` and add your API keys
3. Install dependencies: `pnpm install`
4. Install Python CAD engine: `pip3 install build123d`
5. Run: `pnpm dev`

## Architecture

Read `docs/architecture.md` for the full technical architecture.

The key principle: **agents are specialized and observable**. Each agent has one job, logs its work, and passes structured data to the next.

## Code Style

- TypeScript strict mode
- Tailwind CSS for styling (no CSS modules)
- Server components by default, `'use client'` only when needed
- API routes in `app/api/` — each is a self-contained module
- Zustand for client state — single store in `lib/store.ts`

## Adding a New Agent

1. Add the model config to `lib/ai-clients.ts`
2. Add the agent step to `app/api/generate/route.ts` (emit SSE events)
3. Add the agent card to `components/parametric/agent-monitor.tsx`
4. Update types in `lib/types.ts` if needed

## Adding a New Primitive

1. Add the op to the `DesignNode.op` union type in `lib/types.ts`
2. Add it to the Tree Builder's allowed ops list in `app/api/generate/route.ts`
3. Add Build123d example code to the Code Generator's system prompt
4. Update scoring heuristics in `lib/scoring.ts` if needed

## Adding a New DIR Family

1. Add the family to the DIR schema in `app/api/analyze-image/route.ts`
2. Add the family name mapping in `dirToPrompt()`
3. Add the family to the VLM prompt's enum list
4. Document it in `docs/dir-pipeline.md`
