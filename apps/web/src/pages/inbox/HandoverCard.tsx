import React, { useState } from 'react'
import { ArrowLeftRight, Bot, CheckCheck, ClipboardList, Hand } from 'lucide-react'
import { Badge, Button } from '@ybot/ui'
import { RETURN_LABELS, type HandoverContract, type ReturnOutcome } from '@ybot/shared'
import { contextLine, held, priorityTone, returnedLine, routingLine, sourceLine } from '../../lib/handover-format'

interface HandoverCardProps {
  chat: { status: string; assignedTo?: string | null; handover?: Partial<HandoverContract> | null }
  memberName: (id: string | undefined) => string | undefined
  busy: boolean
  error?: string
  onHandBack: (outcome: ReturnOutcome, note: string) => void
}

const ACTIONS: Array<{ outcome: ReturnOutcome; icon: React.ReactNode; hint: string }> = [
  { outcome: 'resolved', icon: <CheckCheck size={12} />, hint: 'Close the chat as solved by the team.' },
  { outcome: 'needs_bot', icon: <Bot size={12} />, hint: 'The bot answers the guest’s next message.' },
  { outcome: 'needs_follow_up', icon: <ClipboardList size={12} />, hint: 'Close the chat and add a follow-up task.' },
]

export function HandoverCard({ chat, memberName, busy, error, onHandBack }: HandoverCardProps) {
  const [note, setNote] = useState('')
  const handover = chat.handover ?? undefined
  const returned = returnedLine(handover, memberName(handover?.returned?.by))
  const variables = Object.entries(handover?.variables ?? {})
  const canHandBack = held(chat)

  return (
    <div data-handover-card className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Hand size={13} className="text-[var(--accent)]" />
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          {handover?.reason ? 'Handed to the team' : 'You have this chat'}
        </span>
        {handover?.priority && <Badge variant={priorityTone(handover.priority)}>{handover.priority}</Badge>}
        {handover?.reason && <span className="text-[11px] text-[var(--text-muted)]">{sourceLine(handover.source)}</span>}
        {handover?.tags?.map((tag) => (
          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-overlay)] text-[var(--text-secondary)] border border-[var(--border)]">{tag}</span>
        ))}
      </div>

      {handover?.reason && (
        <div className="space-y-1">
          <p className="text-sm text-[var(--text-primary)]">{handover.reason}</p>
          {handover.summary && <p className="text-xs text-[var(--text-secondary)]">{handover.summary}</p>}
          <p className="text-[11px] text-[var(--text-muted)]">{routingLine(handover.routing)}</p>
          {variables.length > 0 && (
            <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
              {variables.map(([key, value]) => (
                <div key={key} className="flex gap-1">
                  <dt className="text-[var(--text-muted)]">{key.replace(/_/g, ' ')}</dt>
                  <dd className="text-[var(--text-primary)]">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-[11px] text-[var(--text-muted)]">{contextLine(handover.context)}</p>
        </div>
      )}

      {returned && !canHandBack && (
        <p className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1"><ArrowLeftRight size={11} /> Handed back: {returned}</p>
      )}

      {canHandBack && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the hand-back (optional)"
            maxLength={1000}
            className="flex-1 min-w-[180px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-2.5 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
          />
          {ACTIONS.map((action) => (
            <Button
              key={action.outcome}
              size="sm"
              variant={action.outcome === 'resolved' ? 'default' : 'secondary'}
              className="gap-1.5"
              title={action.hint}
              disabled={busy}
              onClick={() => { onHandBack(action.outcome, note.trim()); setNote('') }}
            >
              {action.icon}
              {RETURN_LABELS[action.outcome]}
            </Button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-[11px] text-[var(--error)]">{error}</p>}
    </div>
  )
}
