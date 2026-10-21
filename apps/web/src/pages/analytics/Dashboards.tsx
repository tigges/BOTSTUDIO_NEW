import React, { useState } from 'react'
import { storedToken } from '../../lib/storage-keys'
import {
  LayoutDashboard, Plus, MoreHorizontal, Pin, Trash2,
  BarChart3, MessageSquare, UserCheck, ThumbsUp,
  FileText, Clock, Download, Mail, CalendarDays, RefreshCw,
  Pencil, Copy, Loader2,
} from 'lucide-react'
import { Button, Badge } from '@botstudio/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@botstudio/ui'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@botstudio/ui'
import { SubNav } from '../../components/SubNav'
import { cn } from '@botstudio/ui'
import { useDashboards, useCreateDashboard, useDeleteDashboard, useReports, useCreateReport, useRunReport, useDeleteReport } from '../../lib/hooks'
import { AnalyticsFilterBar, MetricCard, useAnalyticsScope } from '../../components/analytics/AnalyticsScope'
import { DASHBOARD_TEMPLATES, templateWidgets, widgetMetric } from '../../lib/dashboard-widgets'
import { useAppStore } from '../../store/app'
import type { Dashboard } from '../../lib/api'

const SUBNAV = [
  { label: 'Overview', path: '/analytics' },
  { label: 'Dashboards', path: '/analytics/dashboards' },
  { label: 'Reports', path: '/analytics/reports' },
]

const DASHBOARD_ICONS: Record<string, React.ReactNode> = {
  bot:   <BarChart3 size={20} />,
  agent: <UserCheck size={20} />,
  csat:  <ThumbsUp size={20} />,
  inbox: <MessageSquare size={20} />,
}

function DashboardCard({
  dash,
  onDelete,
  onOpen,
}: {
  dash: Dashboard
  onDelete: (id: string) => void
  onOpen: (id: string) => void
}) {
  const icon = DASHBOARD_ICONS['bot'] ?? <LayoutDashboard size={20} />
  const widgetCount = dash.widgets?.length ?? 0
  const relativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60_000)
    if (m < 2) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }
  return (
    <div
      className={cn(
        'group rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-5 cursor-pointer transition-all hover:border-[var(--accent)]/40 hover:shadow-[var(--shadow-md)]',
        'border-[var(--border)]'
      )}
      onClick={() => onOpen(dash.id)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={cn('p-2.5 rounded-[var(--radius-md)] bg-[var(--bg-overlay)] text-[var(--text-muted)]')}>
          {icon}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-all">
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={(e) => { e.stopPropagation(); onDelete(dash.id) }}><Trash2 size={13} /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <h3 className="font-semibold text-[var(--text-primary)] mb-1">{dash.name}</h3>

      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] pt-3 border-t border-[var(--border)]">
        <span>{widgetCount} widget{widgetCount !== 1 ? 's' : ''}</span>
        <span>{relativeTime(dash.updatedAt)}</span>
      </div>
    </div>
  )
}

export function DashboardsPage() {
  const { data: dashboards = [], isLoading } = useDashboards()
  const createDashboard = useCreateDashboard()
  const deleteDashboard = useDeleteDashboard()
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTemplate, setNewTemplate] = useState('blank')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const scope = useAnalyticsScope()
  const openDash = dashboards.find((dash) => dash.id === openId) ?? null

  async function handleCreate() {
    if (!newName.trim()) return
    const created = await createDashboard.mutateAsync({ name: newName.trim(), widgets: templateWidgets(newTemplate) })
    setOpenId(created.id)
    setShowNew(false)
    setNewName('')
  }

  async function handleDelete() {
    if (!deleteConfirm) return
    await deleteDashboard.mutateAsync(deleteConfirm)
    setDeleteConfirm(null)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <div className="flex items-center justify-between pb-3">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Analytics</h1>
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Plus size={14} /> New Dashboard
          </Button>
        </div>
        <SubNav items={SUBNAV} />
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading && (
          <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading dashboards…
          </div>
        )}

        {!isLoading && dashboards.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <LayoutDashboard size={32} className="text-[var(--text-muted)] mb-3" />
            <p className="text-sm font-medium text-[var(--text-primary)]">No dashboards yet</p>
            <p className="text-xs text-[var(--text-muted)] mt-1 mb-4">
              Create your first dashboard to visualise key metrics.
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
              <Plus size={14} /> New Dashboard
            </Button>
          </div>
        )}

        {openDash && (
          <section className="mb-6 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">{openDash.name}</h2>
              <AnalyticsFilterBar scope={scope} />
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Same numbers and filters as the overview. The filters stay in the link, so you can share this view.</p>
            {(openDash.widgets ?? []).length === 0 && <p className="mt-4 text-xs text-[var(--text-muted)]">This dashboard has no widgets yet. Pick a template when you create a dashboard to start with a set.</p>}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(openDash.widgets ?? []).map((widget) => {
                const metric = widgetMetric(widget.config)
                return metric
                  ? <MetricCard key={widget.id} scope={scope} metric={metric} title={widget.title} />
                  : (
                    <div key={widget.id} className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] px-4 py-3">
                      <p className="text-xs text-[var(--text-muted)]">{widget.title}</p>
                      <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">—</p>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">Not a chat metric. See Inbox → Contacts for contact counts.</p>
                    </div>
                  )
              })}
            </div>
          </section>
        )}

        {dashboards.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">All dashboards ({dashboards.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {dashboards.map((d) => (
                <DashboardCard
                  key={d.id}
                  dash={d}
                  onOpen={setOpenId}
                  onDelete={(id) => setDeleteConfirm(id)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <Dialog open={showNew} onOpenChange={(o) => { if (!o) { setShowNew(false); setNewName('') } }}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>New dashboard</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Dashboard name *</label>
              <input
                autoFocus
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="e.g. Weekly Bot Summary"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-2 block">Start from a template</label>
              <div className="grid grid-cols-2 gap-2">
                {DASHBOARD_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setNewTemplate(t.id)}
                    className={cn(
                      'flex items-center gap-2 p-3 rounded-[var(--radius-md)] border text-left text-sm transition-colors',
                      newTemplate === t.id
                        ? 'border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                    )}
                  >
                    <LayoutDashboard size={16} /> {t.label}
                  </button>
                ))}
              </div>
            </div>
            {createDashboard.isError && (
              <p className="text-xs text-[var(--danger)]">Failed to create dashboard. Please try again.</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowNew(false); setNewName('') }}>Cancel</Button>
            <Button disabled={!newName.trim() || createDashboard.isPending} onClick={handleCreate}>
              {createDashboard.isPending && <Loader2 size={13} className="animate-spin" />}
              Create dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={(o) => { if (!o) setDeleteConfirm(null) }}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>Delete dashboard?</DialogTitle></DialogHeader>
          <DialogBody>
            <p className="text-sm text-[var(--text-secondary)]">
              This will permanently delete the dashboard and all its widgets. This action cannot be undone.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteDashboard.isPending} onClick={handleDelete}>
              {deleteDashboard.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


// ── Reports ─────────────────────────────────────────────────────────────────
type ReportFrequency = 'daily' | 'weekly' | 'monthly' | 'one-time'
type ReportFormat = 'csv' | 'xlsx' | 'pdf'
type ReportStatus = 'scheduled' | 'running' | 'ready' | 'failed'

interface Report {
  id: string
  name: string
  type: string
  frequency: ReportFrequency
  format: ReportFormat
  status: ReportStatus
  lastRun?: string
  nextRun?: string
  recipients: number
  size?: string
}

const MOCK_REPORTS: Report[] = [
  { id: 'R-001', name: 'Weekly conversation summary', type: 'Conversation', frequency: 'weekly', format: 'xlsx', status: 'ready', lastRun: '2d ago', nextRun: 'In 5 days', recipients: 3, size: '42KB' },
  { id: 'R-002', name: 'Daily CSAT digest', type: 'CSAT', frequency: 'daily', format: 'pdf', status: 'ready', lastRun: '8h ago', nextRun: 'Tomorrow 08:00', recipients: 5, size: '18KB' },
  { id: 'R-003', name: 'Monthly agent performance', type: 'Agent', frequency: 'monthly', format: 'xlsx', status: 'scheduled', nextRun: 'Oct 1, 09:00', recipients: 2 },
  { id: 'R-004', name: 'Bot analytics — Q3 2026', type: 'Bot analytics', frequency: 'one-time', format: 'pdf', status: 'ready', lastRun: '1w ago', recipients: 4, size: '128KB' },
  { id: 'R-005', name: 'Channel breakdown report', type: 'Channel', frequency: 'weekly', format: 'csv', status: 'running', lastRun: '5m ago', nextRun: 'In 7 days', recipients: 1 },
  { id: 'R-006', name: 'Campaign performance Q3', type: 'Campaign', frequency: 'one-time', format: 'xlsx', status: 'failed', lastRun: '3d ago', recipients: 2 },
]

const STATUS_CFG: Record<ReportStatus, { label: string; variant: 'success' | 'info' | 'warning' | 'error' | 'muted'; icon: React.ReactNode }> = {
  ready:     { label: 'Ready',     variant: 'success', icon: <Download size={11} /> },
  scheduled: { label: 'Scheduled', variant: 'info',    icon: <CalendarDays size={11} /> },
  running:   { label: 'Running',   variant: 'warning', icon: <RefreshCw size={11} className="animate-spin" /> },
  failed:    { label: 'Failed',    variant: 'error',   icon: <MoreHorizontal size={11} /> },
}

const FREQ_CFG: Record<ReportFrequency, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', 'one-time': 'One-time',
}

export function ReportsPage() {
  const { data: saved = [] } = useReports()
  const createReport = useCreateReport()
  const runReport = useRunReport()
  const deleteReport = useDeleteReport()
  const botId = useAppStore((s) => s.selectedBotId)
  const reports: Report[] = saved.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    frequency: (row.frequency === 'daily' || row.frequency === 'weekly' || row.frequency === 'monthly' ? row.frequency : 'one-time') as ReportFrequency,
    format: (row.format === 'pdf' || row.format === 'xlsx' ? row.format : 'csv') as ReportFormat,
    status: (row.status === 'ready' || row.status === 'failed' || row.status === 'running' ? row.status : 'scheduled') as ReportStatus,
    lastRun: row.lastRunAt ? new Date(row.lastRunAt).toLocaleString() : undefined,
    recipients: row.recipients.length,
  }))
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('Conversation')
  const [newFormat, setNewFormat] = useState('csv')
  const [newFrequency, setNewFrequency] = useState('one-time')

  async function saveReport(run: boolean) {
    const created = await createReport.mutateAsync({ name: newName.trim(), type: newType, format: newFormat, frequency: newFrequency })
    if (run) await runReport.mutateAsync(created.id)
    setNewName('')
    setShowNew(false)
  }

  async function downloadReport(id: string, name: string) {
    if (!botId) return
    const token = storedToken()
    const res = await fetch(`/api/v1/bots/${botId}/reports/${id}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) return
    const url = URL.createObjectURL(await res.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = `${name}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <div className="flex items-center justify-between pb-3">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Analytics</h1>
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Plus size={14} /> New Report
          </Button>
        </div>
        <SubNav items={SUBNAV} />
      </div>

      {reports.length === 0 && (
        <div className="px-6 py-3 border-b border-[var(--border)] text-sm text-[var(--text-muted)]">No reports yet. Create one to save it for this bot.</div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-6 px-6 py-2.5 bg-[var(--bg-overlay)] border-b border-[var(--border)] shrink-0">
        {[
          { label: 'Total reports', value: reports.length },
          { label: 'Ready to download', value: reports.filter((r) => r.status === 'ready').length },
          { label: 'Scheduled', value: reports.filter((r) => r.status === 'scheduled' || r.frequency !== 'one-time').length },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text-primary)]">{s.value}</span>
            <span className="text-xs text-[var(--text-muted)]">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--bg-surface)] border-b border-[var(--border)] z-10">
            <tr>
              {['Report', 'Type', 'Frequency', 'Format', 'Status', 'Last run', 'Next run', 'Recipients', ''].map((h) => (
                <th key={h} className="px-5 py-2.5 text-left text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {reports.map((r) => {
              const sc = STATUS_CFG[r.status]
              return (
                <tr key={r.id} className="hover:bg-[var(--bg-hover)] transition-colors group">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <FileText size={14} className="text-[var(--text-muted)] shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">{r.name}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">{r.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs text-[var(--text-secondary)]">{r.type}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs font-medium text-[var(--text-secondary)]">{FREQ_CFG[r.frequency]}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-[11px] font-mono uppercase text-[var(--text-muted)] border border-[var(--border)] px-1.5 py-0.5 rounded">{r.format}</span>
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={sc.variant} className="gap-1">{sc.icon} {sc.label}</Badge>
                  </td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{r.lastRun ?? '—'}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{r.nextRun ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]"><Mail size={11} /> {r.recipients}</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      {r.status === 'ready' && (
                        <button className="p-1.5 rounded hover:bg-[var(--bg-overlay)] text-[var(--accent)] transition-colors" title="Download" onClick={() => void downloadReport(r.id, r.name)}>
                          <Download size={13} />
                        </button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1.5 rounded hover:bg-[var(--bg-overlay)] text-[var(--text-muted)] transition-colors">
                            <MoreHorizontal size={13} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => runReport.mutate(r.id)}><RefreshCw size={13} /> Run now</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void downloadReport(r.id, r.name)}><Download size={13} /> Download</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onClick={() => deleteReport.mutate(r.id)}><Trash2 size={13} /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* New report dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>New report</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Report name *</label>
              <input
                autoFocus
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="e.g. Monthly agent summary"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Report type</label>
                <select value={newType} onChange={(e) => setNewType(e.target.value)} className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none">
                  <option>Conversation</option><option>CSAT</option><option>Agent performance</option>
                  <option>Bot analytics</option><option>Channel breakdown</option><option>Campaign</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Format</label>
                <select value={newFormat} onChange={(e) => setNewFormat(e.target.value)} className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none">
                  <option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option><option value="pdf">PDF</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Date range</label>
                <select className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none">
                  <option>Last 7 days</option><option>Last 30 days</option><option>Last 90 days</option><option>Custom</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Schedule</label>
                <select value={newFrequency} onChange={(e) => setNewFrequency(e.target.value)} className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none">
                  <option value="one-time">One-time</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Send to (email addresses)</label>
              <input
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="admin@acme.com, sarah@acme.com…"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button variant="secondary" disabled={!newName.trim()} onClick={() => void saveReport(false)}>Save &amp; schedule</Button>
            <Button disabled={!newName.trim()} onClick={() => void saveReport(true)}>Run now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
