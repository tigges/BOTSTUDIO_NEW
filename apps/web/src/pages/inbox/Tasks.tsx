import React, { useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Circle, ClipboardList, Clock, MessageSquare, MoreHorizontal, Plus, Search, SearchX, User } from 'lucide-react'
import { Avatar, Badge, Button, Input, Skeleton, cn } from '@botstudio/ui'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@botstudio/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@botstudio/ui'
import { useNavigate } from '@tanstack/react-router'
import { useCreateTicket, useTeamMembers, useTickets, useUpdateTicket } from '../../lib/hooks'
import { queueChat } from '../../lib/inbox-nav'
import { TASK_PRIORITIES, matchesTask, taskPriority, type TaskFilter, type TaskPriority, type TaskStatus } from '../../lib/tasks'
import { InboxTabs } from './InboxTabs'

interface Task {
  id: string
  subject: string
  priority: TaskPriority
  status: TaskStatus
  assignee: string | null
  contact: string
  chatId: string | null
  createdAt: string
  tags: string[]
}

const COLUMNS: { status: TaskStatus; label: string; icon: React.ReactNode; color: string }[] = [
  { status: 'open', label: 'Open', icon: <Circle size={13} />, color: 'text-[var(--text-muted)]' },
  { status: 'in_progress', label: 'In progress', icon: <Clock size={13} />, color: 'text-[var(--accent)]' },
  { status: 'pending', label: 'Waiting on someone', icon: <AlertTriangle size={13} />, color: 'text-[var(--warning,#fbbf24)]' },
  { status: 'resolved', label: 'Done', icon: <CheckCircle2 size={13} />, color: 'text-[var(--success)]' },
]

const PRIORITY_BADGE: Record<TaskPriority, { variant: 'error' | 'warning' | 'info' | 'muted'; dot: boolean }> = {
  critical: { variant: 'error', dot: true },
  high: { variant: 'warning', dot: true },
  medium: { variant: 'info', dot: false },
  low: { variant: 'muted', dot: false },
}

const FIELD = 'w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40'

function TaskCard({ task, onMove, onOpenChat }: { task: Task; onMove: (id: string, status: TaskStatus) => void; onOpenChat: (chatId: string) => void }) {
  const badge = PRIORITY_BADGE[task.priority]
  const label = TASK_PRIORITIES.find((p) => p.id === task.priority)?.label
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 hover:border-[var(--accent)]/40 transition-colors group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm text-[var(--text-primary)] font-medium leading-snug line-clamp-2">{task.subject}</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Move “${task.subject}”`} className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]">
              <MoreHorizontal size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {COLUMNS.filter((c) => c.status !== task.status).map((c) => (
              <DropdownMenuItem key={c.status} onClick={() => onMove(task.id, c.status)}>Move to {c.label}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        <Badge variant={badge.variant} dot={badge.dot}>{label}</Badge>
        {task.tags.map((t) => (
          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-overlay)] text-[var(--text-muted)] border border-[var(--border)]">{t}</span>
        ))}
      </div>
      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1"><User size={11} /> {task.contact}</span>
        <span>{task.createdAt}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-[var(--border)]">
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          {task.assignee ? <><Avatar name={task.assignee} size="xs" /> {task.assignee}</> : 'Unassigned'}
        </span>
        {task.chatId && (
          <button type="button" onClick={() => onOpenChat(task.chatId!)} className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline">
            <MessageSquare size={11} /> Open chat
          </button>
        )}
      </div>
    </div>
  )
}

export function TasksPage() {
  const tickets = useTickets()
  const createTask = useCreateTicket()
  const updateTask = useUpdateTicket()
  const { data: members = [] } = useTeamMembers()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<TaskFilter>({ search: '', priority: 'all' })
  const [showNew, setShowNew] = useState(false)

  const tasks: Task[] = (tickets.data ?? []).map((t) => ({
    id: t.id,
    subject: t.subject,
    priority: taskPriority(t.priority),
    status: (t.status === 'closed' ? 'resolved' : t.status) as TaskStatus,
    assignee: members.find((m) => m.id === t.assignedTo)?.displayName ?? null,
    contact: t.conversation?.contact?.displayName ?? 'No contact',
    chatId: t.conversationId ?? null,
    createdAt: new Date(t.createdAt).toLocaleDateString(),
    tags: t.tags ?? [],
  }))
  const shown = tasks.filter((task) => matchesTask(task, filter))
  const filtered = filter.search.trim() !== '' || filter.priority !== 'all'

  function openChat(chatId: string) {
    queueChat(chatId)
    void navigate({ to: '/inbox/chats' })
  }

  return (
    <div className="flex flex-col h-full">
      <InboxTabs />
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
        <p className="text-xs text-[var(--text-muted)] mr-2">Follow-ups and approvals that outlive a chat.</p>
        <Input
          placeholder="Search tasks or contacts…"
          aria-label="Search tasks"
          leftIcon={<Search size={13} />}
          value={filter.search}
          onChange={(e) => setFilter({ ...filter, search: e.target.value })}
          className="w-64"
        />
        <select aria-label="Priority" className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-2 py-1.5 text-xs text-[var(--text-primary)]" value={filter.priority} onChange={(e) => setFilter({ ...filter, priority: e.target.value as TaskFilter['priority'] })}>
          <option value="all">Any priority</option>
          {TASK_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <Button size="sm" className="ml-auto gap-1.5" onClick={() => setShowNew(true)}>
          <Plus size={14} /> New task
        </Button>
      </div>

      {tickets.isLoading ? (
        <div className="flex gap-4 p-4">{COLUMNS.map((c) => <Skeleton key={c.status} className="h-40 w-[260px] rounded-[var(--radius-md)]" />)}</div>
      ) : tickets.isError ? (
        <Message icon={<AlertCircle size={18} />} title="Tasks could not be loaded" body="Check your connection, then try again.">
          <Button size="sm" variant="secondary" onClick={() => void tickets.refetch()}>Retry</Button>
        </Message>
      ) : tasks.length === 0 ? (
        <Message icon={<ClipboardList size={18} />} title="No tasks yet" body="Add one from a chat (More → Add a task) when something needs a follow-up after the chat ends, or start one here.">
          <Button size="sm" onClick={() => setShowNew(true)}>New task</Button>
        </Message>
      ) : shown.length === 0 && filtered ? (
        <Message icon={<SearchX size={18} />} title="No tasks match" body="Nothing fits this search and priority.">
          <Button size="sm" variant="secondary" onClick={() => setFilter({ search: '', priority: 'all' })}>Show all tasks</Button>
        </Message>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full gap-4 p-4 min-w-max">
            {COLUMNS.map((col) => {
              const column = shown.filter((t) => t.status === col.status)
              return (
                <div key={col.status} className="flex flex-col w-[260px] shrink-0">
                  <div className={cn('flex items-center gap-1.5 mb-3 px-1', col.color)}>
                    {col.icon}
                    <span className="text-sm font-semibold">{col.label}</span>
                    <span className="ml-auto text-xs font-medium bg-[var(--bg-overlay)] px-1.5 py-0.5 rounded-full text-[var(--text-muted)]">{column.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {column.map((t) => <TaskCard key={t.id} task={t} onMove={(id, status) => updateTask.mutate({ id, status })} onOpenChat={openChat} />)}
                    {column.length === 0 && (
                      <div className="flex items-center justify-center h-24 rounded-[var(--radius-md)] border-2 border-dashed border-[var(--border)]">
                        <p className="text-xs text-[var(--text-muted)]">Nothing here</p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <NewTaskDialog open={showNew} onOpenChange={setShowNew} members={members} pending={createTask.isPending} onCreate={(body) => createTask.mutateAsync(body).then(() => undefined)} />
    </div>
  )
}

function Message(props: { icon: React.ReactNode; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <span className="text-[var(--text-muted)]">{props.icon}</span>
      <p className="text-sm font-medium text-[var(--text-primary)]">{props.title}</p>
      <p className="max-w-sm text-xs text-[var(--text-muted)]">{props.body}</p>
      {props.children}
    </div>
  )
}

function NewTaskDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  members: Array<{ id: string; displayName: string }>
  pending: boolean
  onCreate: (body: { subject: string; priority: string; description?: string; assignedTo?: string }) => Promise<void>
}) {
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [assignee, setAssignee] = useState('')
  const [error, setError] = useState<string | undefined>()

  async function save() {
    if (!subject.trim()) return
    setError(undefined)
    try {
      await props.onCreate({ subject: subject.trim(), priority, ...(description.trim() ? { description: description.trim() } : {}), ...(assignee ? { assignedTo: assignee } : {}) })
      setSubject('')
      setDescription('')
      setAssignee('')
      setPriority('medium')
      props.onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? `The task was not saved: ${err.message}` : 'The task was not saved. Try again.')
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
        <DialogBody className="space-y-4">
          <div>
            <label htmlFor="new-task-subject" className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">What needs doing</label>
            <input id="new-task-subject" autoFocus className={FIELD} placeholder="e.g. Approve the refund for order 1042" value={subject} onChange={(e) => setSubject(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save() }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-task-priority" className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Priority</label>
              <select id="new-task-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={FIELD}>
                {TASK_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="new-task-assignee" className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Assign to</label>
              <select id="new-task-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={FIELD}>
                <option value="">Unassigned</option>
                {props.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="new-task-description" className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Details (optional)</label>
            <textarea id="new-task-description" rows={3} className={cn(FIELD, 'resize-none')} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {error && <p className="text-xs text-[var(--error)]">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>Cancel</Button>
          <Button disabled={!subject.trim() || props.pending} onClick={() => void save()}>{props.pending ? 'Saving…' : 'Add task'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
