import React, { useEffect, useState } from 'react'
import { AlertCircle, ChevronDown, Inbox, Plus, Search, SearchX } from 'lucide-react'
import { Avatar, Button, Input, Skeleton, cn } from '@ybot/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@ybot/ui'
import { DEFAULT_INBOX_FILTERS, SORT_LABELS, listState, type InboxFilters, type InboxSort, type InboxView } from '../../lib/inbox-list'
import { ChannelIcon, SlaChip, TestRunChip, type Convo } from './chat-model'

const VIEWS: Array<{ id: InboxView; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'escalated', label: 'Escalated' },
]

const SEARCH_DELAY_MS = 300

export function ChatList(props: {
  chats: Convo[]
  /** Chats loaded before the view tab is applied. */
  total: number
  testRunChats: number
  filters: InboxFilters
  onFilters: (filters: InboxFilters) => void
  loading: boolean
  error: boolean
  onRetry: () => void
  selectedId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}) {
  const { filters, onFilters } = props
  const [typed, setTyped] = useState(filters.search)

  useEffect(() => {
    if (typed === filters.search) return
    const timer = setTimeout(() => onFilters({ ...filters, search: typed }), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [typed]) // eslint-disable-line react-hooks/exhaustive-deps

  const state = listState({ loading: props.loading, error: props.error, total: props.total, shown: props.chats.length, filters })
  const clear = () => {
    setTyped('')
    onFilters({ ...DEFAULT_INBOX_FILTERS, sort: filters.sort, showTestRuns: filters.showTestRuns })
  }

  return (
    <div className="flex w-[280px] flex-col border-r border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
      <div className="p-3 space-y-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-1.5">
          <Input
            placeholder="Search name, email or message…"
            aria-label="Search chats"
            leftIcon={<Search size={13} />}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0" onClick={props.onNew} title="New conversation" aria-label="New conversation">
            <Plus size={14} />
          </Button>
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Show">
          {VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={filters.view === view.id}
              onClick={() => onFilters({ ...filters, view: view.id })}
              className={cn(
                'flex-1 rounded py-0.5 text-[11px] font-medium transition-colors',
                filters.view === view.id ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]',
              )}
            >
              {view.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <input type="checkbox" checked={filters.showTestRuns} onChange={(event) => onFilters({ ...filters, showTestRuns: event.target.checked })} />
          Show test-run chats{!filters.showTestRuns && props.testRunChats > 0 ? ` (${props.testRunChats} hidden)` : ''}
        </label>
      </div>

      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] text-[var(--text-muted)]">{state === 'loading' ? 'Loading…' : `${props.chats.length} chat${props.chats.length === 1 ? '' : 's'}`}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex items-center gap-0.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
              {SORT_LABELS[filters.sort]} <ChevronDown size={10} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(Object.keys(SORT_LABELS) as InboxSort[]).map((sort) => (
              <DropdownMenuItem key={sort} onClick={() => onFilters({ ...filters, sort })}>{SORT_LABELS[sort]}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
        {state === 'loading' && Array.from({ length: 5 }).map((_, i) => <div key={i} className="p-3"><Skeleton className="h-12 w-full rounded-[var(--radius)]" /></div>)}
        {state === 'error' && (
          <ListMessage icon={<AlertCircle size={18} />} title="Chats could not be loaded" body="Check your connection, then try again.">
            <Button size="sm" variant="secondary" onClick={props.onRetry}>Retry</Button>
          </ListMessage>
        )}
        {state === 'empty' && (
          <ListMessage
            icon={<Inbox size={18} />}
            title="No chats yet"
            body={props.testRunChats > 0 && !filters.showTestRuns
              ? `Only test-run chats so far (${props.testRunChats}). Real visitors show up here as soon as they write.`
              : 'Chats appear here when a visitor writes, or when the bot hands a chat to a person.'}
          />
        )}
        {state === 'no-match' && (
          <ListMessage icon={<SearchX size={18} />} title="No chats match" body={filters.search.trim() ? `Nothing for “${filters.search.trim()}” in this view.` : 'Nothing in this view.'}>
            <Button size="sm" variant="secondary" onClick={clear}>Show all chats</Button>
          </ListMessage>
        )}
        {state === 'rows' && props.chats.map((conv) => (
          <button
            key={conv.id}
            type="button"
            data-convo-id={conv.id}
            data-selected={props.selectedId === conv.id ? 'true' : 'false'}
            onClick={() => props.onSelect(conv.id)}
            className={cn(
              'flex w-full items-start gap-2.5 px-3 py-3 text-left transition-colors',
              props.selectedId === conv.id ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]',
            )}
          >
            <div className="relative shrink-0 mt-0.5">
              <Avatar name={conv.name} size="sm" />
              <span className={cn(
                'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-surface)]',
                conv.status === 'active' ? 'bg-[var(--success)]'
                  : conv.status === 'escalated' ? 'bg-[var(--error)]'
                    : conv.status === 'pending' ? 'bg-[var(--warning,#fbbf24)]'
                      : 'bg-[var(--text-muted)]',
              )} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{conv.name}</span>
                <span className="text-[11px] text-[var(--text-muted)] shrink-0">{conv.time}</span>
              </div>
              <p className="mt-0.5 text-[12px] text-[var(--text-muted)] truncate">{conv.message}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <ChannelIcon ch={conv.channel} />
                {conv.sla && <SlaChip sla={conv.sla} />}
                {conv.testRun && <TestRunChip />}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function ListMessage(props: { icon: React.ReactNode; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="text-[var(--text-muted)]">{props.icon}</span>
      <p className="text-sm font-medium text-[var(--text-primary)]">{props.title}</p>
      <p className="text-xs text-[var(--text-muted)]">{props.body}</p>
      {props.children}
    </div>
  )
}
