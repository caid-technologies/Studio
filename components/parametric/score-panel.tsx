'use client'

import { useRef, useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import type { StoreState } from '@/lib/store'
import { getScoreColor, getScoreLabel, getScoreBgColor } from '@/lib/scoring'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import {
  Play,
  RotateCcw,
  Zap,
  Square,
  MessageSquare,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import type { HistoryEntry } from '@/lib/types'

// ─── Agent color map ──────────────────────────────────────────────
const AGENT_COLORS: Record<string, string> = {
  Nemotron: 'bg-blue-400',
  'Tree Logic': 'bg-purple-400',
  Script: 'bg-violet-400',
  Evaluation: 'bg-orange-400',
  Scoring: 'bg-green-400',
  System: 'bg-gray-400',
}

// ─── SSE streaming helper ─────────────────────────────────────────
async function streamIterate(
  store: StoreState,
  onDone?: () => void
) {
  if (!store.designTree || !store.scores) return

  const body = {
    tree: store.designTree,
    scores: store.scores,
    prompt: store.prompt,
    constraints: store.constraints,
    iteration: store.iteration + 1,
  }

  let latestTree = store.designTree
  let latestCode = store.scadCode
  let latestScores = store.scores

  try {
    const response = await fetch('/api/iterate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok || !response.body) return

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
          switch (event.type) {
            case 'phase':
              store.setPhase(event.phase)
              break
            case 'tree':
              latestTree = event.data
              store.setDesignTree(event.data)
              break
            case 'code':
              latestCode = event.data
              store.setScadCode(event.data)
              break
            case 'scores':
              latestScores = event.data
              store.setScores(event.data)
              store.appendHistory({
                iteration: store.iteration + 1,
                scores: event.data,
                scadCode: latestCode,
                editScript: null,
                justification: [],
                tree: latestTree,
              })
              store.incrementIteration()
              break
            case 'agent_log':
              store.appendAgentLog({
                agent: event.agent,
                message: event.message,
                timestamp: Date.now(),
              })
              break
            case 'edit_script':
              break
          }
        } catch {}
      }
    }
  } finally {
    onDone?.()
  }
}

// ─── Main Component ───────────────────────────────────────────────
export default function ScorePanel() {
  const store = useStore()
  const {
    scores,
    history,
    iteration,
    phase,
    designTree,
    constraints,
    agentLog,
    isAutoRunning,
    nemotronCritique,
    scadCode,
    prompt,
  } = store

  const logEndRef = useRef<HTMLDivElement>(null)
  const [critiqueOpen, setCritiqueOpen] = useState(false)
  const [critiqueLoading, setCritiqueLoading] = useState(false)

  const isActive = !['idle', 'done', 'error'].includes(phase)

  // Auto-scroll agent log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [agentLog.length])

  // Run one iteration
  async function handleStep() {
    if (isActive || !scores) return
    store.setPhase('iterating')
    await streamIterate(store)
    store.setPhase('done')
  }

  // Run 3 iterations
  async function handleRunThree() {
    if (isActive || !scores) return
    for (let i = 0; i < 3; i++) {
      if (!store.scores) break
      store.setPhase('iterating')
      await streamIterate(store)
      store.setPhase('done')
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  // Auto-run until target score
  async function handleAuto() {
    if (isActive) return
    store.setAutoRunning(true)
    let iters = 0
    while (store.isAutoRunning && iters < 10) {
      const currentScore = useStore.getState().scores?.overall ?? 0
      if (currentScore >= 0.85) break
      store.setPhase('iterating')
      await streamIterate(store)
      store.setPhase('done')
      await new Promise((r) => setTimeout(r, 300))
      iters++
    }
    store.setAutoRunning(false)
    store.setPhase('done')
  }

  // Get Nemotron critique
  async function handleCritique() {
    if (!scadCode || !scores) return
    setCritiqueLoading(true)
    try {
      const res = await fetch('/api/critique', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scadCode, scores, prompt }),
      })
      const data = await res.json()
      store.setNemotronCritique(data)
    } catch {
      store.setNemotronCritique({
        critique: 'Critique unavailable.',
        suggestions: [],
      })
    } finally {
      setCritiqueLoading(false)
    }
  }

  const chartData = history.map((h: HistoryEntry) => ({
    iteration: h.iteration,
    score: h.scores.overall,
  }))

  return (
    <div className="flex flex-col h-full text-sm">

      {/* ── Score Header ── */}
      <div className="p-4 border-b border-border">
        {!scores ? (
          <p className="text-muted-foreground text-xs">
            No score yet — generate a design first
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span
                className={`text-3xl font-mono font-bold ${getScoreColor(scores.overall)}`}
              >
                {scores.overall.toFixed(2)}
              </span>
              <Badge className={getScoreBgColor(scores.overall)}>
                {getScoreLabel(scores.overall)}
              </Badge>
            </div>
            {iteration > 0 && (
              <p className="text-muted-foreground text-xs">
                Iteration {iteration}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Sub-scores ── */}
      {scores && (
        <div className="p-4 border-b border-border space-y-2">
          {[
            { label: 'Proportion', value: scores.proportion },
            { label: 'Symmetry', value: scores.symmetry },
            { label: 'Features', value: scores.featureCount },
            { label: 'Params', value: scores.parameterRange },
          ].map(({ label, value }) => (
            <div key={label} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className={getScoreColor(value)}>
                  {value.toFixed(2)}
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    value >= 0.8
                      ? 'bg-green-400'
                      : value >= 0.6
                      ? 'bg-yellow-400'
                      : 'bg-red-400'
                  }`}
                  style={{ width: `${value * 100}%` }}
                />
              </div>
            </div>
          ))}
          {scores.breakdown.length > 0 && (
            <div className="pt-1 space-y-1">
              {scores.breakdown.map((msg, i) => (
                <p key={i} className="text-red-400 text-xs">
                  · {msg}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Score History Chart ── */}
      {chartData.length > 1 && (
        <div className="px-4 pt-3 pb-1 border-b border-border">
          <p className="text-muted-foreground text-xs mb-2">Score history</p>
          <div className="h-16">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <XAxis dataKey="iteration" hide />
                <YAxis domain={[0, 1]} hide />
                <Tooltip
                  contentStyle={{
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '6px',
                    fontSize: '11px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#4ade80"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Iteration Controls ── */}
      <div className="p-4 border-b border-border space-y-2">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          Iterate
        </p>
        {isAutoRunning ? (
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => store.setAutoRunning(false)}
          >
            <Square className="w-3 h-3 mr-2" />
            Stop Auto
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleStep}
              disabled={isActive || !scores}
            >
              <Play className="w-3 h-3 mr-2" />
              Step
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleRunThree}
              disabled={isActive || !scores}
            >
              <RotateCcw className="w-3 h-3 mr-2" />
              Run ×3
            </Button>
            <Button
              size="sm"
              className="w-full bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/30"
              onClick={handleAuto}
              disabled={isActive || !scores}
            >
              <Zap className="w-3 h-3 mr-2" />
              Auto → 0.85
            </Button>
          </>
        )}
      </div>

      {/* ── Parameter Constraints ── */}
      {designTree && Object.keys(designTree.parameters).length > 0 && (
        <div className="p-4 border-b border-border">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider mb-2">
            Lock Parameters
          </p>
          <div className="space-y-2">
            {Object.values(designTree.parameters).map((param) => {
              const isLocked = constraints[param.key]?.locked ?? false
              return (
                <div
                  key={param.key}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-xs ${
                        isLocked
                          ? 'text-yellow-400'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {param.key}
                    </span>
                    <span className="text-muted-foreground/50 text-xs">
                      {param.value}
                      {param.unit}
                    </span>
                  </div>
                  <Switch
                    checked={isLocked}
                    onCheckedChange={(checked) =>
                      store.setConstraint(param.key, { locked: checked })
                    }
                    className="scale-75"
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Agent Log ── */}
      <div className="flex-1 flex flex-col min-h-0 border-b border-border">
        <div className="flex items-center justify-between px-4 py-2">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            Agent Log
          </p>
          <button
            onClick={store.clearAgentLog}
            className="text-muted-foreground/50 hover:text-muted-foreground text-xs"
          >
            clear
          </button>
        </div>
        <ScrollArea className="flex-1 px-4 pb-2">
          <div className="space-y-1.5">
            {agentLog.map((entry, i) => (
              <div key={i} className="flex items-start gap-2">
                <div
                  className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                    AGENT_COLORS[entry.agent] ?? 'bg-gray-400'
                  }`}
                />
                <div>
                  <span className="text-muted-foreground/70 text-[10px]">
                    {entry.agent}
                  </span>
                  <p className="text-xs text-foreground/80 leading-snug">
                    {entry.message}
                  </p>
                </div>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </ScrollArea>
      </div>

      {/* ── Nemotron Critique ── */}
      <div className="p-4">
        <button
          className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground mb-2"
          onClick={() => setCritiqueOpen((o) => !o)}
        >
          <span className="flex items-center gap-1.5">
            <MessageSquare className="w-3 h-3" />
            Nemotron Critique
          </span>
          {critiqueOpen ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>

        {critiqueOpen && (
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleCritique}
              disabled={critiqueLoading || !scadCode}
            >
              {critiqueLoading ? 'Analyzing...' : 'Get Critique'}
            </Button>
            {nemotronCritique && (
              <div className="space-y-2">
                <p className="text-xs text-foreground/80 italic">
                  "{nemotronCritique.critique}"
                </p>
                <div className="flex flex-wrap gap-1">
                  {nemotronCritique.suggestions.map((s, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="text-[10px] text-muted-foreground"
                    >
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
