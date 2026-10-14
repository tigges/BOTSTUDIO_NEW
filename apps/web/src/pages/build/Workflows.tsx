import React, { useState } from 'react'
import {
  Repeat2, Plus, Pause, Trash2, MoreHorizontal,
  Zap, Clock, MessageSquare, Globe, ToggleLeft, ToggleRight,
  ChevronRight, AlertCircle, Loader2,
} from 'lucide-react'
import { Badge, Button } from '@ybot/ui'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@ybot/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@ybot/ui'
import { cn } from '@ybot/ui'
import { useWorkflows, useCreateWorkflow, useToggleWorkflow, useDeleteWorkflow } from '../../lib/hooks'
import type { AutomationRule } from '../../lib/api'

type TriggerKind = AutomationRule['trigger']

const TRIGGER_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  'conversation.resolved': { label: 'Conversation resolved', icon: <MessageSquare size={12} /> },
  'message.received':      { label: 'Message received',      icon: <MessageSquare size={12} /> },
  'contact.created':       { label: 'Contact created',        icon: <Globe size={12} /> },
  'ticket.created':        { label: 'Ticket created',         icon: <AlertCircle size={12} /> },
  'sla.breached':          { label: 'SLA breached',           icon: <Clock size={12} /> },
  'schedule':              { label: 'Scheduled',              icon: <Clock size={12} /> },
  'intent_matched':        { label: 'Intent matched',         icon: <Zap size={12} /> },
}

const TRIGGER_KINDS = Object.keys(TRIGGER_LABELS) as TriggerKind[]

export function WorkflowsPage() {
  const { data: workflows = [], isLoading } = useWorkflows()
  const createWorkflow = useCreateWorkflow()
  const toggleWorkflow = useToggleWorkflow()
  const deleteWorkflow = useDeleteWorkflow()

  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newTrigger, setNewTrigger] = useState<TriggerKind>('conversation.resolved')
  const [deleteConfirm, setDeleteConfirm] = useState<AutomationRule | null>(null)

  const active = workflows.filter((w) => w.status === 'active').length

  function resetNew() { setNewName(''); setNewDescription(''); setNewTrigger('conversation.resolved') }

  async function handleCreate() {
    if (!newName.trim()) return
    try {
      await createWorkflow.mutateAsync({ name: newName.trim(), description: newDescription.trim() || undefined, trigger: newTrigger, status: 'draft' })
      setShowNew(false)
      resetNew()
    } catch {
      // The dialog stays open and shows createWorkflow.isError.
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return
    await deleteWorkflow.mutateAsync(deleteConfirm.id)
    setDeleteConfirm(null)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-base font-semibold text-[var(--text-primary)]">Workflows</h1>
            <p className="text-xs text-[var(--text-muted)]">Automations around the conversation. They do not speak to the guest.</p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Plus size={14} /> New Workflow
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-6 px-6 py-2.5 bg-[var(--bg-overlay)] border-b border-[var(--border)] shrink-0">
        {[
          { label: 'Total', value: workflows.length },
          { label: 'Active', value: active },
          { label: 'Total runs', value: workflows.reduce((s, w) => s + w.runCount, 0) },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text-primary)]">{s.value.toLocaleString()}</span>
            <span className="text-xs text-[var(--text-muted)]">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-3">
        {isLoading && (
          <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading workflows…
          </div>
        )}

        {!isLoading && workflows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Repeat2 size={32} className="text-[var(--text-muted)] mb-3" />
            <p className="text-sm font-medium text-[var(--text-primary)]">No workflows yet</p>
            <p className="text-xs text-[var(--text-muted)] mt-1 mb-4">
              Create automation rules to streamline your support flow.
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
              <Plus size={14} /> New Workflow
            </Button>
          </div>
        )}

        {workflows.map((w) => {
          const trig = TRIGGER_LABELS[w.trigger] ?? { label: w.trigger, icon: <Zap size={12} /> }
          const isToggling = toggleWorkflow.isPending && toggleWorkflow.variables === w.id
          return (
            <div
              key={w.id}
              className={cn(
                'rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-4 group transition-all',
                w.status === 'active' ? 'border-[var(--border)]' :
                w.status === 'paused' ? 'border-[var(--warning,#fbbf24)]/20 bg-[var(--warning,#fbbf24)]/5' :
                'border-dashed border-[var(--border)]'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={cn('p-2 rounded-[var(--radius-md)] shrink-0', w.status === 'active' ? 'bg-[var(--accent-muted)] text-[var(--accent)]' : 'bg-[var(--bg-overlay)] text-[var(--text-muted)]')}>
                    <Zap size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{w.name}</h3>
                      <Badge variant={w.status === 'active' ? 'success' : w.status === 'paused' ? 'warning' : 'muted'} className="capitalize">{w.status}</Badge>
                    </div>
                    {w.description && <p className="text-xs text-[var(--text-muted)] mb-2">{w.description}</p>}

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--accent-muted)] text-[var(--accent)] font-medium">
                        {trig.icon} When: {trig.label}
                      </span>
                      {w.conditions && (
                        <>
                          <ChevronRight size={11} className="text-[var(--text-muted)]" />
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--bg-overlay)] text-[var(--text-muted)] border border-[var(--border)] font-mono">{w.conditions}</span>
                        </>
                      )}
                      {w.actions && w.actions.length > 0 && (
                        <>
                          <ChevronRight size={11} className="text-[var(--text-muted)]" />
                          <div className="flex gap-1 flex-wrap">
                            {w.actions.map((a, i) => (
                              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--bg-overlay)] text-[var(--text-secondary)] border border-[var(--border)]">{a}</span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="text-xs font-semibold text-[var(--text-primary)]">{w.runCount.toLocaleString()} runs</p>
                    {w.lastRunAt && <p className="text-[10px] text-[var(--text-muted)]">Last: {new Date(w.lastRunAt).toLocaleDateString()}</p>}
                  </div>
                  <button
                    onClick={() => toggleWorkflow.mutate(w.id)}
                    disabled={isToggling}
                    className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
                    title="Toggle active/paused"
                  >
                    {isToggling
                      ? <Loader2 size={22} className="animate-spin" />
                      : w.status === 'active'
                        ? <ToggleRight size={22} className="text-[var(--accent)]" />
                        : <ToggleLeft size={22} />
                    }
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--bg-overlay)] text-[var(--text-muted)] transition-all">
                        <MoreHorizontal size={14} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => toggleWorkflow.mutate(w.id)}>
                        {w.status === 'active' ? <><Pause size={13} /> Pause</> : <><Zap size={13} /> Activate</>}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onClick={() => setDeleteConfirm(w)}><Trash2 size={13} /> Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* New workflow dialog */}
      <Dialog open={showNew} onOpenChange={(o) => { if (!o) { setShowNew(false); resetNew() } }}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>New workflow</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Workflow name *</label>
              <input
                autoFocus
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="e.g. Route VIP conversations"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Description</label>
              <input
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="What does this workflow do?"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Trigger event</label>
              <div className="grid grid-cols-2 gap-2">
                {TRIGGER_KINDS.map((t) => {
                  const tl = TRIGGER_LABELS[t]!
                  return (
                    <button
                      key={t}
                      onClick={() => setNewTrigger(t)}
                      className={cn(
                        'flex items-center gap-2 p-2.5 rounded-[var(--radius-md)] border text-left text-xs transition-colors',
                        newTrigger === t
                          ? 'border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)]'
                          : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                      )}
                    >
                      {tl.icon} {tl.label}
                    </button>
                  )
                })}
              </div>
            </div>
            {createWorkflow.isError && (
              <p className="text-xs text-[var(--danger)]">Failed to create workflow. Please try again.</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowNew(false); resetNew() }}>Cancel</Button>
            <Button disabled={!newName.trim() || createWorkflow.isPending} onClick={handleCreate}>
              {createWorkflow.isPending && <Loader2 size={13} className="animate-spin" />}
              Create workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => { if (!o) setDeleteConfirm(null) }}>
        {deleteConfirm && (
          <DialogContent size="sm">
            <DialogHeader><DialogTitle>Delete workflow?</DialogTitle></DialogHeader>
            <DialogBody>
              <p className="text-sm text-[var(--text-secondary)]">
                Are you sure you want to delete <strong className="text-[var(--text-primary)]">{deleteConfirm.name}</strong>?
                This action cannot be undone.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button variant="destructive" disabled={deleteWorkflow.isPending} onClick={handleDelete}>
                {deleteWorkflow.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
