import React from 'react'
import { MessageSquare, Users, CheckCircle, Clock, Loader2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, Badge } from '@ybot/ui'
import { useAppStore } from '../store/app'
import { useAnalyticsOverview, useConversationTrends, useConversations, useAnalyticsChannels } from '../lib/hooks'
import { chatText } from '../lib/chat-text'
import { ofFinished, percentOrDash } from '../lib/outcome-format'
import { TestRunsCard } from '../components/TestRunsCard'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts'

interface MetricTileProps {
  label: string
  value: string
  sub?: string
  icon: React.ReactNode
  color: string
  loading?: boolean
}

function MetricTile({ label, value, sub, icon, color, loading }: MetricTileProps) {
  return (
    <Card className="flex items-start justify-between">
      <div>
        <p className="text-xs text-[var(--text-muted)] font-medium">{label}</p>
        {loading
          ? <div className="mt-2 h-8 w-20 rounded animate-pulse bg-[var(--bg-overlay)]" />
          : <p className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{value}</p>}
        {sub && !loading && (
          <p className="text-xs text-[var(--text-muted)] mt-1">{sub}</p>
        )}
      </div>
      <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)]" style={{ background: color }}>
        {icon}
      </div>
    </Card>
  )
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`
}

export function OverviewPage() {
  const selectedBot = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId))
  const selectedBotId = useAppStore((s) => s.selectedBotId)
  const selectedEnv = useAppStore((s) => s.selectedEnv)
  const isAdmin = useAppStore((s) => s.user?.role === 'ADMIN')

  const { data: overview, isLoading: ovLoading } = useAnalyticsOverview()
  const { data: trends = [], isLoading: trendsLoading } = useConversationTrends()
  const { data: recentConvos = [] } = useConversations({ botId: selectedBotId ?? '', limit: '5' })
  const { data: channels = [] } = useAnalyticsChannels()

  // Map trends to chart-friendly format with short day labels
  const chartData = trends.map((t) => ({
    date: new Date(t.date).toLocaleDateString('en', { weekday: 'short' }),
    conversations: t.conversations,
    resolved: t.resolved,
    escalated: t.escalated,
  }))

  const channelData = channels.length
    ? channels.map((row) => ({ name: row.name || 'Unknown', value: row.total }))
    : [{ name: 'No channels yet', value: 0 }]

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">Overview</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {selectedBot?.name ?? 'All bots'} · {selectedBot?.environments.find((env) => env.kind === selectedEnv)?.name ?? (selectedEnv === 'sandbox' ? 'Sandbox' : 'Production')}
            </p>
          </div>
          <Badge variant="muted">Last 7 days</Badge>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {/* Metrics */}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <MetricTile
            label="Total Conversations"
            value={overview ? overview.totalConversations.toLocaleString() : '—'}
            sub={overview?.outcomes ? `${percentOrDash(overview.outcomes.rates.escalated)} escalated · ${ofFinished(overview.outcomes.buckets.escalated, overview.outcomes)}` : undefined}
            icon={<MessageSquare size={18} className="text-[var(--accent)]" />}
            color="var(--accent-muted)"
            loading={ovLoading}
          />
          <MetricTile
            label="Resolved by bot"
            value={percentOrDash(overview?.outcomes?.rates.resolvedByBot)}
            sub={overview?.csatScore ? `CSAT ${pct(overview.csatScore)}` : undefined}
            icon={<CheckCircle size={18} className="text-[var(--success)]" />}
            color="var(--success-muted)"
            loading={ovLoading}
          />
          <MetricTile
            label="Total Contacts"
            value={overview ? overview.totalContacts.toLocaleString() : '—'}
            sub={overview?.outcomes ? `${percentOrDash(overview.outcomes.rates.contained)} contained by the bot` : undefined}
            icon={<Users size={18} className="text-[var(--info)]" />}
            color="var(--info-muted)"
            loading={ovLoading}
          />
          <MetricTile
            label="Avg Response Time"
            value={overview ? (overview.avgResponseTimeMs != null ? fmt(overview.avgResponseTimeMs) : '—') : '—'}
            icon={<Clock size={18} className="text-[var(--warning)]" />}
            color="var(--warning-muted)"
            loading={ovLoading}
          />
        </div>

        {/* Charts row */}
        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2" padding="none">
            <CardHeader className="px-4 pt-4">
              <CardTitle>Conversations (7 days)</CardTitle>
              {trendsLoading && <Loader2 size={13} className="animate-spin text-[var(--text-muted)]" />}
              {!trendsLoading && <Badge variant="muted">Daily</Badge>}
            </CardHeader>
            <div className="px-4 pb-4 h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData.length ? chartData : [{ date: '—', conversations: 0, resolved: 0, escalated: 0 }]}>
                  <defs>
                    <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }} />
                  <Area type="monotone" dataKey="conversations" stroke="#6366f1" fill="url(#convGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="resolved" stroke="#22c55e" fill="transparent" strokeWidth={1.5} strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card padding="none">
            <CardHeader className="px-4 pt-4">
              <CardTitle>By Channel</CardTitle>
            </CardHeader>
            <div className="px-4 pb-4 h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={channelData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={60} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }} />
                  <Bar dataKey="value" fill="#6366f1" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="mt-6 empty:hidden">
          <TestRunsCard botId={selectedBotId} isAdmin={isAdmin} />
        </div>

        {/* Recent conversations */}
        <div className="mt-6">
          <Card padding="none">
            <CardHeader className="px-4 pt-4">
              <CardTitle>Recent Conversations</CardTitle>
              <Badge variant="muted" dot>Live</Badge>
            </CardHeader>
            <div className="divide-y divide-[var(--border)]">
              {recentConvos.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">No conversations yet</div>
              )}
              {recentConvos.map((c) => {
                const lastMsg = (c as { messages?: Array<{ content: { text?: string } }> }).messages?.[0]
                const contact = (c as { contact?: { displayName?: string } }).contact
                const statusColor: Record<string, string> = { active: 'var(--accent)', resolved: 'var(--success)', escalated: 'var(--warning)', closed: 'var(--text-muted)' }
                return (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: statusColor[c.status] ?? 'var(--text-muted)' }} />
                    <p className="flex-1 text-sm text-[var(--text-secondary)] truncate">
                      {contact?.displayName ?? 'Visitor'}{lastMsg ? ` — ${chatText(lastMsg.content.text, contact?.displayName)}` : ''}
                    </p>
                    <Badge variant={c.status === 'resolved' ? 'success' : c.status === 'escalated' ? 'warning' : 'info'} className="shrink-0 capitalize">{c.status}</Badge>
                    <span className="text-xs text-[var(--text-muted)] shrink-0">{new Date(c.updatedAt as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
