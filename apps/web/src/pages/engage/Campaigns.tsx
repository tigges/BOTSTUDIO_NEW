import React, { useState } from 'react'
import {
  Plus, Search, Filter, MoreHorizontal, Megaphone,
  Calendar, Users, BarChart2, Play, Pause, CheckCircle2,
  Clock, AlertCircle, Send, Loader2, Tag, X,
} from 'lucide-react'
import { Avatar, Badge, Button, Input } from '@botstudio/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@botstudio/ui'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@botstudio/ui'
import { SubNav } from '../../components/SubNav'
import { cn } from '@botstudio/ui'
import { useCampaigns, useCreateCampaign, useUpdateCampaign, useLaunchCampaign, usePauseCampaign, useDeleteCampaign, useCampaignDeliveries, useAudienceCount } from '../../lib/hooks'

const SUBNAV = [
  { label: 'Campaigns', path: '/engage/campaigns' },
  { label: 'Templates', path: '/engage/templates' },
]

type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'completed' | 'paused' | 'failed'
type CampaignChannel = 'email' | 'whatsapp' | 'sms' | 'web'

interface Campaign {
  id: string
  name: string
  status: CampaignStatus
  channel: CampaignChannel
  audience: number
  sent?: number
  opened?: number
  clicked?: number
  scheduledAt?: string
  createdAt: string
  template?: string
  filters?: { hasEmail?: boolean; hasPhone?: boolean; channel?: string; tags?: string[] }
}

const STATUS_CONFIG: Record<CampaignStatus, { label: string; variant: 'info' | 'success' | 'error' | 'warning' | 'muted'; icon: React.ReactNode }> = {
  draft: { label: 'Draft', variant: 'muted', icon: <Clock size={11} /> },
  scheduled: { label: 'Scheduled', variant: 'info', icon: <Calendar size={11} /> },
  running: { label: 'Running', variant: 'success', icon: <Play size={11} /> },
  completed: { label: 'Completed', variant: 'success', icon: <CheckCircle2 size={11} /> },
  paused: { label: 'Paused', variant: 'warning', icon: <Pause size={11} /> },
  failed: { label: 'Failed', variant: 'error', icon: <AlertCircle size={11} /> },
}

function pct(a?: number, b?: number): string {
  if (!a || !b) return '—'
  return `${((a / b) * 100).toFixed(1)}%`
}

interface AudienceFilters {
  hasEmail: boolean
  hasPhone: boolean
  channel: string
  tags: string[]
}

const DEFAULT_FILTERS: AudienceFilters = { hasEmail: false, hasPhone: false, channel: '', tags: [] }

function AudiencePicker({
  value,
  onChange,
}: {
  value: AudienceFilters
  onChange: (f: AudienceFilters) => void
}) {
  const [tagInput, setTagInput] = useState('')
  const { data: count, isLoading: counting } = useAudienceCount({
    hasEmail: value.hasEmail || undefined,
    hasPhone: value.hasPhone || undefined,
    channel: value.channel || undefined,
    tags: value.tags.length ? value.tags : undefined,
  })

  function addTag() {
    const t = tagInput.trim()
    if (t && !value.tags.includes(t)) onChange({ ...value, tags: [...value.tags, t] })
    setTagInput('')
  }

  function removeTag(t: string) {
    onChange({ ...value, tags: value.tags.filter((x) => x !== t) })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[var(--text-muted)]">Audience segment</label>
        <span className="text-xs text-[var(--text-muted)]">
          {counting
            ? <span className="flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> counting…</span>
            : count !== undefined
              ? <span className="font-medium text-[var(--text-primary)]"><Users size={11} className="inline mr-1" />{count.toLocaleString()} contacts match</span>
              : <span className="text-[var(--text-muted)]">All contacts</span>
          }
        </span>
      </div>

      {/* Contact requirements */}
      <div className="flex gap-3">
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={value.hasEmail}
            onChange={(e) => onChange({ ...value, hasEmail: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          <span className="text-[var(--text-secondary)]">Has email</span>
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={value.hasPhone}
            onChange={(e) => onChange({ ...value, hasPhone: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          <span className="text-[var(--text-secondary)]">Has phone</span>
        </label>
      </div>

      {/* Channel filter */}
      <div>
        <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">First contact via channel</label>
        <select
          value={value.channel}
          onChange={(e) => onChange({ ...value, channel: e.target.value })}
          className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
        >
          <option value="">Any channel</option>
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
          <option value="web">Web chat</option>
        </select>
      </div>

      {/* Tags filter */}
      <div>
        <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Contact tags (must have all)</label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            placeholder="Type tag and press Enter…"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
          />
          <Button size="sm" variant="secondary" onClick={addTag} disabled={!tagInput.trim()}>
            <Tag size={12} /> Add
          </Button>
        </div>
        {value.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {value.tags.map((t) => (
              <span key={t} className="flex items-center gap-1 text-xs bg-[var(--accent)]/15 text-[var(--accent)] rounded-full px-2 py-0.5 font-medium">
                {t}
                <button onClick={() => removeTag(t)} className="hover:text-[var(--danger)]"><X size={9} /></button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function CampaignsPage() {
  const { data: rawCampaigns = [], isLoading } = useCampaigns()
  const createCampaign = useCreateCampaign()
  const updateCampaign = useUpdateCampaign()
  const launchCampaign = useLaunchCampaign()
  const pauseCampaign = usePauseCampaign()
  const deleteCampaign = useDeleteCampaign()
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newChannel, setNewChannel] = useState('email')
  const [newSubject, setNewSubject] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newSchedule, setNewSchedule] = useState('immediate')
  const [newFilters, setNewFilters] = useState<AudienceFilters>(DEFAULT_FILTERS)
  const [formError, setFormError] = useState('')
  const [viewDeliveries, setViewDeliveries] = useState<string | null>(null)

  // Edit state
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null)
  const [editName, setEditName] = useState('')
  const [editChannel, setEditChannel] = useState('email')
  const [editFilters, setEditFilters] = useState<AudienceFilters>(DEFAULT_FILTERS)
  const [editError, setEditError] = useState('')

  function openEdit(c: Campaign) {
    setEditCampaign(c)
    setEditName(c.name)
    setEditChannel(c.channel ?? 'email')
    setEditFilters({
      hasEmail: c.filters?.hasEmail ?? false,
      hasPhone: c.filters?.hasPhone ?? false,
      channel: c.filters?.channel ?? '',
      tags: c.filters?.tags ?? [],
    })
    setEditError('')
  }

  function closeEdit() {
    setEditCampaign(null)
    setEditName('')
    setEditChannel('email')
    setEditFilters(DEFAULT_FILTERS)
    setEditError('')
  }

  async function handleSaveEdit() {
    if (!editCampaign || !editName.trim()) return
    setEditError('')
    try {
      const filters = {
        hasEmail: editFilters.hasEmail || undefined,
        hasPhone: editFilters.hasPhone || undefined,
        channel: editFilters.channel || undefined,
        tags: editFilters.tags.length ? editFilters.tags : undefined,
      }
      await updateCampaign.mutateAsync({ id: editCampaign.id, name: editName.trim(), channel: editChannel, filters })
      closeEdit()
    } catch (e) { setEditError(e instanceof Error ? e.message : 'Failed to save') }
  }

  function resetForm() {
    setNewName(''); setNewChannel('email'); setNewSchedule('immediate')
    setNewSubject(''); setNewBody(''); setNewFilters(DEFAULT_FILTERS); setFormError('')
  }

  function buildFilters() {
    return {
      hasEmail: newFilters.hasEmail || undefined,
      hasPhone: newFilters.hasPhone || undefined,
      channel: newFilters.channel || undefined,
      tags: newFilters.tags.length ? newFilters.tags : undefined,
    }
  }

  async function handleSaveDraft() {
    if (!newName.trim()) return
    setFormError('')
    try {
      await createCampaign.mutateAsync({ name: newName.trim(), channel: newChannel, subject: newSubject.trim() || undefined, body: newBody.trim() || undefined, status: 'draft', filters: buildFilters() })
      setShowNew(false); resetForm()
    } catch (e) { setFormError(e instanceof Error ? e.message : 'Failed to save') }
  }

  async function handleLaunch() {
    if (!newName.trim()) return
    setFormError('')
    try {
      await createCampaign.mutateAsync({ name: newName.trim(), channel: newChannel, subject: newSubject.trim() || undefined, body: newBody.trim() || undefined, status: 'running', filters: buildFilters() })
      setShowNew(false); resetForm()
    } catch (e) { setFormError(e instanceof Error ? e.message : 'Failed to launch') }
  }

  const campaigns = (rawCampaigns as unknown as Campaign[])
  const filtered = campaigns.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <h1 className="text-base font-semibold text-[var(--text-primary)]">Engage</h1>
        <SubNav items={SUBNAV} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
        <Input
          placeholder="Search campaigns…"
          leftIcon={<Search size={13} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <Button variant="ghost" size="sm" className="gap-1.5"><Filter size={13} /> Filter</Button>
        <div className="ml-auto">
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Plus size={14} /> New Campaign
          </Button>
        </div>
      </div>

      {/* Stats overview */}
      <div className="grid grid-cols-4 gap-px bg-[var(--border)] border-b border-[var(--border)] shrink-0">
        {[
          { label: 'Total campaigns', value: campaigns.length, icon: <Megaphone size={14} />, sub: `${campaigns.filter((c) => c.status === 'running').length} running` },
          { label: 'Total audience', value: campaigns.reduce((s, c) => s + (c.audience ?? 0), 0).toLocaleString(), icon: <Users size={14} />, sub: 'across all campaigns' },
          { label: 'Total sent', value: campaigns.reduce((s, c) => s + (c.sent ?? 0), 0).toLocaleString(), icon: <Send size={14} />, sub: 'messages delivered' },
          { label: 'Avg open rate', value: '53.2%', icon: <BarChart2 size={14} />, sub: '+4.1% vs last month' },
        ].map((s) => (
          <div key={s.label} className="bg-[var(--bg-surface)] px-5 py-4">
            <div className="flex items-center gap-2 mb-1 text-[var(--text-muted)]">{s.icon}<span className="text-[11px] uppercase tracking-wide font-medium">{s.label}</span></div>
            <p className="text-xl font-bold text-[var(--text-primary)]">{s.value}</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Campaign list */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--bg-surface)] border-b border-[var(--border)] z-10">
            <tr>
              {['Campaign', 'Status', 'Channel', 'Audience', 'Sent', 'Open rate', 'Click rate', 'Date', ''].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map((c) => {
              const st = STATUS_CONFIG[c.status] ?? STATUS_CONFIG['draft']
              const chColor: Record<CampaignChannel, string> = { email: 'info', whatsapp: 'success', sms: 'warning', web: 'muted' }
              return (
                <tr key={c.id} className="hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group" onClick={() => openEdit(c)}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-[var(--text-primary)] max-w-xs truncate">{c.name}</p>
                    {c.template && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Template: {c.template}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={st.variant} className="gap-1">{st.icon}{st.label}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={chColor[c.channel] as 'info' | 'success' | 'warning' | 'muted'}>{c.channel}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
                    {(c.audience ?? 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                    {c.sent?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {c.opened && c.sent ? (
                      <div>
                        <span className="text-sm font-medium text-[var(--text-primary)]">{pct(c.opened, c.sent)}</span>
                        <div className="mt-1 h-1 w-16 rounded-full bg-[var(--bg-overlay)]">
                          <div className="h-1 rounded-full bg-[var(--accent)]" style={{ width: pct(c.opened, c.sent) }} />
                        </div>
                      </div>
                    ) : <span className="text-xs text-[var(--text-muted)]">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {c.clicked && c.sent
                      ? <span className="text-sm font-medium text-[var(--text-primary)]">{pct(c.clicked, c.sent)}</span>
                      : <span className="text-xs text-[var(--text-muted)]">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)] whitespace-nowrap">
                    {c.scheduledAt ?? c.createdAt}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--bg-overlay)] text-[var(--text-muted)] transition-all">
                          <MoreHorizontal size={14} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(c)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setViewDeliveries(c.id)}>View deliveries</DropdownMenuItem>
                        <DropdownMenuItem>Duplicate</DropdownMenuItem>
                        {(c.status === 'draft' || c.status === 'paused') && (
                          <DropdownMenuItem onClick={() => launchCampaign.mutate(c.id)}>
                            <Play size={13} /> {c.status === 'paused' ? 'Resume' : 'Launch'}
                          </DropdownMenuItem>
                        )}
                        {(c.status === 'running' || c.status === 'scheduled') && (
                          <DropdownMenuItem onClick={() => pauseCampaign.mutate(c.id)}>
                            <Pause size={13} /> Pause
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onClick={() => deleteCampaign.mutate(c.id)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* New campaign dialog */}
      <Dialog open={showNew} onOpenChange={(o) => { setShowNew(o); if (!o) resetForm() }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Campaign name *</label>
              <input
                autoFocus
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="e.g. Black Friday 2026 — Email"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveDraft() }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Channel</label>
                <select
                  value={newChannel}
                  onChange={(e) => setNewChannel(e.target.value)}
                  className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
                >
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="web">Web</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Schedule</label>
                <select
                  value={newSchedule}
                  onChange={(e) => setNewSchedule(e.target.value)}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none w-full"
                >
                  <option value="immediate">Send immediately</option>
                  <option value="later">Schedule for later</option>
                </select>
              </div>
            </div>

            {/* Audience segment picker */}
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 bg-[var(--bg-overlay)] space-y-3">
              <AudiencePicker value={newFilters} onChange={setNewFilters} />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Email subject</label>
              <input
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="Your subject line…"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Message body (HTML or plain text)</label>
              <textarea
                rows={3}
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 resize-none"
                placeholder="Hi {{name}}, …"
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
              />
            </div>
            {formError && (
              <p className="text-xs text-[var(--danger)] bg-[var(--danger)]/10 rounded-[var(--radius-md)] px-3 py-2">{formError}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowNew(false); resetForm() }}>Cancel</Button>
            <Button
              variant="secondary"
              disabled={!newName.trim() || createCampaign.isPending}
              onClick={handleSaveDraft}
            >
              {createCampaign.isPending ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
              Save as draft
            </Button>
            <Button
              disabled={!newName.trim() || createCampaign.isPending}
              onClick={handleLaunch}
            >
              {createCampaign.isPending ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
              Launch campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit campaign dialog */}
      <Dialog open={!!editCampaign} onOpenChange={(o) => { if (!o) closeEdit() }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Edit campaign</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Campaign name *</label>
              <input
                autoFocus
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="Campaign name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit() }}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Channel</label>
              <select
                value={editChannel}
                onChange={(e) => setEditChannel(e.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
              >
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
                <option value="web">Web</option>
              </select>
            </div>
            {/* Audience picker */}
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 bg-[var(--bg-overlay)]">
              <AudiencePicker value={editFilters} onChange={setEditFilters} />
            </div>
            {editCampaign && (
              <p className="text-xs text-[var(--text-muted)]">
                Status: <span className="font-medium text-[var(--text-secondary)]">{STATUS_CONFIG[editCampaign.status]?.label ?? editCampaign.status}</span>
                {editCampaign.scheduledAt && <> · Scheduled: {editCampaign.scheduledAt}</>}
              </p>
            )}
            {editError && (
              <p className="text-xs text-[var(--danger)] bg-[var(--danger)]/10 rounded-[var(--radius-md)] px-3 py-2">{editError}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={closeEdit}>Cancel</Button>
            <Button
              disabled={!editName.trim() || updateCampaign.isPending}
              onClick={handleSaveEdit}
            >
              {updateCampaign.isPending ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deliveries dialog */}
      <DeliveriesDialog campaignId={viewDeliveries} onClose={() => setViewDeliveries(null)} />
    </div>
  )
}

function DeliveriesDialog({ campaignId, onClose }: { campaignId: string | null; onClose: () => void }) {
  const { data: deliveries = [] } = useCampaignDeliveries(campaignId ?? '')
  const sent = deliveries.filter((d) => d.status === 'sent' || d.status === 'simulated').length
  const failed = deliveries.filter((d) => d.status === 'failed').length
  const pending = deliveries.filter((d) => d.status === 'pending').length
  return (
    <Dialog open={!!campaignId} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Delivery report</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'Sent', value: sent, color: 'text-[var(--success)]' },
              { label: 'Pending', value: pending, color: 'text-[var(--warning)]' },
              { label: 'Failed', value: failed, color: 'text-[var(--danger)]' },
            ].map((s) => (
              <div key={s.label} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-[var(--border)] text-sm">
            {deliveries.length === 0 && <p className="text-center py-6 text-[var(--text-muted)] text-sm">No deliveries yet</p>}
            {deliveries.slice(0, 100).map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-2 px-1">
                <span className={`text-xs font-medium w-20 shrink-0 capitalize ${d.status === 'sent' || d.status === 'simulated' ? 'text-[var(--success)]' : d.status === 'failed' ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>{d.status}</span>
                <span className="text-[var(--text-secondary)] truncate">{d.email ?? d.contactId}</span>
                {d.sentAt && <span className="text-xs text-[var(--text-muted)] shrink-0 ml-auto">{new Date(d.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

