/**
 * Configure > Optimizations
 *
 * Learn from chats drafts a shorter chart from sample or rated chats.
 * Prompt suggestions are supervised system-prompt proposals.
 */

import React, { useState } from 'react'
import {
  Sparkles, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  BookMarked, BarChart3, Loader2, RefreshCcw,
} from 'lucide-react'
import { Button, Badge } from '@ybot/ui'
import { SubNav } from '../../components/SubNav'
import { useOptimizations, useApplyOptimization, useDismissOptimization } from '../../lib/hooks'
import { useAppStore } from '../../store/app'
import { cn } from '@ybot/ui'
import type { TemplateOptimization } from '../../lib/api'
import { LearnFromChats } from '../build/LearnFromChats'

const SUBNAV = [
  { label: 'Channels',      path: '/configure/channels' },
  { label: 'Optimizations', path: '/configure/optimizations' },
  { label: 'Integrations',  path: '/configure/integrations' },
  { label: 'Database',      path: '/configure/database' },
  { label: 'Webhooks',      path: '/configure/webhooks' },
]

// ── Diff view ─────────────────────────────────────────────────────────────────
function DiffView({ current, proposed }: { current: string; proposed: string }) {
  const currentLines = current.split('\n')
  const proposedLines = proposed.split('\n')

  // Find lines only in proposed (simplified line diff)
  const added = proposedLines.filter((l) => !currentLines.includes(l))
  const removed = currentLines.filter((l) => !proposedLines.includes(l))

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] overflow-hidden font-mono text-xs">
      {removed.length > 0 && removed.map((line, i) => (
        <div key={`r${i}`} className="px-3 py-0.5 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 flex gap-2">
          <span className="select-none text-red-400">-</span>
          <span className="break-all">{line || '\u00a0'}</span>
        </div>
      ))}
      {added.length > 0 && added.map((line, i) => (
        <div key={`a${i}`} className="px-3 py-0.5 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 flex gap-2">
          <span className="select-none text-green-500">+</span>
          <span className="break-all">{line || '\u00a0'}</span>
        </div>
      ))}
      {removed.length === 0 && added.length === 0 && (
        <div className="px-3 py-2 text-[var(--text-muted)]">No textual diff detected.</div>
      )}
    </div>
  )
}

// ── Single optimization card ──────────────────────────────────────────────────
function OptimizationCard({
  opt,
  onApply,
  onDismiss,
  isApplying,
  isDismissing,
}: {
  opt: TemplateOptimization
  onApply: () => void
  onDismiss: () => void
  isApplying: boolean
  isDismissing: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const scorePct = Math.round(opt.avgQualityScore * 100)
  const scoreColor = scorePct >= 80 ? 'text-[var(--success)]' : scorePct >= 60 ? 'text-yellow-600' : 'text-[var(--text-muted)]'

  const statusBadge = {
    pending:   { label: 'Pending review', variant: 'info'    as const },
    applied:   { label: 'Applied',        variant: 'success' as const },
    dismissed: { label: 'Dismissed',      variant: 'muted'   as const },
  }[opt.status] ?? { label: opt.status, variant: 'muted' as const }

  return (
    <div className={cn(
      'rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-5 transition-colors',
      opt.status === 'pending' ? 'border-[var(--accent)]/30 shadow-sm' : 'border-[var(--border)] opacity-70',
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 rounded-[var(--radius-md)] bg-[var(--accent-muted)] text-[var(--accent)] shrink-0 mt-0.5">
            <Sparkles size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold text-[var(--text-primary)] text-sm">{opt.title}</h3>
              <Badge variant={statusBadge.variant} className="text-[10px] uppercase tracking-wide shrink-0">
                {statusBadge.label}
              </Badge>
            </div>
            <p className="text-xs text-[var(--text-secondary)] line-clamp-2">{opt.description}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 shrink-0 text-xs text-[var(--text-muted)]">
          <div className="flex items-center gap-1" title="Number of conversations supporting this suggestion">
            <BookMarked size={12} />
            <span>{opt.evidenceCount} examples</span>
          </div>
          <div className="flex items-center gap-1" title="Average quality score of supporting conversations">
            <BarChart3 size={12} />
            <span className={scoreColor}>{scorePct}% quality</span>
          </div>
        </div>
      </div>

      {/* Diff toggle */}
      {(opt.currentValue || opt.proposedValue) && (
        <div className="mb-4">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-2"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {expanded ? 'Hide' : 'Show'} proposed change
          </button>
          {expanded && (
            <DiffView
              current={opt.currentValue ?? ''}
              proposed={opt.proposedValue}
            />
          )}
        </div>
      )}

      {/* Actions */}
      {opt.status === 'pending' && (
        <div className="flex items-center gap-2 pt-3 border-t border-[var(--border)]">
          <Button
            size="sm"
            className="gap-1.5"
            disabled={isApplying || isDismissing}
            onClick={onApply}
          >
            {isApplying ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Apply to bot
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-[var(--text-muted)]"
            disabled={isApplying || isDismissing}
            onClick={onDismiss}
          >
            {isDismissing ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
            Dismiss
          </Button>
          <span className="ml-auto text-[10px] text-[var(--text-muted)]">
            {opt.kind === 'system_prompt' ? 'Will update system prompt' : opt.kind}
          </span>
        </div>
      )}

      {opt.status === 'applied' && opt.appliedAt && (
        <p className="text-[10px] text-[var(--text-muted)] pt-2 border-t border-[var(--border)] mt-3">
          Applied {new Date(opt.appliedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function OptimizationsPage() {
  const selectedBotId = useAppStore((s: { selectedBotId: string | null }) => s.selectedBotId) ?? ''
  const [filter, setFilter] = useState<string>('pending')

  const { data: opts = [], isLoading, refetch } = useOptimizations(selectedBotId, filter || undefined)
  const apply   = useApplyOptimization(selectedBotId)
  const dismiss = useDismissOptimization(selectedBotId)

  const pending   = opts.filter((o) => o.status === 'pending').length
  const applied   = opts.filter((o) => o.status === 'applied').length
  const dismissed = opts.filter((o) => o.status === 'dismissed').length

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <div className="flex items-center justify-between pb-3">
          <div>
            <h1 className="text-base font-semibold text-[var(--text-primary)]">Configure</h1>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Learn from real chats, then review prompt suggestions. Changes stay supervised — review before they go live.
            </p>
          </div>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => refetch()}>
            <RefreshCcw size={13} /> Refresh
          </Button>
        </div>
        <SubNav items={SUBNAV} />
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-6">
          <LearnFromChats />
        </div>

        <p className="mb-3 text-sm font-medium text-[var(--text-primary)]">Prompt suggestions</p>
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          {[
            { label: 'Pending',   value: pending,   key: 'pending',   color: 'text-[var(--accent)]' },
            { label: 'Applied',   value: applied,   key: 'applied',   color: 'text-[var(--success)]' },
            { label: 'Dismissed', value: dismissed, key: 'dismissed', color: 'text-[var(--text-muted)]' },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setFilter(filter === s.key ? '' : s.key)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-md)] border text-xs font-medium transition-colors',
                filter === s.key
                  ? 'border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
              )}
            >
              <span className={cn('text-base font-bold', s.color)}>{s.value}</span>
              {s.label}
            </button>
          ))}
        </div>

        {!selectedBotId && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-[var(--text-muted)]">
            <Sparkles size={36} />
            <p className="text-sm">Select a bot to view its optimizations.</p>
          </div>
        )}

        {selectedBotId && isLoading && (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading…
          </div>
        )}

        {selectedBotId && !isLoading && opts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="p-4 rounded-full bg-[var(--bg-overlay)]">
              <Sparkles size={32} className="text-[var(--text-muted)]" />
            </div>
            <div>
              <p className="font-semibold text-[var(--text-primary)] mb-1">No prompt suggestions yet</p>
              <p className="text-sm text-[var(--text-muted)] max-w-sm">
                {filter === 'pending'
                  ? 'Prompt suggestions appear after conversations are resolved with helpful ratings. Learn from chats above can draft a shorter chart in the meantime.'
                  : `No ${filter} prompt suggestions.`}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {opts.map((opt) => (
            <OptimizationCard
              key={opt.id}
              opt={opt}
              onApply={() => apply.mutate(opt.id)}
              onDismiss={() => dismiss.mutate(opt.id)}
              isApplying={apply.isPending && apply.variables === opt.id}
              isDismissing={dismiss.isPending && dismiss.variables === opt.id}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
