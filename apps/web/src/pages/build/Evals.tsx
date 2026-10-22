import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, FlaskConical, Loader2, Play, Plus, ShieldCheck, Trash2, XCircle } from 'lucide-react'
import { Badge, Button, EmptyState, PageHeader, cn } from '@botstudio/ui'
import {
  EVAL_CHECK_KINDS,
  EVAL_CHECK_LABELS,
  EVAL_ENDINGS,
  EVAL_ENDING_LABELS,
  EVAL_LIMITS,
  describeCheck,
  evalIssues,
  type EvalCheck,
  type EvalCheckKind,
  type EvalScenario,
  type EvalScenarioResult,
} from '@botstudio/shared'
import type { EvalRunRow, EvalSuiteRow } from '../../lib/api'
import { useDeleteEvalSuite, useEvalRuns, useEvalSuites, useRunEvalSuite, useSaveEvalSuite } from '../../lib/hooks'

const field = 'rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none'

type Draft = { id?: string; name: string; gate: boolean; scenarios: EvalScenario[] }

function newId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`
}

function blankScenario(): EvalScenario {
  return { id: newId('s_'), name: '', turns: [''], checks: [{ kind: 'says', text: '' }] }
}

function blankCheck(kind: EvalCheckKind, chapters: string[]): EvalCheck {
  switch (kind) {
    case 'says': return { kind, text: '' }
    case 'never_says': return { kind, text: '' }
    case 'ends': return { kind, ending: 'resolved' }
    case 'reaches_chapter': return { kind, chapter: chapters[0] ?? '' }
    case 'not_blocked': return { kind }
  }
}

export function formatCost(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return '—'
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function RunStatus({ run }: { run: Pick<EvalRunRow, 'status' | 'passed' | 'failed'> | null }) {
  if (!run) return <Badge variant="muted">Not run yet</Badge>
  if (run.status === 'passed') return <Badge variant="success" dot>{run.passed} passed</Badge>
  if (run.status === 'error') return <Badge variant="error" dot>Could not run</Badge>
  return <Badge variant="error" dot>{run.failed} of {run.passed + run.failed} failed</Badge>
}

export function EvalsPage() {
  const { data, isLoading, isError, refetch } = useEvalSuites()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const suites = data?.suites ?? []
  const selected = suites.find((suite) => suite.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId && suites[0] && !draft) setSelectedId(suites[0].id)
  }, [suites, selectedId, draft])

  useEffect(() => {
    if (selected) setDraft({ id: selected.id, name: selected.name, gate: selected.gate, scenarios: selected.scenarios })
  }, [selected?.id, selected?.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  function startNew() {
    setSelectedId(null)
    setDraft({ name: '', gate: true, scenarios: [blankScenario()] })
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Evals"
        description="Scripted test chats with checks. A gate suite must pass before a release reaches Production."
        actions={<Button size="sm" onClick={startNew}><Plus size={12} className="mr-1" /> New suite</Button>}
      />
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-xs text-[var(--text-muted)]"><Loader2 size={16} className="mr-2 animate-spin" /> Loading eval suites…</div>
        ) : isError || !data ? (
          <EmptyState icon={<AlertCircle size={20} />} title="Eval suites could not be loaded" description="Check your connection and try again." action={<Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>} />
        ) : suites.length === 0 && !draft ? (
          <EmptyState
            icon={<FlaskConical size={20} />}
            title="No eval suites yet"
            description="Write what a guest types and what the bot must (or must never) say. Gate suites run on every publish to Production."
            action={<Button size="sm" onClick={startNew}><Plus size={12} className="mr-1" /> New suite</Button>}
          />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
            <SuiteList suites={suites} selectedId={draft?.id ?? null} creating={!!draft && !draft.id} onSelect={(id) => setSelectedId(id)} />
            {draft && (
              <SuiteEditor
                key={draft.id ?? 'new'}
                saved={selected}
                draft={draft}
                chapters={data.chapters}
                onChange={setDraft}
                onSaved={(id) => setSelectedId(id)}
                onDeleted={() => { setSelectedId(null); setDraft(null) }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SuiteList({ suites, selectedId, creating, onSelect }: { suites: EvalSuiteRow[]; selectedId: string | null; creating: boolean; onSelect: (id: string) => void }) {
  return (
    <ul className="space-y-2">
      {creating && (
        <li className="rounded-[var(--radius-lg)] border border-[var(--accent)] bg-[var(--bg-surface)] p-3 text-xs text-[var(--text-primary)]">New suite (not saved)</li>
      )}
      {suites.map((suite) => (
        <li key={suite.id}>
          <button
            type="button"
            onClick={() => onSelect(suite.id)}
            className={cn('w-full rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-3 text-left', suite.id === selectedId ? 'border-[var(--accent)]' : 'border-[var(--border)] hover:border-[var(--border-focus)]')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-[var(--text-primary)]">{suite.name}</span>
              {suite.gate && <Badge variant="info"><ShieldCheck size={10} className="mr-0.5" /> Gate</Badge>}
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
              <span>{suite.scenarios.length} scenario{suite.scenarios.length === 1 ? '' : 's'}</span>
              <RunStatus run={suite.latestRun} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

function SuiteEditor({ saved, draft, chapters, onChange, onSaved, onDeleted }: {
  saved: EvalSuiteRow | null
  draft: Draft
  chapters: string[]
  onChange: (next: Draft) => void
  onSaved: (id: string) => void
  onDeleted: () => void
}) {
  const save = useSaveEvalSuite()
  const run = useRunEvalSuite()
  const remove = useDeleteEvalSuite()
  const issues = useMemo(() => evalIssues(draft.scenarios), [draft.scenarios])
  const nameMissing = !draft.name.trim()
  const dirty = !saved || JSON.stringify({ name: saved.name, gate: saved.gate, scenarios: saved.scenarios }) !== JSON.stringify({ name: draft.name, gate: draft.gate, scenarios: draft.scenarios })
  const latest = run.data && run.data.suiteId === saved?.id ? run.data : saved?.latestRun ?? null

  function setScenario(index: number, next: EvalScenario) {
    onChange({ ...draft, scenarios: draft.scenarios.map((item, i) => (i === index ? next : item)) })
  }

  function submit() {
    save.mutate({ id: draft.id, body: { name: draft.name.trim(), gate: draft.gate, scenarios: draft.scenarios } }, { onSuccess: (row) => onSaved(row.id) })
  }

  return (
    <div className="min-w-0 space-y-5">
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">Suite name</span>
            <input className={field} value={draft.name} placeholder="Salon basics" onChange={(e) => onChange({ ...draft, name: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-xs text-[var(--text-primary)]">
            <input type="checkbox" checked={draft.gate} onChange={(e) => onChange({ ...draft, gate: e.target.checked })} />
            Gate: must pass before publishing to Production
          </label>
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">Each scenario opens a fresh test chat, plays the greeting, then sends the guest messages in order. Checks are decided by code from the replies and how the chat ended, so a run only costs the bot’s own model calls. Nothing reaches the Inbox or analytics.</p>
      </section>

      {draft.scenarios.map((scenario, index) => (
        <ScenarioCard
          key={scenario.id}
          scenario={scenario}
          chapters={chapters}
          issues={issues.filter((issue) => issue.scenarioId === scenario.id).map((issue) => issue.message)}
          onChange={(next) => setScenario(index, next)}
          onRemove={draft.scenarios.length > 1 ? () => onChange({ ...draft, scenarios: draft.scenarios.filter((_, i) => i !== index) }) : undefined}
        />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={draft.scenarios.length >= EVAL_LIMITS.scenarios} onClick={() => onChange({ ...draft, scenarios: [...draft.scenarios, blankScenario()] })}>
          <Plus size={12} className="mr-1" /> Add scenario
        </Button>
        <div className="flex-1" />
        {saved && (
          <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete the suite "${saved.name}" and its run history?`)) remove.mutate(saved.id, { onSuccess: onDeleted }) }}>
            <Trash2 size={12} className="mr-1" /> Delete
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={!dirty || save.isPending || issues.length > 0 || nameMissing} onClick={submit}>
          {save.isPending ? <Loader2 size={12} className="mr-1 animate-spin" /> : null} Save suite
        </Button>
        <Button
          size="sm"
          disabled={!saved || dirty || run.isPending}
          title={dirty ? 'Save the suite before running it.' : 'Runs every scenario on the working copy (newest saved chart per chapter).'}
          onClick={() => saved && run.mutate(saved.id)}
        >
          {run.isPending ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Play size={12} className="mr-1" />} Run on working copy
        </Button>
      </div>
      {(nameMissing || issues.length > 0) && (
        <p className="text-[11px] text-[var(--error)]">{nameMissing ? 'Give the suite a name.' : issues[0]!.message}</p>
      )}
      {save.error && <p className="text-[11px] text-[var(--error)]">{save.error.message}</p>}
      {run.error && <p className="text-[11px] text-[var(--error)]">{run.error.message}</p>}

      {saved && <RunPanel suiteId={saved.id} latest={latest} running={run.isPending} />}
    </div>
  )
}

function ScenarioCard({ scenario, chapters, issues, onChange, onRemove }: {
  scenario: EvalScenario
  chapters: string[]
  issues: string[]
  onChange: (next: EvalScenario) => void
  onRemove?: () => void
}) {
  function setCheck(index: number, next: EvalCheck) {
    onChange({ ...scenario, checks: scenario.checks.map((item, i) => (i === index ? next : item)) })
  }
  return (
    <section className={cn('rounded-[var(--radius-lg)] border bg-[var(--bg-surface)]', issues.length ? 'border-[var(--error)]/50' : 'border-[var(--border)]')}>
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <input aria-label="Scenario name" className={cn(field, 'flex-1 font-medium')} placeholder="Books a cut for Saturday" value={scenario.name} onChange={(e) => onChange({ ...scenario, name: e.target.value })} />
        {onRemove && <Button size="icon-sm" variant="ghost" title="Remove scenario" onClick={onRemove}><Trash2 size={12} /></Button>}
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-[var(--text-secondary)]">The guest types, one message per line</p>
          <textarea
            aria-label="Guest messages"
            className={cn(field, 'h-28 w-full resize-y font-mono')}
            value={scenario.turns.join('\n')}
            placeholder={'I’d like a haircut\nSaturday morning'}
            onChange={(e) => onChange({ ...scenario, turns: e.target.value.split('\n') })}
          />
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-[var(--text-secondary)]">Checks</p>
          <ul className="space-y-1.5">
            {scenario.checks.map((check, index) => (
              <li key={index} className="flex items-center gap-1.5">
                <select aria-label="Check" className={cn(field, 'w-48')} value={check.kind} onChange={(e) => setCheck(index, blankCheck(e.target.value as EvalCheckKind, chapters))}>
                  {EVAL_CHECK_KINDS.map((kind) => <option key={kind} value={kind}>{EVAL_CHECK_LABELS[kind]}</option>)}
                </select>
                {(check.kind === 'says' || check.kind === 'never_says') && (
                  <input aria-label="Words" className={cn(field, 'min-w-0 flex-1')} placeholder="Which service" value={check.text} onChange={(e) => setCheck(index, { ...check, text: e.target.value })} />
                )}
                {check.kind === 'ends' && (
                  <select aria-label="Ending" className={cn(field, 'min-w-0 flex-1')} value={check.ending} onChange={(e) => setCheck(index, { ...check, ending: e.target.value as typeof check.ending })}>
                    {EVAL_ENDINGS.map((ending) => <option key={ending} value={ending}>{EVAL_ENDING_LABELS[ending]}</option>)}
                  </select>
                )}
                {check.kind === 'reaches_chapter' && (
                  <select aria-label="Chapter" className={cn(field, 'min-w-0 flex-1')} value={check.chapter} onChange={(e) => setCheck(index, { ...check, chapter: e.target.value })}>
                    {!chapters.includes(check.chapter) && <option value={check.chapter}>{check.chapter || 'Pick a chapter'}</option>}
                    {chapters.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                )}
                {check.kind === 'not_blocked' && <span className="flex-1" />}
                <Button size="icon-sm" variant="ghost" title="Remove check" disabled={scenario.checks.length <= 1} onClick={() => onChange({ ...scenario, checks: scenario.checks.filter((_, i) => i !== index) })}><Trash2 size={12} /></Button>
              </li>
            ))}
          </ul>
          <Button className="mt-2" size="sm" variant="ghost" disabled={scenario.checks.length >= EVAL_LIMITS.checks} onClick={() => onChange({ ...scenario, checks: [...scenario.checks, blankCheck('says', chapters)] })}>
            <Plus size={12} className="mr-1" /> Add check
          </Button>
        </div>
      </div>
      {issues.length > 0 && <p className="border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--error)]">{issues[0]}</p>}
    </section>
  )
}

function RunPanel({ suiteId, latest, running }: { suiteId: string; latest: EvalRunRow | null; running: boolean }) {
  const history = useEvalRuns(suiteId)
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Latest run</h2>
          {latest && (
            <p className="text-[11px] text-[var(--text-muted)]">
              {latest.trigger === 'publish' ? 'Gate run on a Production release candidate' : 'Run on the working copy'} · {when(latest.createdAt)} · {(latest.durationMs / 1000).toFixed(1)} s · model cost {formatCost(latest.costUsd)}
            </p>
          )}
        </div>
        {running ? <Badge variant="info"><Loader2 size={10} className="mr-1 animate-spin" /> Running…</Badge> : <RunStatus run={latest} />}
      </div>
      {!latest ? (
        <p className="px-4 py-4 text-xs text-[var(--text-muted)]">This suite has not run yet. Run it on the working copy, or publish to Production to run it as a gate.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {(latest.results ?? []).map((result) => <ScenarioResult key={`${latest.id}:${result.scenarioId}`} result={result} />)}
        </ul>
      )}
      <div className="border-t border-[var(--border)] px-4 py-3">
        <p className="mb-2 text-[11px] font-medium text-[var(--text-secondary)]">History</p>
        {history.isLoading ? (
          <p className="text-[11px] text-[var(--text-muted)]">Loading runs…</p>
        ) : history.isError ? (
          <p className="text-[11px] text-[var(--error)]">Runs could not be loaded. <button type="button" className="underline" onClick={() => history.refetch()}>Retry</button></p>
        ) : (history.data ?? []).length === 0 ? (
          <p className="text-[11px] text-[var(--text-muted)]">No runs yet.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="text-left text-[var(--text-muted)]">
              <tr><th className="pb-1 font-normal">When</th><th className="pb-1 font-normal">What ran</th><th className="pb-1 font-normal">Result</th><th className="pb-1 text-right font-normal">Model cost</th></tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((row) => (
                <tr key={row.id} className="border-t border-[var(--border)]">
                  <td className="py-1.5 text-[var(--text-secondary)]">{when(row.createdAt)}</td>
                  <td className="py-1.5 text-[var(--text-secondary)]">{row.trigger === 'publish' ? 'Publish gate' : 'Working copy'}</td>
                  <td className="py-1.5"><RunStatus run={row} /></td>
                  <td className="py-1.5 text-right text-[var(--text-secondary)]">{formatCost(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

function ScenarioResult({ result }: { result: EvalScenarioResult }) {
  const [open, setOpen] = useState(!result.passed)
  return (
    <li className="px-4 py-3">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {result.passed ? <CheckCircle2 size={13} className="text-[var(--success)]" /> : <XCircle size={13} className="text-[var(--error)]" />}
        <span className="text-xs font-medium text-[var(--text-primary)]">{result.name || 'Unnamed scenario'}</span>
      </button>
      {open && (
        <div className="mt-2 grid gap-3 pl-6 lg:grid-cols-2">
          <ul className="space-y-1">
            {result.error && <li className="text-[11px] text-[var(--error)]">{result.error}</li>}
            {result.checks.map((check, index) => (
              <li key={index} className="flex items-start gap-1.5 text-[11px]">
                {check.passed ? <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-[var(--success)]" /> : <XCircle size={11} className="mt-0.5 shrink-0 text-[var(--error)]" />}
                <span><span className="text-[var(--text-primary)]">{describeCheck(check.check)}</span> <span className="text-[var(--text-muted)]">· {check.detail}</span></span>
              </li>
            ))}
          </ul>
          <ol className="space-y-1 rounded border border-[var(--border)] bg-[var(--bg-overlay)] p-2">
            {result.transcript.length === 0 && <li className="text-[11px] text-[var(--text-muted)]">The chat produced no lines.</li>}
            {result.transcript.map((line, index) => (
              <li key={index} className={cn('text-[11px]', line.role === 'guest' ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')}>
                <span className="font-medium">{line.role === 'guest' ? 'Guest' : 'Bot'}:</span> {line.text}
                {line.role === 'bot' && line.chapter && <span className="text-[var(--text-muted)]"> · {line.chapter}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  )
}
