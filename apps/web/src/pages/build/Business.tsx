import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Building2, CheckCircle2, Loader2, RefreshCw, Save } from 'lucide-react'
import { Button, EmptyState, PageHeader, cn } from '@ybot/ui'
import type { BusinessProfile, FieldChange } from '@ybot/shared'
import { BusinessFieldRow, takeAlternative, withValue } from '../../components/BusinessFields'
import { useAcceptBusiness, useBusiness, useRereadBusiness, useSaveBusiness } from '../../lib/hooks'

type Filter = 'all' | 'check' | 'missing'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'check', label: 'Needs a look' },
  { id: 'missing', label: 'Missing' },
]

export function BusinessPage() {
  const { data, isLoading, isError, refetch } = useBusiness()
  const save = useSaveBusiness()
  const reread = useRereadBusiness()
  const accept = useAcceptBusiness()
  const [draft, setDraft] = useState<BusinessProfile | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [url, setUrl] = useState('')
  const [rereading, setRereading] = useState(false)
  const [ticked, setTicked] = useState<string[]>([])
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    if (data?.profile) setDraft(data.profile)
  }, [data?.profile])

  const specs = data?.blueprint?.fields ?? []
  const dirty = Boolean(draft && data?.profile && JSON.stringify(draft) !== JSON.stringify(data.profile))
  const issueFor = (key: string) => data?.issues.find((issue) => issue.field === key)
  const visible = useMemo(() => specs.filter((spec) => {
    const status = draft?.fields[spec.key]?.status ?? 'missing'
    if (filter === 'missing') return status === 'missing'
    if (filter === 'check') return status === 'missing' || status === 'conflict' || status === 'found' || Boolean(issueFor(spec.key))
    return true
  }), [specs, draft, filter, data?.issues]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onSave() {
    if (!draft) return
    setSaved(null)
    const result = await save.mutateAsync(draft).catch(() => null)
    if (result) setSaved(`Saved. ${result.facts} answers and ${result.documents} Knowledge documents now use these details.`)
  }

  async function onReread() {
    setTicked([])
    await reread.mutateAsync(url.trim() || undefined).catch(() => null)
  }

  async function onAccept(fresh: BusinessProfile) {
    const result = await accept.mutateAsync({ fresh, keys: ticked }).catch(() => null)
    if (result) {
      setSaved(`Kept ${result.accepted.length} change${result.accepted.length === 1 ? '' : 's'} from the website.`)
      setRereading(false)
      reread.reset()
    }
  }

  const persona = draft?.personaName || data?.blueprint?.persona || 'The bot'

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Business details"
        description={`What ${persona} tells guests. Saved changes reach the next answer without publishing.`}
        actions={data?.profile ? (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setRereading(true); reread.reset() }}>
              <RefreshCw size={12} className="mr-1" /> Read website again
            </Button>
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => { void onSave() }}>
              {save.isPending ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Save size={12} className="mr-1" />} Save changes
            </Button>
          </div>
        ) : undefined}
      />
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-xs text-[var(--text-muted)]"><Loader2 size={16} className="mr-2 animate-spin" /> Loading business details…</div>
        ) : isError || !data ? (
          <EmptyState icon={<AlertCircle size={20} />} title="Business details could not be loaded" description="Check your connection and try again." action={<Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>} />
        ) : !data.blueprint || !draft ? (
          <EmptyState
            icon={<Building2 size={20} />}
            title="This bot has no business details"
            description="Bots started from a blueprint keep their hours, prices and plans here. Start a new bot from the Dental practice blueprint to try it."
          />
        ) : (
          <div className="mx-auto grid max-w-4xl gap-4">
            <p className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
              {data.blueprint.name} blueprint. Chapters look these details up on every turn, and Knowledge keeps {data.documents} document{data.documents === 1 ? '' : 's'} built from them, so answers name their source.
              {draft.websiteUrl ? ` Read from ${draft.websiteUrl}.` : ' These are the sample business’s details.'}
            </p>

            {rereading && (
              <RereadPanel
                needsUrl={!draft.websiteUrl}
                url={url}
                onUrl={setUrl}
                loading={reread.isPending}
                error={reread.error instanceof Error ? reread.error.message : null}
                changes={reread.data?.changes ?? null}
                ticked={ticked}
                onTick={(key, on) => setTicked((keys) => (on ? [...keys, key] : keys.filter((item) => item !== key)))}
                onRead={() => { void onReread() }}
                onKeep={() => reread.data && void onAccept(reread.data.fresh)}
                keeping={accept.isPending}
                onClose={() => { setRereading(false); reread.reset() }}
              />
            )}

            {saved && <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 size={13} /> {saved}</p>}
            {save.error instanceof Error && <p className="text-xs text-[var(--error)]">{save.error.message}</p>}
            {accept.error instanceof Error && <p className="text-xs text-[var(--error)]">{accept.error.message}</p>}

            <label className="grid gap-1 text-xs">
              <span className="font-semibold text-[var(--text-primary)]">Business name</span>
              <input
                className="rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
                value={draft.businessName}
                onChange={(event) => setDraft({ ...draft, businessName: event.target.value })}
              />
            </label>

            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Show">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={cn('rounded-full border px-3 py-1 text-xs font-medium', filter === item.id ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--border)] text-[var(--text-muted)]')}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 size={20} />}
                title={filter === 'missing' ? 'Nothing is missing' : 'Nothing needs a look'}
                description="Every detail in this view is filled in and checked."
                action={<Button size="sm" variant="secondary" onClick={() => setFilter('all')}>Show all details</Button>}
              />
            ) : visible.map((spec) => (
              <BusinessFieldRow
                key={spec.key}
                spec={spec}
                field={draft.fields[spec.key]}
                issue={issueFor(spec.key)}
                editing
                onChange={(value) => setDraft(withValue(draft, spec.key, value))}
                onUseAlternative={() => setDraft(takeAlternative(draft, spec.key))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RereadPanel(props: {
  needsUrl: boolean
  url: string
  onUrl: (url: string) => void
  loading: boolean
  error: string | null
  changes: FieldChange[] | null
  ticked: string[]
  onTick: (key: string, on: boolean) => void
  onRead: () => void
  onKeep: () => void
  keeping: boolean
  onClose: () => void
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--accent)] bg-[var(--bg-surface)] p-4" aria-label="Read website again">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Read the website again</h2>
        <button type="button" className="text-xs text-[var(--text-muted)]" onClick={props.onClose}>Close</button>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">Nothing changes until you tick a detail and keep it. Details you edited stay as they are unless you tick them.</p>
      <div className="mt-3 flex gap-2">
        {props.needsUrl && (
          <input
            aria-label="Website address"
            placeholder="https://www.your-practice.co.uk"
            value={props.url}
            onChange={(event) => props.onUrl(event.target.value)}
            className="w-full rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
          />
        )}
        <Button size="sm" disabled={props.loading || (props.needsUrl && !props.url.trim())} onClick={props.onRead}>
          {props.loading ? 'Reading…' : 'Compare with the website'}
        </Button>
      </div>
      {props.error && <p className="mt-2 text-xs text-[var(--error)]">{props.error}</p>}
      {props.changes && props.changes.length === 0 && <p className="mt-3 text-xs text-emerald-700">The website says the same as your details. Nothing to change.</p>}
      {props.changes && props.changes.length > 0 && (
        <div className="mt-3 grid gap-2">
          {props.changes.map((change) => (
            <label key={change.key} className="grid grid-cols-[18px_1fr] gap-2 rounded border border-[var(--border)] p-2 text-xs">
              <input type="checkbox" checked={props.ticked.includes(change.key)} onChange={(event) => props.onTick(change.key, event.target.checked)} />
              <span>
                <span className="font-semibold text-[var(--text-primary)]">{change.label}</span>
                <span className="mt-1 grid gap-1 sm:grid-cols-2">
                  <span className="whitespace-pre-line text-[var(--text-muted)] line-through decoration-[var(--text-muted)]/40">{change.before || '—'}</span>
                  <span className="whitespace-pre-line text-[var(--text-secondary)]">{change.after}</span>
                </span>
              </span>
            </label>
          ))}
          <div className="flex justify-end">
            <Button size="sm" disabled={props.ticked.length === 0 || props.keeping} onClick={props.onKeep}>
              Keep {props.ticked.length} change{props.ticked.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
