import React from 'react'
import { Download } from 'lucide-react'
import { Badge, Button, Card, CardHeader, CardTitle, Skeleton } from '@ybot/ui'
import { denominatorLine, formatMetric, type AnalyticsMetric } from '@ybot/shared'
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { SubNav } from '../../components/SubNav'
import { AnalyticsFilterBar, MetricCard, useAnalyticsScope, type AnalyticsScope } from '../../components/analytics/AnalyticsScope'
import { useAggregate } from '../../lib/hooks'
import { bucketsIn, channelLines, endings, shortDay, volumeByTime } from '../../lib/analytics-charts'
import { RANGE_OPTIONS } from '../../lib/analytics-filters'

const SUBNAV = [
  { label: 'Overview', path: '/analytics' },
  { label: 'Dashboards', path: '/analytics/dashboards' },
  { label: 'Reports', path: '/analytics/reports' },
]

const KPIS: AnalyticsMetric[] = [
  'conversations', 'contained_rate', 'resolved_by_bot_rate', 'escalated_rate',
  'abandoned_rate', 'csat_score', 'first_reply_ms', 'llm_cost',
]

const ENDING_COLORS = ['#22c55e', '#6366f1', '#6b7280']

const TOOLTIP_STYLE = {
  contentStyle: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)' },
}

function Panel(props: { title: string; badge?: string; query: { isLoading: boolean; isError: boolean; refetch: () => unknown }; empty: boolean; emptyText?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card padding="none" className={props.className}>
      <CardHeader className="px-5 pt-4 pb-2">
        <CardTitle>{props.title}</CardTitle>
        {props.badge && <Badge variant="muted">{props.badge}</Badge>}
      </CardHeader>
      <div className="px-4 pb-4 h-[220px]">
        {props.query.isLoading ? <Skeleton className="h-full w-full" />
          : props.query.isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
              This chart could not be loaded.
              <Button size="sm" variant="secondary" onClick={() => void props.query.refetch()}>Retry</Button>
            </div>
          )
            : props.empty ? <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">{props.emptyText ?? 'No data for these filters'}</div>
              : props.children}
      </div>
    </Card>
  )
}

function rangeLabel(days: number) {
  return RANGE_OPTIONS.find((r) => r.days === days)?.label ?? `Last ${days} days`
}

function downloadCsv(name: string, lines: string[][]) {
  const csv = lines.map((line) => line.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function AnalyticsOverviewPage() {
  const scope = useAnalyticsScope()
  const volume = useAggregate(scope.params({ metric: 'conversations', dimensions: ['time', 'outcome'] }))
  const ended = useAggregate(scope.params({ metric: 'conversations', dimensions: ['outcome'] }))
  const csat = useAggregate(scope.params({ metric: 'csat_score', dimensions: ['time'] }))
  const reply = useAggregate(scope.params({ metric: 'first_reply_ms', dimensions: ['time'] }))
  const byChannel = useAggregate(scope.params({ metric: 'conversations', dimensions: ['channel'] }))
  const containedByChannel = useAggregate(scope.params({ metric: 'contained_rate', dimensions: ['channel'] }))

  const volumeBuckets = volume.data ? bucketsIn(volume.data.query.range, volume.data.query.granularity) : []
  const volumePoints = volume.data?.rows.length ? volumeByTime(volume.data.rows, volumeBuckets).map((p) => ({ ...p, label: shortDay(p.time) })) : []
  const endingSummary = endings(ended.data?.rows ?? [])
  const csatPoints = (csat.data?.rows ?? []).map((r) => ({ label: shortDay(r.key.time ?? ''), score: r.value == null ? null : Math.round(r.value * 1000) / 10, ratings: r.denominator }))
  const replyPoints = (reply.data?.rows ?? []).map((r) => ({ label: shortDay(r.key.time ?? ''), seconds: r.value == null ? null : Math.round(r.value / 100) / 10, answered: r.denominator }))
  const channels = channelLines(byChannel.data?.rows ?? [], containedByChannel.data?.rows ?? [])
  const range = rangeLabel(scope.days)

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Analytics</h1>
          <div className="flex flex-wrap items-center gap-2">
            <AnalyticsFilterBar scope={scope} />
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              disabled={!volumePoints.length}
              title={volumePoints.length ? 'Chats per day and how they ended, for these filters' : 'Nothing to export for these filters'}
              onClick={() => downloadCsv('chats-by-day.csv', [
                ['day', 'chats', 'contained', 'escalated', 'abandoned', 'open'],
                ...volumePoints.map((p) => [p.time, String(p.total), String(p.contained), String(p.escalated), String(p.abandoned), String(p.open)]),
              ])}
            >
              <Download size={13} /> Export
            </Button>
          </div>
        </div>
        <SubNav items={SUBNAV} />
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {KPIS.map((metric) => <MetricCard key={metric} scope={scope} metric={metric} />)}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Panel title="Chats per day" badge={range} query={volume} empty={!volumePoints.length} className="xl:col-span-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={volumePoints}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="total" name="All chats" stroke="#6366f1" fill="#6366f122" strokeWidth={2} />
                <Area type="monotone" dataKey="contained" name="Contained" stroke="#22c55e" fill="transparent" strokeWidth={1.5} />
                <Area type="monotone" dataKey="escalated" name="Escalated" stroke="#ef4444" fill="transparent" strokeWidth={1.5} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="How chats ended" badge={`of ${endingSummary.finished} finished`} query={ended} empty={endingSummary.finished === 0} emptyText={endingSummary.open ? `${endingSummary.open} chats are still open; none has finished yet` : 'No data for these filters'}>
            <div className="flex h-full flex-col justify-center gap-3 px-1">
              {endingSummary.parts.map((part, i) => (
                <div key={part.name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-[var(--text-secondary)]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: ENDING_COLORS[i] }} />{part.name}</span>
                    <span className="font-semibold text-[var(--text-primary)]">{part.share == null ? '—' : `${Math.round(part.share * 1000) / 10}%`} <span className="font-normal text-[var(--text-muted)]">({part.count})</span></span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[var(--bg-overlay)]"><div className="h-1.5 rounded-full" style={{ width: `${(part.share ?? 0) * 100}%`, background: ENDING_COLORS[i] }} /></div>
                </div>
              ))}
              {endingSummary.open > 0 && <p className="text-[11px] text-[var(--text-muted)]">{endingSummary.open} still open, not counted.</p>}
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Panel title="Satisfaction per day" badge="% thumbs up" query={csat} empty={!csatPoints.length} emptyText="No ratings for these filters">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={csatPoints}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, _n, item) => [`${v}% of ${(item.payload as { ratings: number }).ratings} ratings`, 'Satisfaction']} />
                <Line type="monotone" dataKey="score" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 3, fill: '#22c55e', strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Bot reply time per day" badge="seconds, average" query={reply} empty={!replyPoints.length} emptyText="No answered messages for these filters">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={replyPoints}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} unit="s" />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, _n, item) => [`${v}s over ${(item.payload as { answered: number }).answered} messages`, 'Average']} />
                <Area type="monotone" dataKey="seconds" stroke="#f59e0b" fill="#f59e0b22" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          <Card padding="none">
            <CardHeader className="px-5 pt-4 pb-2"><CardTitle>Channels</CardTitle><Badge variant="muted">contained, of finished</Badge></CardHeader>
            <div className="px-5 pb-5 space-y-3">
              {byChannel.isLoading ? <Skeleton className="h-24 w-full" />
                : byChannel.isError ? <Button size="sm" variant="secondary" onClick={() => void byChannel.refetch()}>Retry</Button>
                  : channels.length === 0 ? <p className="py-8 text-center text-xs text-[var(--text-muted)]">No chats for these filters</p>
                    : channels.map((ch) => (
                      <div key={ch.channel}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-[var(--text-primary)] font-medium">{ch.channel}</span>
                          <span className="text-xs text-[var(--text-muted)]">
                            {ch.chats} chat{ch.chats === 1 ? '' : 's'} · {formatMetric('contained_rate', ch.contained)} contained{ch.finished ? ` of ${ch.finished} finished` : ''}
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-[var(--bg-overlay)] overflow-hidden">
                          <div className="h-2 rounded-full bg-[var(--accent)]" style={{ width: `${(ch.contained ?? 0) * 100}%` }} />
                        </div>
                      </div>
                    ))}
            </div>
          </Card>
        </div>

        <AgentTable scope={scope} range={range} />
      </div>
    </div>
  )
}

function AgentTable({ scope, range }: { scope: AnalyticsScope; range: string }) {
  const handled = useAggregate(scope.params({ metric: 'conversations', dimensions: ['agent'] }))
  const rated = useAggregate(scope.params({ metric: 'csat_score', dimensions: ['agent'] }))
  const rows = (handled.data?.rows ?? []).filter((r) => r.key.agent && r.key.agent !== 'Unassigned')
  if (handled.isLoading || rows.length === 0) return null
  const ratings = new Map((rated.data?.rows ?? []).map((r) => [r.key.agent, r]))
  return (
    <Card padding="none">
      <CardHeader className="px-5 pt-4 pb-2"><CardTitle>Teammates</CardTitle><Badge variant="muted">{range}</Badge></CardHeader>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {['Teammate', 'Chats held', 'Satisfaction'].map((h) => <th key={h} className="px-5 py-2.5 text-left text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).map((r) => {
            const rating = ratings.get(r.key.agent)
            return (
              <tr key={r.key.agent}>
                <td className="px-5 py-3 font-medium text-[var(--text-primary)]">{r.key.agent}</td>
                <td className="px-5 py-3 text-[var(--text-secondary)]">{r.value}</td>
                <td className="px-5 py-3 text-[var(--text-secondary)]">
                  {formatMetric('csat_score', rating?.value ?? null)}
                  {rating ? <span className="ml-1 text-[11px] text-[var(--text-muted)]">{denominatorLine('csat_score', rating)}</span> : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}
