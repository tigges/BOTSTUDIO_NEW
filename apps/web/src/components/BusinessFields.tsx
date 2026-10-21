import React from 'react'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { Badge, cn } from '@botstudio/ui'
import {
  WEEKDAYS,
  WEEKDAY_NAMES,
  formatFieldValue,
  type BlueprintFieldSpec,
  type BusinessField,
  type BusinessProfile,
  type BusinessValue,
  type FieldStatus,
  type OpeningDay,
  type PlanItem,
  type PriceItem,
  type ProfileIssue,
  type TopicItem,
} from '@botstudio/shared'

const input = 'w-full rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none'

const STATUS: Record<FieldStatus, { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'muted' }> = {
  found: { label: 'From your website', variant: 'info' },
  conflict: { label: 'Check this', variant: 'warning' },
  missing: { label: 'Missing', variant: 'error' },
  confirmed: { label: 'Checked', variant: 'success' },
  edited: { label: 'Edited', variant: 'success' },
  sample: { label: 'Sample', variant: 'muted' },
}

export function FieldStatusBadge({ status }: { status: FieldStatus }) {
  const meta = STATUS[status]
  return <Badge variant={meta.variant} dot>{meta.label}</Badge>
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch {
    return url
  }
}

/** Replaces one field's value. Status and stamps are the server's job when it saves. */
export function withValue(profile: BusinessProfile, key: string, value: BusinessValue | null): BusinessProfile {
  const field: BusinessField = profile.fields[key] ?? { value: null, status: 'missing' }
  return { ...profile, fields: { ...profile.fields, [key]: { ...field, value } } }
}

/** Takes the other reading the website gave, and keeps the first as the alternative. */
export function takeAlternative(profile: BusinessProfile, key: string): BusinessProfile {
  const field = profile.fields[key]
  if (!field?.alternative) return profile
  return { ...profile, fields: { ...profile.fields, [key]: { ...field, value: field.alternative, alternative: field.value ?? undefined } } }
}

function lines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean)
}

function HoursEditor({ value, onChange }: { value: OpeningDay[]; onChange: (next: OpeningDay[]) => void }) {
  const rows = WEEKDAYS.map((day) => value.find((row) => row.day === day) ?? { day, closed: true })
  const set = (day: OpeningDay['day'], patch: Partial<OpeningDay>) => {
    onChange(rows.map((row) => {
      if (row.day !== day) return row
      const next = { ...row, ...patch }
      return next.closed ? { day, closed: true } : { day, open: next.open ?? '09:00', close: next.close ?? '17:00' }
    }))
  }
  return (
    <div className="grid gap-1">
      {rows.map((row) => (
        <div key={row.day} className="grid grid-cols-[92px_1fr_1fr_auto] items-center gap-2 text-xs">
          <span className="text-[var(--text-secondary)]">{WEEKDAY_NAMES[row.day]}</span>
          <input type="time" aria-label={`${WEEKDAY_NAMES[row.day]} opens`} className={input} value={row.open ?? ''} disabled={row.closed} onChange={(event) => set(row.day, { open: event.target.value })} />
          <input type="time" aria-label={`${WEEKDAY_NAMES[row.day]} closes`} className={input} value={row.close ?? ''} disabled={row.closed} onChange={(event) => set(row.day, { close: event.target.value })} />
          <label className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <input type="checkbox" checked={Boolean(row.closed)} onChange={(event) => set(row.day, { closed: event.target.checked })} /> Closed
          </label>
        </div>
      ))}
    </div>
  )
}

function PriceEditor({ value, onChange }: { value: PriceItem[]; onChange: (next: PriceItem[]) => void }) {
  const set = (index: number, patch: Partial<PriceItem>) => onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <div className="grid gap-1">
      <div className="grid grid-cols-[1fr_96px_56px_24px] gap-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        <span>Treatment</span><span>Price (£)</span><span>From</span><span />
      </div>
      {value.map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_96px_56px_24px] items-center gap-2">
          <input aria-label="Treatment" className={input} value={row.name} onChange={(event) => set(index, { name: event.target.value })} />
          <input aria-label={`${row.name || 'Treatment'} price`} type="number" min={0} step="0.01" className={input} value={Number.isFinite(row.amount) ? row.amount : ''} onChange={(event) => set(index, { amount: Number(event.target.value) })} />
          <label className="flex items-center justify-center"><input type="checkbox" aria-label={`${row.name || 'Treatment'} is a starting price`} checked={Boolean(row.from)} onChange={(event) => set(index, { from: event.target.checked || undefined })} /></label>
          <button type="button" aria-label={`Remove ${row.name || 'this row'}`} className="text-[var(--text-muted)] hover:text-[var(--error)]" onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={12} /></button>
        </div>
      ))}
      <button type="button" className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)]" onClick={() => onChange([...value, { name: '', amount: 0 }])}>
        <Plus size={11} /> Add a price
      </button>
    </div>
  )
}

function PlanEditor({ value, onChange }: { value: PlanItem[]; onChange: (next: PlanItem[]) => void }) {
  const set = (index: number, patch: Partial<PlanItem>) => onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <div className="grid gap-2">
      {value.map((plan, index) => (
        <div key={index} className="rounded border border-[var(--border)] p-2">
          <div className="grid grid-cols-[1fr_110px_24px] items-center gap-2">
            <input aria-label="Plan name" className={input} value={plan.name} onChange={(event) => set(index, { name: event.target.value })} />
            <input aria-label={`${plan.name || 'Plan'} price a month`} type="number" min={0} step="0.01" className={input} value={plan.monthly} onChange={(event) => set(index, { monthly: Number(event.target.value) })} />
            <button type="button" aria-label={`Remove ${plan.name || 'this plan'}`} className="text-[var(--text-muted)] hover:text-[var(--error)]" onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={12} /></button>
          </div>
          <textarea aria-label={`${plan.name || 'Plan'} includes`} rows={2} className={cn(input, 'mt-1')} placeholder="One benefit per line" value={plan.includes.join('\n')} onChange={(event) => set(index, { includes: lines(event.target.value) })} />
        </div>
      ))}
      <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)]" onClick={() => onChange([...value, { name: '', monthly: 0, includes: [] }])}>
        <Plus size={11} /> Add a plan
      </button>
    </div>
  )
}

function TopicEditor({ value, onChange }: { value: TopicItem[]; onChange: (next: TopicItem[]) => void }) {
  const set = (index: number, patch: Partial<TopicItem>) => onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <div className="grid gap-2">
      {value.map((topic, index) => (
        <div key={index} className="grid grid-cols-[160px_1fr_24px] items-start gap-2">
          <input aria-label="Treatment" className={input} value={topic.name} onChange={(event) => set(index, { name: event.target.value })} />
          <textarea aria-label={`${topic.name || 'Treatment'} explained`} rows={2} className={input} value={topic.summary} onChange={(event) => set(index, { summary: event.target.value })} />
          <button type="button" aria-label={`Remove ${topic.name || 'this treatment'}`} className="mt-1 text-[var(--text-muted)] hover:text-[var(--error)]" onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={12} /></button>
        </div>
      ))}
      <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)]" onClick={() => onChange([...value, { name: '', summary: '' }])}>
        <Plus size={11} /> Add a treatment
      </button>
    </div>
  )
}

function ValueEditor({ spec, value, onChange }: { spec: BlueprintFieldSpec; value: BusinessValue | null; onChange: (next: BusinessValue | null) => void }) {
  switch (spec.kind) {
    case 'weekly_hours': return <HoursEditor value={(value as OpeningDay[] | null) ?? []} onChange={onChange} />
    case 'price_list': return <PriceEditor value={(value as PriceItem[] | null) ?? []} onChange={onChange} />
    case 'plan_list': return <PlanEditor value={(value as PlanItem[] | null) ?? []} onChange={onChange} />
    case 'topic_list': return <TopicEditor value={(value as TopicItem[] | null) ?? []} onChange={onChange} />
    case 'steps':
      return <textarea aria-label={spec.label} rows={4} className={input} placeholder="One step per line" value={((value as string[] | null) ?? []).join('\n')} onChange={(event) => onChange(lines(event.target.value))} />
    case 'text':
      return <textarea aria-label={spec.label} rows={2} className={input} value={(value as string | null) ?? ''} onChange={(event) => onChange(event.target.value)} />
    default:
      return <input aria-label={spec.label} className={input} value={(value as string | null) ?? ''} onChange={(event) => onChange(event.target.value)} />
  }
}

/** One business detail: what it is for, where it came from, and its editor or a read-only summary. */
export function BusinessFieldRow({ spec, field, issue, editing, onChange, onUseAlternative }: {
  spec: BlueprintFieldSpec
  field: BusinessField | undefined
  issue?: ProfileIssue
  editing: boolean
  onChange: (value: BusinessValue | null) => void
  onUseAlternative: () => void
}) {
  const status = field?.status ?? 'missing'
  const summary = formatFieldValue(spec.kind, field?.value)
  return (
    <section className={cn('rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-3', issue?.level === 'block' ? 'border-[var(--error)]' : status === 'conflict' ? 'border-amber-400' : 'border-[var(--border)]')} aria-label={spec.label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">
          {spec.label}{spec.required && <span className="ml-1 text-[var(--text-muted)]">· required</span>}
        </h3>
        <FieldStatusBadge status={status} />
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{spec.help}</p>
      {issue && <p className={cn('mt-1.5 text-[11px]', issue.level === 'block' ? 'text-[var(--error)]' : 'text-amber-700')}>{issue.message}</p>}
      {status === 'conflict' && field?.alternative && (
        <button type="button" className="mt-1 text-[11px] font-semibold text-[var(--accent)]" onClick={onUseAlternative}>
          Use the other reading: {formatFieldValue(spec.kind, field.alternative)}
        </button>
      )}
      <div className="mt-2">
        {editing
          ? <ValueEditor spec={spec} value={field?.value ?? null} onChange={onChange} />
          : <p className="whitespace-pre-line text-xs text-[var(--text-secondary)]">{summary || '—'}</p>}
      </div>
      {(field?.source?.url || field?.updatedBy) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--text-muted)]">
          {field?.source?.url && (
            <a href={field.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--accent)]">
              <ExternalLink size={10} /> {status === 'edited' ? 'Started from ' : ''}{pathOf(field.source.url)}
            </a>
          )}
          {field?.updatedBy && <span>Changed by {field.updatedBy}{field.updatedAt ? ` on ${new Date(field.updatedAt).toLocaleDateString()}` : ''}</span>}
        </p>
      )}
    </section>
  )
}
