import React, { useState } from 'react'
import { HelpCircle, Plus, Search, Save, CheckCircle, Trash2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button, Input, Badge, EmptyState, Skeleton } from '@botstudio/ui'
import { cn } from '@botstudio/ui'
import { KnowledgeSubNav } from './subnav'
import { useFaqs, useCreateFaq, useDeleteFaq, useUpdateFaq } from '../../../lib/hooks'


interface Faq {
  id: string
  question: string
  answer: string
  tags: string[]
}

export function FaqsPage() {
  const { data: faqs = [], isLoading, isError, error, refetch } = useFaqs()
  const createFaq = useCreateFaq()
  const deleteFaq = useDeleteFaq()
  const updateFaq = useUpdateFaq()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [localEdits, setLocalEdits] = useState<Record<string, {question?:string;answer?:string;tags?:string[]}>>({})
  const [query, setQuery] = useState('')
  const [saved, setSaved] = useState(false)

  React.useEffect(() => {
    if (faqs.length && !selectedId) setSelectedId(faqs[0]?.id ?? null)
  }, [faqs, selectedId])

  const filtered = faqs.filter(
    (f) => f.question.toLowerCase().includes(query.toLowerCase()) ||
           f.answer.toLowerCase().includes(query.toLowerCase())
  )
  const rawSelected = faqs.find((f) => f.id === selectedId)
  const selected = rawSelected ? { ...rawSelected, ...(localEdits[selectedId!] ?? {}) } : undefined

  function updateSelected(updates: {question?:string;answer?:string;tags?:string[]}) {
    if (!selectedId) return
    setLocalEdits((e) => ({ ...e, [selectedId]: { ...(e[selectedId] ?? {}), ...updates } }))
  }

  async function addFaq() {
    try {
      const created = await createFaq.mutateAsync({ question: 'New Question', answer: '', tags: [] })
      setSelectedId(created.id)
    } catch { setSelectedId(faqs[0]?.id ?? null) }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between px-6 pt-4 pb-0">
          <div>
            <h1 className="text-base font-semibold text-[var(--text-primary)]">
              <Link to="/build/knowledge/sources" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">Knowledge</Link>
              <span className="mx-1.5 text-[var(--text-muted)]">/</span>FAQs
            </h1>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">Each saved question and answer is a document in the FAQs source, so answers cite it like any other source.</p>
          </div>
          <Button size="sm" onClick={addFaq} disabled={createFaq.isPending}>
            <Plus size={13} /> New FAQ
          </Button>
        </div>
        <KnowledgeSubNav />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* FAQ list */}
        <div className="flex w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="p-3 border-b border-[var(--border)]">
            <Input placeholder="Search FAQs…" leftIcon={<Search size={13} />} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
            {isLoading && Array.from({ length: 4 }).map((_, index) => <div key={index} className="px-4 py-3"><Skeleton className="h-8 w-full rounded" /></div>)}
            {isError && (
              <div className="px-4 py-6 text-xs text-[var(--text-secondary)]">
                {error instanceof Error ? error.message : 'Could not load the FAQs.'}
                <Button className="mt-2" size="sm" variant="secondary" onClick={() => { void refetch() }}>Try again</Button>
              </div>
            )}
            {!isLoading && !isError && faqs.length > 0 && filtered.length === 0 && (
              <div className="px-4 py-6 text-xs text-[var(--text-muted)]">
                No FAQ mentions &ldquo;{query}&rdquo;.{' '}
                <button type="button" className="font-medium text-[var(--accent)]" onClick={() => setQuery('')}>Clear search</button>
              </div>
            )}
            {filtered.map((faq) => (
              <button
                key={faq.id}
                onClick={() => setSelectedId(faq.id)}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                  selectedId === faq.id ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]'
                )}
              >
                <HelpCircle size={13} className="text-[var(--text-muted)] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--text-primary)] line-clamp-2">{faq.question}</p>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {faq.tags.slice(0, 2).map((t) => (
                      <Badge key={t} variant="muted">{t}</Badge>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* FAQ editor */}
        {selected ? (
          <div className="flex-1 overflow-auto p-6 max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">FAQ Editor</h2>
              <div className="flex items-center gap-1">
              <Button size="sm" onClick={() => {
                if (!selectedId) return
                updateFaq.mutate({ id: selectedId, question: selected.question, answer: selected.answer, tags: selected.tags }, {
                  onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) },
                })
              }}>
                {saved ? <><CheckCircle size={13} /> Saved</> : <><Save size={13} /> Save</>}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={deleteFaq.isPending}
                onClick={() => {
                  if (!selectedId || !window.confirm(`Delete "${selected.question}"? The bot stops citing it.`)) return
                  deleteFaq.mutate(selectedId, { onSuccess: () => setSelectedId(faqs.find((faq) => faq.id !== selectedId)?.id ?? null) })
                }}
              >
                <Trash2 size={13} /> Delete
              </Button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)]">Question</label>
                <textarea
                  rows={2}
                  value={selected.question}
                  onChange={(e) => updateSelected({ question: e.target.value })}
                  className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)]">Answer</label>
                <textarea
                  rows={6}
                  value={selected.answer}
                  onChange={(e) => updateSelected({ answer: e.target.value })}
                  className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none resize-none"
                  placeholder="The bot's answer to this question…"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)]">Tags (comma-separated)</label>
                <Input
                  value={selected.tags.join(', ')}
                  onChange={(e) => updateSelected({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
                  placeholder="shipping, orders, returns"
                  className="mt-1"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            {!isLoading && !isError && faqs.length === 0 ? (
              <EmptyState
                icon={<HelpCircle size={20} />}
                title="No FAQs yet"
                description="Write the questions guests ask most, with the answer you want them to get."
                action={<Button size="sm" onClick={addFaq}><Plus size={13} /> New FAQ</Button>}
              />
            ) : (
              <EmptyState icon={<HelpCircle size={20} />} title="Select an FAQ" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
