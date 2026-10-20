import React, { useState } from 'react'
import { Brain, Loader2, RefreshCw, X } from 'lucide-react'
import { Button, cn } from '@ybot/ui'
import type { MemoryFact } from '../lib/api'
import { useForgetMemory } from '../lib/hooks'

/** What bots remember about one contact, with delete and "forget everything". */
export function RememberedFacts({ contactId, facts, loading, error, onRetry, compact = false }: {
  contactId: string | null | undefined
  facts: MemoryFact[] | undefined
  loading: boolean
  error: boolean
  onRetry: () => void
  compact?: boolean
}) {
  const forget = useForgetMemory()
  const [confirming, setConfirming] = useState(false)
  const rows = facts ?? []

  return (
    <div className="space-y-2" data-testid="remembered-facts">
      <div className="flex items-center justify-between">
        <p className={cn('flex items-center gap-1.5 font-medium uppercase text-[var(--text-muted)]', compact ? 'text-[10px]' : 'text-xs')}>
          <Brain size={compact ? 11 : 12} /> Remembered
        </p>
        {contactId && rows.length > 0 && !confirming && (
          <button className="text-[11px] text-[var(--error)] hover:underline" onClick={() => setConfirming(true)}>Forget everything</button>
        )}
      </div>
      {confirming && contactId && (
        <div className="rounded-[var(--radius-md)] border border-[var(--error)]/40 bg-[var(--error-muted)] p-2 text-[11px] text-[var(--text-primary)]">
          {rows.length === 1 ? 'Delete the remembered answer?' : `Delete all ${rows.length} remembered answers?`} The bot asks again next time.
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" variant="destructive" disabled={forget.isPending} onClick={() => forget.mutate({ contactId }, { onSuccess: () => setConfirming(false) })}>Forget everything</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {loading ? (
        <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><Loader2 size={12} className="animate-spin" /> Loading…</p>
      ) : error ? (
        <p className="text-xs text-[var(--error)]">
          Could not load what is remembered. <button className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline" onClick={onRetry}><RefreshCw size={10} /> Retry</button>
        </p>
      ) : !contactId ? (
        <p className="text-xs text-[var(--text-muted)]">This chat has no contact, so nothing is remembered.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">Nothing remembered yet. Bots keep the answers listed under Safety → Contact memory.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((fact) => (
            <li key={fact.key} className="group flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border)] px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] text-[var(--text-muted)]">contact.{fact.key}</p>
                <p className="break-words text-xs text-[var(--text-primary)]">{fact.value}</p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {fact.botName ? `${fact.botName} · ` : ''}{new Date(fact.updatedAt).toLocaleDateString()}
                  {fact.expiresAt ? ` · forgotten ${new Date(fact.expiresAt).toLocaleDateString()}` : ''}
                </p>
              </div>
              <button
                aria-label={`Forget ${fact.key}`}
                className="mt-0.5 text-[var(--text-muted)] hover:text-[var(--error)]"
                disabled={forget.isPending}
                onClick={() => contactId && forget.mutate({ contactId, key: fact.key })}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {forget.error && <p className="text-[11px] text-[var(--error)]">{forget.error instanceof Error ? forget.error.message : 'That did not work. Try again.'}</p>}
    </div>
  )
}
