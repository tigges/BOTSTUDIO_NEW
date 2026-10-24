import React, { useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { Bell, BellOff, Settings2 } from 'lucide-react'
import { cn } from '@botstudio/ui'
import { handoverSoundOn, setHandoverSound } from '../../lib/handover-alert'
import { LiveSupportSwitch } from './LiveSupportSwitch'

const TABS = [
  { label: 'Chats', path: '/inbox/chats' },
  { label: 'Tasks', path: '/inbox/tasks' },
  { label: 'Contacts', path: '/inbox/contacts' },
] as const

/** The tone when a chat is handed to a person, on or off for this browser. */
function HandoverSoundSwitch() {
  const [on, setOn] = useState(handoverSoundOn)
  const label = on ? 'Sound on when a chat is handed to a person. Click to mute.' : 'Sound off for handed-over chats. Click to turn it on.'
  return (
    <button
      type="button"
      onClick={() => { setHandoverSound(!on); setOn(!on) }}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className="flex h-7 w-7 items-center justify-center rounded-[var(--radius)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
    >
      {on ? <Bell size={14} /> : <BellOff size={14} />}
    </button>
  )
}

/** One Inbox: live chats first, then follow-up tasks and the people behind them. Settings sit behind the gear. */
export function InboxTabs({ actions }: { actions?: React.ReactNode }) {
  const { pathname } = useLocation()
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4">
      <h1 className="mr-3 text-sm font-semibold text-[var(--text-primary)]">Inbox</h1>
      <nav className="flex items-center gap-1" aria-label="Inbox">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.path)
          return (
            <Link
              key={tab.path}
              to={tab.path}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-[var(--radius)] px-2.5 py-1 text-xs font-medium transition-colors',
                active ? 'bg-[var(--bg-selected)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <LiveSupportSwitch />
        <HandoverSoundSwitch />
        {actions}
        <Link
          to="/inbox/settings"
          title="Inbox settings: live support, opening hours, reply times, saved replies"
          aria-label="Inbox settings"
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-[var(--radius)] transition-colors',
            pathname.startsWith('/inbox/settings') ? 'bg-[var(--bg-selected)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
          )}
        >
          <Settings2 size={14} />
        </Link>
      </div>
    </div>
  )
}
