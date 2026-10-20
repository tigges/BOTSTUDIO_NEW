/**
 * Contact memory: answers a bot keeps per contact across chats. The bot
 * remembers the flow variables on its list when a turn ends and recalls them
 * as {{contact.<key>}} when the same contact starts a new chat.
 */

export interface MemorySettings {
  enabled: boolean
  /** Flow variable names to remember, for example email or preferred_stylist. */
  keys: string[]
  /** A remembered answer is forgotten this many days after it was last given. */
  days: number
}

export const DEFAULT_MEMORY: MemorySettings = { enabled: false, keys: [], days: 365 }

export const MEMORY_MAX_KEYS = 30
export const MEMORY_MAX_DAYS = 3_650
export const MEMORY_VALUE_MAX = 500
/** contact.name comes from the chat itself; it is never remembered as a fact. */
export const MEMORY_RESERVED_KEYS = ['name'] as const

const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

export function parseMemorySettings(raw: unknown): MemorySettings {
  const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const keys = Array.isArray(row['keys'])
    ? [...new Set((row['keys'] as unknown[]).filter((key): key is string => typeof key === 'string').map((key) => key.trim()).filter(Boolean))]
    : []
  const days = typeof row['days'] === 'number' && Number.isFinite(row['days']) ? Math.round(row['days'] as number) : DEFAULT_MEMORY.days
  return {
    enabled: row['enabled'] === true,
    keys: keys.slice(0, MEMORY_MAX_KEYS),
    days: Math.min(MEMORY_MAX_DAYS, Math.max(1, days)),
  }
}

export interface MemoryIssue {
  field: string
  message: string
}

/** Everything that blocks saving the memory settings, naming the field to fix. */
export function memoryIssues(settings: { enabled: boolean; keys: string[]; days: number }): MemoryIssue[] {
  const issues: MemoryIssue[] = []
  if (settings.keys.length > MEMORY_MAX_KEYS) issues.push({ field: 'keys', message: `Answers to remember: keep it to ${MEMORY_MAX_KEYS} or fewer.` })
  settings.keys.forEach((key, index) => {
    if (!KEY.test(key)) issues.push({ field: `keys.${index}`, message: `Answer ${index + 1}: "${key}" is not a variable name. Use letters, digits and underscores.` })
    else if ((MEMORY_RESERVED_KEYS as readonly string[]).includes(key)) issues.push({ field: `keys.${index}`, message: `Answer ${index + 1}: the contact's name is kept already. Remove "${key}".` })
    else if (key.startsWith('_')) issues.push({ field: `keys.${index}`, message: `Answer ${index + 1}: "${key}" is internal to the bot and cannot be remembered.` })
  })
  if (!Number.isInteger(settings.days) || settings.days < 1 || settings.days > MEMORY_MAX_DAYS) {
    issues.push({ field: 'days', message: `Forget after: enter a number of days between 1 and ${MEMORY_MAX_DAYS}.` })
  }
  if (settings.enabled && settings.keys.length === 0) issues.push({ field: 'keys', message: 'Answers to remember: add at least one variable, or turn memory off.' })
  return issues
}

function factValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > MEMORY_VALUE_MAX) return undefined
  return text
}

/** The answers on the list that this turn's variables hold. */
export function factsToRemember(settings: MemorySettings, flow: Record<string, unknown>): Array<{ key: string; value: string }> {
  if (!settings.enabled) return []
  const facts: Array<{ key: string; value: string }> = []
  for (const key of settings.keys) {
    if ((MEMORY_RESERVED_KEYS as readonly string[]).includes(key) || key.startsWith('_')) continue
    const value = factValue(flow[key])
    if (value !== undefined) facts.push({ key, value })
  }
  return facts
}

/** What a new chat starts with in contact.*: the bot's own keys, not expired. */
export function recallFacts(
  settings: MemorySettings,
  rows: Array<{ key: string; value: string; expiresAt: Date | string | null }>,
  now: Date,
): Record<string, string> {
  if (!settings.enabled) return {}
  const wanted = new Set(settings.keys)
  const out: Record<string, string> = {}
  for (const row of rows) {
    if (!wanted.has(row.key)) continue
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) continue
    out[row.key] = row.value
  }
  return out
}

export function memoryExpiry(settings: MemorySettings, now: Date): Date {
  return new Date(now.getTime() + settings.days * 86_400_000)
}

/** Variables the journey asks for or sets: the choices for "answers to remember". */
export function journeyVariables(graphs: Array<{ nodes?: Array<{ data?: { kind?: string; config?: Record<string, unknown> } }> }>): string[] {
  const names = new Set<string>()
  for (const graph of graphs) {
    for (const node of graph.nodes ?? []) {
      const kind = node.data?.kind
      if (kind !== 'ask_question' && kind !== 'set_variable') continue
      const variable = node.data?.config?.['variable']
      if (typeof variable === 'string' && KEY.test(variable.trim()) && !variable.startsWith('_')) names.add(variable.trim())
    }
  }
  return [...names].sort()
}
