export interface TabItem {
  label: string
  path: string
}

/** A rail item stays lit on its own pages: Journey owns every flow, Knowledge every knowledge tab. */
export function navItemActive(id: string, path: string, pathname: string): boolean {
  if (id === 'journey') return pathname === path || pathname === '/build/flows' || pathname.startsWith('/build/flows/')
  if (id === 'knowledge') return pathname === '/build/knowledge' || pathname.startsWith('/build/knowledge/')
  return pathname === path || pathname.startsWith(path + '/')
}

const CORE_TABS: TabItem[] = [
  { label: 'Sources', path: '/build/knowledge/sources' },
  { label: 'Documents', path: '/build/knowledge/documents' },
  { label: 'Search & Test', path: '/build/knowledge/search' },
]

/**
 * Intents and Entities only show for a bot that has some, or while one of them is open;
 * most bots answer from sources and never need them.
 */
export function knowledgeTabs(counts: { intents?: number; entities?: number }, pathname: string): TabItem[] {
  const tabs = [...CORE_TABS]
  if ((counts.intents ?? 0) > 0 || pathname.startsWith('/build/knowledge/intents')) tabs.push({ label: 'Intents', path: '/build/knowledge/intents' })
  if ((counts.entities ?? 0) > 0 || pathname.startsWith('/build/knowledge/entities')) tabs.push({ label: 'Entities', path: '/build/knowledge/entities' })
  return tabs
}
