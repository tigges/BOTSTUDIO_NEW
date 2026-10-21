import type { AnalyticsFilters, AnalyticsMetric, AnalyticsDimension, AnalyticsGranularity } from '@ybot/shared'

/** Analytics filters live in the URL so a shared link opens the same numbers. */
export interface AnalyticsSearch {
  days?: number
  env?: 'production' | 'sandbox' | 'all'
  channel?: string
  tests?: 'include'
}

export const RANGE_OPTIONS = [
  { days: 1, label: 'Last 24 hours' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const

export const DEFAULT_DAYS = 7

export function readAnalyticsSearch(search: Record<string, unknown>): AnalyticsSearch {
  const days = Number(search.days)
  return {
    ...(RANGE_OPTIONS.some((r) => r.days === days) ? { days } : {}),
    ...(search.env === 'production' || search.env === 'sandbox' || search.env === 'all' ? { env: search.env } : {}),
    ...(typeof search.channel === 'string' && search.channel ? { channel: search.channel } : {}),
    ...(search.tests === 'include' ? { tests: 'include' as const } : {}),
  }
}

/** Without an env in the URL, the numbers follow the environment picked in the top bar. */
export function aggregateFilters(search: AnalyticsSearch, topBarEnv: 'production' | 'sandbox', botId: string | null): AnalyticsFilters {
  const env = search.env ?? topBarEnv
  return {
    ...(botId ? { botId } : {}),
    ...(env !== 'all' ? { environment: env } : {}),
    ...(search.channel ? { channelId: search.channel } : {}),
    testRuns: search.tests === 'include' ? 'include' : 'exclude',
  }
}

export interface AggregateRequest {
  metric: AnalyticsMetric
  dimensions?: AnalyticsDimension[]
  granularity?: AnalyticsGranularity
}

/** Flat query string for GET /analytics/aggregate. */
export function aggregateParams(request: AggregateRequest, filters: AnalyticsFilters, days: number): Record<string, string> {
  return {
    metric: request.metric,
    ...(request.dimensions?.length ? { dimensions: request.dimensions.join(',') } : {}),
    granularity: request.granularity ?? (days > 31 ? 'week' : 'day'),
    days: String(days),
    testRuns: filters.testRuns,
    ...(filters.botId ? { botId: filters.botId } : {}),
    ...(filters.environment ? { environment: filters.environment } : {}),
    ...(filters.channelId ? { channelId: filters.channelId } : {}),
  }
}
