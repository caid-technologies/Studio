import { create } from 'zustand'
import type {
  Phase,
  DesignTree,
  ScoreResult,
  HistoryEntry,
  AgentLogEntry,
  EditScript,
} from '@/lib/types'

interface ConstraintOverride {
  locked: boolean
  min?: number
  max?: number
}

interface StoreState {
  // ─── Core State ───────────────────────────────────────────
  prompt: string
  phase: Phase
  designTree: DesignTree | null
  scadCode: string
  scores: ScoreResult | null
  iteration: number
  history: HistoryEntry[]
  constraints: Record<string, ConstraintOverride>
  agentLog: AgentLogEntry[]
  stlBuffer: ArrayBuffer | null
  geometryMetrics: any
  isAutoRunning: boolean
  errorMessage: string
  designHistory: Array<{
    id: string
    timestamp: number
    prompt: string
    scadCode: string
    stlBuffer: ArrayBuffer | null
    scores: any
    tree: any
    label: string
  }>
  nemotronCritique: { critique: string; suggestions: string[] } | null
  nemotronThinking: string
  nemotronReasoning: string
  agentMetrics: Record<string, { tokens: number; cost: number; endTime: number }>

  // ─── Actions ──────────────────────────────────────────────
  setPrompt: (prompt: string) => void
  setPhase: (phase: Phase) => void
  setDesignTree: (tree: DesignTree) => void
  setScadCode: (code: string) => void
  setScores: (scores: ScoreResult) => void
  incrementIteration: () => void
  appendHistory: (entry: HistoryEntry) => void
  setConstraint: (
    paramKey: string,
    constraint: Partial<ConstraintOverride>
  ) => void
  appendAgentLog: (entry: AgentLogEntry) => void
  clearAgentLog: () => void
  setStlBuffer: (buffer: ArrayBuffer | null) => void
  setGeometryMetrics: (metrics: any) => void
  setAutoRunning: (val: boolean) => void
  setErrorMessage: (msg: string) => void
  setNemotronCritique: (
    critique: { critique: string; suggestions: string[] } | null
  ) => void
  setNemotronThinking: (text: string) => void
  setNemotronReasoning: (text: string) => void
  setAgentMetrics: (agent: string, metrics: { tokens: number; cost: number; endTime: number }) => void
  addToHistory: (entry: { prompt?: string; scadCode: string; stlBuffer: ArrayBuffer | null; scores: any; tree: any; label: string }) => void
  restoreVersion: (id: string) => void
  reset: () => void
}

const defaultState = {
  prompt: '',
  phase: 'idle' as Phase,
  designTree: null,
  scadCode: '',
  scores: null,
  iteration: 0,
  history: [],
  constraints: {},
  agentLog: [],
  stlBuffer: null,
  geometryMetrics: null,
  isAutoRunning: false,
  errorMessage: '',
  nemotronCritique: null,
  nemotronThinking: '',
  nemotronReasoning: '',
  agentMetrics: {},
  designHistory: [],
}

export const useStore = create<StoreState>()((set) => ({
  ...defaultState,

  setPrompt: (prompt) => set({ prompt }),
  setPhase: (phase) => set({ phase }),
  setDesignTree: (designTree) => set({ designTree }),
  setScadCode: (scadCode) => set({ scadCode }),
  setScores: (scores) => set({ scores }),
  incrementIteration: () =>
    set((state) => ({ iteration: state.iteration + 1 })),
  appendHistory: (entry) =>
    set((state) => ({ history: [...state.history, entry] })),
  setConstraint: (paramKey, constraint) =>
    set((state) => ({
      constraints: {
        ...state.constraints,
        [paramKey]: {
          ...state.constraints[paramKey],
          locked: state.constraints[paramKey]?.locked ?? false,
          ...constraint,
        },
      },
    })),
  appendAgentLog: (entry) =>
    set((state) => ({
      agentLog: [...state.agentLog.slice(-49), entry],
    })),
  clearAgentLog: () => set({ agentLog: [] }),
  setStlBuffer: (stlBuffer) => set({ stlBuffer }),
  setGeometryMetrics: (geometryMetrics) => set({ geometryMetrics }),
  setAutoRunning: (isAutoRunning) => set({ isAutoRunning }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  setNemotronCritique: (nemotronCritique) => set({ nemotronCritique }),
  setNemotronThinking: (nemotronThinking) => set({ nemotronThinking }),
  setNemotronReasoning: (nemotronReasoning) => set({ nemotronReasoning }),
  setAgentMetrics: (agent, metrics) =>
    set((s) => ({ agentMetrics: { ...s.agentMetrics, [agent]: metrics } })),
  addToHistory: (entry) => set((s) => ({
    designHistory: [...s.designHistory, {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      prompt: entry.prompt || s.prompt,
      scadCode: entry.scadCode,
      stlBuffer: entry.stlBuffer,
      scores: entry.scores,
      tree: entry.tree,
      label: entry.label,
    }]
  })),
  restoreVersion: (id) => set((s) => {
    const version = s.designHistory.find(h => h.id === id)
    if (!version) return {}
    return {
      prompt: version.prompt,
      scadCode: version.scadCode,
      stlBuffer: version.stlBuffer,
      scores: version.scores,
      designTree: version.tree,
      phase: 'done' as const,
    }
  }),
  reset: () =>
    set((state) => ({
      ...defaultState,
      prompt: state.prompt,
      designHistory: state.designHistory,
      agentMetrics: {},
    })),
}))

export type { StoreState }
