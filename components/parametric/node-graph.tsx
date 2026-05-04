'use client'

import { useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  type NodeProps,
  type Node,
  type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useStore } from '@/lib/store'
import type { DesignTree } from '@/lib/types'


// ─── Custom Node Components ───────────────────────────────────────

function ParameterNode({ data }: NodeProps) {
  return (
    <div className="bg-blue-950 border border-blue-500/50 rounded-lg p-3 min-w-[130px] shadow-lg">
      <div className="text-blue-400 text-[10px] font-bold uppercase tracking-wider mb-1">
        PARAM
      </div>
      <div className="text-white font-mono text-sm font-semibold">
        {data.label}
      </div>
      <div className="text-blue-300 text-xs mt-1 flex items-center justify-between">
        <span>{data.value}</span>
        <span className="text-blue-500">{data.unit}</span>
        {data.locked && <span className="ml-1">🔒</span>}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-blue-400 !border-blue-600 !w-2 !h-2"
      />
    </div>
  )
}

function GeometryNode({ data }: NodeProps) {
  const paramEntries = Object.entries(data.params ?? {}).slice(0, 2)
  const isSelected = data.isSelected
  const isEditing = data.isEditing
  
  return (
    <div className={`bg-green-950 border rounded-lg p-3 min-w-[140px] shadow-lg cursor-pointer transition-all ${
      isSelected ? 'border-green-300 ring-2 ring-green-400' : 'border-green-500/50'
    }`}>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-green-400 !border-green-600 !w-2 !h-2"
      />
      <div className="text-green-400 text-[10px] font-bold uppercase tracking-wider mb-1">
        {data.op}
      </div>
      <div className="text-white text-sm font-semibold">{data.label}</div>
      {paramEntries.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {paramEntries.map(([k, v]) => (
            <div key={k} className="text-green-300 text-xs font-mono">
              {k}: {String(v)}
            </div>
          ))}
        </div>
      )}
      {isEditing && <div className="text-xs text-green-200 mt-2">✎ Click to edit</div>}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-green-400 !border-green-600 !w-2 !h-2"
      />
    </div>
  )
}

function OperationNode({ data }: NodeProps) {
  const icons: Record<string, string> = {
    union: '⊕',
    difference: '⊖',
    intersection: '⊗',
  }
  const isSelected = data.isSelected
  
  return (
    <div className={`bg-orange-950 border rounded-lg p-3 min-w-[120px] shadow-lg cursor-pointer transition-all ${
      isSelected ? 'border-orange-300 ring-2 ring-orange-400' : 'border-orange-500/50'
    }`}>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-orange-400 !border-orange-600 !w-2 !h-2"
      />
      <div className="text-orange-400 text-[10px] font-bold uppercase tracking-wider mb-1">
        {icons[data.op] ?? '◈'} {data.op}
      </div>
      <div className="text-white text-sm font-semibold">{data.label}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-orange-400 !border-orange-600 !w-2 !h-2"
      />
    </div>
  )
}

function TransformNode({ data }: NodeProps) {
  const isSelected = data.isSelected
  
  return (
    <div className={`bg-purple-950 border rounded-lg p-3 min-w-[120px] shadow-lg cursor-pointer transition-all ${
      isSelected ? 'border-purple-300 ring-2 ring-purple-400' : 'border-purple-500/50'
    }`}>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-purple-400 !border-purple-600 !w-2 !h-2"
      />
      <div className="text-purple-400 text-[10px] font-bold uppercase tracking-wider mb-1">
        {data.op}
      </div>
      <div className="text-white text-sm font-semibold">{data.label}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-purple-400 !border-purple-600 !w-2 !h-2"
      />
    </div>
  )
}

// ─── Tree Conversion ──────────────────────────────────────────────

function convertTreeToFlow(
  tree: DesignTree,
  selectedNodeId?: string
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const GEOMETRY_OPS = ['cube', 'sphere', 'cylinder', 'linear_extrude', 'rotate_extrude']
  const OPERATION_OPS = ['union', 'difference', 'intersection']
  const TRANSFORM_OPS = ['translate', 'rotate', 'scale']

  // Layout rows
  const params = Object.values(tree.parameters)
  const designNodes = Object.values(tree.nodes)

  const geometryNodes = designNodes.filter((n) => GEOMETRY_OPS.includes(n.op))
  const operationNodes = designNodes.filter((n) => OPERATION_OPS.includes(n.op))
  const transformNodes = designNodes.filter((n) => TRANSFORM_OPS.includes(n.op))

  const X_SPACING = 200
  const centerX = (count: number, i: number) =>
    i * X_SPACING - ((count - 1) * X_SPACING) / 2 + 400

  // Parameter nodes — row 0
  params.forEach((p, i) => {
    nodes.push({
      id: `param_${p.key}`,
      type: 'parameter',
      position: { x: centerX(params.length, i), y: 0 },
      data: {
        label: p.key,
        value: p.value,
        unit: p.unit,
        locked: p.locked,
      },
    })
  })

  // Geometry nodes — row 1
  geometryNodes.forEach((n, i) => {
    nodes.push({
      id: n.id,
      type: 'geometry',
      position: { x: centerX(geometryNodes.length, i), y: 180 },
      data: { label: n.label, op: n.op, params: n.params, isSelected: selectedNodeId === n.id, nodeId: n.id },
    })
    n.depends_on.forEach((dep) => {
      edges.push({
        id: `e_param_${dep}_${n.id}`,
        source: `param_${dep}`,
        target: n.id,
        style: { stroke: '#3b82f6', strokeWidth: 1.5, opacity: 0.6 },
      })
    })
  })

  // Transform nodes — row 2
  transformNodes.forEach((n, i) => {
    nodes.push({
      id: n.id,
      type: 'transform',
      position: { x: centerX(transformNodes.length, i), y: 340 },
      data: { label: n.label, op: n.op, isSelected: selectedNodeId === n.id, nodeId: n.id },
    })
    n.children.forEach((childId) => {
      edges.push({
        id: `e_${childId}_${n.id}`,
        source: childId,
        target: n.id,
        style: { stroke: '#a855f7', strokeWidth: 1.5, opacity: 0.6 },
      })
    })
  })

  // Operation nodes — row 3
  operationNodes.forEach((n, i) => {
    nodes.push({
      id: n.id,
      type: 'operation',
      position: { x: centerX(operationNodes.length, i), y: 500 },
      data: { label: n.label, op: n.op, isSelected: selectedNodeId === n.id, nodeId: n.id },
    })
    n.children.forEach((childId) => {
      edges.push({
        id: `e_${childId}_${n.id}`,
        source: childId,
        target: n.id,
        style: { stroke: '#f97316', strokeWidth: 1.5, opacity: 0.6 },
      })
    })
  })

  return { nodes, edges }
}

// ─── Node type map (module-level for stable reference) ────────────
const nodeTypes = {
  parameter: ParameterNode,
  geometry: GeometryNode,
  operation: OperationNode,
  transform: TransformNode,
}

// ─── Properties Panel Component ───────────────────────────────────

interface PropertiesPanelProps {
  node: any
  nodeType: 'parameter' | 'geometry' | 'operation' | 'transform'
  onClose: () => void
  onEditSubmit: (instruction: string) => void
  isLoading: boolean
}

function PropertiesPanel({ node, nodeType, onClose, onEditSubmit, isLoading }: PropertiesPanelProps) {
  const [instruction, setInstruction] = useState('')

  if (!node) return null

  const nodeLabel = node.label || node.key || 'Unknown'
  const nodeOp = node.op || nodeType

  const props: Array<{ key: string; value: string }> = []
  if (nodeType === 'parameter') {
    props.push({ key: 'Value', value: `${node.value}${node.unit ? ' ' + node.unit : ''}` })
    if (node.locked) props.push({ key: 'Status', value: 'Locked' })
  } else {
    props.push({ key: 'Type', value: String(nodeOp).toUpperCase() })
    if (node.params) {
      Object.entries(node.params).forEach(([k, v]) => {
        props.push({ key: k, value: String(v) })
      })
    }
    if (node.depends_on?.length) props.push({ key: 'Deps', value: node.depends_on.join(', ') })
    if (node.children?.length) props.push({ key: 'Children', value: node.children.join(', ') })
  }

  const submit = () => {
    if (!instruction.trim() || isLoading) return
    onEditSubmit(instruction)
    setInstruction('')
  }

  return (
    <div className="absolute right-2 top-2 w-[220px] bg-[#0d0d0f]/95 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl z-20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white leading-none truncate">{nodeLabel}</p>
          <p className="text-[10px] text-white/30 font-mono mt-0.5">{String(nodeOp).toLowerCase()}</p>
        </div>
        <button
          onClick={onClose}
          className="w-5 h-5 rounded-full flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/8 transition-colors text-[10px] ml-2 shrink-0"
        >
          ✕
        </button>
      </div>

      {/* Divider */}
      <div className="mx-3 h-px bg-white/5" />

      {/* Properties */}
      <div className="px-3 py-2 space-y-0.5">
        {props.map(({ key, value }) => (
          <div key={key} className="flex items-baseline justify-between py-0.5">
            <span className="text-[10px] text-white/35 shrink-0">{key}</span>
            <span className="text-[10px] font-mono text-white/75 ml-2 text-right truncate max-w-[110px]">{value}</span>
          </div>
        ))}
      </div>

      {/* NL Edit — for all node types */}
      {(
        <div className="px-3 pb-3 pt-1.5">
          <div className="mx-0 h-px bg-white/5 mb-2" />
          <div className="flex items-center gap-1">
            <input
              type="text"
              placeholder="Describe changes..."
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              disabled={isLoading}
              className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-white placeholder:text-white/20 outline-none focus:border-blue-500/50 transition-colors"
            />
            <button
              onClick={submit}
              disabled={isLoading || !instruction.trim()}
              className="w-7 h-7 rounded-lg bg-blue-600/80 hover:bg-blue-500/80 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white transition-colors shrink-0"
            >
              {isLoading ? (
                <span className="w-3 h-3 border border-white/60 border-t-transparent rounded-full animate-spin block" />
              ) : (
                <span className="text-[12px] leading-none">→</span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────

export default function NodeGraph() {
  const { designTree, phase, setDesignTree } = useStore()
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [editInstruction, setEditInstruction] = useState('')
  const [isEditLoading, setIsEditLoading] = useState(false)

  const handleNodeClick = (nodeId: string) => {
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null)
      return
    }
    setSelectedNodeId(nodeId)
    setEditInstruction('')
  }

  const handleEditSubmit = async () => {
    if (!selectedNodeId || !designTree || !editInstruction.trim()) return

    setIsEditLoading(true)
    try {
      // Find the node in the design tree
      const nodeToEdit = Object.values(designTree.nodes).find((n) => n.id === selectedNodeId)
      if (!nodeToEdit) {
        console.error('[node-graph] Node not found:', selectedNodeId)
        return
      }

      // Call the edit-node API
      const response = await fetch('/api/edit-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: editInstruction,
          node: {
            id: nodeToEdit.id,
            type: 'geometry',
            label: nodeToEdit.label,
            op: nodeToEdit.op,
            params: nodeToEdit.params,
          },
          fullTree: designTree,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        console.error('[node-graph] Edit failed:', error)
        return
      }

      const { params: updatedParams } = await response.json()
      console.log('[node-graph] Updated params:', updatedParams)

      // Update the node in the design tree
      const updatedTree: DesignTree = {
        ...designTree,
        nodes: {
          ...designTree.nodes,
          [selectedNodeId]: {
            ...nodeToEdit,
            params: { ...nodeToEdit.params, ...updatedParams },
          },
        },
      }

      setDesignTree(updatedTree)

      // Regenerate Build123d code from updated tree and recompile
      try {
        const store = useStore.getState()

        store.appendAgentLog({ agent: 'System', message: 'Regenerating code after node edit...', timestamp: Date.now() })
        store.setPhase('generating-code')

        // Call the generate API to get new code from updated tree
        const codeRes = await fetch('/api/generate-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tree: updatedTree }),
        })

        if (codeRes.ok) {
          const { code } = await codeRes.json()
          store.setScadCode(code)
          store.appendAgentLog({ agent: 'Script', message: `Regenerated ${code.split('\n').length} lines of Build123d code`, timestamp: Date.now() })

          // Compile
          store.setPhase('compiling')
          store.appendAgentLog({ agent: 'System', message: 'Recompiling geometry...', timestamp: Date.now() })

          const compileRes = await fetch('/api/compile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          })

          if (compileRes.ok) {
            const stlBuffer = await compileRes.arrayBuffer()
            store.setStlBuffer(stlBuffer)
            store.appendAgentLog({ agent: 'System', message: `Recompiled successfully (${(stlBuffer.byteLength / 1024).toFixed(1)} KB)`, timestamp: Date.now() })
            useStore.getState().addToHistory({
              scadCode: code,
              stlBuffer: stlBuffer,
              scores: null,
              tree: updatedTree,
              label: `Edit: ${editInstruction.substring(0, 30)}`,
            })
          }
        }
        store.setPhase('done')
      } catch (regenErr) {
        console.error('[node-graph] Regeneration failed:', regenErr)
        useStore.getState().setPhase('done')
      }

      // Close the dialog
      setSelectedNodeId(null)
      setEditInstruction('')
    } catch (error) {
      console.error('[node-graph] Edit error:', error)
    } finally {
      setIsEditLoading(false)
    }
  }

  if (!designTree) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#0a0a0a] gap-2">
        <p className="text-muted-foreground/30 text-xs">Parametric graph</p>
        <p className="text-muted-foreground/15 text-[10px]">Generate a design to see nodes</p>
      </div>
    )
  }

  const { nodes, edges } = convertTreeToFlow(designTree, selectedNodeId ?? undefined)

  const animatedEdges = edges.map((e) => ({
    ...e,
    animated: phase === 'building-tree',
  }))

  return (
    <div className="w-full h-full bg-[#0a0a0a] relative">
      <ReactFlow
        nodes={nodes}
        edges={animatedEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => handleNodeClick(node.id)}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#222" gap={20} />
        <Controls
          className="!bg-card !border-border"
          showInteractive={false}
        />
      </ReactFlow>

      {selectedNodeId && designTree && (() => {
        // Determine if it's a parameter or design node
        if (selectedNodeId.startsWith('param_')) {
          const paramKey = selectedNodeId.replace('param_', '')
          const param = Object.values(designTree.parameters).find(p => p.key === paramKey)
          if (!param) return null
          return (
            <PropertiesPanel
              node={param}
              nodeType="parameter"
              onClose={() => setSelectedNodeId(null)}
              onEditSubmit={async (instruction) => {
                if (!designTree || !instruction.trim()) return
                setIsEditLoading(true)
                try {
                  const store = useStore.getState()
                  const currentValue = param.value

                  // Try to parse the instruction locally first (fast, no API call)
                  let newValue: number | null = null
                  const lower = instruction.toLowerCase().trim()

                  // ── Percentage changes: "make it 23.65% bigger", "increase by 50%", "reduce 10%" ──
                  const pctUpMatch = lower.match(/(\d+\.?\d*)\s*%\s*(?:bigger|larger|more|increase|up|greater|higher|taller|wider|thicker)/)
                  const pctDownMatch = lower.match(/(\d+\.?\d*)\s*%\s*(?:smaller|less|decrease|down|lower|shorter|narrower|thinner|reduce)/)
                  const pctGenericMatch = lower.match(/(?:increase|grow|scale up|bigger|larger|more|up)\s*(?:by)?\s*(\d+\.?\d*)\s*%/)
                  const pctGenericDownMatch = lower.match(/(?:decrease|shrink|scale down|smaller|less|reduce|down)\s*(?:by)?\s*(\d+\.?\d*)\s*%/)
                  const pctPlainMatch = lower.match(/(\d+\.?\d*)\s*%/)

                  if (pctUpMatch) newValue = currentValue * (1 + parseFloat(pctUpMatch[1]) / 100)
                  else if (pctDownMatch) newValue = currentValue * (1 - parseFloat(pctDownMatch[1]) / 100)
                  else if (pctGenericMatch) newValue = currentValue * (1 + parseFloat(pctGenericMatch[1]) / 100)
                  else if (pctGenericDownMatch) newValue = currentValue * (1 - parseFloat(pctGenericDownMatch[1]) / 100)

                  // ── Multipliers: "double", "triple", "half", "quarter" ──
                  else if (lower.includes('double')) newValue = currentValue * 2
                  else if (lower.includes('triple')) newValue = currentValue * 3
                  else if (lower.includes('quadruple')) newValue = currentValue * 4
                  else if (lower.includes('halve') || lower.includes('half')) newValue = currentValue / 2
                  else if (lower.includes('quarter')) newValue = currentValue / 4

                  // ── Relative: "make it bigger/smaller" without a number → default 20% ──
                  else if (/\b(bigger|larger|more|increase|taller|wider|thicker|longer)\b/.test(lower) && !pctPlainMatch) newValue = currentValue * 1.2
                  else if (/\b(smaller|less|decrease|shorter|narrower|thinner|reduce|compact)\b/.test(lower) && !pctPlainMatch) newValue = currentValue * 0.8

                  // ── Absolute set: "set to 50", "change to 100", "make it 25" ──
                  else if (/(?:set|change|make)\s*(?:it|to|=)?\s*(\d+\.?\d*)/.test(lower)) {
                    const m = lower.match(/(?:set|change|make)\s*(?:it|to|=)?\s*(\d+\.?\d*)/)
                    if (m) newValue = parseFloat(m[1])
                  }

                  // ── Arithmetic: "increase by 10", "add 5", "subtract 3" ──
                  else {
                    const incMatch = lower.match(/(?:increase|add|plus|\+)\s*(?:by)?\s*(\d+\.?\d*)/)
                    const decMatch = lower.match(/(?:decrease|subtract|reduce|minus|\-)\s*(?:by)?\s*(\d+\.?\d*)/)
                    const mulMatch = lower.match(/(?:multiply|times|x)\s*(?:by)?\s*(\d+\.?\d*)/)
                    const divMatch = lower.match(/(?:divide)\s*(?:by)?\s*(\d+\.?\d*)/)

                    if (incMatch) newValue = currentValue + parseFloat(incMatch[1])
                    else if (decMatch) newValue = currentValue - parseFloat(decMatch[1])
                    else if (mulMatch) newValue = currentValue * parseFloat(mulMatch[1])
                    else if (divMatch && parseFloat(divMatch[1]) !== 0) newValue = currentValue / parseFloat(divMatch[1])
                  }

                  // ── Plain percentage with context: "23.65% bigger" already caught above ──
                  // ── If just a percentage with no direction word, treat as increase ──
                  if (newValue === null && pctPlainMatch) {
                    newValue = currentValue * (1 + parseFloat(pctPlainMatch[1]) / 100)
                  }

                  // ── Plain number: user just typed "50" ──
                  if (newValue === null && /^\d+\.?\d*$/.test(lower)) newValue = parseFloat(lower)

                  // Round to 2 decimal places for cleanliness
                  if (newValue !== null) newValue = Math.round(newValue * 100) / 100

                  // If local parsing failed, try the API
                  if (newValue === null) {
                    try {
                      const response = await fetch('/api/edit-node', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          instruction: 'The parameter "' + param.key + '" currently has value ' + currentValue + ' (unit: ' + (param.unit || 'none') + '). The user says: "' + instruction + '". Return the updated value for this parameter as JSON: {"' + param.key + '": newValue}',
                          node: { id: paramKey, type: 'geometry', label: param.key, op: 'cube', params: { [param.key]: currentValue } },
                          fullTree: designTree,
                        }),
                      })
                      if (response.ok) {
                        const { params: updatedParams } = await response.json()
                        const val = updatedParams[param.key] ?? updatedParams.value
                        if (val !== undefined && typeof val === 'number') newValue = val
                      } else {
                        const errBody = await response.json().catch(() => ({}))
                        console.error('[node-graph] API edit-node error:', response.status, errBody)
                      }
                    } catch (apiErr) {
                      console.error('[node-graph] API call failed:', apiErr)
                    }
                  }

                  // Last resort: extract any number from instruction
                  if (newValue === null) {
                    const anyNum = instruction.match(/(\d+\.?\d*)/)
                    if (anyNum) newValue = parseFloat(anyNum[1])
                  }

                  if (newValue === null) {
                    store.appendAgentLog({ agent: 'System', message: 'Could not parse edit instruction: ' + instruction, timestamp: Date.now() })
                    setIsEditLoading(false)
                    return
                  }

                  // Clamp to min/max if defined
                  if (param.min !== undefined && newValue < param.min) newValue = param.min
                  if (param.max !== undefined && newValue > param.max) newValue = param.max

                  const updatedTree = {
                    ...designTree,
                    parameters: {
                      ...designTree.parameters,
                      [paramKey]: { ...param, value: newValue },
                    },
                  }

                  setDesignTree(updatedTree)
                  store.appendAgentLog({ agent: 'System', message: paramKey + ': ' + currentValue + ' → ' + newValue + ' (' + instruction + ')', timestamp: Date.now() })
                  store.setPhase('generating-code')

                  const codeRes = await fetch('/api/generate-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tree: updatedTree }),
                  })

                  if (codeRes.ok) {
                    const { code } = await codeRes.json()
                    store.setScadCode(code)
                    store.appendAgentLog({ agent: 'System', message: 'Regenerated ' + code.split('\n').length + ' lines', timestamp: Date.now() })
                    store.setPhase('compiling')

                    const compileRes = await fetch('/api/compile', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ code }),
                    })

                    if (compileRes.ok) {
                      const stlBuffer = await compileRes.arrayBuffer()
                      store.setStlBuffer(stlBuffer)
                      store.appendAgentLog({ agent: 'System', message: 'Recompiled (' + (stlBuffer.byteLength / 1024).toFixed(1) + ' KB)', timestamp: Date.now() })
                      store.addToHistory({
                        scadCode: code,
                        stlBuffer: stlBuffer,
                        scores: null,
                        tree: updatedTree,
                        label: paramKey + ': ' + currentValue + ' → ' + newValue,
                      })
                    } else {
                      const errBody = await compileRes.json().catch(() => ({}))
                      store.appendAgentLog({ agent: 'System', message: 'Compile failed: ' + (errBody.error || 'unknown'), timestamp: Date.now() })
                    }
                  } else {
                    store.appendAgentLog({ agent: 'System', message: 'Code generation failed', timestamp: Date.now() })
                  }

                  store.setPhase('done')
                  setSelectedNodeId(null)
                } catch (error) {
                  console.error('[node-graph] Param edit error:', error)
                  useStore.getState().appendAgentLog({ agent: 'System', message: 'Edit failed: ' + (error instanceof Error ? error.message : 'unknown'), timestamp: Date.now() })
                  useStore.getState().setPhase('done')
                } finally {
                  setIsEditLoading(false)
                }
              }}
              isLoading={isEditLoading}
            />
          )
        }
        
        const designNode = designTree.nodes[selectedNodeId]
        if (!designNode) return null
        
        const GEOMETRY_OPS = ['cube', 'sphere', 'cylinder', 'linear_extrude', 'rotate_extrude', 'box', 'cone', 'torus']
        const OPERATION_OPS = ['union', 'difference', 'intersection']
        const TRANSFORM_OPS = ['translate', 'rotate', 'scale']
        
        const nodeType = GEOMETRY_OPS.includes(designNode.op) ? 'geometry' as const
          : OPERATION_OPS.includes(designNode.op) ? 'operation' as const
          : TRANSFORM_OPS.includes(designNode.op) ? 'transform' as const
          : 'geometry' as const
        
        return (
          <PropertiesPanel
            node={designNode}
            nodeType={nodeType}
            onClose={() => setSelectedNodeId(null)}
            onEditSubmit={async (instruction) => {
              if (!selectedNodeId || !designTree || !instruction.trim()) return
              setIsEditLoading(true)
              try {
                const nodeToEdit = Object.values(designTree.nodes).find((n) => n.id === selectedNodeId)
                if (!nodeToEdit) return

                const response = await fetch('/api/edit-node', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    instruction: instruction,
                    node: { id: nodeToEdit.id, type: 'geometry', label: nodeToEdit.label, op: nodeToEdit.op, params: nodeToEdit.params },
                    fullTree: designTree,
                  }),
                })

                if (!response.ok) return

                const { params: updatedParams } = await response.json()

                const updatedTree = {
                  ...designTree,
                  nodes: {
                    ...designTree.nodes,
                    [selectedNodeId]: { ...nodeToEdit, params: { ...nodeToEdit.params, ...updatedParams } },
                  },
                }

                setDesignTree(updatedTree)

                const store = useStore.getState()
                store.appendAgentLog({ agent: 'System', message: 'Regenerating code after edit: ' + instruction, timestamp: Date.now() })
                store.setPhase('generating-code')

                const codeRes = await fetch('/api/generate-code', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tree: updatedTree }),
                })

                if (codeRes.ok) {
                  const { code } = await codeRes.json()
                  store.setScadCode(code)
                  store.setPhase('compiling')

                  const compileRes = await fetch('/api/compile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code }),
                  })

                  if (compileRes.ok) {
                    const stlBuffer = await compileRes.arrayBuffer()
                    store.setStlBuffer(stlBuffer)
                    store.addToHistory({
                      scadCode: code,
                      stlBuffer: stlBuffer,
                      scores: null,
                      tree: updatedTree,
                      label: 'Edit: ' + instruction.substring(0, 30),
                    })
                  }
                }
                store.setPhase('done')
                setSelectedNodeId(null)
              } catch (error) {
                console.error('[node-graph] Edit error:', error)
                useStore.getState().setPhase('done')
              } finally {
                setIsEditLoading(false)
              }
            }}
            isLoading={isEditLoading}
          />
        )
      })()}
    </div>
  )
}
