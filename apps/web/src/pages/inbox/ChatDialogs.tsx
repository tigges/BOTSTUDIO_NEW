import React, { useEffect, useState } from 'react'
import { Avatar, Button, cn } from '@botstudio/ui'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@botstudio/ui'
import { useQueryClient } from '@tanstack/react-query'
import * as api from '../../lib/api'
import { useCreateLabel, useCreateTicket, useLabels } from '../../lib/hooks'

type Member = { id: string; displayName: string; email?: string }

const FIELD = 'w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40'

export function TransferDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; members: Member[]; onPick: (id: string) => void }) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Transfer conversation</DialogTitle></DialogHeader>
        <DialogBody className="space-y-2">
          <p className="text-sm text-[var(--text-secondary)] mb-3">Pick the teammate who takes this chat over.</p>
          {props.members.length === 0 && <p className="text-xs text-[var(--text-muted)]">No teammates yet. Invite them in Settings → Team.</p>}
          {props.members.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => props.onPick(member.id)}
              className="flex items-center gap-3 w-full p-3 rounded-[var(--radius-md)] border border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors text-left"
            >
              <Avatar name={member.displayName} size="sm" />
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{member.displayName}</p>
                {member.email && <p className="text-xs text-[var(--text-muted)]">{member.email}</p>}
              </div>
            </button>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

const PRIORITIES = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'critical', label: 'Critical' },
] as const

export function TaskDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; chatId: string | null; members: Member[] }) {
  const createTask = useCreateTicket()
  const [subject, setSubject] = useState('')
  const [priority, setPriority] = useState<string>('medium')
  const [assignee, setAssignee] = useState('')
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!props.open) return
    setSubject('')
    setPriority('medium')
    setAssignee('')
    setError(undefined)
  }, [props.open])

  async function save() {
    if (!subject.trim() || !props.chatId) return
    try {
      await createTask.mutateAsync({ subject: subject.trim(), priority, conversationId: props.chatId, ...(assignee ? { assignedTo: assignee } : {}) })
      props.onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? `The task was not saved: ${err.message}` : 'The task was not saved. Try again.')
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Add a task</DialogTitle></DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-xs text-[var(--text-muted)]">For follow-ups that outlive this chat, like a callback or an approval. The task links back here.</p>
          <div>
            <label htmlFor="task-subject" className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">What needs doing</label>
            <input id="task-subject" autoFocus className={FIELD} placeholder="e.g. Call back about the refund" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label htmlFor="task-priority" className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Priority</label>
            <select id="task-priority" className={FIELD} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="task-assignee" className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Assign to</label>
            <select id="task-assignee" className={FIELD} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {props.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
            </select>
          </div>
          {error && <p className="text-xs text-[var(--error)]">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>Cancel</Button>
          <Button disabled={!subject.trim() || createTask.isPending} onClick={() => void save()}>{createTask.isPending ? 'Saving…' : 'Add task'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function LabelsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; chatId: string | null; active: string[] }) {
  const { data: labels = [] } = useLabels()
  const createLabel = useCreateLabel()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()

  async function toggle(row: { id: string; name: string }, on: boolean) {
    if (!props.chatId) return
    setError(undefined)
    try {
      if (on) await api.conversations.labels.remove(props.chatId, row.id)
      else await api.conversations.labels.add(props.chatId, row.id)
      await qc.invalidateQueries({ queryKey: ['conversations'] })
    } catch {
      setError(`“${row.name}” was not ${on ? 'removed' : 'added'}. Try again.`)
    }
  }

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    const existing = labels.find((row) => row.name.toLowerCase() === trimmed.toLowerCase())
    try {
      const row = existing ?? await createLabel.mutateAsync(trimmed)
      if (!props.active.includes(row.name)) await toggle(row, false)
      setName('')
    } catch {
      setError(`The label “${trimmed}” was not created. Try again.`)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Manage labels</DialogTitle></DialogHeader>
        <DialogBody className="space-y-3">
          {labels.length === 0 && <p className="text-xs text-[var(--text-muted)]">No labels yet. Type one to add it to this chat.</p>}
          <div className="flex flex-wrap gap-2">
            {labels.map((row) => {
              const on = props.active.includes(row.name)
              return (
                <button
                  key={row.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => void toggle(row, on)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm border transition-colors',
                    on ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  {row.name}
                </button>
              )
            })}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
            <input aria-label="New label" className={FIELD} placeholder="New label" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!name.trim()}>Add</Button>
          </form>
          {error && <p className="text-xs text-[var(--error)]">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => props.onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function NewChatDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; botId: string | null; pending: boolean; onCreate: (message: string) => Promise<void> }) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | undefined>()
  useEffect(() => { if (props.open) { setMessage(''); setError(undefined) } }, [props.open])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>New conversation</DialogTitle></DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-[var(--text-muted)]">
            {props.botId ? 'Start an outbound chat. The selected bot answers first.' : 'Pick a bot in the top bar first. The new chat runs on that bot.'}
          </p>
          <div>
            <label htmlFor="new-chat-message" className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Opening message (optional)</label>
            <textarea id="new-chat-message" className={cn(FIELD, 'resize-none')} rows={3} placeholder="Hi! How can I help you today?" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          {error && <p className="text-xs text-[var(--error)]">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={props.pending || !props.botId}
            onClick={async () => {
              try { await props.onCreate(message.trim()) } catch (err) {
                setError(err instanceof Error ? `The chat was not started: ${err.message}` : 'The chat was not started. Try again.')
              }
            }}
          >
            {props.pending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
