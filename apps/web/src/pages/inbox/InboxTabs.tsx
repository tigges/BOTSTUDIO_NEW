import React from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'
import { cn } from '@botstudio/ui'

const TABS = [
  { label: 'Chats', path: '/inbox/chats' },
  { label: 'Tasks', path: '/inbox/tasks' },
  { label: 'Contacts', path: '/inbox/contacts' },
] as const

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
        {actions}
        <Link
          to="/inbox/settings"
          title="Inbox settings: assignment, reply times, working hours, saved replies"
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
