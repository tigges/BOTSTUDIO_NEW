import React from 'react'
import { Link } from '@tanstack/react-router'
import { Search, Loader2, AlertTriangle, ChevronDown, ChevronRight, Building2 } from 'lucide-react'
import { Badge, Button, Card } from '@ybot/ui'
import { SubNav } from '../../../components/SubNav'
import { KNOWLEDGE_SUBNAV } from './subnav'
import { useSearchTest } from '../../../lib/hooks'
import type { EngineState, SearchMode, SearchTestReport } from '../../../lib/api'
import { clampTopK, highlightParts } from '../../../lib/knowledge-view'

const MODES: Array<{ id: SearchMode; label: string; help: string }> = [
  { id: 'hybrid', label: 'Hybrid', help: 'Both engines, merged by rank. Finds passages that match the meaning and the exact words.' },
  { id: 'semantic', label: 'Semantic', help: 'Matches meaning through embeddings, so "when are you open" finds "opening hours".' },
  { id: 'keyword', label: 'Keyword', help: 'Matches the words themselves. Works without an embedding model.' },
]

function EngineChip({ label, state }: { label: string; state: EngineState }) {
  if (state.state === 'skipped') return <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-muted)]">{label}: not used</span>
  if (state.state === 'unavailable') {
    return (
      <span className="rounded-full border border-[var(--warning)] bg-[var(--warning-muted)] px-2.5 py-1 text-xs text-[var(--text-primary)]" title={state.reason}>
        {label}: unavailable
      </span>
    )
  }
  return (
    <span className="rounded-full border border-[var(--border)] bg-[var(--bg-overlay)] px-2.5 py-1 text-xs text-[var(--text-secondary)]" data-testid={`engine-${label.toLowerCase()}`}>
      {label}: <span className="font-medium tabular-nums text-[var(--text-primary)]">{state.ms} ms</span>
      {label !== 'Embedding' && <span className="text-[var(--text-muted)]"> · {state.hits} found</span>}
    </span>
  )
}

function Why({ result, mode }: { result: SearchTestReport['results'][number]; mode: SearchMode }) {
  const { why } = result
  const lines: string[] = []
  if (why.semantic) lines.push(`Semantic search ranked it #${why.semantic.rank}, ${Math.round(why.semantic.similarity * 100)}% similar in meaning to the question.`)
  else if (mode !== 'keyword') lines.push('Semantic search did not return it.')
  if (why.keyword) lines.push(`Keyword search ranked it #${why.keyword.rank} (text rank ${why.keyword.score.toFixed(3)}).`)
  else if (mode !== 'semantic') lines.push('Keyword search did not return it.')
  lines.push(why.matchedTerms.length ? `Words from the question it contains: ${why.matchedTerms.join(', ')}.` : 'It shares no words with the question; only its meaning matched.')
  if (why.fused != null) lines.push(`Hybrid score ${why.fused.toFixed(4)}: each engine adds 1 ÷ (60 + its rank), so passages both engines found rise to the top.`)
  if (why.businessFirst) lines.push('Moved up because Business details outrank other sources: when another source disagrees, the bot uses the Business details.')
  return (
    <ul className="mt-2 space-y-1 rounded-[var(--radius)] bg-[var(--bg-overlay)] p-3 text-xs text-[var(--text-secondary)]" data-testid="why">
      {lines.map((line) => <li key={line}>{line}</li>)}
    </ul>
  )
}

function ResultCard({ result, mode }: { result: SearchTestReport['results'][number]; mode: SearchMode }) {
  const [open, setOpen] = React.useState(result.rank === 1)
  const parts = highlightParts(result.content, result.why.matchedTerms)
  return (
    <Card padding="sm" data-testid="search-result">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-muted)] text-xs font-semibold text-[var(--accent)]">{result.rank}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/build/knowledge/documents" search={{ doc: result.documentId }} className="truncate text-sm font-medium text-[var(--text-primary)] hover:underline">{result.title}</Link>
            {result.sourceKind !== 'business' && <span className="text-xs text-[var(--text-muted)]">{result.source}</span>}
            {result.sourceKind === 'business' && <Badge variant="info"><Building2 size={10} /> Business details</Badge>}
            {!result.chunkId && <Badge variant="muted">Whole document</Badge>}
          </div>
          <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
            {parts.map((part, i) => part.hit ? <mark key={i} className="rounded bg-[var(--warning-muted)] px-0.5 text-[var(--text-primary)]">{part.text}</mark> : <React.Fragment key={i}>{part.text}</React.Fragment>)}
          </p>
          <button onClick={() => setOpen((o) => !o)} className="mt-2 flex items-center gap-1 text-xs font-medium text-[var(--accent)]" aria-expanded={open}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Why this passage
          </button>
          {open && <Why result={result} mode={mode} />}
        </div>
      </div>
    </Card>
  )
}

export function SearchTestPage() {
  const [query, setQuery] = React.useState('')
  const [mode, setMode] = React.useState<SearchMode>('hybrid')
  const [topK, setTopK] = React.useState(5)
  const searchTest = useSearchTest()
  const report = searchTest.data
  const unavailable = report ? Object.entries(report.engines).filter(([, s]) => s.state === 'unavailable') as Array<[string, Extract<EngineState, { state: 'unavailable' }>]> : []

  const run = (event?: React.FormEvent) => {
    event?.preventDefault()
    if (!query.trim()) return
    searchTest.mutate({ query: query.trim(), mode, topK: clampTopK(topK) })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between px-6 pt-4 pb-0">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Knowledge</h1>
        </div>
        <SubNav items={KNOWLEDGE_SUBNAV} />
      </div>
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Search & Test</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Ask what a customer would ask and see which passages come back, how long each engine took, and why. Chats use semantic search, and keyword search when nothing is embedded; Business details always go first.
            </p>
          </div>

          <form onSubmit={run} className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. How much is a hygiene visit?"
                  aria-label="Question"
                  maxLength={500}
                  className="h-9 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-base)] pl-9 pr-3 text-sm text-[var(--text-primary)]"
                />
              </div>
              <Button type="submit" disabled={!query.trim() || searchTest.isPending}>
                {searchTest.isPending ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Search
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div role="radiogroup" aria-label="Search mode" className="flex rounded-[var(--radius)] border border-[var(--border)] p-0.5">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    onClick={() => setMode(m.id)}
                    className={`rounded px-3 py-1 text-xs font-medium ${mode === m.id ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                Top K
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value))}
                  onBlur={() => setTopK(clampTopK(topK))}
                  aria-label="Top K"
                  className="h-7 w-16 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-base)] px-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <p className="flex-1 text-xs text-[var(--text-muted)]">{MODES.find((m) => m.id === mode)?.help}</p>
            </div>
          </form>

          {searchTest.error && (
            <Card className="flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--text-secondary)]">The search did not run: {searchTest.error instanceof Error ? searchTest.error.message : 'unknown error'}</p>
              <Button size="sm" variant="secondary" onClick={() => run()}>Retry</Button>
            </Card>
          )}

          {report && (
            <div className="space-y-3" data-testid="search-report">
              <div className="flex flex-wrap items-center gap-2">
                <EngineChip label="Embedding" state={report.engines.embed} />
                <EngineChip label="Semantic" state={report.engines.semantic} />
                <EngineChip label="Keyword" state={report.engines.keyword} />
                <span className="text-xs text-[var(--text-muted)]">Total {report.totalMs} ms · {report.results.length} of top {report.topK}</span>
              </div>
              {unavailable.length > 0 && (
                <Card className="flex gap-2" padding="sm">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--warning)]" />
                  <div className="space-y-1 text-xs text-[var(--text-secondary)]">
                    {unavailable.map(([engine, state]) => <p key={engine}><span className="font-medium capitalize">{engine === 'embed' ? 'Embedding' : engine}:</span> {state.reason}</p>)}
                  </div>
                </Card>
              )}
              {report.results.length === 0 && (
                <Card>
                  <p className="text-sm text-[var(--text-secondary)]">Nothing matched “{report.query}”.</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {report.mode === 'semantic' && report.engines.semantic.state === 'unavailable'
                      ? 'Semantic search is unavailable here; try Keyword or Hybrid.'
                      : 'Try other words, or add a source that covers this question.'}
                  </p>
                </Card>
              )}
              {report.results.map((result) => <ResultCard key={`${result.chunkId ?? result.documentId}-${report.mode}`} result={result} mode={report.mode} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
