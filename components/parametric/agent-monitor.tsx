'use client'

import { useStore } from '@/lib/store'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Phase } from '@/lib/types'

// ─── Live Timer ──────────────────────────────────────────────
function LiveTimer({ active, startTime }: { active: boolean; startTime: number | null }) {
  const [elapsed, setElapsed] = useState(0)
  const frozenRef = useRef<number | null>(null)

  useEffect(() => {
    if (active && startTime) {
      frozenRef.current = null
      const iv = setInterval(() => setElapsed(Date.now() - startTime), 50)
      return () => clearInterval(iv)
    } else if (!active && startTime && frozenRef.current === null) {
      frozenRef.current = Date.now() - startTime
      setElapsed(frozenRef.current)
    } else if (!active && !startTime) {
      setElapsed(0)
      frozenRef.current = null
    }
  }, [active, startTime])

  if (!startTime) return <span className="text-[10px] font-mono text-muted-foreground/50">—</span>
  const display = frozenRef.current ?? elapsed
  if (!active) return <span className="text-[10px] font-mono text-green-400">{(display / 1000).toFixed(1)}s</span>
  return <span className="text-[10px] font-mono text-yellow-400 animate-pulse">{(elapsed / 1000).toFixed(1)}s</span>
}

// ─── Animated Flow Arrow ─────────────────────────────────────
function FlowArrow({ active, done, message }: { active: boolean; done: boolean; message?: string }) {
  return (
    <div className="relative flex flex-col items-center py-1">
      {/* Animated line */}
      <div className="relative w-0.5 h-6 bg-border/30 overflow-hidden rounded-full">
        {(active || done) && (
          <div className={`absolute inset-x-0 rounded-full ${
            active 
              ? 'h-full bg-gradient-to-b from-blue-500 via-purple-500 to-blue-500 animate-pulse'
              : 'h-full bg-green-500/40'
          }`} />
        )}
        {active && (
          <div className="absolute w-full h-2 bg-white/60 rounded-full animate-[flowDown_1s_ease-in-out_infinite]" />
        )}
      </div>
      
      {/* Data message bubble */}
      {done && message && (
        <div className="mt-0.5 max-w-full px-2 py-0.5 rounded bg-white/5 border border-white/10">
          <p className="text-[9px] font-mono text-muted-foreground/70 truncate max-w-[260px]">
            → {message}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Score Bar ───────────────────────────────────────────────
function ScoreBar({ label, value, color, info }: { label: string; value: number; color: string; info: string }) {
  const [showInfo, setShowInfo] = useState(false)
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2 relative">
      <span className="text-[10px] text-muted-foreground w-20 shrink-0 flex items-center gap-1">
        {label}
        <button
          onMouseEnter={() => setShowInfo(true)}
          onMouseLeave={() => setShowInfo(false)}
          className="w-3 h-3 rounded-full bg-white/5 text-[8px] text-muted-foreground/50 hover:text-muted-foreground hover:bg-white/10 flex items-center justify-center"
        >
          ?
        </button>
      </span>
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className={'h-full rounded-full transition-all duration-1000 ease-out ' + color}
          style={{ width: pct + '%' }}
        />
      </div>
      <span className={'text-[10px] font-mono font-bold w-10 text-right ' + (
        pct >= 90 ? 'text-green-400' : pct >= 70 ? 'text-yellow-400' : 'text-red-400'
      )}>
        {pct}%
      </span>
      {showInfo && (
        <div className="absolute left-0 -top-8 z-30 px-2 py-1 rounded bg-black/90 border border-white/10 text-[9px] text-white/70 whitespace-nowrap shadow-lg">
          {info}
        </div>
      )}
    </div>
  )
}

// ─── Agent Card ──────────────────────────────────────────────
interface AgentCardProps {
  name: string
  role: string
  model: string
  icon: string
  colorBg: string
  colorBorder: string
  colorDot: string
  colorGlow: string
  isActive: boolean
  isDone: boolean
  tokens?: number
  cost?: number
  startTime: number | null
  output?: string
  expanded?: boolean
  onToggle?: () => void
}

function AgentCard({
  name, role, model, icon, colorBg, colorBorder, colorDot, colorGlow,
  isActive, isDone, tokens, cost, startTime, output, expanded, onToggle,
}: AgentCardProps) {
  return (
    <div
      className={`rounded-lg border p-3 transition-all duration-500 cursor-pointer ${
        isActive
          ? `${colorBg} ${colorBorder} shadow-lg shadow-${colorGlow}/10 scale-[1.01]`
          : isDone
          ? `bg-card/80 border-border`
          : 'bg-card/40 border-border/50 opacity-50'
      }`}
      onClick={onToggle}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full transition-all duration-300 ${
            isActive ? `${colorDot} animate-pulse shadow-lg shadow-${colorGlow}/50` :
            isDone ? 'bg-green-400' : 'bg-muted-foreground/20'
          }`} />
          <span className="text-xs font-bold text-foreground">{name}</span>
        </div>
        <div className="flex items-center gap-2">
          <LiveTimer active={isActive} startTime={startTime} />
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
            isActive ? 'bg-white/15 text-white animate-pulse' :
            isDone ? 'bg-green-400/15 text-green-400' :
            'bg-muted/50 text-muted-foreground/50'
          }`}>
            {isActive ? '● Live' : isDone ? '✓ Done' : '○ Idle'}
          </span>
        </div>
      </div>

      {/* Role and model */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] text-muted-foreground">{role}</p>
        <p className="text-[9px] font-mono text-muted-foreground/40">{model}</p>
      </div>

      {/* Stats row */}
      {(isDone || isActive) && (
        <div className="flex items-center gap-3 pt-1.5 border-t border-white/5">
          {tokens !== undefined && (
            <span className="text-[10px] font-mono text-muted-foreground">
              <span className="text-muted-foreground/50">tok:</span> ~{tokens}
            </span>
          )}
          {cost !== undefined && (
            <span className="text-[10px] font-mono text-muted-foreground">
              <span className="text-muted-foreground/50">cost:</span> ${cost.toFixed(4)}
            </span>
          )}
        </div>
      )}

      {/* Expandable output */}
      {expanded && isDone && output && (
        <div className="mt-2 pt-2 border-t border-white/5">
          <p className="text-[9px] font-mono text-muted-foreground/60 leading-relaxed whitespace-pre-wrap max-h-24 overflow-y-auto">
            {output}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────
function getAgentStates(phase: Phase) {
  const phases = ['parsing', 'building-tree', 'generating-code', 'compiling', 'scoring', 'done', 'iterating']
  const pi = phases.indexOf(phase)
  return {
    nemotron: { isActive: phase === 'parsing', isDone: pi > 0 || phase === 'done' },
    claudeLogic: { isActive: phase === 'building-tree' || phase === 'iterating', isDone: (pi > 1 || phase === 'done') && phase !== 'building-tree' },
    claudeCode: { isActive: phase === 'generating-code', isDone: (pi > 2 || phase === 'done') && phase !== 'generating-code' },
    scoring: { isActive: phase === 'scoring', isDone: phase === 'done' || phase === 'iterating' },
  }
}

/** Build per-agent message lists once per agentLog update (avoids repeated filter per card). */
function useAgentLogDerived(agentLog: Array<{ agent: string; message: string }>) {
  return useMemo(() => {
    const byAgent: Record<string, string[]> = {}
    for (const e of agentLog) {
      if (!byAgent[e.agent]) byAgent[e.agent] = []
      byAgent[e.agent].push(e.message)
    }
    const agentOutput = (name: string) => (byAgent[name] ?? []).join('\n')
    const flowMessage = (name: string) => {
      const arr = byAgent[name]
      if (!arr?.length) return undefined
      const msg = arr[arr.length - 1]!
      if (msg.length > 60) return msg.substring(0, 57) + '...'
      return msg
    }
    return { agentOutput, flowMessage }
  }, [agentLog])
}

export default function AgentMonitor() {
  const {
    phase,
    agentLog,
    scores,
    iteration,
    nemotronThinking,
    nemotronReasoning,
    designTree,
    scadCode,
    designHistory,
    agentMetrics,
  } = useStore(
    useShallow((s) => ({
      phase: s.phase,
      agentLog: s.agentLog,
      scores: s.scores,
      iteration: s.iteration,
      nemotronThinking: s.nemotronThinking,
      nemotronReasoning: s.nemotronReasoning,
      designTree: s.designTree,
      scadCode: s.scadCode,
      designHistory: s.designHistory,
      agentMetrics: s.agentMetrics,
    }))
  )
  const { agentOutput, flowMessage } = useAgentLogDerived(agentLog)
  const states = getAgentStates(phase)
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [agentTimers, setAgentTimers] = useState<Record<string, number | null>>({
    nemotron: null, claudeLogic: null, claudeCode: null, scoring: null,
  })

  // Track start times
  useEffect(() => {
    if (states.nemotron.isActive && !agentTimers.nemotron) setAgentTimers(t => ({ ...t, nemotron: Date.now() }))
    if (states.claudeLogic.isActive && !agentTimers.claudeLogic) setAgentTimers(t => ({ ...t, claudeLogic: Date.now() }))
    if (states.claudeCode.isActive && !agentTimers.claudeCode) setAgentTimers(t => ({ ...t, claudeCode: Date.now() }))
    if (states.scoring.isActive && !agentTimers.scoring) setAgentTimers(t => ({ ...t, scoring: Date.now() }))
    if (phase === 'idle') setAgentTimers({ nemotron: null, claudeLogic: null, claudeCode: null, scoring: null })
  }, [phase, states.nemotron.isActive, states.claudeLogic.isActive, states.claudeCode.isActive, states.scoring.isActive])

  const totalCost = Object.values(agentMetrics).reduce((sum, m) => sum + m.cost, 0)
  const isIdle = phase === 'idle'

  return (
    <div className="p-3 space-y-1">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-border">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${!isIdle ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground/30'}`} />
          <p className="text-xs font-bold text-foreground uppercase tracking-wider">Agent Pipeline</p>
        </div>
        {!isIdle && (
          <span className="text-[10px] text-muted-foreground font-mono">
            ~${totalCost.toFixed(4)} total
          </span>
        )}
      </div>

      {isIdle ? (
        <div className="text-center py-8 space-y-2">
          <p className="text-lg opacity-20 font-mono">⬡</p>
          <p className="text-muted-foreground text-xs">4 agents ready</p>
          <p className="text-muted-foreground/50 text-[10px]">Describe a 3D object to activate the pipeline</p>
        </div>
      ) : (
        <div className="space-y-0.5">

          {/* ── Nemotron (NVIDIA) ── */}
          <AgentCard
            name="Nemotron" role="Intent Parser — extracts design parameters from natural language"
            model="nvidia-nemotron-nano-9b-v2" icon="N"
            colorBg="bg-emerald-950" colorBorder="border-emerald-500/50"
            colorDot="bg-emerald-400" colorGlow="emerald"
            {...states.nemotron} tokens={agentMetrics['Nemotron']?.tokens ?? (states.nemotron.isDone ? 400 : undefined)}
            cost={agentMetrics['Nemotron']?.cost ?? (states.nemotron.isDone ? 0.0001 : undefined)}
            startTime={agentTimers.nemotron}
            output={agentOutput('Nemotron')}
            expanded={expandedAgent === 'nemotron'}
            onToggle={() => setExpandedAgent(expandedAgent === 'nemotron' ? null : 'nemotron')}
          />

          {/* Nemotron reasoning trace */}
          {(nemotronThinking || nemotronReasoning) && (
            <div className="mx-2 p-2 rounded-md bg-emerald-950/30 border border-emerald-500/10">
              <p className="text-[9px] text-emerald-400/70 font-semibold uppercase tracking-widest mb-1">
                REASONING TRACE
              </p>
              <p className="text-[10px] text-emerald-300/50 font-mono leading-relaxed line-clamp-3">
                {nemotronReasoning || nemotronThinking || '...'}
              </p>
            </div>
          )}

          <FlowArrow
            active={states.nemotron.isActive}
            done={states.nemotron.isDone}
            message={states.nemotron.isDone ? flowMessage('Nemotron') : undefined}
          />

          {/* ── Tree Logic ── */}
          <AgentCard
            name="Tree Logic" role="Tree Builder — constructs parametric dependency graph"
            model="claude-sonnet-4-5" icon="CL"
            colorBg="bg-purple-950" colorBorder="border-purple-500/50"
            colorDot="bg-purple-400" colorGlow="purple"
            {...states.claudeLogic} tokens={agentMetrics['Tree Logic']?.tokens ?? (states.claudeLogic.isDone ? 1300 : undefined)}
            cost={agentMetrics['Tree Logic']?.cost ?? (states.claudeLogic.isDone ? 0.0085 : undefined)}
            startTime={agentTimers.claudeLogic}
            output={designTree ? `Tree: ${JSON.stringify(designTree).substring(0, 200)}...` : agentOutput('Tree Logic')}
            expanded={expandedAgent === 'claudeLogic'}
            onToggle={() => setExpandedAgent(expandedAgent === 'claudeLogic' ? null : 'claudeLogic')}
          />

          <FlowArrow
            active={states.claudeLogic.isActive}
            done={states.claudeLogic.isDone}
            message={states.claudeLogic.isDone ? flowMessage('Tree Logic') : undefined}
          />

          {/* ── Script ── */}
          <AgentCard
            name="Script" role="Code Generator — produces Build123d Python from tree"
            model="claude-sonnet-4-5" icon="CC"
            colorBg="bg-blue-950" colorBorder="border-blue-500/50"
            colorDot="bg-blue-400" colorGlow="blue"
            {...states.claudeCode}
            tokens={agentMetrics['Script']?.tokens ?? (states.claudeCode.isDone ? 500 : undefined)}
            cost={agentMetrics['Script']?.cost ?? (states.claudeCode.isDone ? 0.0072 : undefined)}
            startTime={agentTimers.claudeCode}
            output={scadCode ? scadCode.substring(0, 300) : agentOutput('Script')}
            expanded={expandedAgent === 'claudeCode'}
            onToggle={() => setExpandedAgent(expandedAgent === 'claudeCode' ? null : 'claudeCode')}
          />

          <FlowArrow
            active={states.claudeCode.isActive}
            done={states.claudeCode.isDone}
            message={states.claudeCode.isDone ? flowMessage('Script') : undefined}
          />

          {/* ── Evaluation ── */}
          <AgentCard
            name="Evaluation" role="Deterministic Critic — evaluates geometry against spec"
            model="Pure Math — No LLM" icon="SE"
            colorBg="bg-amber-950" colorBorder="border-amber-500/50"
            colorDot="bg-amber-400" colorGlow="amber"
            {...states.scoring} tokens={0} cost={0}
            startTime={agentTimers.scoring}
            output={scores ? `Overall: ${scores.overall.toFixed(2)}` : undefined}
            expanded={expandedAgent === 'scoring'}
            onToggle={() => setExpandedAgent(expandedAgent === 'scoring' ? null : 'scoring')}
          />
        </div>
      )}

      {/* ── Score Breakdown ── */}
      {phase === 'done' && scores && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          {/* Big score */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-mono font-black ${
                scores.overall >= 0.9 ? 'text-green-400' : scores.overall >= 0.7 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {Math.round(scores.overall * 100)}%
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                scores.overall >= 0.9 ? 'bg-green-400/15 text-green-400' :
                scores.overall >= 0.7 ? 'bg-yellow-400/15 text-yellow-400' :
                'bg-red-400/15 text-red-400'
              }`}>
                {scores.overall >= 0.9 ? 'Excellent' : scores.overall >= 0.7 ? 'Good' : 'Needs Work'}
              </span>
            </div>
          </div>

          {/* Bars */}
          <div className="space-y-1.5">
            <ScoreBar label="Proportions" value={scores.proportion ?? 0} color="bg-blue-500" info="SpecMatch: Do actual dimensions match the target ratios?" />
            <ScoreBar label="Symmetry" value={scores.symmetry ?? 0} color="bg-green-500" info="SpecMatch: Does geometry meet the symmetry requirement?" />
            <ScoreBar label="Features" value={scores.featureCount ?? 0} color="bg-orange-500" info="SpecMatch: Are all requested features present in the BREP?" />
            <ScoreBar label="Quality" value={scores.parameterRange ?? 0} color="bg-purple-500" info="Quality: BREP validity, manifold check, compactness, complexity" />
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Iterations</p>
              <p className="text-sm font-mono font-bold text-foreground">{iteration}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Est. Cost</p>
              <p className="text-sm font-mono font-bold text-foreground">~${totalCost.toFixed(4)}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Agents</p>
              <p className="text-sm font-mono font-bold text-foreground">4</p>
            </div>
          </div>
          {/* Download report */}
          <button
            onClick={() => {
              const metrics = useStore.getState().agentMetrics
              const log = useStore.getState().agentLog
              const tree = useStore.getState().designTree
              const code = useStore.getState().scadCode
              const prompt = useStore.getState().prompt

              const lines = [
                '# Studio — Design Generation Report',
                '',
                `**Prompt:** ${prompt}`,
                `**Generated:** ${new Date().toLocaleString()}`,
                '',
                '## Pipeline Summary',
                '',
                `| Agent | Model | Tokens | Cost | Time |`,
                `|-------|-------|--------|------|------|`,
                `| Nemotron | nvidia-nemotron-nano-9b-v2 | ~${metrics['Nemotron']?.tokens ?? '?'} | $${(metrics['Nemotron']?.cost ?? 0).toFixed(4)} | ${metrics['Nemotron']?.endTime && agentTimers.nemotron ? ((metrics['Nemotron'].endTime - agentTimers.nemotron) / 1000).toFixed(1) + 's' : '?'} |`,
                `| Tree Logic | claude-sonnet-4-5 | ~${metrics['Tree Logic']?.tokens ?? '?'} | $${(metrics['Tree Logic']?.cost ?? 0).toFixed(4)} | ${metrics['Tree Logic']?.endTime && agentTimers.claudeLogic ? ((metrics['Tree Logic'].endTime - agentTimers.claudeLogic) / 1000).toFixed(1) + 's' : '?'} |`,
                `| Script | claude-sonnet-4-5 | ~${metrics['Script']?.tokens ?? '?'} | $${(metrics['Script']?.cost ?? 0).toFixed(4)} | ${metrics['Script']?.endTime && agentTimers.claudeCode ? ((metrics['Script'].endTime - agentTimers.claudeCode) / 1000).toFixed(1) + 's' : '?'} |`,
                `| Evaluation | Deterministic | 0 | $0.0000 | <0.1s |`,
                '',
                `**Total estimated cost:** ~$${Object.values(metrics).reduce((s, m) => s + m.cost, 0).toFixed(4)}`,
                '',
                '## Scores',
                '',
                `| Metric | Score |`,
                `|--------|-------|`,
                `| Overall | ${scores.overall.toFixed(2)} |`,
                `| Proportion | ${(scores.proportion ?? 0).toFixed(2)} |`,
                `| Symmetry | ${(scores.symmetry ?? 0).toFixed(2)} |`,
                `| Features | ${(scores.featureCount ?? 0).toFixed(2)} |`,
                `| Parameters | ${(scores.parameterRange ?? 0).toFixed(2)} |`,
                '',
                '## Design Tree',
                '',
                `- **Nodes:** ${tree ? Object.keys(tree.nodes).length : 0}`,
                `- **Parameters:** ${tree ? Object.keys(tree.parameters).length : 0}`,
                '',
                '## Generated Build123d Code',
                '',
                '```python',
                code || '# No code generated',
                '```',
                '',
                '## Agent Log',
                '',
                ...log.map(e => `- **${e.agent}:** ${e.message}`),
                '',
                '---',
                '*Generated by Studio*',
              ]

              const md = lines.join('\n')
              const blob = new Blob([md], { type: 'text/markdown' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'studio-report.md'
              a.click()
              URL.revokeObjectURL(url)
            }}
            className="w-full mt-2 py-1.5 rounded-md text-[10px] font-medium bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground border border-white/10 transition-colors"
          >
            ↓ Download Report (.md)
          </button>
        </div>
      )}

      {/* ── Agent Log ── */}
      {agentLog.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Agent Log <span className="text-muted-foreground/50 font-normal lowercase ml-1">({agentLog.length} events)</span>
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {agentLog.map((entry, i) => (
              <div key={i} className="flex items-start gap-1.5 py-0.5">
                <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${
                  entry.agent === 'Nemotron' ? 'bg-emerald-400' :
                  entry.agent === 'Tree Logic' ? 'bg-purple-400' :
                  entry.agent === 'Script' ? 'bg-blue-400' :
                  entry.agent === 'Scoring' ? 'bg-amber-400' :
                  'bg-gray-400'
                }`} />
                <div className="min-w-0">
                  <span className="text-[9px] font-semibold text-muted-foreground">{entry.agent}</span>
                  <p className="text-[10px] text-muted-foreground/70 break-words">{entry.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Version History ── */}
      {designHistory.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Version History <span className="text-muted-foreground/50 font-normal lowercase ml-1">({designHistory.length})</span>
          </p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {[...designHistory].reverse().map((v) => (
              <button
                key={v.id}
                onClick={() => useStore.getState().restoreVersion(v.id)}
                className="w-full flex items-center justify-between py-1 px-2 rounded text-left hover:bg-white/5 transition-colors group"
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-mono text-foreground truncate">{v.label}</p>
                  <p className="text-[9px] text-muted-foreground/40">
                    {new Date(v.timestamp).toLocaleTimeString()}
                    {v.scores?.overall ? ` · ${v.scores.overall.toFixed(2)}` : ''}
                  </p>
                </div>
                <span className="text-[9px] text-muted-foreground/30 group-hover:text-blue-400 shrink-0 ml-2">Restore</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── CSS Animation ── */}
      <style jsx>{`
        @keyframes flowDown {
          0% { top: -8px; opacity: 0; }
          50% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  )
}
