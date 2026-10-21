import React from 'react'
import { Link } from '@tanstack/react-router'
import { CheckCircle2, Circle, ArrowRight, Rocket, RefreshCw, AlertTriangle } from 'lucide-react'
import { Card, CardHeader, CardTitle, Badge, Button, Skeleton } from '@ybot/ui'
import type { ChecklistItem } from '@ybot/shared'
import { useAppStore } from '../store/app'
import { useBotOverview, useConversations } from '../lib/hooks'
import type { BotOverview } from '../lib/api'
import { chatText } from '../lib/chat-text'
import { TestRunsCard } from '../components/TestRunsCard'

function money(usd: number | null): string {
  if (usd == null) return '—'
  if (usd === 0) return '$0.00'
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

function when(iso: string): string {
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const ACTION_LABELS: Record<string, string> = {
  'release.published': 'Published a release',
  'release.rolled_back': 'Rolled back a release',
  'flow.updated': 'Edited a flow',
  'flow.created': 'Created a flow',
  'flow.published': 'Published a flow',
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function Checklist({ items }: { items: ChecklistItem[] }) {
  const done = items.filter((item) => item.done).length
  const next = items.find((item) => !item.done)
  return (
    <Card padding="none">
      <CardHeader className="px-4 pt-4 mb-2">
        <CardTitle>Get the bot ready</CardTitle>
        <span className="text-xs text-[var(--text-muted)]" data-testid="checklist-progress">{done} of {items.length} done</span>
      </CardHeader>
      <div className="mx-4 mb-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
        <div className="h-full rounded-full bg-[var(--success)] transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ol className="divide-y divide-[var(--border)]">
        {items.map((item) => (
          <li key={item.id}>
            <Link to={item.path} className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors">
              {item.done
                ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--success)]" />
                : <Circle size={16} className={`mt-0.5 shrink-0 ${item === next ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />}
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${item.done ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]'}`}>{item.label}</p>
                {!item.done && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{item.hint}</p>}
              </div>
              {item === next && <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--accent)]">Next <ArrowRight size={12} /></span>}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function CountTile({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Link to={to} className="block">
      <Card className="h-full hover:border-[var(--accent)] transition-colors">
        <p className="text-xs font-medium text-[var(--text-muted)]">{label}</p>
        <p className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{value.toLocaleString()}</p>
      </Card>
    </Link>
  )
}

function KpiTile({ label, value, denominator }: { label: string; value: string; denominator: string }) {
  return (
    <Card>
      <p className="text-xs font-medium text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]" data-testid="denominator">{denominator}</p>
    </Card>
  )
}

function BuildCounts({ overview }: { overview: BotOverview }) {
  const f = overview.footprint
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <CountTile label="Business details" value={f.businessFields} to="/build/business" />
      <CountTile label="Knowledge items" value={f.knowledgeItems} to="/build/knowledge/sources" />
      <CountTile label="Flows" value={f.flows} to="/build/journey" />
      <CountTile label="Tools" value={f.tools} to="/build/tools" />
      <CountTile label="Sandbox chats" value={f.sandboxChats} to="/build/journey" />
      <CountTile label="Production channels" value={f.productionChannels} to="/configure/channels" />
    </div>
  )
}

function Releases({ overview }: { overview: BotOverview }) {
  return (
    <Card padding="none">
      <CardHeader className="px-4 pt-4 mb-2">
        <CardTitle>Production releases</CardTitle>
        <Link to="/build/releases" className="text-xs text-[var(--accent)]">All releases</Link>
      </CardHeader>
      <ul className="divide-y divide-[var(--border)]">
        {overview.releases.map((release) => (
          <li key={release.number} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <Rocket size={14} className="shrink-0 text-[var(--text-muted)]" />
            <span className="font-medium text-[var(--text-primary)]">Release {release.number}</span>
            {release.live && <Badge variant="success">Live</Badge>}
            <span className="flex-1 truncate text-[var(--text-muted)]">{release.note ?? ''}</span>
            <span className="shrink-0 text-xs text-[var(--text-muted)]">{when(release.createdAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Activity({ items }: { items: NonNullable<BotOverview['activity']> }) {
  return (
    <Card padding="none">
      <CardHeader className="px-4 pt-4 mb-2">
        <CardTitle>Recent changes</CardTitle>
        <Link to="/admin/audit" className="text-xs text-[var(--accent)]">Audit log</Link>
      </CardHeader>
      {items.length === 0
        ? <p className="px-4 pb-4 text-sm text-[var(--text-muted)]">No changes recorded for this bot yet.</p>
        : (
          <ul className="divide-y divide-[var(--border)]">
            {items.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="flex-1 truncate text-[var(--text-secondary)]">{actionLabel(row.action)}</span>
                <span className="shrink-0 text-xs text-[var(--text-muted)]">{row.who ?? 'System'} · {when(row.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
    </Card>
  )
}

function RecentChats({ botId }: { botId: string }) {
  const { data: chats = [], isLoading, error, refetch } = useConversations({ botId, limit: '5' })
  return (
    <Card padding="none">
      <CardHeader className="px-4 pt-4 mb-2">
        <CardTitle>Latest chats</CardTitle>
        <Link to="/inbox/chats" className="text-xs text-[var(--accent)]">Open Inbox</Link>
      </CardHeader>
      <div className="divide-y divide-[var(--border)]">
        {isLoading && <div className="space-y-2 px-4 pb-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-full" />)}</div>}
        {error && (
          <div className="flex items-center justify-between gap-3 px-4 pb-4 text-sm text-[var(--text-muted)]">
            Chats could not be loaded.
            <Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>
          </div>
        )}
        {!isLoading && !error && chats.length === 0 && <p className="px-4 pb-4 text-sm text-[var(--text-muted)]">No chats yet.</p>}
        {chats.slice(0, 5).map((c) => {
          const lastMsg = (c as { messages?: Array<{ content: { text?: string } }> }).messages?.[0]
          const contact = (c as { contact?: { displayName?: string } }).contact
          return (
            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <p className="flex-1 truncate text-sm text-[var(--text-secondary)]">
                {contact?.displayName ?? 'Visitor'}{lastMsg ? ` — ${chatText(lastMsg.content.text, contact?.displayName)}` : ''}
              </p>
              <Badge variant={c.status === 'resolved' ? 'success' : c.status === 'escalated' ? 'warning' : 'info'} className="shrink-0 capitalize">{c.status}</Badge>
              <span className="shrink-0 text-xs text-[var(--text-muted)]">{new Date(c.updatedAt as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function LiveView({ overview, botId, isAdmin }: { overview: BotOverview; botId: string; isAdmin: boolean }) {
  const p = overview.production
  const left = overview.checklist.filter((item) => !item.done && item.id !== 'sandbox')
  const scope = 'Production, last 7 days, test runs left out'
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiTile label="Chats" value={p.chats.toLocaleString()} denominator={scope} />
        <KpiTile label="Handed to the team" value={p.chats ? p.handedOver.toLocaleString() : '—'} denominator={p.chats ? `of ${p.chats} chats` : 'No chats to count'} />
        <KpiTile label="Open now" value={p.chats ? p.open.toLocaleString() : '—'} denominator={p.chats ? `of ${p.chats} chats, with the bot or waiting` : 'No chats to count'} />
        <KpiTile label="Cost per chat" value={money(p.costPerChatUsd)} denominator={p.costUsd != null ? `${money(p.costUsd)} model cost ÷ ${p.chats} chats` : 'No model calls logged'} />
      </div>
      {left.length > 0 && (
        <Card className="flex items-center gap-3">
          <AlertTriangle size={16} className="shrink-0 text-[var(--warning)]" />
          <p className="flex-1 text-sm text-[var(--text-secondary)]">
            {left.length === 1 ? 'One setup step is still open' : `${left.length} setup steps are still open`}: {left.map((item) => item.label).join('; ')}.
          </p>
          <Link to={left[0]!.path} className="text-sm font-medium text-[var(--accent)]">Finish</Link>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <RecentChats botId={botId} />
        <Releases overview={overview} />
      </div>
      {overview.activity && <Activity items={overview.activity} />}
      <div className="empty:hidden"><TestRunsCard botId={botId} isAdmin={isAdmin} /></div>
    </div>
  )
}

function stageBadge(overview: BotOverview) {
  if (overview.stage === 'live') return <Badge variant="success" dot>Live · release {overview.footprint.liveRelease}</Badge>
  if (overview.stage === 'building') return <Badge variant="info">Building · not published</Badge>
  return <Badge variant="muted">Not set up yet</Badge>
}

export function OverviewPage() {
  const selectedBot = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId))
  const selectedBotId = useAppStore((s) => s.selectedBotId)
  const isAdmin = useAppStore((s) => s.user?.role === 'ADMIN')
  const { data: overview, isLoading, error, refetch, isFetching } = useBotOverview()

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 py-4 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">Overview</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{selectedBot?.name ?? 'No bot selected'}</p>
          </div>
          {overview && stageBadge(overview)}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {!selectedBotId && (
          <Card className="mx-auto max-w-lg text-center">
            <p className="text-sm text-[var(--text-secondary)]">Create a bot to get started.</p>
            <Link to="/bots/new" className="mt-3 inline-block text-sm font-medium text-[var(--accent)]">Create a bot</Link>
          </Card>
        )}
        {selectedBotId && isLoading && (
          <div className="space-y-4" data-testid="overview-loading">
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
            <Skeleton className="h-64" />
          </div>
        )}
        {selectedBotId && error && !overview && (
          <Card className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
            <p className="text-sm text-[var(--text-secondary)]">The overview could not be loaded: {error instanceof Error ? error.message : 'unknown error'}</p>
            <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Retry
            </Button>
          </Card>
        )}
        {overview && overview.stage === 'empty' && (
          <div className="mx-auto max-w-2xl space-y-4" data-stage="empty">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Set up {selectedBot?.name ?? 'your bot'}</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Six steps from an empty bot to one that answers customers in Production. Start anywhere; this list follows what you have done.</p>
            </div>
            <Checklist items={overview.checklist} />
          </div>
        )}
        {overview && overview.stage === 'building' && (
          <div className="space-y-6" data-stage="building">
            <BuildCounts overview={overview} />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Checklist items={overview.checklist} />
              {overview.activity && <Activity items={overview.activity} />}
            </div>
            <div className="empty:hidden"><TestRunsCard botId={selectedBotId} isAdmin={isAdmin} /></div>
          </div>
        )}
        {overview && overview.stage === 'live' && selectedBotId && (
          <div data-stage="live"><LiveView overview={overview} botId={selectedBotId} isAdmin={isAdmin} /></div>
        )}
      </div>
    </div>
  )
}
