/**
 * What the ⌘K palette offers and how a typed query ranks it. Pure, so the
 * component only renders and runs the chosen command.
 */

export type CommandGroup = 'Actions' | 'Pages' | 'Bots' | 'Flows'
export const COMMAND_GROUPS: CommandGroup[] = ['Actions', 'Pages', 'Bots', 'Flows']

export type CommandTarget =
  | { kind: 'path'; to: string }
  | { kind: 'bot'; botId: string }
  | { kind: 'env'; env: 'sandbox' | 'production' }

export interface PaletteCommand {
  id: string
  group: CommandGroup
  label: string
  /** Where it sits, shown greyed on the right. */
  hint?: string
  keywords?: string[]
  target: CommandTarget
}

export interface PaletteSources {
  pages: Array<{ id: string; label: string; path: string; section?: string }>
  bots: Array<{ id: string; name: string }>
  selectedBotId: string | null
  flows: Array<{ id: string; name: string }>
  selectedEnv: 'sandbox' | 'production'
  canBuild: boolean
}

export function paletteCommands(src: PaletteSources): PaletteCommand[] {
  const actions: PaletteCommand[] = [
    { id: 'act-inbox', group: 'Actions', label: 'Open waiting chats', hint: 'Inbox', keywords: ['handover', 'reply', 'human'], target: { kind: 'path', to: '/inbox/chats' } },
    { id: 'act-task', group: 'Actions', label: 'Create a task', hint: 'Inbox', keywords: ['ticket', 'follow-up', 'new'], target: { kind: 'path', to: '/inbox/tickets' } },
    { id: 'act-test', group: 'Actions', label: 'Try the bot in Sandbox', hint: 'Journey', keywords: ['test', 'chat', 'preview'], target: { kind: 'path', to: '/build/journey' } },
    src.selectedEnv === 'sandbox'
      ? { id: 'act-env', group: 'Actions', label: 'Switch to Production', keywords: ['environment', 'live'], target: { kind: 'env', env: 'production' } }
      : { id: 'act-env', group: 'Actions', label: 'Switch to Sandbox', keywords: ['environment', 'draft', 'test'], target: { kind: 'env', env: 'sandbox' } },
  ]
  if (src.canBuild) {
    actions.push(
      { id: 'act-publish', group: 'Actions', label: 'Publish to Production', hint: 'Releases', keywords: ['release', 'deploy', 'go live', 'rollback'], target: { kind: 'path', to: '/build/releases' } },
      { id: 'act-new-bot', group: 'Actions', label: 'Create a bot', keywords: ['new', 'add'], target: { kind: 'path', to: '/bots/new' } },
      { id: 'act-knowledge', group: 'Actions', label: 'Add knowledge', hint: 'Knowledge', keywords: ['document', 'website', 'source', 'upload'], target: { kind: 'path', to: '/build/knowledge/sources' } },
    )
  }
  const pages: PaletteCommand[] = src.pages.map((page) => ({
    id: `page-${page.id}`,
    group: 'Pages',
    label: page.label,
    hint: page.section,
    target: { kind: 'path', to: page.path },
  }))
  const bots: PaletteCommand[] = src.bots
    .filter((bot) => bot.id !== src.selectedBotId)
    .map((bot) => ({ id: `bot-${bot.id}`, group: 'Bots', label: `Switch to ${bot.name}`, keywords: [bot.name], target: { kind: 'bot', botId: bot.id } }))
  const flows: PaletteCommand[] = src.flows.map((flow) => ({
    id: `flow-${flow.id}`,
    group: 'Flows',
    label: flow.name,
    hint: 'Open on the canvas',
    keywords: ['flow', 'journey'],
    target: { kind: 'path', to: `/build/flows/${flow.id}` },
  }))
  return [...actions, ...pages, ...bots, ...flows]
}

/**
 * 0 means no match. Whole-label prefix beats a word prefix, which beats a
 * substring, which beats the letters appearing in order from the start of a word.
 */
export function matchScore(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const t = text.toLowerCase()
  if (t.startsWith(q)) return 100 - Math.min(t.length - q.length, 50) / 10
  if (t.split(/[\s/·-]+/).some((word) => word.startsWith(q))) return 70
  if (t.includes(q)) return 50
  const letters = q.replace(/\s+/g, '')
  const starts = [0, ...[...t.matchAll(/[\s/·-]+/g)].map((m) => m.index! + m[0].length)]
  let at = starts.find((i) => t[i] === letters[0]) ?? -1
  if (at < 0) return 0
  for (const ch of letters) {
    at = t.indexOf(ch, at)
    if (at < 0) return 0
    at += 1
  }
  return 20
}

function commandScore(query: string, cmd: PaletteCommand): number {
  const fromLabel = matchScore(query, cmd.label)
  const fromHint = cmd.hint ? matchScore(query, cmd.hint) * 0.6 : 0
  const fromKeywords = Math.max(0, ...(cmd.keywords ?? []).map((word) => matchScore(query, word) * 0.8))
  return Math.max(fromLabel, fromHint, fromKeywords)
}

/** With no query, groups keep their order and each group is capped; with a query, the best matches lead. */
export function rankCommands(query: string, commands: PaletteCommand[], perGroup = 6): PaletteCommand[] {
  if (!query.trim()) {
    return COMMAND_GROUPS.flatMap((group) => commands.filter((cmd) => cmd.group === group).slice(0, perGroup))
  }
  return commands
    .map((cmd, index) => ({ cmd, index, score: commandScore(query, cmd) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 30)
    .map((row) => row.cmd)
}

export function isPaletteShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)
}
