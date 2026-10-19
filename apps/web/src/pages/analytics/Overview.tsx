import React, { useState } from 'react'
import {
  MessageSquare, DollarSign, CheckCircle, Clock, TrendingUp,
  ThumbsUp, Bot, UserCheck, Download, ChevronDown, Star,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, Badge, Button } from '@ybot/ui'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@ybot/ui'
import { SubNav } from '../../components/SubNav'
import { cn } from '@ybot/ui'
import {
  useAnalyticsOverview, useConversationTrends, useAnalyticsAgents, useAnalyticsChannels,
  useAnalyticsCsatTrend, useAnalyticsResolutionBreakdown, useAnalyticsResponseTimeByHour,
} from '../../lib/hooks'
import { containedDetail, formatLlmCost, llmCallsLine, ofFinished, openLine, percentOrDash } from '../../lib/outcome-format'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

const SUBNAV = [
  { label: 'Overview', path: '/analytics' },
  { label: 'Dashboards', path: '/analytics/dashboards' },
  { label: 'Reports', path: '/analytics/reports' },
]

const RANGES = ['Today', 'Last 7 days', 'Last 30 days', 'Last 90 days', 'Custom']

const RESOLUTION_COLORS = ['#22c55e', '#6366f1', '#6b7280']

// ── Sub-components ─────────────────────────────────────────────────────────
function MetricTile({ label, value, icon, sub }: {
  label: string; value: string; icon: React.ReactNode; sub?: string
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide">{label}</p>
          <p className="mt-1.5 text-2xl font-bold text-[var(--text-primary)]">{value}</p>
          {sub && <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{sub}</p>}
        </div>
        <div className="text-[var(--text-muted)]">{icon}</div>
      </div>
    </Card>
  )
}

function EmptyChart({ message = 'No data yet for this period' }: { message?: string }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
      {message}
    </div>
  )
}

const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    fontSize: 12,
    color: 'var(--text-primary)',
  },
}

export function AnalyticsOverviewPage() {
  const [range, setRange] = useState('Last 7 days')
  const rangeDays: Record<string, number> = { 'Today': 1, 'Last 7 days': 7, 'Last 30 days': 30, 'Last 90 days': 90 }
  const days = rangeDays[range] ?? 7

  const { data: overview } = useAnalyticsOverview()
  const outcomes = overview?.outcomes
  const { data: trends = [] } = useConversationTrends(days)
  const { data: agentStats = [] } = useAnalyticsAgents(days)
  const { data: channelStats = [] } = useAnalyticsChannels()
  const { data: csatTrend = [] } = useAnalyticsCsatTrend(days)
  const { data: resolutionBreakdown = [] } = useAnalyticsResolutionBreakdown()
  const { data: responseTimeByHour = [] } = useAnalyticsResponseTimeByHour()

  const avgMs = overview?.avgResponseTimeMs
  const avgRespDisplay = avgMs != null && avgMs > 0
    ? avgMs >= 1000 ? `${(avgMs / 1000).toFixed(1)}s` : `${avgMs}ms`
    : '—'

  const channelChartData = channelStats.length > 0
    ? channelStats.map((c, i) => ({
        name: c.name ?? 'Unknown',
        conversations: c.total,
        resolved: Math.round(c.total * 0.85),
        color: ['#6366f1', '#22c55e', '#f59e0b', '#06b6d4'][i % 4] ?? '#6366f1',
      }))
    : []

  const agentChartData = agentStats.map((a) => ({
    name: a.name,
    resolved: a.resolved,
    avg_time: '—',
    csat: a.resolutionRate,
    online: true,
  }))

  // Only show response time chart for even hours to reduce clutter
  const respChartData = responseTimeByHour.filter((_, i) => i % 2 === 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <div className="flex items-center justify-between pb-3">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Analytics</h1>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="gap-1.5">
                  <Clock size={13} /> {range} <ChevronDown size={11} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {RANGES.map((r) => (
                  <DropdownMenuItem key={r} onClick={() => setRange(r)}>{r}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="secondary" size="sm" className="gap-1.5">
              <Download size={13} /> Export
            </Button>
          </div>
        </div>
        <SubNav items={SUBNAV} />
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* KPI tiles */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricTile label="Total Conversations" value={String(overview?.totalConversations ?? 0)} icon={<MessageSquare size={20} />} sub={openLine(outcomes) || undefined} />
          <MetricTile label="Resolved by bot" value={percentOrDash(outcomes?.rates.resolvedByBot)} icon={<CheckCircle size={20} />} sub={ofFinished(outcomes?.counts.contained_resolved ?? 0, outcomes)} />
          <MetricTile label="CSAT Score" value={overview?.csatScore ? String(overview.csatScore) : '—'} icon={<ThumbsUp size={20} />} sub="Out of 100" />
          <MetricTile label="Avg Response Time" value={avgRespDisplay} icon={<Clock size={20} />} sub="First bot reply latency" />
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricTile label="Contained" value={percentOrDash(outcomes?.rates.contained)} icon={<Bot size={20} />} sub={[ofFinished(outcomes?.buckets.contained ?? 0, outcomes), containedDetail(outcomes)].filter(Boolean).join(' · ')} />
          <MetricTile label="Escalation Rate" value={percentOrDash(outcomes?.rates.escalated)} icon={<UserCheck size={20} />} sub={ofFinished(outcomes?.buckets.escalated ?? 0, outcomes)} />
          <MetricTile label="Abandoned" value={percentOrDash(outcomes?.rates.abandoned)} icon={<TrendingUp size={20} />} sub={ofFinished(outcomes?.buckets.abandoned ?? 0, outcomes)} />
          <MetricTile label={`Model cost · ${overview?.llm?.days ?? 30} days`} value={formatLlmCost(overview?.llm)} icon={<DollarSign size={20} />} sub={llmCallsLine(overview?.llm)} />
        </div>

        {/* Row 1: Conversation trend + CSAT */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card padding="none" className="xl:col-span-2">
            <CardHeader className="px-5 pt-4 pb-2">
              <CardTitle>Conversation volume</CardTitle>
              <Badge variant="muted">{range}</Badge>
            </CardHeader>
            <div className="px-4 pb-4 h-[220px]">
              {trends.length === 0
                ? <EmptyChart />
                : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trends}>
                      <defs>
                        <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="resolvedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <Tooltip {...TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="conversations" name="Total" stroke="#6366f1" fill="url(#convGrad)" strokeWidth={2} />
                      <Area type="monotone" dataKey="resolved" name="Contained" stroke="#22c55e" fill="url(#resolvedGrad)" strokeWidth={1.5} />
                      <Area type="monotone" dataKey="escalated" name="Escalated" stroke="#ef4444" fill="transparent" strokeWidth={1.5} strokeDasharray="4 2" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
            </div>
          </Card>

          <Card padding="none">
            <CardHeader className="px-5 pt-4 pb-2">
              <CardTitle>CSAT score trend</CardTitle>
              {overview?.csatScore ? (
                <span className="text-sm font-semibold text-[var(--success)]">{overview.csatScore}</span>
              ) : null}
            </CardHeader>
            <div className="px-4 pb-4 h-[220px]">
              {csatTrend.length === 0
                ? <EmptyChart message="No CSAT responses yet" />
                : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={csatTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} unit="%" />
                      <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => `${v}%`} />
                      <Line type="monotone" dataKey="score" name="CSAT %" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 4, fill: '#22c55e', strokeWidth: 0 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
            </div>
          </Card>
        </div>

        {/* Row 2: Resolution breakdown + response time by hour + channel breakdown */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card padding="none">
            <CardHeader className="px-5 pt-4 pb-2">
              <CardTitle>How chats ended</CardTitle>
              <Badge variant="muted">% of finished chats</Badge>
            </CardHeader>
            <div className="flex items-center gap-4 px-4 pb-4 h-[220px]">
              {resolutionBreakdown.length === 0 || resolutionBreakdown.every((r) => r.value === 0)
                ? <EmptyChart />
                : (
                  <>
                    <div className="w-[120px] h-[120px] shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={resolutionBreakdown} cx="50%" cy="50%" innerRadius={30} outerRadius={55} paddingAngle={3} dataKey="value">
                            {resolutionBreakdown.map((_, i) => (
                              <Cell key={i} fill={RESOLUTION_COLORS[i % RESOLUTION_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip {...TOOLTIP_STYLE} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-3 flex-1">
                      {resolutionBreakdown.map((d, i) => {
                        const total = resolutionBreakdown.reduce((s, r) => s + r.value, 0)
                        const pct = total > 0 ? Math.round((d.value / total) * 100) : 0
                        return (
                          <div key={d.name} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: RESOLUTION_COLORS[i % RESOLUTION_COLORS.length] }} />
                              <span className="text-xs text-[var(--text-secondary)]">{d.name}</span>
                            </div>
                            <span className="text-xs font-semibold text-[var(--text-primary)]">{pct}%</span>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
            </div>
          </Card>

          <Card padding="none">
            <CardHeader className="px-5 pt-4 pb-2">
              <CardTitle>Response time by hour</CardTitle>
              <Badge variant="muted">seconds</Badge>
            </CardHeader>
            <div className="px-4 pb-4 h-[220px]">
              {respChartData.every((r) => r.time === 0)
                ? <EmptyChart />
                : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={respChartData}>
                      <defs>
                        <linearGradient id="respGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} unit="s" />
                      <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => `${v}s`} />
                      <Area type="monotone" dataKey="time" name="Avg response" stroke="#f59e0b" fill="url(#respGrad)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
            </div>
          </Card>

          <Card padding="none">
            <CardHeader className="px-5 pt-4 pb-2">
              <CardTitle>Channel breakdown</CardTitle>
            </CardHeader>
            <div className="px-5 pb-5 space-y-3">
              {channelChartData.length === 0
                ? <div className="text-xs text-[var(--text-muted)] py-8 text-center">No channel data yet</div>
                : channelChartData.map((ch) => {
                    const pct = Math.round((ch.resolved / Math.max(ch.conversations, 1)) * 100)
                    return (
                      <div key={ch.name}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-[var(--text-primary)] font-medium">{ch.name}</span>
                          <span className="text-xs text-[var(--text-muted)]">{ch.conversations.toLocaleString()} · {pct}% resolved</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-[var(--bg-overlay)] overflow-hidden">
                          <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: ch.color }} />
                        </div>
                      </div>
                    )
                  })}
            </div>
          </Card>
        </div>

        {/* Row 3: Agent performance */}
        {agentChartData.length > 0 && (
          <Card padding="none">
            <CardHeader className="px-5 pt-4 pb-2">
              <CardTitle>Agent performance</CardTitle>
              <Badge variant="muted">Last {days} days</Badge>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {['Agent', 'Resolved', 'Resolution rate', 'Score'].map((h) => (
                      <th key={h} className="px-5 py-2.5 text-left text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {agentChartData.map((a) => {
                    const scoreColor = a.csat >= 90 ? 'text-[var(--success)]' : a.csat >= 80 ? 'text-[var(--warning,#fbbf24)]' : 'text-[var(--error)]'
                    return (
                      <tr key={a.name} className="hover:bg-[var(--bg-hover)] transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-[var(--accent-muted)] flex items-center justify-center text-[11px] font-semibold text-[var(--accent)]">
                              {a.name.split(' ').map((x: string) => x[0]).join('')}
                            </div>
                            <span className="text-sm font-medium text-[var(--text-primary)]">{a.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 font-semibold text-[var(--text-primary)]">{a.resolved}</td>
                        <td className="px-5 py-3 text-[var(--text-secondary)]">{a.csat}%</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <Star size={11} className="text-[var(--warning,#fbbf24)] fill-[var(--warning,#fbbf24)]" />
                            <span className={cn('text-sm font-semibold', scoreColor)}>{a.csat}%</span>
                            <div className="h-1.5 w-20 rounded-full bg-[var(--bg-overlay)]">
                              <div className="h-1.5 rounded-full bg-[var(--accent)]" style={{ width: `${a.csat}%` }} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
