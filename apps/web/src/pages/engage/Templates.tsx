import React, { useState } from 'react'
import {
  Plus, Search, MoreHorizontal, FileText,
  CheckCircle2, Clock, AlertCircle, Edit2, Copy, Trash2,
  Mail, MessageSquare, Phone, Globe, Eye, Loader2,
} from 'lucide-react'
import { Badge, Button, Input } from '@botstudio/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@botstudio/ui'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@botstudio/ui'
import { SubNav } from '../../components/SubNav'
import { cn } from '@botstudio/ui'
import { useTemplates, useCreateTemplate, useDeleteTemplate } from '../../lib/hooks'

const SUBNAV = [
  { label: 'Campaigns', path: '/engage/campaigns' },
  { label: 'Templates', path: '/engage/templates' },
]

type ApprovalStatus = 'approved' | 'pending' | 'rejected' | 'draft'
type TemplateChannel = 'email' | 'whatsapp' | 'sms' | 'web'
type TemplateCategory = 'marketing' | 'transactional' | 'support' | 'utility'

interface Template {
  id: string
  name: string
  channel: TemplateChannel
  category: TemplateCategory
  status: ApprovalStatus
  language: string
  body: string
  usedIn: number
  createdAt: string
  updatedAt: string
}

const STATUS_CONFIG: Record<ApprovalStatus, { label: string; variant: 'success' | 'warning' | 'error' | 'muted'; icon: React.ReactNode }> = {
  approved: { label: 'Approved', variant: 'success', icon: <CheckCircle2 size={11} /> },
  pending: { label: 'Pending review', variant: 'warning', icon: <Clock size={11} /> },
  rejected: { label: 'Rejected', variant: 'error', icon: <AlertCircle size={11} /> },
  draft: { label: 'Draft', variant: 'muted', icon: <Edit2 size={11} /> },
}

const CHANNEL_ICONS: Record<TemplateChannel, React.ReactNode> = {
  email: <Mail size={13} />,
  whatsapp: <MessageSquare size={13} />,
  sms: <Phone size={13} />,
  web: <Globe size={13} />,
}

const CHANNEL_COLORS: Record<TemplateChannel, 'info' | 'success' | 'warning' | 'muted'> = {
  email: 'info', whatsapp: 'success', sms: 'warning', web: 'muted',
}

const CHANNEL_VALUES: TemplateChannel[] = ['email', 'whatsapp', 'sms', 'web']
const CATEGORY_VALUES: TemplateCategory[] = ['marketing', 'transactional', 'support', 'utility']

export function TemplatesPage() {
  const { data: rawTemplates = [] } = useTemplates()
  const createTemplate = useCreateTemplate()
  const deleteTemplate = useDeleteTemplate()

  const templates = (rawTemplates as unknown as Array<{
    id: string; name: string; channel: string
    approvalStatus?: string; status?: string
    content?: { body?: string; category?: string }; body?: string
    category?: string; usedIn?: number; language?: string
    createdAt: string; updatedAt: string
  }>).map((t) => ({
    ...t,
    status: (t.status ?? t.approvalStatus ?? 'draft') as ApprovalStatus,
    body: t.body ?? (t.content as { body?: string } | undefined)?.body ?? '',
    category: (t.category ?? (t.content as { category?: string } | undefined)?.category ?? 'marketing') as TemplateCategory,
    usedIn: t.usedIn ?? 0,
    language: t.language ?? 'en',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  })) as Template[]

  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState<TemplateChannel | 'all'>('all')
  const [preview, setPreview] = useState<Template | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newChannel, setNewChannel] = useState<TemplateChannel>('email')
  const [newCategory, setNewCategory] = useState<TemplateCategory>('marketing')
  const [newBody, setNewBody] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<Template | null>(null)

  const filtered = templates.filter((t) => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase())
    const matchChannel = channelFilter === 'all' || t.channel === channelFilter
    return matchSearch && matchChannel
  })

  function resetNew() {
    setNewName(''); setNewChannel('email'); setNewCategory('marketing'); setNewBody('')
  }

  async function handleCreate(submitForReview: boolean) {
    if (!newName.trim() || !newBody.trim()) return
    await createTemplate.mutateAsync({
      name: newName.trim(),
      channel: newChannel,
      content: { body: newBody.trim(), category: newCategory },
      submitForReview,
    })
    setShowNew(false)
    resetNew()
  }

  async function handleDelete() {
    if (!deleteConfirm) return
    await deleteTemplate.mutateAsync(deleteConfirm.id)
    setDeleteConfirm(null)
    if (preview?.id === deleteConfirm.id) setPreview(null)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <h1 className="text-base font-semibold text-[var(--text-primary)]">Engage</h1>
        <SubNav items={SUBNAV} />
      </div>

      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
        <Input
          placeholder="Search templates…"
          leftIcon={<Search size={13} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />

        <div className="flex gap-1">
          {(['all', ...CHANNEL_VALUES] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => setChannelFilter(ch as TemplateChannel | 'all')}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors border',
                channelFilter === ch
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
              )}
            >
              {ch === 'all' ? 'All channels' : ch}
            </button>
          ))}
        </div>

        <div className="ml-auto">
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Plus size={14} /> New Template
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-6 px-6 py-2.5 bg-[var(--bg-overlay)] border-b border-[var(--border)] shrink-0">
        {[
          { label: 'Total', value: templates.length },
          { label: 'Approved', value: templates.filter((t) => t.status === 'approved').length },
          { label: 'Pending review', value: templates.filter((t) => t.status === 'pending').length },
          { label: 'Rejected', value: templates.filter((t) => t.status === 'rejected').length },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text-primary)]">{s.value}</span>
            <span className="text-xs text-[var(--text-muted)]">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((t) => {
            const st = STATUS_CONFIG[t.status] ?? STATUS_CONFIG['draft']
            return (
              <div
                key={t.id}
                className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden hover:border-[var(--accent)]/40 transition-colors group cursor-pointer"
                onClick={() => setPreview(t)}
              >
                <div className="flex items-start justify-between p-4 pb-3 border-b border-[var(--border)]">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="mt-0.5 text-[var(--text-muted)]">{CHANNEL_ICONS[t.channel]}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{t.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge variant={CHANNEL_COLORS[t.channel]}>{t.channel}</Badge>
                        <span className="text-[10px] text-[var(--text-muted)] capitalize">{t.category}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <Badge variant={st.variant} className="gap-0.5 shrink-0">{st.icon}{st.label}</Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <button className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-all">
                          <MoreHorizontal size={14} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setPreview(t) }}>
                          <Eye size={13} /> Preview
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onClick={(e) => { e.stopPropagation(); setDeleteConfirm(t) }}>
                          <Trash2 size={13} /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="px-4 py-3">
                  <p className="text-xs text-[var(--text-secondary)] line-clamp-3 leading-relaxed">{t.body}</p>
                </div>

                <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-overlay)] border-t border-[var(--border)] text-[11px] text-[var(--text-muted)]">
                  <span>{(t.language ?? 'EN').toUpperCase()} · {t.usedIn ?? 0} campaign{(t.usedIn ?? 0) !== 1 ? 's' : ''}</span>
                  <span>Updated {t.updatedAt}</span>
                </div>
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="col-span-3 flex flex-col items-center justify-center py-20 text-center">
              <FileText size={32} className="text-[var(--text-muted)] mb-3" />
              <p className="text-sm font-medium text-[var(--text-primary)]">No templates found</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {search || channelFilter !== 'all' ? 'Try a different search or filter.' : 'Create your first template to get started.'}
              </p>
              {!search && channelFilter === 'all' && (
                <Button size="sm" className="mt-4 gap-1.5" onClick={() => setShowNew(true)}>
                  <Plus size={14} /> New Template
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Preview dialog */}
      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null) }}>
        {preview && (
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>{preview.name}</DialogTitle>
            </DialogHeader>
            <DialogBody className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant={CHANNEL_COLORS[preview.channel] ?? 'muted'}>{CHANNEL_ICONS[preview.channel]}{preview.channel}</Badge>
                <Badge variant="muted" className="capitalize">{preview.category}</Badge>
                {(() => { const st = STATUS_CONFIG[preview.status] ?? STATUS_CONFIG['draft']; return <Badge variant={st.variant}>{st.icon}{st.label}</Badge> })()}
                <span className="text-xs text-[var(--text-muted)] flex items-center">{(preview.language ?? 'en').toUpperCase()}</span>
              </div>
              <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] p-4">
                <p className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">{preview.body}</p>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Variables like <code className="bg-[var(--bg-overlay)] px-1 rounded font-mono">{`{{1}}`}</code> are filled at send time.
                Used in {preview.usedIn ?? 0} campaign{(preview.usedIn ?? 0) !== 1 ? 's' : ''}.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPreview(null)}>Close</Button>
              <Button
                variant="destructive"
                className="gap-1.5"
                onClick={() => { setDeleteConfirm(preview); setPreview(null) }}
              >
                <Trash2 size={13} /> Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* New template dialog */}
      <Dialog open={showNew} onOpenChange={(o) => { if (!o) { setShowNew(false); resetNew() } }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>New template</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Template name *</label>
              <input
                autoFocus
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="e.g. Order Confirmation"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Channel</label>
                <select
                  className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
                  value={newChannel}
                  onChange={(e) => setNewChannel(e.target.value as TemplateChannel)}
                >
                  {CHANNEL_VALUES.map((ch) => (
                    <option key={ch} value={ch} className="capitalize">{ch.charAt(0).toUpperCase() + ch.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Category</label>
                <select
                  className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as TemplateCategory)}
                >
                  {CATEGORY_VALUES.map((cat) => (
                    <option key={cat} value={cat} className="capitalize">{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Message body *</label>
              <textarea
                rows={5}
                className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder={`Use {{1}}, {{2}} for dynamic variables.\n\ne.g. Hi {{1}}, your order #{{2}} is confirmed!`}
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
              />
            </div>
            {createTemplate.isError && (
              <p className="text-xs text-[var(--danger)]">Failed to create template. Please try again.</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowNew(false); resetNew() }}>Cancel</Button>
            <Button
              variant="secondary"
              disabled={!newName.trim() || createTemplate.isPending}
              onClick={() => handleCreate(false)}
            >
              {createTemplate.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
              Save as draft
            </Button>
            <Button
              disabled={!newName.trim() || !newBody.trim() || createTemplate.isPending}
              onClick={() => handleCreate(true)}
            >
              {createTemplate.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
              Submit for review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => { if (!o) setDeleteConfirm(null) }}>
        {deleteConfirm && (
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>Delete template?</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <p className="text-sm text-[var(--text-secondary)]">
                Are you sure you want to delete <strong className="text-[var(--text-primary)]">{deleteConfirm.name}</strong>?
                This action cannot be undone.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={deleteTemplate.isPending}
                onClick={handleDelete}
              >
                {deleteTemplate.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
