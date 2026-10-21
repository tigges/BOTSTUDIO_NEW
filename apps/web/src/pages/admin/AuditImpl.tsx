import React, { useState } from 'react'
import {
  Search, Filter, ChevronDown, ChevronRight,
  LogIn, Bot, FileText, Users, Settings, Globe,
  CheckCircle2, AlertCircle, Info, Pencil, Trash2,
  Shield, UserPlus, Send, RefreshCw, Key, Bell, Tag,
  MessageSquare,
} from 'lucide-react'
import { Avatar, Badge, Button, Input } from '@ybot/ui'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@ybot/ui'
import { SubNav } from '../../components/SubNav'
import { cn } from '@ybot/ui'
import { useAuditLog } from '../../lib/hooks'

const SUBNAV = [
  { label: 'Team', path: '/admin/team' },
  { label: 'Audit Log', path: '/admin/audit' },
]

type AuditAction =
  | 'user.login' | 'user.logout' | 'user.invited' | 'user.role_changed'
  | 'bot.published' | 'bot.created'
  | 'flow.updated' | 'flow.published'
  | 'template.submitted' | 'template.approved'
  | 'channel.connected' | 'channel.disconnected'
  | 'webhook.created' | 'webhook.deleted'
  | 'settings.updated' | 'api_key.created' | 'api_key.revoked'
  | 'knowledge.synced' | 'contact.deleted'
  | 'automation.alert' | 'automation.label_added'
  | 'bot.settings_changed'

type AuditSeverity = 'info' | 'warning' | 'success' | 'error'

interface AuditEvent {
  id: string
  actor: { name: string; email: string }
  action: string
  resource: string
  details: string
  change: AuditChange | null
  ip: string
  timestamp: string
  severity: AuditSeverity
}

interface AuditChange {
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  changes: string[]
  source: string | null
}

type ActionConfig = { icon: React.ReactNode; label: string; category: string }

const ACTION_CFG: Record<AuditAction, ActionConfig> = {
  'user.login':           { icon: <LogIn size={12} />,        label: 'User signed in',         category: 'Auth' },
  'user.logout':          { icon: <LogIn size={12} />,        label: 'User signed out',         category: 'Auth' },
  'user.invited':         { icon: <UserPlus size={12} />,     label: 'User invited',           category: 'Team' },
  'user.role_changed':    { icon: <Shield size={12} />,       label: 'Role changed',           category: 'Team' },
  'bot.published':        { icon: <Bot size={12} />,          label: 'Bot published',          category: 'Bot' },
  'bot.created':          { icon: <Bot size={12} />,          label: 'Bot created',            category: 'Bot' },
  'flow.updated':         { icon: <RefreshCw size={12} />,    label: 'Flow updated',           category: 'Build' },
  'flow.published':       { icon: <CheckCircle2 size={12} />, label: 'Flow published',         category: 'Build' },
  'template.submitted':   { icon: <FileText size={12} />,     label: 'Template submitted',     category: 'Engage' },
  'template.approved':    { icon: <CheckCircle2 size={12} />, label: 'Template approved',      category: 'Engage' },
  'channel.connected':    { icon: <Globe size={12} />,        label: 'Channel connected',      category: 'Config' },
  'channel.disconnected': { icon: <Globe size={12} />,        label: 'Channel disconnected',   category: 'Config' },
  'webhook.created':      { icon: <Send size={12} />,         label: 'Webhook created',        category: 'Config' },
  'webhook.deleted':      { icon: <Trash2 size={12} />,       label: 'Webhook deleted',        category: 'Config' },
  'settings.updated':     { icon: <Settings size={12} />,     label: 'Settings updated',       category: 'Settings' },
  'api_key.created':      { icon: <Key size={12} />,          label: 'API key created',        category: 'Auth' },
  'api_key.revoked':      { icon: <Key size={12} />,          label: 'API key revoked',        category: 'Auth' },
  'knowledge.synced':     { icon: <RefreshCw size={12} />,    label: 'Knowledge synced',       category: 'Build' },
  'contact.deleted':      { icon: <Trash2 size={12} />,       label: 'Contact deleted',        category: 'Inbox' },
  'automation.alert':     { icon: <Bell size={12} />,         label: 'Automation alert',       category: 'Automation' },
  'automation.label_added': { icon: <Tag size={12} />,        label: 'Label added',            category: 'Automation' },
  'bot.settings_changed': { icon: <Settings size={12} />,     label: 'Bot settings changed',   category: 'Bot' },
}

const SEVERITY_VARIANT: Record<AuditSeverity, 'info' | 'success' | 'warning' | 'error'> = {
  info: 'info', success: 'success', warning: 'warning', error: 'error',
}

const CATEGORY_BY_RESOURCE: Record<string, string> = {
  guardrail_policy: 'Safety', bot_config: 'Bot', bot: 'Bot', environment: 'Bot',
  flow: 'Build', flow_version: 'Build', tool: 'Build', auth_profile: 'Build', workflow: 'Build', intent: 'Build', entity: 'Build', faq: 'Build', knowledge_source: 'Build',
  user: 'Team', invitation: 'Team', api_key: 'Auth',
  channel: 'Config', channel_connection: 'Config', webhook: 'Config', integration_connection: 'Config',
  conversation: 'Inbox', contact: 'Inbox', ticket: 'Inbox', canned_response: 'Inbox',
  campaign: 'Engage', template: 'Engage', automation_rule: 'Automation', tenant: 'Settings',
}

const VERB: Record<string, { label: string; icon: React.ReactNode; severity: AuditSeverity }> = {
  created: { label: 'created', icon: <CheckCircle2 size={12} />, severity: 'success' },
  updated: { label: 'changed', icon: <Pencil size={12} />, severity: 'info' },
  deleted: { label: 'deleted', icon: <Trash2 size={12} />, severity: 'warning' },
}

function humanise(noun: string): string {
  const words = noun.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Known product events keep their wording; every audited model write reads "<Thing> created/changed/deleted". */
function actionConfig(action: string): ActionConfig & { severity: AuditSeverity } {
  const known = ACTION_CFG[action as AuditAction]
  if (known) return { ...known, severity: 'info' }
  const [noun = action, verb = ''] = action.split('.')
  const v = VERB[verb]
  return {
    icon: v?.icon ?? <Info size={12} />,
    label: v ? `${humanise(noun)} ${v.label}` : humanise(action),
    category: CATEGORY_BY_RESOURCE[noun] ?? 'Other',
    severity: v?.severity ?? 'info',
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** A change to many rows reads as one line per row and field, e.g. "Strict · active". */
function flattenRows(value: unknown, fields: string[]): Record<string, unknown> | null {
  if (!Array.isArray(value)) return asRecord(value)
  const out: Record<string, unknown> = {}
  for (const [index, row] of value.entries()) {
    const record = asRecord(row) ?? {}
    const named = [record['name'], record['title'], record['id']].find((v) => typeof v === 'string' && v)
    const label = typeof named === 'string' ? named : `#${index + 1}`
    for (const field of fields) out[`${label} · ${field}`] = record[field]
  }
  return out
}

function auditChange(metadata: Record<string, unknown> | undefined): AuditChange | null {
  if (!metadata || !('before' in metadata || 'after' in metadata)) return null
  const changes = Array.isArray(metadata['changes']) ? (metadata['changes'] as unknown[]).filter((f): f is string => typeof f === 'string') : []
  const many = Array.isArray(metadata['before']) || Array.isArray(metadata['after'])
  const rowFields = changes.length ? changes : [...new Set([metadata['before'], metadata['after']].flatMap((rows) => (Array.isArray(rows) ? rows : []).flatMap((row) => Object.keys(asRecord(row) ?? {}))))].filter((key) => !HIDDEN_FIELDS.has(key))
  const before = flattenRows(metadata['before'], rowFields)
  const after = flattenRows(metadata['after'], rowFields)
  return {
    before,
    after,
    changes: many ? Object.keys({ ...before, ...after }) : changes,
    source: typeof metadata['source'] === 'string' ? metadata['source'] : null,
  }
}

const HIDDEN_FIELDS = new Set(['id', 'tenantId', 'createdAt', 'updatedAt'])

function changeHeading(action: string, change: AuditChange): string {
  if (action.endsWith('.created')) return 'Created with'
  if (action.endsWith('.deleted')) return 'Deleted record'
  return change.changes.length ? `Changed: ${change.changes.join(', ')}` : 'No fields changed'
}

function shortValue(value: unknown): string {
  if (value === undefined || value === null) return '—'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
}

function ChangeTable({ change }: { change: AuditChange }) {
  const row = change.after ?? change.before ?? {}
  const fields = change.changes.length
    ? change.changes
    : Object.keys(row).filter((key) => !HIDDEN_FIELDS.has(key))
  const showBefore = change.before !== null
  const showAfter = change.after !== null
  if (fields.length === 0) return <p className="text-xs text-[var(--text-muted)]">No fields changed.</p>
  return (
    <table className="w-full table-fixed text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          <th className="w-40 py-1 pr-3 font-medium">Field</th>
          {showBefore && <th className="py-1 pr-3 font-medium">Before</th>}
          {showAfter && <th className="py-1 font-medium">After</th>}
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={field} className="align-top border-t border-[var(--border)]">
            <td className="py-1.5 pr-3 font-mono text-[var(--text-secondary)]">{field}</td>
            {showBefore && <td className={cn('break-words py-1.5 pr-3 font-mono text-[11px]', change.changes.length ? 'text-[var(--error)]' : 'text-[var(--text-muted)]')}>{shortValue(change.before?.[field])}</td>}
            {showAfter && <td className={cn('break-words py-1.5 font-mono text-[11px]', change.changes.length ? 'text-[var(--success)]' : 'text-[var(--text-primary)]')}>{shortValue(change.after?.[field])}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function formatAuditTime(iso?: string) {
  if (!iso) return '?'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 2) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function AuditPage() {
  const { data: apiEvents = [], isLoading, isError, refetch } = useAuditLog()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [severityFilter, setSeverityFilter] = useState<AuditSeverity | 'all'>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Map API audit events to display shape (fall back to static mock if API not available)
  const events: AuditEvent[] = apiEvents.map((e) => {
    const change = auditChange(e.metadata)
    const name = change && typeof (change.after ?? change.before)?.['name'] === 'string' ? String((change.after ?? change.before)!['name']) : null
    return {
      id: e.id,
      actor: { name: e.user?.displayName ?? 'System', email: e.user?.email ?? '' },
      action: e.action,
      resource: name ?? e.resourceId ?? e.resource ?? '—',
      details: change ? '' : JSON.stringify(e.metadata ?? {}),
      change,
      ip: typeof e.metadata?.ip === 'string' ? e.metadata.ip : 'unknown',
      timestamp: formatAuditTime(e.createdAt),
      severity: actionConfig(e.action).severity,
    }
  })
  const categories = Array.from(new Set([...Object.values(ACTION_CFG).map((a) => a.category), ...events.map((e) => actionConfig(e.action).category)]))

  const filtered = events.filter((e) => {
    const matchSearch = !search ||
      e.actor.name.toLowerCase().includes(search.toLowerCase()) ||
      e.action.toLowerCase().includes(search.toLowerCase()) ||
      actionConfig(e.action).label.toLowerCase().includes(search.toLowerCase()) ||
      e.resource.toLowerCase().includes(search.toLowerCase()) ||
      e.details.toLowerCase().includes(search.toLowerCase()) ||
      (e.change?.changes ?? []).some((field) => field.toLowerCase().includes(search.toLowerCase()))
    const matchCat = categoryFilter === 'all' || actionConfig(e.action).category === categoryFilter
    const matchSev = severityFilter === 'all' || e.severity === severityFilter
    return matchSearch && matchCat && matchSev
  })

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <h1 className="text-base font-semibold text-[var(--text-primary)] pb-3">Admin</h1>
        <SubNav items={SUBNAV} />
      </div>

      {isLoading && (
        <div className="px-6 py-3 border-b border-[var(--border)] text-sm text-[var(--text-muted)]">Loading audit events…</div>
      )}
      {isError && (
        <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border)] text-sm text-[var(--error)]">
          The audit log could not be loaded. <Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>
        </div>
      )}
      {!isLoading && !isError && apiEvents.length === 0 && (
        <div className="px-6 py-3 border-b border-[var(--border)] text-sm text-[var(--text-muted)]">No audit events yet. Every change someone makes in the console is recorded here with what it was before and after.</div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0 flex-wrap">
        <Input placeholder="Search events, actors, resources…" leftIcon={<Search size={13} />} value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />

        {/* Category filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="gap-1.5">
              <Filter size={13} />
              {categoryFilter === 'all' ? 'All categories' : categoryFilter}
              <ChevronDown size={11} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setCategoryFilter('all')}>All categories</DropdownMenuItem>
            {categories.map((c) => (
              <DropdownMenuItem key={c} onClick={() => setCategoryFilter(c)}>{c}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Severity filter */}
        <div className="flex gap-1">
          {(['all', 'info', 'success', 'warning', 'error'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium capitalize transition-colors border',
                severityFilter === s ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
              )}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-[var(--text-muted)]">{filtered.length} events</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--bg-surface)] border-b border-[var(--border)] z-10">
            <tr>
              {['', 'Actor', 'Action', 'Resource', 'IP address', 'Timestamp', ''].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((ev) => {
              const ac = actionConfig(ev.action)
              const isExpanded = expanded.has(ev.id)
              return (
                <React.Fragment key={ev.id}>
                  <tr
                    className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                    onClick={() => toggleExpand(ev.id)}
                  >
                    <td className="px-4 py-3 w-8">
                      <ChevronRight size={13} className={cn('text-[var(--text-muted)] transition-transform', isExpanded && 'rotate-90')} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={ev.actor.name} size="xs" />
                        <div>
                          <p className="text-xs font-medium text-[var(--text-primary)]">{ev.actor.name}</p>
                          <p className="text-[10px] text-[var(--text-muted)]">{ev.actor.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={SEVERITY_VARIANT[ev.severity]} className="gap-1 shrink-0">
                          {ac.icon} {ac.label}
                        </Badge>
                        <span className="text-[10px] text-[var(--text-muted)] border border-[var(--border)] px-1.5 py-0.5 rounded">{ac.category}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-[var(--text-secondary)] max-w-xs truncate block">{ev.resource}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-[var(--text-muted)]">{ev.ip}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)] whitespace-nowrap">{ev.timestamp}</td>
                    <td className="px-4 py-3 text-[11px] font-mono text-[var(--text-muted)]">{ev.id}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-[var(--border)] bg-[var(--bg-overlay)]">
                      <td />
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <Info size={13} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">
                              {ev.change ? changeHeading(ev.action, ev.change) : 'Event details'}
                              {ev.change?.source && <span className="ml-2 font-normal text-[var(--text-muted)]">via {ev.change.source === 'console' ? 'the console' : ev.change.source === 'api' ? 'an API key' : 'a script'}</span>}
                            </p>
                            {ev.change ? <ChangeTable change={ev.change} /> : <p className="text-xs text-[var(--text-muted)]">{ev.details}</p>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-[var(--text-muted)]">No events match your filters</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
