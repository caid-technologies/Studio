// ─── Core Parameter ───────────────────────────────────────────────
export interface DesignParameter {
  key: string
  value: number
  unit: string
  min?: number
  max?: number
  locked: boolean
  derivedFrom?: string
}

// ─── Dependency Graph Node ────────────────────────────────────────
export interface DesignNode {
  id: string
  op: 
    | 'cube' 
    | 'sphere' 
    | 'cylinder' 
    | 'union' 
    | 'difference' 
    | 'intersection' 
    | 'translate' 
    | 'rotate' 
    | 'scale' 
    | 'linear_extrude' 
    | 'rotate_extrude'
  label: string
  params: Record<string, number | string>
  children: string[]
  depends_on: string[]
}

// ─── The Core Product — Parametric Dependency Tree ────────────────
export interface DesignTree {
  design_id: string
  name: string
  prompt: string
  parameters: Record<string, DesignParameter>
  nodes: Record<string, DesignNode>
  root_id: string
  created_at: number
}

// ─── Scoring ──────────────────────────────────────────────────────
export interface ScoreResult {
  overall: number
  proportion: number
  symmetry: number
  featureCount: number
  parameterRange: number
  breakdown: string[]
}

// ─── Edit Script Protocol ─────────────────────────────────────────
export type EditType = 
  | 'SET_PARAM' 
  | 'ADD_NODE' 
  | 'REMOVE_NODE' 
  | 'CONNECT' 
  | 'DISCONNECT'

export interface EditAction {
  type: EditType
  node?: string
  key?: string
  value?: number | string
  from?: string
  to?: string
  justification: string
}

export interface EditScript {
  iteration: number
  edits: EditAction[]
  why: string[]
}

// ─── History ──────────────────────────────────────────────────────
export interface HistoryEntry {
  iteration: number
  scores: ScoreResult
  scadCode: string
  editScript: EditScript | null
  justification: string[]
  tree: DesignTree
}

// ─── Agent Log ────────────────────────────────────────────────────
export type AgentName = 
  | 'Nemotron' 
  | 'Tree Logic' 
  | 'Script' 
  | 'Evaluation' 
  | 'Scoring' 
  | 'System'

export interface AgentLogEntry {
  agent: AgentName
  message: string
  timestamp: number
}

// ─── Pipeline Phases ──────────────────────────────────────────────
export type Phase = 
  | 'idle' 
  | 'parsing' 
  | 'building-tree' 
  | 'generating-code' 
  | 'compiling' 
  | 'validating' 
  | 'scoring' 
  | 'iterating' 
  | 'done' 
  | 'error'
