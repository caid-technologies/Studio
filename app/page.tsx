'use client'

import dynamic from 'next/dynamic'
import { useStore } from '@/lib/store'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import PromptPanel from '@/components/parametric/prompt-panel'
import { Boxes } from 'lucide-react'

const NodeGraph = dynamic(
  () => import('@/components/parametric/node-graph'),
  { ssr: false }
)

const Viewport3D = dynamic(
  () => import('@/components/parametric/viewport-3d'),
  { ssr: false }
)

const AgentMonitor = dynamic(
  () => import('@/components/parametric/agent-monitor'),
  { ssr: false }
)

const PHASE_LABELS: Record<string, string> = {
  idle: 'Ready',
  parsing: 'Parsing intent...',
  'building-tree': 'Building graph...',
  'generating-code': 'Generating code...',
  compiling: 'Compiling geometry...',
  validating: 'Validating...',
  scoring: 'Scoring...',
  iterating: 'Iterating...',
  done: 'Complete',
  error: 'Error',
}

export default function Home() {
  const phase = useStore((s) => s.phase)
  const iteration = useStore((s) => s.iteration)

  const isActive = !['idle', 'done', 'error'].includes(phase)

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0 h-12">
        <div className="flex items-center gap-2.5">
          <Boxes className="w-5 h-5 text-accent" />
          <span className="font-semibold text-sm tracking-tight">
            Studio
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all duration-500 ${
              phase === 'done'
                ? 'bg-white/10 text-white ring-1 ring-white/20 shadow-[0_0_8px_rgba(255,255,255,0.15)]'
                : phase === 'error'
                ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                : isActive
                ? 'bg-white/5 text-white/70 animate-pulse'
                : 'bg-white/5 text-white/40'
            }`}
          >
            {PHASE_LABELS[phase] ?? phase}
          </span>
          {iteration > 0 && (
            <span className="text-muted-foreground text-xs">
              Iteration {iteration}
            </span>
          )}
        </div>
      </header>

      {/* ── Main content ── */}
        <PanelGroup direction="horizontal" className="flex-1">
          <Panel defaultSize={75} minSize={50}>
            <PanelGroup direction="vertical" className="h-full">
              <Panel defaultSize={75} minSize={30}>
                {/* Top: Viewport and Graph side-by-side */}
                <PanelGroup direction="horizontal" className="h-full">
                  <Panel defaultSize={50} minSize={20}>
                    <div className="w-full h-full">
                      <Viewport3D />
                    </div>
                  </Panel>

                  <PanelResizeHandle className="w-1.5 bg-border hover:bg-blue-500 transition-colors cursor-col-resize" />

                  <Panel defaultSize={50} minSize={20}>
                    <div className="w-full h-full overflow-hidden">
                      <NodeGraph />
                    </div>
                  </Panel>
                </PanelGroup>
              </Panel>

              <PanelResizeHandle className="h-1.5 bg-border hover:bg-blue-500 transition-colors cursor-row-resize" />

              <Panel defaultSize={25} minSize={10} maxSize={50}>
                <div className="h-full overflow-y-auto">
                  <PromptPanel />
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="w-1.5 bg-border hover:bg-blue-500 transition-colors cursor-col-resize" />

          {/* Right: Agent Monitor sidebar (now resizable) */}
          <Panel defaultSize={25} minSize={15} maxSize={40}>
            <div className="h-full overflow-y-auto">
              <AgentMonitor />
            </div>
          </Panel>
        </PanelGroup>
    </div>
  )
}
