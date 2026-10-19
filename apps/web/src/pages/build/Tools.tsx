import React, { useMemo, useState } from 'react'
import { Wrench, Plus, Server, Search, AlertCircle, Loader2, Trash2, CheckCircle2, XCircle, KeyRound } from 'lucide-react'
import {
  Badge, Button, EmptyState, cn,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@ybot/ui'
import { TOOL_EFFECT_LABELS, TOOL_KINDS, TOOL_KIND_LABELS, toolChangesData, type ToolDraft, type ToolKind } from '@ybot/shared'
import type { ToolSummary } from '../../lib/api'
import { useDeleteTool, useTools } from '../../lib/hooks'
import { ToolEditor, blankTool } from './tools/ToolEditor'
import { McpImportDialog } from './tools/McpImport'
import { AuthProfilesPanel } from './tools/AuthProfiles'

const KIND_BLURB: Record<ToolKind, string> = {
  http: 'Call an API over HTTP',
  function: 'Run a small JavaScript transform',
  mcp: 'Use a tool from an MCP server',
  knowledge: 'Search this bot’s knowledge',
  workflow: 'Run one of your workflows',
}

export function ToolsPage() {
  const [tab, setTab] = useState<'tools' | 'profiles'>('tools')
  const [editing, setEditing] = useState<{ tool?: ToolSummary; initial?: ToolDraft } | null>(null)
  const [mcpOpen, setMcpOpen] = useState(false)

  function startNew(kind: ToolKind) {
    if (kind === 'mcp') { setMcpOpen(true); return }
    setTab('tools')
    setEditing({ initial: blankTool(kind) })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-base font-semibold text-[var(--text-primary)]">Tools</h1>
            <p className="text-xs text-[var(--text-muted)]">Everything the bot and your team can run: HTTP, Functions, MCP, Knowledge and Workflow tools. Credentials live in Auth Profiles.</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5"><Plus size={14} /> New tool</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {TOOL_KINDS.map((kind) => (
                <DropdownMenuItem key={kind} onSelect={() => startNew(kind)}>
                  <div>
                    <p className="text-xs font-medium">{TOOL_KIND_LABELS[kind]}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{KIND_BLURB[kind]}</p>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex gap-4 px-6">
          {([['tools', 'Tools', Wrench], ['profiles', 'Auth Profiles', KeyRound]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn('flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium', tab === id ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]')}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tab === 'tools' ? <ToolList onOpen={(tool) => setEditing({ tool })} onNew={startNew} /> : <AuthProfilesPanel />}
      </div>

      <ToolEditor open={editing !== null} tool={editing?.tool} initial={editing?.initial} onClose={() => setEditing(null)} onSaved={(tool) => setEditing((current) => (current?.tool ? { tool } : current))} />
      <McpImportDialog open={mcpOpen} onClose={() => setMcpOpen(false)} />
    </div>
  )
}

function ToolList({ onOpen, onNew }: { onOpen: (tool: ToolSummary) => void; onNew: (kind: ToolKind) => void }) {
  const { data: tools = [], isLoading, isError, refetch } = useTools()
  const remove = useDeleteTool()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<ToolKind | 'all'>('all')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tools.filter((tool) => (kind === 'all' || tool.kind === kind) && (!q || tool.name.includes(q) || tool.description.toLowerCase().includes(q)))
  }, [tools, query, kind])

  if (isLoading) return <div className="flex items-center justify-center py-20 text-xs text-[var(--text-muted)]"><Loader2 size={16} className="mr-2 animate-spin" /> Loading tools…</div>
  if (isError) {
    return <EmptyState icon={<AlertCircle size={20} />} title="Tools could not be loaded" description="Check your connection and try again." action={<Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>} />
  }
  if (tools.length === 0) {
    return (
      <EmptyState
        icon={<Wrench size={20} />}
        title="No tools yet"
        description="Add a tool so the bot can look things up or take action, and so your team can run the same tool from the Inbox."
        action={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onNew('http')}><Plus size={12} className="mr-1" /> HTTP tool</Button>
            <Button size="sm" variant="secondary" onClick={() => onNew('mcp')}><Server size={12} className="mr-1" /> From MCP server</Button>
          </div>
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input aria-label="Search tools" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools" className="w-56 rounded border border-[var(--border)] bg-[var(--bg-overlay)] py-1.5 pl-7 pr-2 text-xs text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none" />
        </div>
        {(['all', ...TOOL_KINDS] as const).map((value) => (
          <button key={value} onClick={() => setKind(value)} className={cn('rounded-full border px-2.5 py-1 text-[11px]', kind === value ? 'border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]')}>
            {value === 'all' ? 'All' : TOOL_KIND_LABELS[value]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<Search size={20} />} title="No tools match" description="Change the search or the type filter." action={<Button size="sm" variant="secondary" onClick={() => { setQuery(''); setKind('all') }}>Clear filters</Button>} />
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
          {shown.map((tool) => (
            <li key={tool.id} className="group flex items-start gap-3 px-4 py-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(tool)}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-[var(--text-primary)]">{tool.name}</span>
                  <Badge variant="info">{TOOL_KIND_LABELS[tool.kind]}</Badge>
                  <Badge variant={toolChangesData(tool.effect) ? 'warning' : 'muted'}>{TOOL_EFFECT_LABELS[tool.effect]}</Badge>
                  {tool.authProfileName && <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]"><KeyRound size={10} /> {tool.authProfileName}</span>}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">{tool.description}</p>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  {tool.parameters.length} {tool.parameters.length === 1 ? 'parameter' : 'parameters'}
                  {tool.lastRun ? (
                    <> · last run <span className={tool.lastRun.ok ? 'text-[var(--success)]' : 'text-[var(--error)]'}>{tool.lastRun.ok ? <CheckCircle2 size={10} className="inline" /> : <XCircle size={10} className="inline" />} {new Date(tool.lastRun.at).toLocaleString()}</span></>
                  ) : ' · never run'}
                </p>
              </button>
              <button aria-label={`Delete ${tool.name}`} className="mt-1 text-[var(--text-muted)] opacity-0 hover:text-[var(--error)] group-hover:opacity-100 focus:opacity-100" onClick={() => { if (window.confirm(`Delete ${tool.name}? Flows that run it will follow their Error line.`)) remove.mutate(tool.id) }}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
