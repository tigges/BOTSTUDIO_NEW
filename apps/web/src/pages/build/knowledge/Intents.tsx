import React, { useState } from 'react'
import {
  Brain, Plus, Trash2, Save, ChevronRight, Search,
  MessageCircle, X, CheckCircle
} from 'lucide-react'
import { Button, Input, Badge, EmptyState } from '@ybot/ui'
import { cn } from '@ybot/ui'
import { KnowledgeSubNav } from './subnav'
import { useIntents, useUpdateIntent, useCreateIntent, useDeleteIntent } from '../../../lib/hooks'


interface Intent {
  id: string
  name: string
  description: string
  utterances: string[]
  responses: string[]
}

const MOCK_INTENTS: Intent[] = [
  {
    id: '1',
    name: 'greeting',
    description: 'User greets the bot',
    utterances: ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'what\'s up'],
    responses: ['Hello! How can I help you today?', 'Hi there! What can I do for you?'],
  },
  {
    id: '2',
    name: 'order_status',
    description: 'User asks about their order',
    utterances: ['where is my order', 'track my order', 'order status', 'when will my order arrive', 'check delivery'],
    responses: ['Let me look up your order. Can you share your order number?'],
  },
  {
    id: '3',
    name: 'cancel_order',
    description: 'User wants to cancel an order',
    utterances: ['cancel my order', 'i want to cancel', 'stop my order', 'cancel order #'],
    responses: ['I can help you with that. Can you provide your order number?'],
  },
  {
    id: '4',
    name: 'refund_request',
    description: 'User requests a refund',
    utterances: ['i want a refund', 'give me my money back', 'refund please', 'request refund'],
    responses: ['I\'ll connect you with our refund team. Can I have your order number?'],
  },
  {
    id: '5',
    name: 'goodbye',
    description: 'User is ending the conversation',
    utterances: ['bye', 'goodbye', 'see you', 'thanks bye', 'that\'s all'],
    responses: ['Goodbye! Have a great day!', 'Take care! Feel free to chat anytime.'],
  },
]

export function IntentsPage() {
  const { data: intents = [], isLoading } = useIntents()
  const updateIntent = useUpdateIntent()
  const createIntent = useCreateIntent()
  const deleteIntent = useDeleteIntent()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [localEdits, setLocalEdits] = useState<Record<string, Partial<Intent>>>({})
  const [query, setQuery] = useState('')
  const [newUtterance, setNewUtterance] = useState('')
  const [newResponse, setNewResponse] = useState('')
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState(false)

  React.useEffect(() => {
    if (intents.length && !selectedId) setSelectedId(intents[0]?.id ?? null)
  }, [intents, selectedId])

  const filtered = intents.filter(
    (i) => i.name.toLowerCase().includes(query.toLowerCase()) ||
           (i.description ?? '').toLowerCase().includes(query.toLowerCase())
  )
  const rawSelected = intents.find((i) => i.id === selectedId)
  const selected = rawSelected ? { ...rawSelected, ...(localEdits[selectedId!] ?? {}) } as Intent : undefined

  function updateSelected(updates: Partial<Intent>) {
    if (!selectedId) return
    setLocalEdits((e) => ({ ...e, [selectedId]: { ...(e[selectedId] ?? {}), ...updates } }))
  }

  function addUtterance() {
    if (!newUtterance.trim() || !selected) return
    updateSelected({ utterances: [...(selected.utterances ?? []), newUtterance.trim()] })
    setNewUtterance('')
  }

  function removeUtterance(idx: number) {
    if (!selected) return
    updateSelected({ utterances: (selected.utterances ?? []).filter((_, i) => i !== idx) })
  }

  function addResponse() {
    if (!newResponse.trim() || !selected) return
    const current = (selected.responses ?? []).map((r: {text:string}|string) => typeof r === 'string' ? r : r.text)
    updateSelected({ responses: [...current, newResponse.trim()] as string[] })
    setNewResponse('')
  }

  function removeResponse(idx: number) {
    if (!selected) return
    updateSelected({ responses: (selected.responses ?? []).filter((_: unknown, i: number) => i !== idx) as string[] })
  }

  async function handleSave() {
    if (!selectedId || !localEdits[selectedId]) return
    try {
      await updateIntent.mutateAsync({ id: selectedId, ...localEdits[selectedId] } as Parameters<typeof updateIntent.mutateAsync>[0])
      setLocalEdits((e) => { const copy = { ...e }; delete copy[selectedId]; return copy })
    } catch { /* demo mode fallback */ }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleDelete() {
    if (!selectedId) return
    const nextId = intents.find((intent) => intent.id !== selectedId)?.id ?? null
    try {
      await deleteIntent.mutateAsync(selectedId)
      setLocalEdits((edits) => {
        const copy = { ...edits }
        delete copy[selectedId]
        return copy
      })
      setSelectedId(nextId)
      setConfirmDelete(false)
      setDeleteError(false)
    } catch {
      setDeleteError(true)
    }
  }

  async function addIntent() {
    const name = `new_intent_${Date.now()}`
    try {
      const created = await createIntent.mutateAsync({ name, description: '', utterances: [], responses: [] })
      setSelectedId(created.id)
    } catch {
      setSelectedId(intents[0]?.id ?? null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between px-6 pt-4 pb-0">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Knowledge</h1>
          <Button size="sm" onClick={addIntent}>
            <Plus size={13} /> New Intent
          </Button>
        </div>
        <KnowledgeSubNav />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Intent list */}
        <div className="flex w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="p-3 border-b border-[var(--border)]">
            <Input
              placeholder="Search intents…"
              leftIcon={<Search size={13} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
            {filtered.map((intent) => (
              <button
                key={intent.id}
                onClick={() => { setSelectedId(intent.id); setConfirmDelete(false); setDeleteError(false) }}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                  selectedId === intent.id ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]'
                )}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--accent-muted)]">
                  <Brain size={13} className="text-[var(--accent)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-medium truncate', selectedId === intent.id ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]')}>
                    {intent.name}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] truncate">{intent.utterances.length} utterances</p>
                </div>
                <ChevronRight size={12} className="text-[var(--text-muted)] shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* Intent editor */}
        {selected ? (
          <div className="flex flex-1 flex-col overflow-auto">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-3 shrink-0">
              <div>
                <Input
                  value={selected.name}
                  onChange={(e) => updateSelected({ name: e.target.value })}
                  className="text-base font-semibold border-0 bg-transparent p-0 focus:ring-0 h-auto"
                />
              </div>
              <div className="flex items-center gap-2">
                {confirmDelete ? (
                  <>
                    <span className={deleteError ? 'text-xs text-[var(--danger)]' : 'text-xs text-[var(--text-muted)]'}>
                      {deleteError ? 'Could not delete this intent.' : 'Delete this intent?'}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => { setConfirmDelete(false); setDeleteError(false) }}>Cancel</Button>
                    <Button variant="destructive" size="sm" disabled={deleteIntent.isPending} onClick={() => void handleDelete()}>
                      {deleteIntent.isPending ? 'Deleting…' : 'Delete'}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => { setDeleteError(false); setConfirmDelete(true) }}>
                      <Trash2 size={13} /> Delete
                    </Button>
                    <Button size="sm" onClick={handleSave}>
                      {saved ? <><CheckCircle size={13} /> Saved</> : <><Save size={13} /> Save</>}
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-8">
              {/* Description */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Description</label>
                <input
                  className="mt-1 w-full border-0 bg-transparent text-sm text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-muted)]"
                  placeholder="What does this intent represent?"
                  value={selected.description}
                  onChange={(e) => updateSelected({ description: e.target.value })}
                />
              </div>

              {/* Utterances */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Training Utterances</label>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">Examples of what users might say to trigger this intent</p>
                  </div>
                  <Badge variant="muted">{selected.utterances.length}</Badge>
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  {selected.utterances.map((u, i) => (
                    <span
                      key={i}
                      className="group flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-overlay)] px-2.5 py-1 text-xs text-[var(--text-secondary)]"
                    >
                      {u}
                      <button
                        onClick={() => removeUtterance(i)}
                        className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--error)] transition-all"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="Add an utterance and press Enter…"
                    value={newUtterance}
                    onChange={(e) => setNewUtterance(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addUtterance()}
                    className="flex-1"
                    leftIcon={<MessageCircle size={13} />}
                  />
                  <Button variant="secondary" size="md" onClick={addUtterance} disabled={!newUtterance.trim()}>
                    Add
                  </Button>
                </div>
              </div>

              {/* Responses */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Bot Responses</label>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">Replies when this intent is detected (one is picked randomly)</p>
                  </div>
                  <Badge variant="muted">{selected.responses.length}</Badge>
                </div>

                <div className="space-y-2 mb-3">
                  {(selected.responses ?? []).map((r: {text:string}|string, i: number) => (
                    <div key={i} className="group flex items-start gap-2">
                      <div className="flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)]">
                        {typeof r === 'string' ? r : r.text}
                      </div>
                      <button
                        onClick={() => removeResponse(i)}
                        className="mt-1.5 opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--error)] transition-all"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="Add a bot response and press Enter…"
                    value={newResponse}
                    onChange={(e) => setNewResponse(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addResponse()}
                    className="flex-1"
                  />
                  <Button variant="secondary" size="md" onClick={addResponse} disabled={!newResponse.trim()}>
                    Add
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<Brain size={20} />}
              title="Select an intent"
              description="Click an intent on the left to edit it, or create a new one."
              action={<Button size="md" onClick={addIntent}><Plus size={14} /> New Intent</Button>}
            />
          </div>
        )}
      </div>

    </div>
  )
}
