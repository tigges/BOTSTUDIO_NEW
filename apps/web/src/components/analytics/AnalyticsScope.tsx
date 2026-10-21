import React from 'react'
import { useLocation, useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Button, Card, Skeleton, cn } from '@botstudio/ui'
import { METRIC_INFO, denominatorLine, formatMetric, movement, type AnalyticsMetric } from '@botstudio/shared'
import { useAggregate, useChannels } from '../../lib/hooks'
import { useAppStore } from '../../store/app'
import {
  DEFAULT_DAYS, RANGE_OPTIONS, aggregateFilters, aggregateParams, readAnalyticsSearch,
  type AggregateRequest, type AnalyticsSearch,
} from '../../lib/analytics-filters'

/** Filters from the URL, the bot and environment from the top bar. Every widget on the page reads the same scope. */
export function useAnalyticsScope() {
  const raw = useSearch({ strict: false }) as Record<string, unknown>
  const search = readAnalyticsSearch(raw)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const botId = useAppStore((s) => s.selectedBotId)
  const topBarEnv = useAppStore((s) => s.selectedEnv)
  const days = search.days ?? DEFAULT_DAYS
  const filters = aggregateFilters(search, topBarEnv, botId)

  const setSearch = (next: Partial<AnalyticsSearch>) => {
    const merged = { ...search, ...next }
    const clean = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined))
    void navigate({ to: pathname, search: clean as never, replace: true })
  }

  return {
    search,
    setSearch,
    days,
    filters,
    topBarEnv,
    params: (request: AggregateRequest) => aggregateParams(request, filters, days),
  }
}

export type AnalyticsScope = ReturnType<typeof useAnalyticsScope>

const SELECT = 'rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-2 py-1.5 text-xs text-[var(--text-primary)]'

export function AnalyticsFilterBar({ scope }: { scope: AnalyticsScope }) {
  const { data: allChannels = [] } = useChannels()
  const env = scope.search.env ?? scope.topBarEnv
  const envId = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId)?.environments.find((e) => e.kind === env)?.id)
  const channels = env === 'all' ? allChannels : allChannels.filter((c) => c.environmentId === envId)
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Analytics filters">
      <select aria-label="Date range" className={SELECT} value={scope.days} onChange={(e) => scope.setSearch({ days: Number(e.target.value) === DEFAULT_DAYS ? undefined : Number(e.target.value) })}>
        {RANGE_OPTIONS.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
      </select>
      <select
        aria-label="Environment"
        className={SELECT}
        value={env}
        onChange={(e) => scope.setSearch({ env: e.target.value === scope.topBarEnv ? undefined : e.target.value as AnalyticsSearch['env'] })}
      >
        <option value="production">Production</option>
        <option value="sandbox">Sandbox</option>
        <option value="all">All environments</option>
      </select>
      <select aria-label="Channel" className={SELECT} value={scope.search.channel ?? ''} onChange={(e) => scope.setSearch({ channel: e.target.value || undefined })}>
        <option value="">All channels</option>
        {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]" title="Chats opened by scheduled test runs. They never count unless you tick this.">
        <input type="checkbox" checked={scope.search.tests === 'include'} onChange={(e) => scope.setSearch({ tests: e.target.checked ? 'include' : undefined })} />
        Include test runs
      </label>
    </div>
  )
}

const MOVE_STYLE = {
  good: 'text-[var(--success)]',
  bad: 'text-[var(--error)]',
  neutral: 'text-[var(--text-secondary)]',
}

export function MetricCard({ scope, metric, title }: { scope: AnalyticsScope; metric: AnalyticsMetric; title?: string }) {
  const result = useAggregate(scope.params({ metric }))
  const info = METRIC_INFO[metric]
  return (
    <Card data-metric={metric}>
      <p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide">{title ?? info.label}</p>
      {result.isLoading ? (
        <div className="mt-2 space-y-1.5"><Skeleton className="h-7 w-20" /><Skeleton className="h-3 w-32" /></div>
      ) : result.isError || !result.data ? (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-[var(--error)]">Could not load this number.</p>
          <Button size="sm" variant="secondary" onClick={() => void result.refetch()}>Retry</Button>
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-2xl font-bold text-[var(--text-primary)]">{formatMetric(metric, result.data.total.value)}</p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]" data-testid="denominator">{denominatorLine(metric, result.data.total)}</p>
          <Change metric={metric} current={result.data.total} previous={result.data.previous} />
        </>
      )}
    </Card>
  )
}

function Change({ metric, current, previous }: { metric: AnalyticsMetric; current: Parameters<typeof movement>[0]; previous: Parameters<typeof movement>[1] }) {
  const move = movement(current, previous)
  const before = `Before: ${formatMetric(metric, previous.value)}`
  if (move === 'unknown') {
    return <p className="mt-1 text-[11px] text-[var(--text-muted)]" data-move="unknown" title="Not enough data in one of the two periods to tell a real change from noise.">{before} · too little data to compare</p>
  }
  if (move === 'flat') {
    return <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--text-muted)]" data-move="flat" title="The change fits inside the margins of error of the two periods."><Minus size={11} /> {before} · no real change</p>
  }
  const better = METRIC_INFO[metric].higherIsBetter
  const tone = better == null ? 'neutral' : (move === 'up') === better ? 'good' : 'bad'
  return (
    <p className={cn('mt-1 flex items-center gap-1 text-[11px] font-medium', MOVE_STYLE[tone])} data-move={move} title="The change is bigger than the margins of error of both periods added together.">
      {move === 'up' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} {before} · {move === 'up' ? 'up' : 'down'}
    </p>
  )
}
