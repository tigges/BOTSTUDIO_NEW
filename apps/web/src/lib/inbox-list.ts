export type InboxView = 'all' | 'mine' | 'unassigned' | 'escalated'
export type InboxSort = 'newest' | 'oldest' | 'sla'

export interface InboxFilters {
  view: InboxView
  search: string
  sort: InboxSort
  showTestRuns: boolean
}

export const DEFAULT_INBOX_FILTERS: InboxFilters = { view: 'all', search: '', sort: 'newest', showTestRuns: false }

export const SORT_LABELS: Record<InboxSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  sla: 'Reply time running out first',
}

/** What the API filters. Views (mine, unassigned, escalated) are applied on the loaded page. */
export function inboxParams(filters: InboxFilters): Record<string, string> {
  return {
    ...(filters.search.trim() ? { q: filters.search.trim() } : {}),
    ...(filters.showTestRuns ? {} : { testRuns: 'exclude' }),
    ...(filters.sort === 'oldest' ? { sort: 'oldest' } : {}),
  }
}

export function isFiltered(filters: InboxFilters): boolean {
  return filters.view !== 'all' || filters.search.trim() !== ''
}

interface Slaable { sla?: string | null }

/** "Breached" first, then chats with a reply clock running, then the rest; ties keep the API order. */
export function orderBySla<T extends Slaable>(chats: T[]): T[] {
  const rank = (chat: T) => (chat.sla === 'Breached' ? 0 : chat.sla ? 1 : 2)
  return chats.map((chat, index) => ({ chat, index })).sort((a, b) => rank(a.chat) - rank(b.chat) || a.index - b.index).map(({ chat }) => chat)
}

export type ListState = 'loading' | 'error' | 'empty' | 'no-match' | 'rows'

/** Which of the four list states to show. A filter that hides everything is not the same as an empty Inbox. */
export function listState(input: { loading: boolean; error: boolean; total: number; shown: number; filters: InboxFilters }): ListState {
  if (input.loading) return 'loading'
  if (input.error) return 'error'
  if (input.shown > 0) return 'rows'
  return input.total > 0 || isFiltered(input.filters) ? 'no-match' : 'empty'
}
