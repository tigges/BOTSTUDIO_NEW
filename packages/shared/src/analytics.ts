/**
 * One typed aggregate for every analytics widget: metric, dimensions, filters, range, granularity.
 * The API turns raw rows into samples; everything after that (grouping, denominators,
 * margins, "moved") lives here so the server and the dashboard agree.
 */

export const ANALYTICS_METRICS = [
  'conversations',
  'contained_rate',
  'resolved_by_bot_rate',
  'escalated_rate',
  'abandoned_rate',
  'csat_score',
  'first_reply_ms',
  'llm_cost',
] as const
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number]

export const ANALYTICS_DIMENSIONS = ['time', 'channel', 'outcome', 'agent'] as const
export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number]

export const ANALYTICS_GRANULARITIES = ['day', 'week'] as const
export type AnalyticsGranularity = (typeof ANALYTICS_GRANULARITIES)[number]

export type TestRunFilter = 'exclude' | 'include' | 'only'

/** count: how many. sum: added up. rate: share of the denominator. mean: average of the samples. */
export type MetricKind = 'count' | 'sum' | 'rate' | 'mean'

export interface MetricInfo {
  label: string
  kind: MetricKind
  unit: 'chats' | 'percent' | 'ms' | 'usd'
  /** What the denominator counts, shown on every card. */
  denominator: string
  /** Higher is better; drives the colour of a real move. Null when neither direction is good. */
  higherIsBetter: boolean | null
}

export const METRIC_INFO: Record<AnalyticsMetric, MetricInfo> = {
  conversations: { label: 'Chats', kind: 'count', unit: 'chats', denominator: 'chats started', higherIsBetter: null },
  contained_rate: { label: 'Contained', kind: 'rate', unit: 'percent', denominator: 'finished chats', higherIsBetter: true },
  resolved_by_bot_rate: { label: 'Resolved by bot', kind: 'rate', unit: 'percent', denominator: 'finished chats', higherIsBetter: true },
  escalated_rate: { label: 'Escalated', kind: 'rate', unit: 'percent', denominator: 'finished chats', higherIsBetter: false },
  abandoned_rate: { label: 'Abandoned', kind: 'rate', unit: 'percent', denominator: 'finished chats', higherIsBetter: false },
  csat_score: { label: 'Satisfaction', kind: 'rate', unit: 'percent', denominator: 'ratings', higherIsBetter: true },
  first_reply_ms: { label: 'Bot reply time', kind: 'mean', unit: 'ms', denominator: 'visitor messages answered', higherIsBetter: false },
  llm_cost: { label: 'Model cost', kind: 'sum', unit: 'usd', denominator: 'model calls in chats', higherIsBetter: false },
}

export interface AnalyticsFilters {
  botId?: string
  /** Environment kind (sandbox, production). Unset means every environment. */
  environment?: string
  channelId?: string
  /** Test runs are their own traffic and stay out of the numbers unless asked for. */
  testRuns: TestRunFilter
}

export interface AnalyticsQuery {
  metric: AnalyticsMetric
  dimensions: AnalyticsDimension[]
  filters: AnalyticsFilters
  range: { from: string; to: string }
  granularity: AnalyticsGranularity
}

/** One measurement. Rates use 1 for a hit and 0 for a miss; counts use 1; sums and means use the measured value. */
export interface AnalyticsSample {
  at: Date
  value: number
  channel: string | null
  outcome: string | null
  /** The teammate holding the chat. */
  agent?: string | null
}

export interface AggregateCell {
  /** Null when there is nothing to measure: render a dash, never a zero. */
  value: number | null
  denominator: number
  /** Half-width of the 95% interval; null when it cannot be estimated. */
  margin: number | null
}

export interface AggregateRow extends AggregateCell {
  key: Partial<Record<AnalyticsDimension, string>>
}

export interface AggregateResult {
  metric: AnalyticsMetric
  query: AnalyticsQuery
  total: AggregateCell
  /** The same length of time just before the range, for "moved". */
  previous: AggregateCell
  rows: AggregateRow[]
}

const DAY = 24 * 60 * 60 * 1000
export const MAX_RANGE_DAYS = 366

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(','))
  if (typeof value === 'string' && value) return value.split(',')
  return []
}

/**
 * Reads the query from a body or a flat query string. Returns the problem as a sentence when
 * something is wrong, so the API can say which field to fix.
 */
export function readAnalyticsQuery(raw: Record<string, unknown>, now = new Date()): AnalyticsQuery | { error: string } {
  const metric = raw['metric']
  if (!oneOf(ANALYTICS_METRICS, metric)) return { error: `metric must be one of ${ANALYTICS_METRICS.join(', ')}.` }

  const dimensions = [...new Set(asList(raw['dimensions']))]
  const unknown = dimensions.find((d) => !oneOf(ANALYTICS_DIMENSIONS, d))
  if (unknown) return { error: `dimensions: "${unknown}" is not one of ${ANALYTICS_DIMENSIONS.join(', ')}.` }
  if (dimensions.includes('outcome') && METRIC_INFO[metric].kind === 'rate' && metric !== 'csat_score') {
    return { error: 'dimensions: outcome cannot split an outcome rate; use metric=conversations with dimensions=outcome.' }
  }

  const granularity = raw['granularity'] ?? 'day'
  if (!oneOf(ANALYTICS_GRANULARITIES, granularity)) return { error: `granularity must be one of ${ANALYTICS_GRANULARITIES.join(', ')}.` }

  const rawFilters = (typeof raw['filters'] === 'object' && raw['filters'] !== null ? raw['filters'] : raw) as Record<string, unknown>
  const testRuns = rawFilters['testRuns'] ?? 'exclude'
  if (!oneOf(['exclude', 'include', 'only'] as const, testRuns)) return { error: 'filters.testRuns must be exclude, include or only.' }
  const text = (key: string) => (typeof rawFilters[key] === 'string' && rawFilters[key] ? String(rawFilters[key]) : undefined)

  const rawRange = (typeof raw['range'] === 'object' && raw['range'] !== null ? raw['range'] : raw) as Record<string, unknown>
  let from: Date
  let to: Date
  if (rawRange['from'] || rawRange['to']) {
    from = new Date(String(rawRange['from']))
    to = rawRange['to'] ? new Date(String(rawRange['to'])) : now
    if (Number.isNaN(from.getTime())) return { error: 'range.from is not a date. Use an ISO date like 2026-10-01.' }
    if (Number.isNaN(to.getTime())) return { error: 'range.to is not a date. Use an ISO date like 2026-10-21.' }
  } else {
    const days = Number(rawRange['days'] ?? 7)
    if (!Number.isFinite(days) || days < 1) return { error: 'range.days must be a whole number of days, 1 or more.' }
    to = now
    from = new Date(now.getTime() - Math.round(days) * DAY)
  }
  if (from >= to) return { error: 'range.from must be before range.to.' }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY) return { error: `range is longer than ${MAX_RANGE_DAYS} days. Pick a shorter range.` }

  return {
    metric,
    dimensions: dimensions as AnalyticsDimension[],
    filters: { botId: text('botId'), environment: text('environment'), channelId: text('channelId'), testRuns },
    range: { from: from.toISOString(), to: to.toISOString() },
    granularity,
  }
}

/** The window of the same length that ends where this one starts. */
export function previousRange(range: { from: string; to: string }): { from: string; to: string } {
  const from = new Date(range.from).getTime()
  const to = new Date(range.to).getTime()
  return { from: new Date(from - (to - from)).toISOString(), to: new Date(from).toISOString() }
}

/** UTC day, or the Monday that starts the UTC week, as YYYY-MM-DD. */
export function timeBucket(at: Date, granularity: AnalyticsGranularity): string {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  if (granularity === 'week') day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day.toISOString().slice(0, 10)
}

const Z95 = 1.96

/**
 * Value, denominator and 95% margin for one group of samples. Rates use the Agresti-Coull
 * interval so 2 of 2 does not claim a zero margin; counts use a Poisson margin, so zero is a measured value.
 */
export function measure(kind: MetricKind, values: number[]): AggregateCell {
  const n = values.length
  const total = values.reduce((sum, v) => sum + v, 0)
  if (kind === 'count') return { value: total, denominator: n, margin: Z95 * Math.sqrt(Math.max(total, 1)) }
  if (n === 0) return { value: null, denominator: 0, margin: null }
  if (kind === 'sum') return { value: total, denominator: n, margin: null }
  const mean = total / n
  if (kind === 'rate') {
    const adjusted = (total + 2) / (n + 4)
    return { value: mean, denominator: n, margin: Z95 * Math.sqrt((adjusted * (1 - adjusted)) / (n + 4)) }
  }
  if (n < 2) return { value: mean, denominator: n, margin: null }
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1)
  return { value: mean, denominator: n, margin: Z95 * Math.sqrt(variance / n) }
}

export function aggregateSamples(query: AnalyticsQuery, samples: AnalyticsSample[], previous: AnalyticsSample[]): AggregateResult {
  const kind = METRIC_INFO[query.metric].kind
  const groups = new Map<string, { key: AggregateRow['key']; values: number[] }>()
  for (const sample of samples) {
    const key: AggregateRow['key'] = {}
    if (query.dimensions.includes('time')) key.time = timeBucket(sample.at, query.granularity)
    if (query.dimensions.includes('channel')) key.channel = sample.channel ?? 'No channel'
    if (query.dimensions.includes('outcome')) key.outcome = sample.outcome ?? 'open'
    if (query.dimensions.includes('agent')) key.agent = sample.agent ?? 'Unassigned'
    const id = JSON.stringify(key)
    const group = groups.get(id) ?? { key, values: [] }
    group.values.push(sample.value)
    groups.set(id, group)
  }
  const rows = [...groups.values()]
    .map(({ key, values }) => ({ key, ...measure(kind, values) }))
    .sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)))
  return {
    metric: query.metric,
    query,
    total: measure(kind, samples.map((s) => s.value)),
    previous: measure(kind, previous.map((s) => s.value)),
    rows,
  }
}

export type Movement = 'up' | 'down' | 'flat' | 'unknown'

/**
 * A change counts as moved only when it clears the margin of both periods together,
 * so the two intervals do not overlap. Without a margin or a value on either side it is unknown, never "moved".
 */
export function movement(current: AggregateCell, previous: AggregateCell): Movement {
  if (current.value == null || previous.value == null) return 'unknown'
  if (current.margin == null || previous.margin == null) return 'unknown'
  const change = current.value - previous.value
  if (Math.abs(change) <= current.margin + previous.margin) return 'flat'
  return change > 0 ? 'up' : 'down'
}

/** A dash means no data. Zero is only shown when zero was measured. */
export function formatMetric(metric: AnalyticsMetric, value: number | null): string {
  if (value == null) return '—'
  const unit = METRIC_INFO[metric].unit
  if (unit === 'percent') return `${(Math.round(value * 1000) / 10).toFixed(1)}%`
  if (unit === 'ms') return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`
  if (unit === 'usd') return value === 0 ? '$0.00' : value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`
  return Math.round(value).toLocaleString('en-GB')
}

export function denominatorLine(metric: AnalyticsMetric, cell: AggregateCell): string {
  const info = METRIC_INFO[metric]
  if (info.kind === 'count') return `${cell.denominator.toLocaleString('en-GB')} ${info.denominator}`
  return `of ${cell.denominator.toLocaleString('en-GB')} ${info.denominator}`
}
