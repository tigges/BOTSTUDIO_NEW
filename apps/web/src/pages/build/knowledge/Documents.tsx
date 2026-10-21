import React from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { FileText, RefreshCw, X, AlertTriangle, CheckCircle2, Search } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Skeleton } from '@ybot/ui'
import type { QualityLevel } from '@ybot/shared'
import { SubNav } from '../../../components/SubNav'
import { KNOWLEDGE_SUBNAV } from './subnav'
import { useDocumentChunks, useKnowledgeDocuments } from '../../../lib/hooks'
import type { KnowledgeDocument } from '../../../lib/api'
import { filterDocuments, levelCounts, type DocumentFilter } from '../../../lib/knowledge-view'

const LEVEL_LABEL: Record<QualityLevel, string> = { good: 'Good', fair: 'Fair', poor: 'Poor', pending: 'Reading' }
const LEVEL_VARIANT: Record<QualityLevel, 'success' | 'warning' | 'error' | 'muted'> = { good: 'success', fair: 'warning', poor: 'error', pending: 'muted' }

function QualityBadge({ doc }: { doc: KnowledgeDocument }) {
  const { level, score } = doc.quality
  return <Badge variant={LEVEL_VARIANT[level]}>{LEVEL_LABEL[level]}{score != null ? ` · ${score}` : ''}</Badge>
}

function DocumentPanel({ doc, onClose }: { doc: KnowledgeDocument; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useDocumentChunks(doc.id)
  return (
    <aside className="flex w-[440px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-surface)]" aria-label="Document detail">
      <div className="flex items-start gap-2 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{doc.title}</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{doc.source.name} · {doc.chars.toLocaleString()} characters</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X size={14} /></Button>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Extraction quality</h3>
            <QualityBadge doc={doc} />
          </div>
          {doc.quality.issues.length === 0
            ? <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><CheckCircle2 size={14} className="text-[var(--success)]" /> Text came through cleanly, split and embedded.</p>
            : (
              <ul className="space-y-1.5">
                {doc.quality.issues.map((issue) => (
                  <li key={issue} className="flex gap-2 text-sm text-[var(--text-secondary)]"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--warning)]" />{issue}</li>
                ))}
              </ul>
            )}
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Passages {data ? `(${data.chunks.length})` : ''}
          </h3>
          {isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>}
          {error && (
            <div className="flex items-center justify-between gap-2 text-sm text-[var(--text-muted)]">
              Passages could not be loaded.
              <Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>
            </div>
          )}
          {data && data.chunks.length === 0 && (
            <>
              <p className="mb-2 text-sm text-[var(--text-muted)]">Not split into passages yet. Keyword search reads the whole text:</p>
              <pre className="whitespace-pre-wrap rounded-[var(--radius)] bg-[var(--bg-overlay)] p-3 text-xs text-[var(--text-secondary)]">{data.text || '(no text)'}</pre>
            </>
          )}
          {data && data.chunks.length > 0 && (
            <ol className="space-y-2">
              {data.chunks.map((chunk, i) => (
                <li key={chunk.id} className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                    <span>#{i + 1}</span>
                    <span>{chunk.content.length} chars</span>
                    {chunk.embedded ? <Badge variant="success">Embedded</Badge> : <Badge variant="warning">No embedding</Badge>}
                  </div>
                  <p className="whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{chunk.content}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </aside>
  )
}

export function DocumentsPage() {
  const { data: docs = [], isLoading, error, refetch, isFetching } = useKnowledgeDocuments()
  const search = useSearch({ strict: false }) as { doc?: string }
  const navigate = useNavigate()
  const [filter, setFilter] = React.useState<DocumentFilter>({ text: '', sourceId: '', level: '' })
  const shown = filterDocuments(docs, filter)
  const counts = levelCounts(docs)
  const sources = [...new Map(docs.map((doc) => [doc.source.id, doc.source])).values()]
  const open = docs.find((doc) => doc.id === search.doc) ?? null
  const select = (id: string | null) => navigate({ to: '/build/knowledge/documents', search: id ? { doc: id } : {}, replace: true })
  const filtered = filter.text || filter.sourceId || filter.level

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between px-6 pt-4 pb-0">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Knowledge</h1>
          <Link to="/build/knowledge/search" className="flex items-center gap-1 text-sm font-medium text-[var(--accent)]"><Search size={13} /> Search & Test</Link>
        </div>
        <SubNav items={KNOWLEDGE_SUBNAV} />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-auto p-6">
          <p className="mb-4 max-w-3xl text-sm text-[var(--text-muted)]">
            Every document the bot can answer from, and how well its text came through. Open one to see its passages: the pieces search returns and the bot quotes.
          </p>

          {!isLoading && !error && docs.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {(['good', 'fair', 'poor', 'pending'] as QualityLevel[]).map((level) => (
                <button key={level} onClick={() => setFilter((f) => ({ ...f, level: f.level === level ? '' : level }))} className="text-left">
                  <Card className={filter.level === level ? 'border-[var(--accent)]' : ''}>
                    <p className="text-xs text-[var(--text-muted)]">{LEVEL_LABEL[level]}</p>
                    <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">{counts[level]}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">of {docs.length} documents</p>
                  </Card>
                </button>
              ))}
            </div>
          )}

          {!isLoading && !error && docs.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={filter.text}
                onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
                placeholder="Filter by title or source"
                aria-label="Filter documents"
                className="h-8 w-64 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-base)] px-3 text-sm text-[var(--text-primary)]"
              />
              <select
                value={filter.sourceId}
                onChange={(e) => setFilter((f) => ({ ...f, sourceId: e.target.value }))}
                aria-label="Source"
                className="h-8 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-base)] px-2 text-sm text-[var(--text-primary)]"
              >
                <option value="">All sources</option>
                {sources.map((src) => <option key={src.id} value={src.id}>{src.name}</option>)}
              </select>
              <select
                value={filter.level}
                onChange={(e) => setFilter((f) => ({ ...f, level: e.target.value as QualityLevel | '' }))}
                aria-label="Quality"
                className="h-8 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-base)] px-2 text-sm text-[var(--text-primary)]"
              >
                <option value="">Any quality</option>
                {(['good', 'fair', 'poor', 'pending'] as QualityLevel[]).map((level) => <option key={level} value={level}>{LEVEL_LABEL[level]}</option>)}
              </select>
              <span className="text-xs text-[var(--text-muted)]">{shown.length} of {docs.length}</span>
            </div>
          )}

          {isLoading && <div className="space-y-2" data-testid="documents-loading">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>}

          {error && (
            <Card className="flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--text-secondary)]">Documents could not be loaded: {error instanceof Error ? error.message : 'unknown error'}</p>
              <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}><RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Retry</Button>
            </Card>
          )}

          {!isLoading && !error && docs.length === 0 && (
            <EmptyState
              icon={<FileText size={28} />}
              title="No documents yet"
              description="Documents appear here once a source is read: a website, an uploaded file, or your Business details."
              action={<Link to="/build/knowledge/sources"><Button size="sm">Add a source</Button></Link>}
            />
          )}

          {!isLoading && !error && docs.length > 0 && shown.length === 0 && (
            <Card className="flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--text-secondary)]">No documents match these filters.</p>
              <Button size="sm" variant="secondary" onClick={() => setFilter({ text: '', sourceId: '', level: '' })}>Clear filters</Button>
            </Card>
          )}

          {shown.length > 0 && (
            <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-overlay)] text-left text-xs text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Quality</th>
                    <th className="px-3 py-2 text-right font-medium">Characters</th>
                    <th className="px-3 py-2 text-right font-medium">Passages</th>
                    <th className="px-3 py-2 font-medium">Main issue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {shown.map((doc) => (
                    <tr
                      key={doc.id}
                      onClick={() => select(doc.id)}
                      className={`cursor-pointer hover:bg-[var(--bg-hover)] ${open?.id === doc.id ? 'bg-[var(--accent-muted)]' : ''}`}
                    >
                      <td className="max-w-[260px] truncate px-3 py-2 text-[var(--text-primary)]">{doc.title}</td>
                      <td className="max-w-[160px] truncate px-3 py-2 text-[var(--text-secondary)]">{doc.source.name}</td>
                      <td className="px-3 py-2"><QualityBadge doc={doc} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">{doc.chars.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]" title={`${doc.embeddedChunks} of ${doc.chunks} embedded`}>
                        {doc.chunks === 0 ? '0' : `${doc.embeddedChunks}/${doc.chunks}`}
                      </td>
                      <td className="max-w-[320px] truncate px-3 py-2 text-xs text-[var(--text-muted)]">{doc.quality.issues[0] ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {open && <DocumentPanel doc={open} onClose={() => select(null)} />}
      </div>
    </div>
  )
}
