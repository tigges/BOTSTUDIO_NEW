import React, { useState, useCallback } from 'react'
import {
  Server, Database, Radio, HardDrive, Cpu, MemoryStick,
  RefreshCw, CheckCircle2, XCircle, Clock, Box,
  BookOpen, FileText, Layers, Activity, ChevronRight, Tag, AlertTriangle,
} from 'lucide-react'
import { Badge, Button } from '@ybot/ui'
import { cn } from '@ybot/ui'
import { useSystemStatus } from '../../lib/hooks'
import type { DockerContainer, RagSourceEntry } from '../../lib/api'
import { shortVersion, fullVersion, buildInfo } from '../../lib/version'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtUptime(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 60)}m`
}

function fmtBytes(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

function fmtAge(iso?: string) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  const m = Math.floor(diff / 60000)
  if (h >= 24) return `${Math.floor(h / 24)}d ago`
  if (h > 0) return `${h}h ago`
  if (m > 0) return `${m}m ago`
  return 'just now'
}

// ── sub-components ────────────────────────────────────────────────────────────

function StatusDot({ ok, pulse }: { ok: boolean; pulse?: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {ok && pulse && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-60" />
      )}
      <span className={cn('relative inline-flex rounded-full h-2.5 w-2.5', ok ? 'bg-[var(--success)]' : 'bg-[var(--danger)]')} />
    </span>
  )
}

function ServiceCard({ label, icon: Icon, ok, latencyMs }: {
  label: string; icon: React.ElementType; ok: boolean; latencyMs: number
}) {
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-[var(--radius-lg)] border p-4',
      ok ? 'border-[var(--success)]/30 bg-[var(--success)]/5' : 'border-[var(--danger)]/30 bg-[var(--danger)]/5',
    )}>
      <div className={cn('flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]',
        ok ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--danger)]/15 text-[var(--danger)]',
      )}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--text-primary)]">{label}</p>
        <p className={cn('text-xs', ok ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
          {ok ? `${latencyMs}ms` : 'Unreachable'}
        </p>
      </div>
      {ok
        ? <CheckCircle2 size={16} className="text-[var(--success)]" />
        : <XCircle size={16} className="text-[var(--danger)]" />}
    </div>
  )
}

function ContainerRow({ c }: { c: DockerContainer }) {
  const running = c.state === 'running'
  const exited = c.state === 'exited'
  const stateColor = running ? 'text-[var(--success)]' : exited ? 'text-[var(--danger)]' : 'text-[var(--warning)]'

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border)] last:border-0">
      <StatusDot ok={running} pulse={running} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--text-primary)] font-mono truncate">{c.name}</p>
        <p className="text-[11px] text-[var(--text-muted)] truncate">{c.image}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={cn('text-xs font-medium capitalize', stateColor)}>{c.state}</p>
        <p className="text-[10px] text-[var(--text-muted)] truncate max-w-[160px]">{c.status}</p>
      </div>
    </div>
  )
}

function MemBar({ pct }: { pct: number }) {
  const color = pct > 85 ? 'bg-[var(--danger)]' : pct > 60 ? 'bg-[var(--warning)]' : 'bg-[var(--success)]'
  return (
    <div className="h-1.5 w-full rounded-full bg-[var(--bg-overlay)] overflow-hidden">
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  )
}

function RagSourceRow({ s }: { s: RagSourceEntry }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border)] last:border-0">
      <div className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent)]/10 shrink-0">
        <BookOpen size={12} className="text-[var(--accent)]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{s.name}</p>
        <p className="text-[11px] text-[var(--text-muted)]">Last sync: {fmtAge(s.lastSyncAt)}</p>
      </div>
      <Badge variant="muted">{s._count.documents} docs</Badge>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export function SystemStatusPage() {
  const [autoRefresh, setAutoRefresh] = useState(false)
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useSystemStatus({
    refetchInterval: autoRefresh ? 15_000 : undefined,
  })

  const handleRefresh = useCallback(() => { void refetch() }, [refetch])

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : '—'

  const release = data?.version ?? buildInfo
  const attention = [...(data?.background?.problems ?? []), ...(data?.secretProblems ?? [])]
  const runningCount = data?.containers.filter((c) => c.state === 'running').length ?? 0
  const totalCount = data?.containers.length ?? 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-[var(--text-primary)]">System Status</h1>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Infrastructure health · Docker containers · RAG corpus
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)] hidden sm:block">
              Updated {lastUpdated}
            </span>
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-medium border transition-colors',
                autoRefresh
                  ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]',
              )}
            >
              <Activity size={11} />
              {autoRefresh ? 'Live' : 'Live off'}
            </button>
            <Button
              variant="secondary" size="sm"
              onClick={handleRefresh}
              disabled={isFetching}
              className="gap-1.5"
            >
              <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw size={20} className="animate-spin text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">Loading status…</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6 space-y-6">

          {attention.length > 0 && (
            <div role="alert" className="rounded-[var(--radius-lg)] border border-[var(--warning)] bg-[var(--warning-muted)] p-4 space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                <AlertTriangle size={13} className="text-[var(--warning)]" />
                Needs attention
              </p>
              <ul className="space-y-1 text-xs text-[var(--text-secondary)] list-disc list-inside">
                {attention.map((item) => <li key={item.key}>{item.message}</li>)}
              </ul>
            </div>
          )}

          {/* Summary pills */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border)]">
              <Box size={13} className="text-[var(--accent)]" />
              <span className="text-xs font-medium text-[var(--text-primary)]">{runningCount}/{totalCount} containers running</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border)]">
              <Layers size={13} className="text-[var(--accent)]" />
              <span className="text-xs font-medium text-[var(--text-primary)]">{(data?.rag.chunks ?? 0).toLocaleString()} RAG chunks</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border)]">
              <MemoryStick size={13} className="text-[var(--accent)]" />
              <span className="text-xs font-medium text-[var(--text-primary)]">{data?.system.usedMemPct ?? 0}% memory used</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border)]">
              <Clock size={13} className="text-[var(--accent)]" />
              <span className="text-xs font-medium text-[var(--text-primary)]">Uptime {fmtUptime(data?.system.uptime ?? 0)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Left column: Services + System */}
            <div className="space-y-6">

              {/* Services health */}
              <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
                  <Radio size={13} className="text-[var(--text-muted)]" />
                  <span className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">Services</span>
                </div>
                <div className="p-4 space-y-3">
                  {data?.services.database && (
                    <ServiceCard label="PostgreSQL" icon={Database} ok={data.services.database.ok} latencyMs={data.services.database.latencyMs} />
                  )}
                  {data?.services.redis && (
                    <ServiceCard label="Redis / Valkey" icon={Radio} ok={data.services.redis.ok} latencyMs={data.services.redis.latencyMs} />
                  )}
                  {data?.background && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-[var(--text-secondary)]">
                        <StatusDot ok={data.background.workers.length > 0} />
                        Background workers
                      </span>
                      <span className="font-mono text-[var(--text-primary)]" title={data.background.workers.map((w) => w.id).join(', ')}>
                        {data.background.workers.length} running
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* System info */}
              <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
                  <Server size={13} className="text-[var(--text-muted)]" />
                  <span className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">System</span>
                </div>
                <div className="p-4 space-y-3">
                  {data && (
                    <>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-[var(--text-muted)] mb-1">Platform</p>
                          <p className="font-medium text-[var(--text-primary)] font-mono">{data.system.platform}</p>
                        </div>
                        <div>
                          <p className="text-[var(--text-muted)] mb-1">Node</p>
                          <p className="font-medium text-[var(--text-primary)] font-mono">{data.system.nodeVersion}</p>
                        </div>
                        <div>
                          <p className="text-[var(--text-muted)] mb-1">CPUs</p>
                          <p className="font-medium text-[var(--text-primary)]">{data.system.cpuCount} cores</p>
                        </div>
                        <div>
                          <p className="text-[var(--text-muted)] mb-1">Uptime</p>
                          <p className="font-medium text-[var(--text-primary)]">{fmtUptime(data.system.uptime)}</p>
                        </div>
                      </div>
                      <div className="pt-1">
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="flex items-center gap-1 text-[var(--text-muted)]">
                            <MemoryStick size={11} /> Memory
                          </span>
                          <span className="font-medium text-[var(--text-primary)]">
                            {fmtBytes(data.system.totalMemMb - data.system.freeMemMb)} / {fmtBytes(data.system.totalMemMb)}
                          </span>
                        </div>
                        <MemBar pct={data.system.usedMemPct} />
                        <p className="text-[10px] text-[var(--text-muted)] mt-1">{data.system.usedMemPct}% used · {fmtBytes(data.system.freeMemMb)} free</p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Release version */}
              <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
                  <Tag size={13} className="text-[var(--text-muted)]" />
                  <span className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">Release</span>
                </div>
                <div className="p-4 space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[var(--text-muted)] mb-1">Version</p>
                      <p className="font-medium text-[var(--text-primary)] font-mono">{release.version}</p>
                    </div>
                    <div>
                      <p className="text-[var(--text-muted)] mb-1">Build #</p>
                      <p className="font-medium text-[var(--text-primary)] font-mono">{release.buildNumber}</p>
                    </div>
                    <div>
                      <p className="text-[var(--text-muted)] mb-1">Git SHA</p>
                      <p className="font-medium text-[var(--text-primary)] font-mono">{release.gitSha.slice(0, 7)}</p>
                    </div>
                    <div>
                      <p className="text-[var(--text-muted)] mb-1">Built</p>
                      <p className="font-medium text-[var(--text-primary)]">{fmtAge(release.buildDate)}</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)] font-mono" title={fullVersion(release)}>
                    {shortVersion(release)}
                  </div>
                </div>
              </div>
            </div>

            {/* Middle column: Docker containers */}
            <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Box size={13} className="text-[var(--text-muted)]" />
                  <span className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">Docker Containers</span>
                </div>
                <Badge variant={runningCount === totalCount ? 'success' : 'warning'}>
                  {runningCount}/{totalCount} up
                </Badge>
              </div>
              {data?.containers.length === 0 ? (
                <div className="p-8 text-center">
                  <Box size={20} className="text-[var(--text-muted)] mx-auto mb-2" />
                  <p className="text-sm text-[var(--text-muted)]">Docker socket not mounted</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Add the Docker socket volume to see containers</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {(data?.containers ?? []).map((c) => <ContainerRow key={c.id} c={c} />)}
                </div>
              )}
            </div>

            {/* Right column: RAG corpus */}
            <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
                <Layers size={13} className="text-[var(--text-muted)]" />
                <span className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">RAG Corpus</span>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 divide-x divide-[var(--border)] border-b border-[var(--border)]">
                {[
                  { label: 'Sources', value: data?.rag.sources ?? 0, icon: BookOpen },
                  { label: 'Docs', value: (data?.rag.documents ?? 0).toLocaleString(), icon: FileText },
                  { label: 'Chunks', value: (data?.rag.chunks ?? 0).toLocaleString(), icon: Layers },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="flex flex-col items-center py-4 gap-1">
                    <Icon size={14} className="text-[var(--accent)]" />
                    <p className="text-base font-bold text-[var(--text-primary)]">{value}</p>
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">{label}</p>
                  </div>
                ))}
              </div>

              {/* Source list */}
              {data?.rag.sourceList.length === 0 ? (
                <div className="p-8 text-center">
                  <Layers size={20} className="text-[var(--text-muted)] mx-auto mb-2" />
                  <p className="text-sm text-[var(--text-muted)]">No knowledge sources</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Add sources in Build › Knowledge › Sources</p>
                </div>
              ) : (
                <div>
                  {(data?.rag.sourceList ?? []).map((s) => <RagSourceRow key={s.id} s={s} />)}
                  <div className="px-4 py-2.5 border-t border-[var(--border)]">
                    <a href="/build/knowledge/sources" className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
                      Manage sources <ChevronRight size={11} />
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
