import React, { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { cn } from '@ybot/ui'
import {
  Play, MessageSquare, HelpCircle, GitBranch, Variable,
  Globe, Workflow, Headphones, CheckCircle, Clock, Mail,
  Sparkles, Search, Layout, Layers, Zap, FileText,
} from 'lucide-react'
import type { JourneyMark, NodeKind } from '@ybot/shared'

const ICON_MAP: Record<NodeKind, React.ElementType> = {
  start: Play,
  send_message: MessageSquare,
  ask_question: HelpCircle,
  condition: GitBranch,
  set_variable: Variable,
  http_request: Globe,
  execute_flow: Workflow,
  transfer_agent: Headphones,
  resolve: CheckCircle,
  delay: Clock,
  send_email: Mail,
  llm_prompt: Sparkles,
  knowledge_search: Search,
  buttons: Layout,
  carousel: Layers,
  quick_replies: Zap,
  // Backend runtime aliases
  trigger_start: Play,
  llm_generate: Sparkles,
  end_flow: CheckCircle,
  handover: Headphones,
  search_knowledge: Search,
  classify_intent: GitBranch,
  create_ticket: FileText,
  route_topic: GitBranch,
  lookup_catalog: Search,
}

const COLOR_MAP: Record<NodeKind, string> = {
  start: '#22c55e',
  send_message: '#3b82f6',
  ask_question: '#8b5cf6',
  condition: '#f59e0b',
  set_variable: '#f59e0b',
  http_request: '#06b6d4',
  execute_flow: '#6366f1',
  transfer_agent: '#ec4899',
  resolve: '#22c55e',
  delay: '#64748b',
  send_email: '#3b82f6',
  llm_prompt: '#a855f7',
  knowledge_search: '#06b6d4',
  buttons: '#3b82f6',
  carousel: '#3b82f6',
  quick_replies: '#3b82f6',
  // Backend runtime aliases
  trigger_start: '#22c55e',
  llm_generate: '#a855f7',
  end_flow: '#22c55e',
  handover: '#ec4899',
  search_knowledge: '#06b6d4',
  classify_intent: '#f59e0b',
  create_ticket: '#3b82f6',
  route_topic: '#f59e0b',
  lookup_catalog: '#06b6d4',
}

function previewValue(value: unknown): string {
  const text =
    value == null
      ? ''
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value)
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

export interface FlowNodeData {
  kind: NodeKind
  label: string
  config?: Record<string, unknown>
  selected?: boolean
  mark?: JourneyMark
}

export const FlowNode = memo(function FlowNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as FlowNodeData
  const Icon = ICON_MAP[nodeData.kind] ?? MessageSquare
  const color = COLOR_MAP[nodeData.kind] ?? '#6366f1'

  const hasTarget = !['start', 'trigger_start'].includes(nodeData.kind)
  const routePorts = nodeData.kind === 'route_topic' ? routePortIds(nodeData.config) : []
  const hasSingleSource =
    !['condition', 'http_request', 'knowledge_search', 'search_knowledge', 'lookup_catalog', 'start', 'trigger_start', 'route_topic'].includes(nodeData.kind) &&
    !['resolve', 'end_flow'].includes(nodeData.kind)
  const hasConditionSources = nodeData.kind === 'condition'
  const hasHttpSources = nodeData.kind === 'http_request'
  const hasKBSources = ['knowledge_search', 'search_knowledge'].includes(nodeData.kind)
  const hasLookupSources = nodeData.kind === 'lookup_catalog'
  const hasStartSource = ['start', 'trigger_start'].includes(nodeData.kind)

  const mark = nodeData.mark

  return (
    <div
      className={cn(
        'group relative min-w-[180px] rounded-[10px] border-2 bg-[var(--bg-elevated)]',
        'shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-150',
        selected
          ? 'border-[var(--accent)] shadow-[0_0_0_3px_rgba(99,102,241,0.25)]'
          : mark === 'improve'
            ? 'border-[var(--accent)] shadow-[0_0_0_3px_rgba(99,102,241,0.18)]'
            : mark === 'error'
              ? 'border-[var(--border-strong)] shadow-[0_0_0_3px_rgba(15,23,42,0.16)]'
              : 'border-[var(--border-strong)] hover:border-[var(--border-focus)]'
      )}
      data-mark={mark ?? ''}
      style={routePorts.length > 2 ? { minWidth: Math.max(220, routePorts.length * 78) } : undefined}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 rounded-t-[8px] px-3 py-[7px]"
        style={{ background: `${color}22`, borderBottom: `1px solid ${color}40` }}
      >
        <div
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={{ background: `${color}30` }}
        >
          <Icon size={13} style={{ color }} />
        </div>
        <span className="text-[13px] font-semibold leading-tight truncate max-w-[130px]" style={{ color: 'var(--text-primary, #f1f5f9)' }}>
          {nodeData.label}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-[6px]">
        {nodeData.config && Object.keys(nodeData.config).length > 0 ? (
          <div className="space-y-[3px]">
            {Object.entries(nodeData.config).slice(0, 2).map(([k, v]) => (
              <div key={k} className="flex items-start gap-1">
                <span className="text-[11px] shrink-0" style={{ color: 'var(--text-muted, #94a3b8)' }}>{k}:</span>
                <span className="text-[11px] font-medium truncate max-w-[110px]" style={{ color: 'var(--text-secondary, #cbd5e1)' }}>
                  {previewValue(v)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] italic" style={{ color: 'var(--text-muted, #64748b)' }}>Click to configure</p>
        )}
        {mark === 'improve' && (
          <p className="mt-1 text-[10px] font-medium text-[var(--accent)]">Ready</p>
        )}
        {mark === 'error' && (
          <p className="mt-1 text-[10px] font-medium text-[var(--text-primary)]">Needs a look</p>
        )}
      </div>

      {/* Handles */}
      {hasTarget && (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3 !w-3 !bg-[var(--bg-overlay)] !border-2 !border-[var(--border-strong)] hover:!border-[var(--accent)]"
        />
      )}

      {hasSingleSource && (
        <Handle
          type="source"
          id="out"
          position={Position.Bottom}
          className="!h-3 !w-3 !bg-[var(--accent)] !border-2 !border-[var(--accent-hover)]"
        />
      )}

      {hasStartSource && (
        <Handle
          type="source"
          id="out"
          position={Position.Bottom}
          className="!h-3 !w-3 !bg-[var(--accent)] !border-2 !border-[var(--accent-hover)]"
        />
      )}

      {hasConditionSources && (
        <>
          <Handle
            type="source"
            id="yes"
            position={Position.Bottom}
            style={{ left: '30%' }}
            className="!h-3 !w-3 !bg-[var(--success)] !border-2"
          />
          <Handle
            type="source"
            id="no"
            position={Position.Bottom}
            style={{ left: '70%' }}
            className="!h-3 !w-3 !bg-[var(--error)] !border-2"
          />
        </>
      )}

      {hasHttpSources && (
        <>
          <Handle
            type="source"
            id="success"
            position={Position.Bottom}
            style={{ left: '30%' }}
            className="!h-3 !w-3 !bg-[var(--success)] !border-2"
          />
          <Handle
            type="source"
            id="error"
            position={Position.Bottom}
            style={{ left: '70%' }}
            className="!h-3 !w-3 !bg-[var(--error)] !border-2"
          />
        </>
      )}

      {hasKBSources && (
        <>
          <Handle
            type="source"
            id="found"
            position={Position.Bottom}
            style={{ left: '30%' }}
            className="!h-3 !w-3 !bg-[var(--success)] !border-2"
          />
          <Handle
            type="source"
            id="not_found"
            position={Position.Bottom}
            style={{ left: '70%' }}
            className="!h-3 !w-3 !bg-[var(--error)] !border-2"
          />
        </>
      )}

      {hasLookupSources && (
        <>
          <Handle
            type="source"
            id="found"
            position={Position.Bottom}
            style={{ left: '30%' }}
            className="!h-3 !w-3 !bg-[var(--success)] !border-2"
          />
          <Handle
            type="source"
            id="other"
            position={Position.Bottom}
            style={{ left: '70%' }}
            className="!h-3 !w-3 !bg-[var(--error)] !border-2"
          />
        </>
      )}

      {routePorts.map((port, index) => (
        <Handle
          key={port}
          type="source"
          id={port}
          position={Position.Bottom}
          style={{ left: `${((index + 1) / (routePorts.length + 1)) * 100}%` }}
          title={port === 'other' ? 'Other' : port.replace(/-/g, ' ')}
          className="!h-3 !w-3 !bg-[var(--accent)] !border-2"
        />
      ))}

      {routePorts.length > 0 && (
        <div className="flex justify-between gap-1 px-2 pb-1">
          {routePorts.map((port) => (
            <span key={port} className="max-w-[72px] truncate text-[8px] text-[var(--text-muted)]" title={port}>
              {port === 'other' ? 'Other' : port.replace(/-/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {/* Port labels for condition/http/kb */}
      {(hasConditionSources || hasHttpSources || hasKBSources || hasLookupSources) && (
        <div className="flex justify-between px-2 pb-1">
          <span className="text-[8px] text-[var(--success)]">
            {hasConditionSources ? 'True' : hasHttpSources ? 'Success' : 'Found'}
          </span>
          <span className="text-[8px] text-[var(--error)]">
            {hasConditionSources ? 'False' : hasHttpSources ? 'Error' : hasLookupSources ? 'Other' : 'Not found'}
          </span>
        </div>
      )}
    </div>
  )
})

function routePortIds(config?: Record<string, unknown>): string[] {
  const raw = config?.['routes']
  const ids = Array.isArray(raw)
    ? raw.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const handle = String((item as { handle?: string }).handle ?? '').trim()
        return handle ? [handle] : []
      })
    : []
  if (!ids.includes('other')) ids.push('other')
  return ids
}

export const nodeTypes = {
  flowNode: FlowNode,
  // Graphs seeded before the canvas rename stored this type string.
  'flow-node': FlowNode,
}
