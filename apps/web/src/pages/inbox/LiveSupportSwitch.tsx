import React from 'react'
import { Headset, Loader2 } from 'lucide-react'
import { cn } from '@botstudio/ui'
import { useLiveSupport, useSaveLiveSupport } from '../../lib/hooks'
import { liveSupportLabel } from '../../lib/live-support-format'
import { useAppStore } from '../../store/app'

const CAN_SWITCH = new Set(['SUPERVISOR', 'ADMIN'])

const DOT: Record<string, string> = {
  open: 'bg-[var(--success,#22c55e)]',
  closed: 'bg-[var(--warning,#fbbf24)]',
  off: 'bg-[var(--text-muted)]',
}

/** The one switch for handing chats to people. Opening hours, if set, decide within "on". */
export function LiveSupportSwitch() {
  const role = useAppStore((s) => s.user?.role ?? '')
  const { data: live, isLoading } = useLiveSupport()
  const save = useSaveLiveSupport()
  if (isLoading || !live) return null

  const label = liveSupportLabel(live)
  const canSwitch = CAN_SWITCH.has(role)
  const busy = save.isPending
  const title = canSwitch
    ? `${label.detail} Click to turn live support ${live.enabled ? 'off' : 'on'}.`
    : `${label.detail} A supervisor or admin can change this.`

  return (
    <button
      type="button"
      role="switch"
      aria-checked={live.enabled}
      aria-label="Live support"
      title={title}
      disabled={!canSwitch || busy}
      onClick={() => save.mutate({ enabled: !live.enabled })}
      className={cn(
        'mr-1 flex h-7 items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-2.5 text-xs font-medium transition-colors',
        canSwitch ? 'hover:bg-[var(--bg-hover)]' : 'cursor-default',
        live.enabled ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]',
      )}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Headset size={12} />}
      <span className={cn('h-2 w-2 rounded-full', DOT[label.tone])} aria-hidden />
      <span>{label.short}</span>
      <span
        aria-hidden
        className={cn(
          'relative ml-1 inline-flex h-4 w-7 items-center rounded-full transition-colors',
          live.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--border)]',
        )}
      >
        <span className={cn('absolute h-3 w-3 rounded-full bg-white transition-transform', live.enabled ? 'translate-x-3.5' : 'translate-x-0.5')} />
      </span>
    </button>
  )
}
