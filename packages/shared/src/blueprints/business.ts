/**
 * Business details: the typed facts a blueprint asks for (hours, prices, plans…).
 *
 * The profile lives on BotConfig.business. It is the one place a person edits.
 * Saving it recompiles two read-only copies: catalog facts the chapters look up
 * on every turn, and one Knowledge document per field so answers carry a source.
 */

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

export const BUSINESS_FIELD_KINDS = ['text', 'phone', 'address', 'url', 'weekly_hours', 'price_list', 'plan_list', 'steps', 'topic_list'] as const
export type BusinessFieldKind = (typeof BUSINESS_FIELD_KINDS)[number]

export interface OpeningDay {
  day: Weekday
  /** 24-hour HH:MM. Missing on a closed day. */
  open?: string
  close?: string
  closed?: boolean
}

export interface PriceItem {
  name: string
  /** Pounds. 85 is £85, 10.5 is £10.50. */
  amount: number
  /** "From £115": the price starts here. */
  from?: boolean
  group?: string
}

export interface PlanItem {
  name: string
  monthly: number
  includes: string[]
}

export interface TopicItem {
  name: string
  summary: string
  /** Other words guests use for it, such as "Invisalign" for aligners. */
  phrases?: string[]
}

export type BusinessValue = string | string[] | OpeningDay[] | PriceItem[] | PlanItem[] | TopicItem[]

/**
 * found: read from the website. conflict: the site says two things; a person picks.
 * missing: not on the site. confirmed / edited: a person checked or changed it.
 * sample: the blueprint's example value (a demo business).
 */
export const FIELD_STATUSES = ['found', 'conflict', 'missing', 'confirmed', 'edited', 'sample'] as const
export type FieldStatus = (typeof FIELD_STATUSES)[number]

export interface FieldSource {
  url: string
  title?: string
}

export interface BusinessField {
  value: BusinessValue | null
  status: FieldStatus
  source?: FieldSource
  /** What a person should check, e.g. the two Monday closing times the site gives. */
  note?: string
  /** The other reading when the site disagrees with itself. */
  alternative?: BusinessValue
  updatedAt?: string
  updatedBy?: string
}

export interface BusinessProfile {
  blueprintId: string
  blueprintVersion: number
  businessName: string
  personaName?: string
  websiteUrl?: string
  scannedAt?: string
  fields: Record<string, BusinessField>
}

export interface BlueprintFieldSpec {
  key: string
  label: string
  kind: BusinessFieldKind
  required: boolean
  /** One line under the field: what it is for and where the bot uses it. */
  help: string
}

// ── Speaking values ──────────────────────────────────────────────────────────

export function formatMoney(amount: number): string {
  if (!Number.isFinite(amount)) return ''
  const whole = Math.round(amount * 100) % 100 === 0
  const text = whole
    ? Math.round(amount).toLocaleString('en-GB')
    : amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `£${text}`
}

export function formatPrice(item: PriceItem): string {
  return `${item.from ? 'from ' : ''}${formatMoney(item.amount)}`
}

function clock(time: string | undefined): string {
  const match = (time ?? '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return time ?? ''
  const hour = Number(match[1])
  const minute = match[2]!
  const suffix = hour >= 12 ? 'pm' : 'am'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return minute === '00' ? `${twelve}${suffix}` : `${twelve}:${minute}${suffix}`
}

function dayRange(days: Weekday[]): string {
  const first = WEEKDAY_NAMES[days[0]!]
  if (days.length === 1) return first
  const last = WEEKDAY_NAMES[days[days.length - 1]!]
  return days.length === 2 ? `${first} and ${last}` : `${first} to ${last}`
}

/** "Monday 8am to 6pm; Tuesday to Thursday 8am to 5pm; closed on Sunday." Consecutive days with the same hours are joined. */
export function formatWeeklyHours(hours: OpeningDay[]): string {
  const byDay = new Map(hours.map((row) => [row.day, row]))
  const groups: Array<{ days: Weekday[]; label: string }> = []
  for (const day of WEEKDAYS) {
    const row = byDay.get(day)
    if (!row) continue
    const label = row.closed || !row.open || !row.close ? 'closed' : `${clock(row.open)} to ${clock(row.close)}`
    const last = groups[groups.length - 1]
    const previous = last ? last.days[last.days.length - 1]! : undefined
    if (last && last.label === label && previous && WEEKDAYS.indexOf(previous) === WEEKDAYS.indexOf(day) - 1) last.days.push(day)
    else groups.push({ days: [day], label })
  }
  if (groups.length === 0) return ''
  const parts = groups.map((group) => group.label === 'closed' ? `closed on ${dayRange(group.days)}` : `${dayRange(group.days)} ${group.label}`)
  const text = parts.join('; ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

export function formatPlan(plan: PlanItem): string {
  const includes = plan.includes.length ? `: ${plan.includes.join(', ')}` : ''
  return `${plan.name}, ${formatMoney(plan.monthly)} a month${includes}.`
}

export function formatSteps(steps: string[]): string {
  return steps.map((step, index) => `${index + 1}. ${step.replace(/\.$/, '')}.`).join(' ')
}

/** The whole field as plain sentences, for the review screen and the Knowledge document. */
export function formatFieldValue(kind: BusinessFieldKind, value: BusinessValue | null | undefined): string {
  if (value === null || value === undefined) return ''
  switch (kind) {
    case 'weekly_hours': return Array.isArray(value) ? formatWeeklyHours(value as OpeningDay[]) : ''
    case 'price_list': return Array.isArray(value)
      ? (value as PriceItem[]).map((item) => `${item.name}: ${formatPrice(item)}`).join('\n')
      : ''
    case 'plan_list': return Array.isArray(value) ? (value as PlanItem[]).map(formatPlan).join('\n') : ''
    case 'steps': return Array.isArray(value) ? formatSteps(value as string[]) : ''
    case 'topic_list': return Array.isArray(value)
      ? (value as TopicItem[]).map((item) => `${item.name}: ${item.summary}`).join('\n')
      : ''
    default: return typeof value === 'string' ? value : ''
  }
}

// ── Reading values back ──────────────────────────────────────────────────────

function text(raw: unknown, max = 600): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function amount(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/[£,\s]/g, ''))
  return Number.isFinite(value) && value >= 0 && value < 1_000_000 ? Math.round(value * 100) / 100 : null
}

function hhmm(raw: unknown): string | undefined {
  const match = String(raw ?? '').trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return undefined
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function rows(raw: unknown, limit: number): Record<string, unknown>[] {
  return Array.isArray(raw)
    ? raw.slice(0, limit).filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    : []
}

/** Coerces stored or posted JSON into the field's shape. Anything unusable becomes null. */
export function parseFieldValue(kind: BusinessFieldKind, raw: unknown): BusinessValue | null {
  switch (kind) {
    case 'weekly_hours': {
      const days = rows(raw, 7).flatMap((row): OpeningDay[] => {
        const day = String(row['day'] ?? '') as Weekday
        if (!(WEEKDAYS as readonly string[]).includes(day)) return []
        const open = hhmm(row['open'])
        const close = hhmm(row['close'])
        if (row['closed'] === true || !open || !close) return [{ day, closed: true }]
        return [{ day, open, close }]
      })
      return days.length ? days : null
    }
    case 'price_list': {
      const items = rows(raw, 120).flatMap((row): PriceItem[] => {
        const name = text(row['name'], 120)
        const value = amount(row['amount'])
        if (!name || value === null) return []
        const group = text(row['group'], 80)
        return [{ name, amount: value, ...(row['from'] === true ? { from: true } : {}), ...(group ? { group } : {}) }]
      })
      return items.length ? items : null
    }
    case 'plan_list': {
      const plans = rows(raw, 12).flatMap((row): PlanItem[] => {
        const name = text(row['name'], 80)
        const monthly = amount(row['monthly'])
        if (!name || monthly === null) return []
        const includes = Array.isArray(row['includes']) ? row['includes'].map((item) => text(item, 120)).filter(Boolean).slice(0, 12) : []
        return [{ name, monthly, includes }]
      })
      return plans.length ? plans : null
    }
    case 'steps': {
      const steps = Array.isArray(raw) ? raw.map((item) => text(item, 300)).filter(Boolean).slice(0, 12) : []
      return steps.length ? steps : null
    }
    case 'topic_list': {
      const topics = rows(raw, 40).flatMap((row): TopicItem[] => {
        const name = text(row['name'], 80)
        const summary = text(row['summary'], 400)
        if (!name || !summary) return []
        const phrases = Array.isArray(row['phrases']) ? row['phrases'].map((item) => text(item, 60).toLowerCase()).filter(Boolean).slice(0, 12) : []
        return [{ name, summary, ...(phrases.length ? { phrases } : {}) }]
      })
      return topics.length ? topics : null
    }
    case 'url': {
      const value = text(raw, 400)
      return /^https?:\/\/[^\s]+$/i.test(value) ? value : null
    }
    default: {
      const value = text(raw, kind === 'text' ? 1200 : 300)
      return value || null
    }
  }
}

export function isEmptyValue(value: BusinessValue | null | undefined): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return !value.trim()
  return value.length === 0
}

export interface ProfileIssue {
  field: string
  level: 'block' | 'check'
  message: string
}

/** Required and empty blocks the install. A conflict or an unchecked website value asks for a look. */
export function profileIssues(specs: BlueprintFieldSpec[], profile: BusinessProfile): ProfileIssue[] {
  const issues: ProfileIssue[] = []
  if (!profile.businessName.trim()) issues.push({ field: 'businessName', level: 'block', message: 'Enter the business name. The greeting uses it.' })
  for (const spec of specs) {
    const field = profile.fields[spec.key]
    if (spec.required && isEmptyValue(field?.value)) {
      issues.push({ field: spec.key, level: 'block', message: `${spec.label} is empty. Add it, or the bot cannot answer this.` })
    } else if (field?.status === 'conflict') {
      issues.push({ field: spec.key, level: 'check', message: field.note || `${spec.label}: the website says two different things. Pick the right one.` })
    }
  }
  return issues
}

/** Every field in the spec, typed; unknown keys are dropped. Who changed what is kept from the request. */
export function parseBusinessProfile(specs: BlueprintFieldSpec[], raw: unknown): BusinessProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const blueprintId = text(row['blueprintId'], 60)
  if (!blueprintId) return null
  const fieldsRaw = row['fields'] && typeof row['fields'] === 'object' ? row['fields'] as Record<string, unknown> : {}
  const fields: Record<string, BusinessField> = {}
  for (const spec of specs) {
    const stored = fieldsRaw[spec.key] && typeof fieldsRaw[spec.key] === 'object' ? fieldsRaw[spec.key] as Record<string, unknown> : {}
    const value = parseFieldValue(spec.kind, stored['value'])
    const status = (FIELD_STATUSES as readonly string[]).includes(String(stored['status'])) ? stored['status'] as FieldStatus : (value ? 'confirmed' : 'missing')
    const source = stored['source'] && typeof stored['source'] === 'object' ? stored['source'] as Record<string, unknown> : null
    const url = text(source?.['url'], 400)
    const alternative = stored['alternative'] !== undefined ? parseFieldValue(spec.kind, stored['alternative']) : null
    fields[spec.key] = {
      value,
      status: value ? status : 'missing',
      ...(url ? { source: { url, ...(text(source?.['title'], 160) ? { title: text(source?.['title'], 160) } : {}) } } : {}),
      ...(text(stored['note'], 300) ? { note: text(stored['note'], 300) } : {}),
      ...(alternative ? { alternative } : {}),
      ...(text(stored['updatedAt'], 40) ? { updatedAt: text(stored['updatedAt'], 40) } : {}),
      ...(text(stored['updatedBy'], 120) ? { updatedBy: text(stored['updatedBy'], 120) } : {}),
    }
  }
  const version = Number(row['blueprintVersion'])
  return {
    blueprintId,
    blueprintVersion: Number.isInteger(version) && version > 0 ? version : 1,
    businessName: text(row['businessName'], 120),
    ...(text(row['personaName'], 60) ? { personaName: text(row['personaName'], 60) } : {}),
    ...(text(row['websiteUrl'], 400) ? { websiteUrl: text(row['websiteUrl'], 400) } : {}),
    ...(text(row['scannedAt'], 40) ? { scannedAt: text(row['scannedAt'], 40) } : {}),
    fields,
  }
}

/**
 * Applies a person's edit. A changed value becomes "edited"; an unchanged value they
 * looked at becomes "confirmed". The time and the person are stamped on the field.
 */
export function applyProfileEdit(
  specs: BlueprintFieldSpec[],
  current: BusinessProfile,
  next: BusinessProfile,
  who: { userId: string; at: string },
): BusinessProfile {
  const fields: Record<string, BusinessField> = {}
  for (const spec of specs) {
    const before = current.fields[spec.key]
    const after = next.fields[spec.key] ?? { value: null, status: 'missing' as const }
    const changed = JSON.stringify(before?.value ?? null) !== JSON.stringify(after.value ?? null)
    if (!changed && before && after.status === before.status) {
      fields[spec.key] = before
      continue
    }
    const status: FieldStatus = isEmptyValue(after.value) ? 'missing' : changed ? 'edited' : 'confirmed'
    const { alternative: _dropped, ...kept } = after
    fields[spec.key] = {
      ...kept,
      status,
      ...(changed ? {} : before?.source ? { source: before.source } : {}),
      ...(status === 'confirmed' || status === 'edited' ? { note: undefined } : {}),
      updatedAt: who.at,
      updatedBy: who.userId,
    }
    if (fields[spec.key]!.note === undefined) delete fields[spec.key]!.note
  }
  return { ...current, businessName: next.businessName || current.businessName, personaName: next.personaName ?? current.personaName, fields }
}

export interface FieldChange {
  key: string
  label: string
  before: string
  after: string
  source?: FieldSource
}

/** What a fresh read of the website would change, field by field, in words a person can accept or skip. */
export function diffProfiles(specs: BlueprintFieldSpec[], current: BusinessProfile, fresh: BusinessProfile): FieldChange[] {
  const changes: FieldChange[] = []
  for (const spec of specs) {
    const next = fresh.fields[spec.key]
    if (!next || isEmptyValue(next.value)) continue
    const before = formatFieldValue(spec.kind, current.fields[spec.key]?.value)
    const after = formatFieldValue(spec.kind, next.value)
    if (before === after) continue
    changes.push({ key: spec.key, label: spec.label, before, after, ...(next.source ? { source: next.source } : {}) })
  }
  return changes
}

/** Takes the accepted fields from a fresh read. They keep the website as their source and count as checked. */
export function acceptChanges(current: BusinessProfile, fresh: BusinessProfile, keys: string[], who: { userId: string; at: string }): BusinessProfile {
  const fields = { ...current.fields }
  for (const key of keys) {
    const next = fresh.fields[key]
    if (!next || isEmptyValue(next.value)) continue
    fields[key] = { value: next.value, status: 'confirmed', ...(next.source ? { source: next.source } : {}), updatedAt: who.at, updatedBy: who.userId }
  }
  return { ...current, scannedAt: fresh.scannedAt ?? current.scannedAt, fields }
}

export interface BusinessDocument {
  key: string
  title: string
  content: string
  url?: string
}

/** One Knowledge document per filled field, titled by the field, pointing at the page it came from. */
export function businessDocuments(specs: BlueprintFieldSpec[], profile: BusinessProfile): BusinessDocument[] {
  return specs.flatMap((spec) => {
    const field = profile.fields[spec.key]
    const content = formatFieldValue(spec.kind, field?.value)
    if (!content) return []
    return [{
      key: spec.key,
      title: `${profile.businessName}: ${spec.label}`,
      content,
      ...(field?.source?.url ? { url: field.source.url } : {}),
    }]
  })
}

/** Every £ amount the business publishes, so a reply rule can catch a price nobody wrote. */
export function publishedAmounts(specs: BlueprintFieldSpec[], profile: BusinessProfile): string[] {
  const seen = new Set<string>()
  for (const spec of specs) {
    const content = formatFieldValue(spec.kind, profile.fields[spec.key]?.value)
    for (const match of content.matchAll(/£\s?(\d[\d,]*(?:\.\d{1,2})?)/g)) seen.add(match[1]!.replace(/,/g, ''))
  }
  return [...seen].sort((a, b) => Number(a) - Number(b))
}

export function slugFor(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item'
}
