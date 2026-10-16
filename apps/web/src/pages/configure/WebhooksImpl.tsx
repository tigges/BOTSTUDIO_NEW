import React, { useState } from 'react'
import {
  Plus, Search, MoreHorizontal, Repeat2, CheckCircle2, AlertCircle,
  Clock, Pause, Play, Trash2, Pencil, ChevronDown, Code2,
  Copy, ExternalLink, RefreshCw, Activity, Filter,
} from 'lucide-react'
import { Badge, Button, Input } from '@ybot/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@ybot/ui'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@ybot/ui'
import { cn } from '@ybot/ui'
import { useWebhooks, useCreateWebhook, useDeleteWebhook, useTestWebhook } from '../../lib/hooks'
import * as api from '../../lib/api'
import { useQueryClient } from '@tanstack/react-query'

const WEBHOOK_EVENTS = [
  'conversation.created', 'conversation.resolved', 'conversation.escalated',
  'message.received', 'message.sent', 'agent.assigned',
  'ticket.created', 'ticket.updated', 'template.approved',
  'bot.published', 'flow.updated', 'contact.created',
]

type WebhookStatus = 'active' | 'paused' | 'error'

interface Webhook {
  id: string
  url: string
  events: string[]
  status: WebhookStatus
  successRate: number
  lastTriggered?: string
  createdAt: string
  secret?: string | null
  isActive?: boolean
}

interface DeliveryLog {
  id: string
  event: string
  status: number
  duration: string
  timestamp: string
}

const MOCK_WEBHOOKS: Webhook[] = [
  {
    id: 'WH-001', url: 'https://hooks.zapier.com/hooks/catch/12345/abc', events: ['conversation.created', 'message.received', 'conversation.resolved'],
    status: 'active', successRate: 98.2, lastTriggered: '2m ago', createdAt: '3 months ago',
  },
  {
    id: 'WH-002', url: 'https://api.hubspot.com/webhooks/v3/receive', events: ['contact.created', 'conversation.created'],
    status: 'active', successRate: 100, lastTriggered: '45m ago', createdAt: '2 months ago',
  },
  {
    id: 'WH-003', url: 'https://n8n.acme.io/webhook/ybot-tickets', events: ['ticket.created', 'ticket.updated', 'agent.assigned'],
    status: 'error', successRate: 54, lastTriggered: '3h ago', createdAt: '1 month ago',
  },
  {
    id: 'WH-004', url: 'https://slack.com/services/T0123/B456/xyz', events: ['bot.published', 'flow.updated', 'template.approved'],
    status: 'paused', successRate: 96.7, lastTriggered: '2d ago', createdAt: '2 weeks ago',
  },
]

const MOCK_LOGS: DeliveryLog[] = [
  { id: 'L-1', event: 'conversation.created', status: 200, duration: '142ms', timestamp: '2m ago' },
  { id: 'L-2', event: 'message.received', status: 200, duration: '89ms', timestamp: '5m ago' },
  { id: 'L-3', event: 'conversation.resolved', status: 200, duration: '203ms', timestamp: '18m ago' },
  { id: 'L-4', event: 'conversation.created', status: 500, duration: '4231ms', timestamp: '45m ago' },
  { id: 'L-5', event: 'message.received', status: 200, duration: '76ms', timestamp: '1h ago' },
  { id: 'L-6', event: 'contact.created', status: 404, duration: '2100ms', timestamp: '2h ago' },
  { id: 'L-7', event: 'message.received', status: 200, duration: '95ms', timestamp: '3h ago' },
]

export function WebhooksPage() {
  const { data: rawWebhooks = [] } = useWebhooks()
  const webhooks: Webhook[] = rawWebhooks.map((w) => ({
    id: w.id,
    url: w.url,
    events: w.events,
    status: (w.isActive === false ? 'paused' : 'active') as WebhookStatus,
    successRate: w.successRate ?? 0,
    createdAt: w.createdAt,
    secret: w.secret,
    isActive: w.isActive,
  }))
  const createWebhook = useCreateWebhook()
  const deleteWebhook = useDeleteWebhook()
  const testWebhookMutation = useTestWebhook()
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [showLogs, setShowLogs] = useState<Webhook | null>(null)
  const [deliveries, setDeliveries] = useState<api.WebhookDelivery[]>([])
  const [newUrl, setNewUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [testResult, setTestResult] = useState<string | null>(null)

  React.useEffect(() => {
    if (!showLogs) return
    void api.webhooks.deliveries(showLogs.id).then((res) => setDeliveries(res.data)).catch(() => setDeliveries([]))
  }, [showLogs])

  function describe(result: { delivered: boolean; statusCode: number; durationMs: number; error?: string }) {
    setTestResult(result.delivered ? `✓ ${result.statusCode} in ${result.durationMs}ms` : `Failed${result.statusCode ? ` ${result.statusCode}` : ''}${result.error ? `: ${result.error}` : ''}`)
    void qc.invalidateQueries({ queryKey: ['webhooks'] })
  }

  function testWebhook(id?: string) {
    setTestResult('Sending test payload…')
    if (id) {
      testWebhookMutation.mutate(id, { onSuccess: describe, onError: (err) => setTestResult(err instanceof Error ? err.message : 'Test failed') })
      return
    }
    void api.webhooks.probe(newUrl).then((res) => describe(res.data)).catch((err) => setTestResult(err instanceof Error ? err.message : 'Test failed'))
  }

  function toggleEvent(event: string) {
    setSelectedEvents((prev) => prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event])
  }

  const STATUS_CFG: Record<WebhookStatus, { label: string; variant: 'success' | 'error' | 'warning' | 'muted'; icon: React.ReactNode }> = {
    active:  { label: 'Active',  variant: 'success', icon: <Activity size={11} /> },
    paused:  { label: 'Paused',  variant: 'warning', icon: <Pause size={11} /> },
    error:   { label: 'Error',   variant: 'error',   icon: <AlertCircle size={11} /> },
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Webhooks</h1>
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Plus size={14} /> Add Webhook
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 px-6 py-2.5 bg-[var(--bg-overlay)] border-b border-[var(--border)] shrink-0">
        {[
          { label: 'Total', value: webhooks.length },
          { label: 'Active', value: webhooks.filter((w) => w.status === 'active').length },
          { label: 'Errors', value: webhooks.filter((w) => w.status === 'error').length },
          { label: 'Avg success rate', value: webhooks.length ? `${(webhooks.reduce((s, w) => s + (w.successRate ?? 0), 0) / webhooks.length).toFixed(1)}%` : '—' },
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
              {['Endpoint', 'Events', 'Status', 'Success rate', 'Last triggered', ''].map((h) => (
                <th key={h} className="px-5 py-2.5 text-left text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {webhooks.map((w) => {
              const sc = STATUS_CFG[w.status] ?? STATUS_CFG['active']
              const successColor = w.successRate >= 95 ? 'text-[var(--success)]' : w.successRate >= 70 ? 'text-[var(--warning,#fbbf24)]' : 'text-[var(--error)]'
              return (
                <tr key={w.id} className="hover:bg-[var(--bg-hover)] transition-colors group">
                  <td className="px-5 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Repeat2 size={14} className="text-[var(--text-muted)] shrink-0" />
                        <span className="text-xs font-mono text-[var(--text-primary)] truncate max-w-xs">{w.url}</span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5 ml-5">Created {w.createdAt}</p>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {w.events.slice(0, 2).map((e) => (
                        <span key={e} className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-[var(--bg-overlay)] text-[var(--text-muted)] border border-[var(--border)]">{e}</span>
                      ))}
                      {w.events.length > 2 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-overlay)] text-[var(--text-muted)] border border-[var(--border)]">+{w.events.length - 2} more</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={sc.variant} className="gap-1">{sc.icon}{sc.label}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-[var(--bg-overlay)]">
                        <div className="h-1.5 rounded-full bg-[var(--accent)]" style={{ width: `${w.successRate}%` }} />
                      </div>
                      <span className={cn('text-xs font-semibold', successColor)}>{w.successRate}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{w.lastTriggered ?? '—'}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button
                        onClick={() => setShowLogs(w)}
                        className="p-1.5 rounded hover:bg-[var(--bg-overlay)] text-[var(--text-muted)] transition-colors"
                        title="Delivery logs"
                      >
                        <Activity size={13} />
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1.5 rounded hover:bg-[var(--bg-overlay)] text-[var(--text-muted)] transition-colors">
                            <MoreHorizontal size={13} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { void api.webhooks.update(w.id, { isActive: w.status === 'paused' }).then(() => qc.invalidateQueries({ queryKey: ['webhooks'] })) }}>
                            <Pause size={13} /> {w.status === 'paused' ? 'Resume' : 'Pause'}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            const next = window.prompt('Endpoint URL', w.url)
                            if (next && next !== w.url) void api.webhooks.update(w.id, { url: next }).then(() => qc.invalidateQueries({ queryKey: ['webhooks'] }))
                          }}><Pencil size={13} /> Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => testWebhook(w.id)}><RefreshCw size={13} /> Send test</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onClick={() => deleteWebhook.mutate(w.id)}><Trash2 size={13} /> Delete</DropdownMenuItem>
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

      {/* Delivery logs dialog */}
      <Dialog open={!!showLogs} onOpenChange={(o) => { if (!o) setShowLogs(null) }}>
        {showLogs && (
          <DialogContent size="lg">
            <DialogHeader><DialogTitle>Delivery log — {showLogs.url.slice(0, 40)}…</DialogTitle></DialogHeader>
            <DialogBody className="space-y-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {['Event', 'Status', 'Duration', 'Timestamp'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-[var(--text-muted)] uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {deliveries.map((log) => (
                    <tr key={log.id} className="hover:bg-[var(--bg-hover)]">
                      <td className="px-3 py-2.5 font-mono text-[var(--text-secondary)]">{log.event}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn('font-semibold', log.success ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
                          {log.statusCode || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[var(--text-muted)]">{log.durationMs}ms</td>
                      <td className="px-3 py-2.5 text-[var(--text-muted)]">{new Date(log.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowLogs(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* New webhook dialog */}
      <Dialog open={showNew} onOpenChange={(o) => { if (!o) { setShowNew(false); setTestResult(null); setSelectedEvents([]) } }}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>Add webhook</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Endpoint URL *</label>
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                  placeholder="https://your-server.com/webhook"
                  value={newUrl}
                  onChange={(e) => { setNewUrl(e.target.value); setTestResult(null) }}
                />
                <Button variant="secondary" size="sm" disabled={!newUrl.trim()} onClick={() => testWebhook()}>Test</Button>
              </div>
              {testResult && (
                <p className={cn('mt-1.5 text-xs font-medium', testResult.startsWith('✓') ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
                  {testResult}
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Subscribe to events *</label>
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                {WEBHOOK_EVENTS.map((ev) => (
                  <button
                    key={ev}
                    onClick={() => toggleEvent(ev)}
                    className={cn(
                      'px-2 py-1 rounded text-[11px] font-mono border transition-colors',
                      selectedEvents.includes(ev)
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                    )}
                  >
                    {ev}
                  </button>
                ))}
              </div>
              {selectedEvents.length > 0 && (
                <p className="text-[11px] text-[var(--text-muted)] mt-1">{selectedEvents.length} event{selectedEvents.length !== 1 ? 's' : ''} selected</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Signing secret <span className="font-normal">(optional)</span></label>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="Used to verify webhook signatures"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowNew(false); setTestResult(null); setSelectedEvents([]) }}>Cancel</Button>
            <Button disabled={!newUrl.trim() || selectedEvents.length === 0} onClick={() => { createWebhook.mutate({ url: newUrl, events: selectedEvents, secret: secret || undefined }); setShowNew(false); setTestResult(null); setSelectedEvents([]); setNewUrl(''); setSecret('') }}>
              Create webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
