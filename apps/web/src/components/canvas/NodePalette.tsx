import React from 'react'
import { cn } from '@ybot/ui'
import { NODE_DEFINITIONS, type NodeKind } from '@ybot/shared'
import {
  Play, MessageSquare, HelpCircle, GitBranch, Variable,
  Globe, Workflow, Headphones, CheckCircle, Clock, Mail,
  Sparkles, Search, Layout, Layers, Zap, FileText, ChevronLeft, ChevronRight,
} from 'lucide-react'

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
  // Backend runtime aliases — not shown in palette (category: runtime_alias)
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

const CATEGORIES = [
  { id: 'trigger', label: 'Trigger' },
  { id: 'message', label: 'Messages' },
  { id: 'logic', label: 'Logic' },
  { id: 'action', label: 'Actions' },
  { id: 'integration', label: 'Integrations' },
  { id: 'end', label: 'End' },
]

interface NodePaletteProps {
  collapsed: boolean
  onToggle: () => void
  onDragStart: (kind: NodeKind, label: string) => void
}

export function NodePalette({ collapsed, onToggle, onDragStart }: NodePaletteProps) {
  if (collapsed) {
    return (
      <div className="flex h-full w-12 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)]">
        <button
          type="button"
          onClick={onToggle}
          title="Show nodes"
          className="flex h-10 items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <ChevronRight size={16} />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onToggle}
          title="Show nodes"
          className="flex h-10 items-center justify-center border-t border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full w-[200px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:shadow-xl">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Nodes</h3>
        <button
          type="button"
          onClick={onToggle}
          title="Hide nodes"
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {CATEGORIES.map((cat) => {
          const nodes = Object.values(NODE_DEFINITIONS).filter((n) => n.category === cat.id)
          if (nodes.length === 0) return null
          return (
            <div key={cat.id} className="mb-3">
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {cat.label}
              </p>
              <div className="space-y-0.5 px-2">
                {nodes.map((def) => {
                  const Icon = ICON_MAP[def.kind] ?? MessageSquare
                  return (
                    <div
                      key={def.kind}
                      draggable
                      onDragStart={() => onDragStart(def.kind, def.label)}
                      className={cn(
                        'flex cursor-grab items-center gap-2 rounded-[var(--radius)] px-2 py-1.5',
                        'border border-transparent hover:border-[var(--border)] hover:bg-[var(--bg-hover)]',
                        'transition-colors select-none active:cursor-grabbing'
                      )}
                      title={def.description}
                    >
                      <div
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
                        style={{ background: `${def.color}20` }}
                      >
                        <Icon size={12} style={{ color: def.color }} />
                      </div>
                      <span className="text-xs text-[var(--text-secondary)]">{def.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t border-[var(--border)] p-2">
        <button
          type="button"
          onClick={onToggle}
          title="Hide nodes"
          className="flex h-8 w-full items-center justify-center rounded-[var(--radius)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <ChevronLeft size={14} />
        </button>
      </div>
    </div>
  )
}
