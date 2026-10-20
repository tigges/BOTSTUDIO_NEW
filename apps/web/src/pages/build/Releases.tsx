import React, { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertCircle, AlertTriangle, CheckCircle2, Download, FileUp, History, Loader2, Rocket, RotateCcw, ShieldCheck, XCircle } from 'lucide-react'
import {
  Badge, Button, EmptyState, PageHeader, cn,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@ybot/ui'
import type { ReleaseDiff } from '@ybot/shared'
import { ApiError, bundle as bundleApi, type EvalRunRow, type ImportPlanItem, type ImportPlanView, type ReleaseRow } from '../../lib/api'
import { useImportBundle, usePublishRelease, useReleases, useRollback } from '../../lib/hooks'
import { useAppStore } from '../../store/app'
import { RunStatus } from './Evals'

const field = 'rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none'

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function DiffChips({ diff, empty }: { diff: ReleaseDiff; empty: string }) {
  const parts: Array<[string, string[], 'success' | 'info' | 'error']> = [
    ['Added', diff.added, 'success'],
    ['Changed', diff.changed, 'info'],
    ['Removed', diff.removed, 'error'],
  ]
  const shown = parts.filter(([, names]) => names.length > 0)
  if (shown.length === 0) return <span className="text-[11px] text-[var(--text-muted)]">{empty}</span>
  return (
    <span className="flex flex-wrap gap-1.5">
      {shown.map(([label, names, variant]) => (
        <Badge key={label} variant={variant}>{label}: {names.join(', ')}</Badge>
      ))}
    </span>
  )
}

export function ReleasesPage() {
  const { data, isLoading, isError, refetch } = useReleases()
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Releases" description="What guests on Production hear. Releases never change; rolling back makes an older one live again." />
      <div className="flex-1 space-y-6 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-xs text-[var(--text-muted)]"><Loader2 size={16} className="mr-2 animate-spin" /> Loading releases…</div>
        ) : isError || !data ? (
          <EmptyState icon={<AlertCircle size={20} />} title="Releases could not be loaded" description="Check your connection and try again." action={<Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>} />
        ) : (
          <>
            <PublishPanel view={data} />
            <ReleaseList releases={data.releases} />
          </>
        )}
        <BundlePanel />
      </div>
    </div>
  )
}

function PublishPanel({ view }: { view: NonNullable<ReturnType<typeof useReleases>['data']> }) {
  const navigate = useNavigate()
  const publish = usePublishRelease()
  const [note, setNote] = useState('')
  const live = view.releases.find((release) => release.live)
  const pendingCount = view.pending.added.length + view.pending.changed.length + view.pending.removed.length
  const blocked = publish.error instanceof ApiError ? publish.error.body : undefined
  const gateRuns = (blocked?.['runs'] as EvalRunRow[] | undefined) ?? []
  const nothingToPublish = view.plays === 'release' && pendingCount === 0

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <Rocket size={14} className="text-[var(--accent)]" />
            {live ? <>Production plays release #{live.number}</> : 'Production plays the working copy'}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {live
              ? `Published ${when(live.createdAt)}${live.note ? ` · “${live.note}”` : ''}. Saved edits wait in drafts until you publish.`
              : 'Nothing has been released yet, so guests hear the newest saved chart of each chapter. Publish once to freeze what guests hear.'}
          </p>
        </div>
        {live && <Badge variant="success" dot>Live</Badge>}
      </div>
      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span className="font-medium">Publishing now would change:</span>
          <DiffChips diff={view.pending} empty={view.plays === 'release' ? 'Nothing. Production already plays every saved chapter.' : 'Nothing changes for guests; this freezes the current chapters as release #1.'} />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <ShieldCheck size={12} />
          {view.gateSuites > 0
            ? `${view.gateSuites} gate suite${view.gateSuites === 1 ? '' : 's'} will run against these exact chapters. Any failure stops the release.`
            : <>No gate suites yet. <button type="button" className="text-[var(--accent)] hover:underline" onClick={() => navigate({ to: '/build/evals' })}>Add one on Evals</button> to test every release before guests hear it.</>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Release note" className={cn(field, 'min-w-[240px] flex-1')} maxLength={280} placeholder="What changed, for example “New colour prices”" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={publish.isPending || nothingToPublish} onClick={() => publish.mutate(note.trim() || undefined, { onSuccess: () => setNote('') })}>
            {publish.isPending ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Rocket size={12} className="mr-1" />}
            {publish.isPending ? (view.gateSuites > 0 ? 'Running gate suites…' : 'Publishing…') : 'Publish to Production'}
          </Button>
        </div>
        {publish.isSuccess && (
          <p className="flex items-center gap-1.5 text-xs text-[var(--success)]"><CheckCircle2 size={12} /> Release #{publish.data.number} is live on Production{publish.data.runs.length ? ` after ${publish.data.runs.length} gate suite${publish.data.runs.length === 1 ? '' : 's'} passed` : ''}.</p>
        )}
        {publish.error && (
          <div role="alert" className="rounded border border-[var(--error)]/40 bg-[var(--error-muted)] px-3 py-2 text-xs text-[var(--text-primary)]">
            <p className="flex items-center gap-1.5 font-medium"><XCircle size={12} className="text-[var(--error)]" /> {publish.error.message}</p>
            {gateRuns.length > 0 && (
              <ul className="mt-2 space-y-1">
                {gateRuns.map((run) => (
                  <li key={run.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{run.suiteName}</span>
                    <RunStatus run={run} />
                    <span className="text-[var(--text-muted)]">
                      {(run.results ?? []).filter((result) => !result.passed).map((result) => result.name).join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {Array.isArray(blocked?.['issues']) && (
              <ul className="mt-2 list-disc pl-4 text-[11px]">
                {(blocked!['issues'] as Array<{ chapter: string; message: string }>).slice(0, 5).map((issue, index) => <li key={index}>{issue.chapter}: {issue.message}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function ReleaseList({ releases }: { releases: ReleaseRow[] }) {
  const rollback = useRollback()
  const [target, setTarget] = useState<ReleaseRow | null>(null)
  const live = releases.find((release) => release.live)
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]"><History size={14} /> Release history</h2>
        <p className="text-xs text-[var(--text-muted)]">Each release is a frozen copy of every chapter. Chats already under way carry on in the same chapter of whichever release is live.</p>
      </div>
      {releases.length === 0 ? (
        <p className="px-4 py-4 text-xs text-[var(--text-muted)]">No releases yet. Your first publish to Production creates release #1.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {releases.map((release) => (
            <li key={release.id} className={cn('flex flex-wrap items-start justify-between gap-3 px-4 py-3', release.live && 'bg-[var(--success-muted)]')}>
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-[var(--text-primary)]">#{release.number}</span>
                  {release.live && <Badge variant="success" dot>Live</Badge>}
                  <span className="text-[var(--text-muted)]">{when(release.createdAt)}</span>
                  {release.note && <span className="text-[var(--text-secondary)]">“{release.note}”</span>}
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">{release.chapters.map((chapter) => `${chapter.name} v${chapter.version}`).join(' · ')}</p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                  <DiffChips diff={release.diff} empty="Same chapters as the release before." />
                  <span>· {release.evalRunIds.length ? `${release.evalRunIds.length} gate suite${release.evalRunIds.length === 1 ? '' : 's'} passed` : 'no gate suites ran'}</span>
                </div>
              </div>
              {!release.live && (
                <Button size="sm" variant="secondary" disabled={rollback.isPending} onClick={() => setTarget(release)}>
                  <RotateCcw size={12} className="mr-1" /> {live && release.number < live.number ? 'Roll back to this' : 'Make live'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {rollback.error && <p className="border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--error)]">{rollback.error.message}</p>}
      <Dialog open={!!target} onOpenChange={(open) => { if (!open) setTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make release #{target?.number} live?</DialogTitle>
            <DialogDescription>Production guests hear release #{target?.number} from their next message. Nothing is deleted; you can make release #{live?.number ?? '—'} live again the same way.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-xs text-[var(--text-secondary)]">{target?.chapters.map((chapter) => `${chapter.name} v${chapter.version}`).join(' · ')}</p>
          </DialogBody>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
            <Button size="sm" disabled={rollback.isPending} onClick={() => target && rollback.mutate(target.id, { onSuccess: () => setTarget(null) })}>
              {rollback.isPending ? <Loader2 size={12} className="mr-1 animate-spin" /> : <RotateCcw size={12} className="mr-1" />} Make live
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

const MODE_HINTS: Record<ImportPlanView['mode'], string> = {
  skip: 'Add what is new. Leave everything that already exists as it is.',
  merge: 'Add what is new and update what exists. Keep everything the file does not mention.',
  replace: 'Like merge, and also remove what the file does not have.',
}

const KIND_LABELS: Record<ImportPlanItem['kind'], string> = {
  chapter: 'Chapter',
  tool: 'Tool',
  guardrail_policy: 'Guardrail policy',
  privacy: 'Personal data settings',
  eval_suite: 'Eval suite',
}

const ACTION_BADGE: Record<ImportPlanItem['action'], { label: string; variant: 'success' | 'info' | 'muted' | 'warning' | 'error' }> = {
  create: { label: 'Add', variant: 'success' },
  update: { label: 'Update', variant: 'info' },
  unchanged: { label: 'Same', variant: 'muted' },
  keep: { label: 'Keep', variant: 'muted' },
  delete: { label: 'Remove', variant: 'error' },
  invalid: { label: 'Skipped', variant: 'warning' },
}

function BundlePanel() {
  const botId = useAppStore((s) => s.selectedBotId)
  const importBundle = useImportBundle()
  const [mode, setMode] = useState<ImportPlanView['mode']>('merge')
  const [file, setFile] = useState<{ name: string; content: string } | null>(null)
  const [plan, setPlan] = useState<ImportPlanView | null>(null)
  const [exporting, setExporting] = useState<'json' | 'yaml' | null>(null)
  const [exportError, setExportError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  async function download(format: 'json' | 'yaml') {
    if (!botId) return
    setExporting(format)
    setExportError('')
    try {
      const { text, fileName } = await bundleApi.download(botId, format)
      const url = URL.createObjectURL(new Blob([text], { type: format === 'yaml' ? 'application/yaml' : 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'The export did not download. Try again.')
    } finally {
      setExporting(null)
    }
  }

  async function pick(next: File | undefined) {
    setPlan(null)
    importBundle.reset()
    if (!next) return
    setFile({ name: next.name, content: await next.text() })
  }

  function preview(nextMode = mode) {
    if (!file) return
    importBundle.mutate({ content: file.content, mode: nextMode, dryRun: true }, { onSuccess: setPlan })
  }

  const changes = plan?.items.filter((item) => item.action === 'create' || item.action === 'update' || item.action === 'delete').length ?? 0

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">Export and import</h2>
        <p className="text-xs text-[var(--text-muted)]">One readable file with the chapters, tools, guardrail policies, personal-data settings and eval suites. Secrets never leave: a tool names its Auth Profile, and the profile must exist where you import.</p>
      </div>
      <div className="grid gap-6 p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-[var(--text-secondary)]">Export this bot</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={!!exporting} onClick={() => void download('json')}>{exporting === 'json' ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Download size={12} className="mr-1" />} JSON</Button>
            <Button size="sm" variant="secondary" disabled={!!exporting} onClick={() => void download('yaml')}>{exporting === 'yaml' ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Download size={12} className="mr-1" />} YAML</Button>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">Chapters export as the working copy: the newest saved chart of each.</p>
          {exportError && <p className="text-[11px] text-[var(--error)]">{exportError}</p>}
        </div>
        <div className="space-y-3">
          <p className="text-[11px] font-medium text-[var(--text-secondary)]">Import into this bot</p>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
            <Button size="sm" variant="secondary" onClick={() => input.current?.click()}><FileUp size={12} className="mr-1" /> Choose file</Button>
            <span className="text-xs text-[var(--text-secondary)]">{file ? file.name : 'No file chosen'}</span>
          </div>
          <fieldset className="space-y-1">
            <legend className="sr-only">When something already exists</legend>
            {(['skip', 'merge', 'replace'] as const).map((value) => (
              <label key={value} className="flex items-start gap-2 text-xs">
                <input type="radio" name="import-mode" className="mt-0.5" checked={mode === value} onChange={() => { setMode(value); if (plan) preview(value) }} />
                <span><span className="font-medium capitalize text-[var(--text-primary)]">{value}</span> <span className="text-[var(--text-muted)]">· {MODE_HINTS[value]}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={!file || importBundle.isPending} onClick={() => preview()}>
              {importBundle.isPending && !plan ? <Loader2 size={12} className="mr-1 animate-spin" /> : null} Preview import
            </Button>
            <Button
              size="sm"
              disabled={!plan || plan.applied || changes === 0 || importBundle.isPending}
              onClick={() => file && importBundle.mutate({ content: file.content, mode, dryRun: false }, { onSuccess: setPlan })}
            >
              {importBundle.isPending && plan ? <Loader2 size={12} className="mr-1 animate-spin" /> : null} Import {changes > 0 ? `${changes} change${changes === 1 ? '' : 's'}` : ''}
            </Button>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">Chapters arrive as drafts. Production keeps playing its live release until you publish.</p>
          {importBundle.error && <p role="alert" className="text-[11px] text-[var(--error)]">{importBundle.error.message}</p>}
          {plan && <PlanTable plan={plan} />}
        </div>
      </div>
    </section>
  )
}

function PlanTable({ plan }: { plan: ImportPlanView }) {
  return (
    <div className="rounded border border-[var(--border)]">
      <p className={cn('border-b border-[var(--border)] px-3 py-2 text-xs', plan.applied ? 'bg-[var(--success-muted)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
        {plan.applied
          ? <><CheckCircle2 size={12} className="mr-1 inline text-[var(--success)]" /> Imported from “{plan.from}”. Review the drafts on the Journey page, then publish.</>
          : <>Preview of “{plan.from}” in {plan.mode} mode. Nothing has changed yet.</>}
      </p>
      {plan.warnings.length > 0 && (
        <ul className="space-y-1 border-b border-[var(--border)] bg-[var(--warning-muted)] px-3 py-2">
          {plan.warnings.map((warning, index) => (
            <li key={index} className="flex items-start gap-1.5 text-[11px] text-[var(--text-primary)]"><AlertTriangle size={11} className="mt-0.5 shrink-0 text-[var(--warning)]" /> {warning}</li>
          ))}
        </ul>
      )}
      {plan.items.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-[var(--text-muted)]">The file is empty.</p>
      ) : (
        <table className="w-full text-[11px]">
          <tbody>
            {plan.items.map((item, index) => (
              <tr key={`${item.kind}-${item.name}-${index}`} className="border-t border-[var(--border)] first:border-t-0">
                <td className="w-20 px-3 py-1.5"><Badge variant={ACTION_BADGE[item.action].variant}>{ACTION_BADGE[item.action].label}</Badge></td>
                <td className="w-36 py-1.5 text-[var(--text-muted)]">{KIND_LABELS[item.kind]}</td>
                <td className="py-1.5 pr-3 text-[var(--text-primary)]">
                  {item.name}
                  {item.note && <span className="block text-[var(--text-muted)]">{item.note}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}