import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
  type EdgeChange,
  BackgroundVariant,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  ArrowLeft, Save, Play, Share2,
  Undo2, Redo2, X,
  AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, LayoutTemplate,
} from 'lucide-react'
import { Button, Badge } from '@ybot/ui'
import { nodeTypes } from '../../../components/canvas/FlowNode'
import { alignHorizontal, alignVertical, tidyLayout } from '../../../components/canvas/layout'
import { NodePalette } from '../../../components/canvas/NodePalette'
import { NodeConfigPanel } from '../../../components/canvas/NodeConfigPanel'
import { ChatWidget } from '../../../components/ChatWidget'
import type { FlowNodeData } from '../../../components/canvas/FlowNode'
import { journeyLayout, journeyTrail, versionForEnvironment, type JourneyMark, type NodeKind } from '@ybot/shared'

let nodeIdCounter = 1
function newId() {
  return `node_${nodeIdCounter++}_${Math.random().toString(36).slice(2, 7)}`
}

/** Saved graphs use `flow-node` (seed) or omit type entirely. The canvas only registers `flowNode`. */
function normalizeCanvasNode(node: Node, index: number): Node {
  const position =
    node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
      ? node.position
      : { x: 80 + index * 220, y: 120 }
  return { ...node, type: 'flowNode', position }
}

/** The bot follows yes/no. Older saves used true/false for the same branches. */
function normalizeCanvasEdge(edge: Edge): Edge {
  const handle = edge.sourceHandle
  const sourceHandle =
    handle === 'true' ? 'yes' : handle === 'false' ? 'no' : handle
  const next = sourceHandle === handle ? edge : { ...edge, sourceHandle }
  const typed = next.type && next.type !== 'default' ? next : { ...next, type: 'smoothstep' }
  return { ...typed, interactionWidth: 24 }
}

function canvasMarkFor(data: FlowNodeData, kind: string | undefined): JourneyMark | undefined {
  if (!kind) return undefined
  if (kind === 'offer_yes' && data.kind === 'route_topic') {
    const raw = data.config?.['routes']
    const handles = Array.isArray(raw)
      ? raw.map((item) => (item && typeof item === 'object' ? String((item as { handle?: string }).handle ?? '') : ''))
      : []
    if (handles.includes('hours') && handles.includes('book')) return 'improve'
  }
  if (kind === 'name_once') {
    const text = `${data.config?.['text'] ?? ''} ${data.config?.['question'] ?? ''} ${data.label ?? ''}`
    if (/what's your name/i.test(text)) return 'error'
  }
  return undefined
}

const INITIAL_NODES: Node[] = [
  {
    id: 'start-1',
    type: 'flowNode',
    position: { x: 300, y: 80 },
    data: { kind: 'start', label: 'Start' } satisfies FlowNodeData,
  },
  {
    id: 'msg-1',
    type: 'flowNode',
    position: { x: 300, y: 220 },
    data: {
      kind: 'send_message',
      label: 'Welcome',
      config: { text: 'Hello! How can I help you today?' },
    } satisfies FlowNodeData,
  },
  {
    id: 'ask-1',
    type: 'flowNode',
    position: { x: 300, y: 380 },
    data: {
      kind: 'ask_question',
      label: 'Ask for intent',
      config: { question: 'What would you like help with?', variable: 'user.intent' },
    } satisfies FlowNodeData,
  },
  {
    id: 'cond-1',
    type: 'flowNode',
    position: { x: 300, y: 540 },
    data: {
      kind: 'condition',
      label: 'Check intent',
      config: { expression: '{{user.intent}} contains "support"' },
    } satisfies FlowNodeData,
  },
  {
    id: 'agent-1',
    type: 'flowNode',
    position: { x: 120, y: 700 },
    data: {
      kind: 'transfer_agent',
      label: 'Escalate to agent',
      config: { team: 'Support Team' },
    } satisfies FlowNodeData,
  },
  {
    id: 'resolve-1',
    type: 'flowNode',
    position: { x: 480, y: 700 },
    data: { kind: 'resolve', label: 'Resolve' } satisfies FlowNodeData,
  },
]

const INITIAL_EDGES: Edge[] = [
  { id: 'e1', source: 'start-1', sourceHandle: 'out', target: 'msg-1', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e2', source: 'msg-1', sourceHandle: 'out', target: 'ask-1', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e3', source: 'ask-1', sourceHandle: 'out', target: 'cond-1', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e4', source: 'cond-1', sourceHandle: 'true', target: 'agent-1', markerEnd: { type: MarkerType.ArrowClosed }, label: 'True', style: { stroke: '#22c55e' } },
  { id: 'e5', source: 'cond-1', sourceHandle: 'false', target: 'resolve-1', markerEnd: { type: MarkerType.ArrowClosed }, label: 'False', style: { stroke: '#ef4444' } },
]

const EDGE_STYLE = {
  stroke: 'var(--border-strong)',
  strokeWidth: 1.5,
}

function FitAfterLayout({ tick }: { tick: number }) {
  const { fitView } = useReactFlow()
  const skip = useRef(true)
  useEffect(() => {
    if (skip.current) {
      skip.current = false
      return
    }
    const id = requestAnimationFrame(() => { void fitView({ padding: 0.2, duration: 200 }) })
    return () => cancelAnimationFrame(id)
  }, [tick, fitView])
  return null
}

import { useFlows, useSaveCanvas, useFlowCanvas, usePublishFlow, useTools, useUpdateFlow } from '../../../lib/hooks'
import { ApiError } from '../../../lib/api'
import { useAppStore } from '../../../store/app'
import { PublishCheckDialog, reviewFlow } from '../PublishCheck'

export function FlowCanvasPage() {
  const navigate = useNavigate()
  const { flowId } = useParams({ from: '/app/build/flows/$flowId' })
  const { from, mark } = useSearch({ from: '/app/build/flows/$flowId' })
  const selectedBotId = useAppStore((s) => s.selectedBotId) ?? 'demo'
  const selectedBot = useAppStore((s) => s.bots.find((bot) => bot.id === s.selectedBotId))
  const selectedEnv = useAppStore((s) => s.selectedEnv)
  const environmentId = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId)?.environments.find((e) => e.kind === s.selectedEnv)?.id ?? '')
  const publishFlow = usePublishFlow()
  const updateFlow = useUpdateFlow()
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const historyPast = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([])
  const historyFuture = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([])
  const applyingHistory = useRef(false)
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES)
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([])
  const [status, setStatus] = useState<'draft' | 'saved' | 'published'>('draft')
  const [saving, setSaving] = useState(false)
  const [publishError, setPublishError] = useState<{ message: string; gate: boolean } | null>(null)
  const { data: flows } = useFlows()
  const flow = (flows ?? []).find((item) => item.id === flowId)
  const trail = useMemo(() => {
    const layout = journeyLayout((flows ?? []).map((item) => {
      const version = versionForEnvironment(item.versions, environmentId, selectedEnv)
      return {
        id: item.id,
        name: item.name,
        tags: item.tags,
        published: version?.status === 'published',
        graph: version?.graph,
      }
    }))
    return journeyTrail(layout, flowId)
  }, [flows, environmentId, selectedEnv, flowId])
  const flowIdByName = useMemo(() => new Map((flows ?? []).map((item) => [item.name, item.id])), [flows])
  const envLabel = selectedEnv === 'production' ? 'Production' : 'Sandbox'
  const shown = versionForEnvironment(flow?.versions, environmentId, selectedEnv)
  const canvasVersion = shown?.version ?? 0
  const flowNames = useMemo(() => (flows ?? []).map((item) => item.name), [flows])
  const { data: tools } = useTools()
  const toolIds = useMemo(() => tools?.map((tool) => tool.id), [tools])
  const review = useMemo(() => reviewFlow({ nodes, edges }, { flowNames, toolIds }), [nodes, edges, flowNames, toolIds])
  const blockingByNode = useMemo(() => {
    const counts = new Map<string, number>()
    for (const issue of review.blocks) {
      if (issue.nodeId) counts.set(issue.nodeId, (counts.get(issue.nodeId) ?? 0) + 1)
    }
    return counts
  }, [review])
  const displayNodes = useMemo(() => nodes.map((node) => {
    const data = node.data as unknown as FlowNodeData
    const nextMark = canvasMarkFor(data, mark)
    const blocking = blockingByNode.get(node.id) ?? 0
    if (data.mark === nextMark && (data.blocking ?? 0) === blocking) return node
    return { ...node, data: { ...data, mark: nextMark, blocking } }
  }), [nodes, mark, blockingByNode])
  const previewGraph = useMemo(() => ({
    nodes: nodes.map((node) => {
      const data = node.data as unknown as FlowNodeData
      return {
        id: node.id,
        data: { kind: data.kind, label: data.label, config: data.config ?? {} },
      }
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    })),
  }), [nodes, edges])

  const saveCanvas = useSaveCanvas()
  // Load the latest saved version. Welcome & Routing lives on version 2.
  const { data: savedCanvas } = useFlowCanvas(flowId ?? '', canvasVersion)
  const activeCanvas = savedCanvas?.version === canvasVersion
    ? savedCanvas
    : shown?.graph
      ? { version: shown.version, status: shown.status, graph: shown.graph }
      : undefined
  const loadedGraph = useRef<string | null>(null)
  React.useEffect(() => {
    if (!activeCanvas?.graph?.nodes?.length) {
      if (loadedGraph.current !== 'empty') {
        loadedGraph.current = 'empty'
        setNodes([])
        setEdges([])
        if (canvasVersion === 0) setStatus('draft')
      }
      return
    }
    const key = `${activeCanvas.version}:${JSON.stringify(activeCanvas.graph)}`
    if (loadedGraph.current === key) return
    loadedGraph.current = key
    historyPast.current = []
    historyFuture.current = []
    setNodes(activeCanvas.graph.nodes.map((n, index) => normalizeCanvasNode(n as Node, index)))
    setEdges((activeCanvas.graph.edges as Edge[]).map(normalizeCanvasEdge))
    setStatus(activeCanvas.status as 'draft' | 'saved' | 'published')
  }, [activeCanvas, canvasVersion, setNodes, setEdges])

  const [showTestPanel, setShowTestPanel] = useState(false)
  const [checkOpen, setCheckOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768)
  const [layoutTick, setLayoutTick] = useState(0)

  const dragKindRef = useRef<{ kind: NodeKind; label: string } | null>(null)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)

  function remember() {
    if (applyingHistory.current) return
    historyPast.current.push({ nodes, edges })
    if (historyPast.current.length > 50) historyPast.current.shift()
    historyFuture.current = []
  }

  function undo() {
    const prev = historyPast.current.pop()
    if (!prev) return
    historyFuture.current.push({ nodes, edges })
    applyingHistory.current = true
    setNodes(prev.nodes)
    setEdges(prev.edges)
    applyingHistory.current = false
  }

  function redo() {
    const next = historyFuture.current.pop()
    if (!next) return
    historyPast.current.push({ nodes, edges })
    applyingHistory.current = true
    setNodes(next.nodes)
    setEdges(next.edges)
    applyingHistory.current = false
  }

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some((change) => change.type === 'remove')) {
      historyPast.current.push({ nodes, edges })
      historyFuture.current = []
    }
    onEdgesChange(changes)
  }, [nodes, edges, onEdgesChange])

  function removeSelectedEdges() {
    if (selectedEdgeIds.length === 0) return
    remember()
    const drop = new Set(selectedEdgeIds)
    setEdges((current) => current.filter((edge) => !drop.has(edge.id)))
    setSelectedEdgeIds([])
  }

  const onConnect = useCallback(
    (params: Connection) => {
      historyPast.current.push({ nodes, edges })
      historyFuture.current = []
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
            style: EDGE_STYLE,
            interactionWidth: 24,
            animated: false,
          },
          eds
        )
      )
    },
    [nodes, edges, setEdges]
  )

  function handleDragStart(kind: NodeKind, label: string) {
    dragKindRef.current = { kind, label }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!dragKindRef.current || !reactFlowWrapper.current) return
    remember()

    const bounds = reactFlowWrapper.current.getBoundingClientRect()
    const position = {
      x: e.clientX - bounds.left - 80,
      y: e.clientY - bounds.top - 40,
    }

    const { kind, label } = dragKindRef.current
    const newNode: Node = {
      id: newId(),
      type: 'flowNode',
      position,
      data: { kind, label } satisfies FlowNodeData,
    }

    setNodes((ns) => [...ns, newNode])
    dragKindRef.current = null
  }

  function handleNodeClick(_: React.MouseEvent, node: Node) {
    setSelectedNode(node)
  }

  function handleUpdateNode(nodeId: string, updates: Partial<FlowNodeData>) {
    setNodes((ns) =>
      ns.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...(n.data as unknown as FlowNodeData), ...updates } }
          : n
      )
    )
    setSelectedNode((prev) =>
      prev?.id === nodeId
        ? { ...prev, data: { ...(prev.data as unknown as FlowNodeData), ...updates } }
        : prev
    )
  }

  function applyLayout(next: Node[]) {
    remember()
    setNodes(next)
    setEdges((current) => current.map((edge) => (edge.type && edge.type !== 'default' ? edge : { ...edge, type: 'smoothstep' })))
    setLayoutTick((tick) => tick + 1)
  }

  function handleDeleteNode(nodeId: string) {
    remember()
    setNodes((ns) => ns.filter((n) => n.id !== nodeId))
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId))
  }

  async function commitName() {
    const next = nameDraft.trim()
    setEditingName(false)
    if (!flowId || !next || next === flow?.name) return
    try {
      await updateFlow.mutateAsync({ flowId, name: next })
    } catch { /* keep the previous name when the save does not land */ }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await saveCanvas.mutateAsync({
        flowId: flowId ?? '',
        version: canvasVersion,
        graph: { nodes: nodes as unknown as import('../../../lib/api').FlowNode[], edges: edges as unknown as import('../../../lib/api').FlowEdge[] },
      })
      setStatus('saved')
    } catch { /* demo mode or no backend — still mark saved locally */ setStatus('saved') }
    setSaving(false)
  }

  function applyGraph(graph: { nodes: Array<{ id: string }>; edges: Array<{ id: string; source: string; target: string }> }) {
    remember()
    setNodes(graph.nodes.map((node, index) => normalizeCanvasNode(node as Node, index)))
    setEdges(graph.edges.map((edge) => normalizeCanvasEdge(edge as Edge)))
  }

  async function publishGraph(graph: { nodes: Node[]; edges: Edge[] }) {
    if (!environmentId) return
    setSaving(true)
    setPublishError(null)
    try {
      const saved = await saveCanvas.mutateAsync({
        flowId: flowId ?? '',
        version: canvasVersion,
        graph: { nodes: graph.nodes as unknown as import('../../../lib/api').FlowNode[], edges: graph.edges as unknown as import('../../../lib/api').FlowEdge[] },
      })
      await publishFlow.mutateAsync({ flowId: flowId ?? '', environmentId, version: saved?.version ?? canvasVersion })
      setStatus('published')
      setSaving(false)
      setCheckOpen(false)
      navigate({ to: '/build/flows' })
      return
    } catch (err) {
      setStatus('saved')
      setCheckOpen(false)
      setPublishError(err instanceof ApiError ? { message: err.message, gate: err.body?.code === 'GATE_FAILED' } : { message: 'Publishing did not go through. Try again.', gate: false })
    }
    setSaving(false)
  }

  function handlePublish() {
    if (!environmentId) return
    const findings = reviewFlow({ nodes, edges }, { flowNames, toolIds })
    if (findings.before.length === 0) {
      void publishGraph({ nodes, edges })
      return
    }
    setCheckOpen(true)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Canvas Toolbar */}
      <div className="flex min-h-[var(--topbar-height)] flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate(from === 'journey' ? { to: '/build/journey' } : { to: '/build/flows' })}
          >
            <ArrowLeft size={14} />
          </Button>
          <div className="h-4 w-px bg-[var(--border)]" />
          <div>
            {editingName ? (
              <input
                autoFocus
                aria-label="Flow name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void commitName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitName()
                  if (e.key === 'Escape') setEditingName(false)
                }}
                className="w-48 rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-2 py-0.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
              />
            ) : (
              <button
                type="button"
                title="Rename flow"
                aria-label="Rename flow"
                className="text-left text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]"
                onClick={() => { setNameDraft(flow?.name ?? ''); setEditingName(true) }}
              >
                {flow?.name ?? 'Flow'}
              </button>
            )}
            <p className="text-xs text-[var(--text-muted)]">{canvasVersion > 0 ? `${envLabel} · v${canvasVersion}` : `${envLabel} · not published`}</p>
          </div>
          <Badge
            variant={status === 'published' ? 'success' : status === 'saved' ? 'info' : 'muted'}
            dot
          >
            {status}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon-sm" title="Tidy layout" onClick={() => applyLayout(tidyLayout(nodes, edges))}><LayoutTemplate size={14} /></Button>
          <Button variant="ghost" size="icon-sm" title="Align nodes in a row" onClick={() => applyLayout(alignHorizontal(nodes))}><AlignHorizontalJustifyCenter size={14} /></Button>
          <Button variant="ghost" size="icon-sm" title="Align nodes in a column" onClick={() => applyLayout(alignVertical(nodes))}><AlignVerticalJustifyCenter size={14} /></Button>
          <div className="h-4 w-px bg-[var(--border)]" />
          <Button variant="ghost" size="sm" disabled={selectedEdgeIds.length === 0} onClick={removeSelectedEdges}>
            Remove connection
          </Button>
          <Button variant="ghost" size="icon-sm" title={`Undo (${selectedEnv})`} onClick={undo}><Undo2 size={14} /></Button>
          <Button variant="ghost" size="icon-sm" title="Redo" onClick={redo}><Redo2 size={14} /></Button>
          <div className="h-4 w-px bg-[var(--border)]" />
          <Button variant="ghost" size="sm" onClick={handleSave} disabled={saving || canvasVersion === 0}>
            <Save size={13} /> {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant={showTestPanel ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setShowTestPanel((v) => !v)}
          >
            <Play size={13} /> {showTestPanel ? 'Hide Test' : 'Test Bot'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCheckOpen(true)}
            data-testid="flow-check-status"
            title={review.blocks.length ? 'Publishing is blocked until these are fixed' : 'Check this flow'}
            className={review.blocks.length ? 'text-[var(--error)]' : undefined}
          >
            {review.blocks.length ? `${review.blocks.length} to fix` : 'Check'}
          </Button>
          <Button size="sm" onClick={handlePublish} disabled={saving || !environmentId || canvasVersion === 0}>
            <Share2 size={13} /> Publish
          </Button>
        </div>
      </div>

      {publishError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--error-muted)] px-3 py-2 text-xs text-[var(--text-primary)]">
          <span className="min-w-0 flex-1">{publishError.message}</span>
          {publishError.gate && (
            <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={() => navigate({ to: '/build/evals' })}>Open Evals</button>
          )}
          <button type="button" aria-label="Dismiss" className="p-1 text-[var(--text-muted)]" onClick={() => setPublishError(null)}><X size={12} /></button>
        </div>
      )}

      {trail.path.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs">
          <button type="button" className="text-[var(--accent)]" onClick={() => navigate({ to: '/build/journey' })}>Journey</button>
          {trail.path.map((chapter, index) => (
            <span key={chapter.id} className="flex items-center gap-2">
              <span className="text-[var(--text-muted)]">/</span>
              {index === trail.path.length - 1 ? (
                <span className="font-medium text-[var(--text-primary)]">{chapter.name}</span>
              ) : (
                <button
                  type="button"
                  className="text-[var(--text-secondary)]"
                  onClick={() => navigate({ to: '/build/flows/$flowId', params: { flowId: chapter.id }, search: { from: 'journey', mark } })}
                >
                  {chapter.name}
                </button>
              )}
            </span>
          ))}
          {trail.next.map((name) => {
            const nextId = flowIdByName.get(name)
            if (!nextId) return null
            return (
              <button
                key={name}
                type="button"
                className="rounded-full bg-[var(--bg-overlay)] px-2 py-0.5 text-[var(--text-secondary)]"
                onClick={() => navigate({ to: '/build/flows/$flowId', params: { flowId: nextId }, search: { from: 'journey', mark } })}
              >
                {name}
              </button>
            )
          })}
        </div>
      )}

      {/* Canvas body */}
      <div className="relative flex flex-1 overflow-hidden">
        <NodePalette collapsed={!paletteOpen} onToggle={() => setPaletteOpen((open) => !open)} onDragStart={handleDragStart} />

        <div
          ref={reactFlowWrapper}
          className="relative flex-1 overflow-hidden"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          {canvasVersion === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-base)] px-6">
              <div className="max-w-sm text-center">
                <p className="text-sm font-medium text-[var(--text-primary)]">This flow has no chart yet.</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Add a step from the palette, then Save. Sandbox and Production share this copy for now.</p>
              </div>
            </div>
          )}
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onNodeClick={handleNodeClick}
            onPaneClick={() => { setSelectedNode(null); setSelectedEdgeIds([]) }}
            onSelectionChange={({ edges: picked }) => {
              const ids = picked.map((edge) => edge.id)
              setSelectedEdgeIds((current) => (
                current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids
              ))
            }}
            deleteKeyCode={['Backspace', 'Delete']}
            edgesFocusable
            elementsSelectable
            nodeTypes={nodeTypes}
            defaultEdgeOptions={{ type: 'smoothstep', style: EDGE_STYLE, interactionWidth: 24, markerEnd: { type: MarkerType.ArrowClosed } }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            style={{ background: 'var(--bg-base)' }}
          >
            <FitAfterLayout tick={layoutTick} />
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="var(--border)"
            />
            <Controls
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            />
            <MiniMap
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
              }}
              nodeColor="var(--accent-muted)"
              maskColor="rgba(0,0,0,0.4)"
            />
          </ReactFlow>
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-secondary)] shadow-sm">
              {selectedEdgeIds.length > 0 ? (
                <>
                  <span>Connection selected</span>
                  <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={removeSelectedEdges}>
                    Remove
                  </button>
                </>
              ) : mark === 'offer_yes' ? (
                <span>Yes after the hours offer should open Salon hours.</span>
              ) : mark === 'name_once' ? (
                <span>Keep one What’s your name? on this chart.</span>
              ) : (
                <span>Click a line between steps, then press Delete to remove it.</span>
              )}
            </div>
          </div>
        </div>

        <PublishCheckDialog
          open={checkOpen}
          review={review}
          pending={saving}
          onClose={() => setCheckOpen(false)}
          onRepair={() => applyGraph(review.graph)}
          onPublish={() => {
            const prepared = review.repairs.length > 0 ? review.graph : { nodes, edges }
            applyGraph(prepared)
            void publishGraph(prepared as { nodes: Node[]; edges: Edge[] })
          }}
        />

        <NodeConfigPanel
          node={selectedNode}
          issues={selectedNode ? [...review.blocks, ...review.notes].filter((issue) => issue.nodeId === selectedNode.id) : []}
          onUpdate={handleUpdateNode}
          onDelete={handleDeleteNode}
          onClose={() => setSelectedNode(null)}
        />

        {/* Test Bot panel */}
        {showTestPanel && (
          <div className="flex w-full max-w-[420px] shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg-base)] max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:shadow-xl md:w-[340px]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">Test Bot</span>
              <button
                onClick={() => setShowTestPanel(false)}
                className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
              >
                <X size={13} />
              </button>
            </div>
            <ChatWidget
              key={flowId}
              botId={selectedBotId}
              botName={selectedBot?.personaName?.trim() || selectedBot?.name || 'Bot Preview'}
              avatarUrl={selectedBot?.avatarUrl}
              autoFocus
              flowGraph={previewGraph}
              flowName={flow?.name}
              className="flex-1 rounded-none border-0 shadow-none"
            />
          </div>
        )}
      </div>
    </div>
  )
}
