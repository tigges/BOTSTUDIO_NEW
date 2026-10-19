/**
 * The handover contract: what the bot hands a person, and how the person hands it back.
 *
 * A Handover step (or the always-human word list) produces a request. The API adds the
 * summary and saves the contract on the chat, where the Inbox header shows it.
 */

export const HANDOVER_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export type HandoverPriority = typeof HANDOVER_PRIORITIES[number]

/** How a person hands the chat back. */
export const RETURN_OUTCOMES = ['resolved', 'needs_bot', 'needs_follow_up'] as const
export type ReturnOutcome = typeof RETURN_OUTCOMES[number]

/** The full transcript travels unless the step opts into the summary alone. */
export const HANDOVER_CONTEXTS = ['full_transcript', 'summary_only'] as const
export type HandoverContext = typeof HANDOVER_CONTEXTS[number]

export interface HandoverRouting {
  queue: string
  skills: string[]
  /** Higher is more urgent. Follows the priority unless the step sets it. */
  priority: number
}

export interface HandoverRequest {
  reason: string
  priority: HandoverPriority
  tags: string[]
  /** Written on the step. Empty means the API writes one from the chat. */
  summary: string
  variables: Record<string, string>
  routing: HandoverRouting
  context: HandoverContext
}

export interface HandoverReturn {
  outcome: ReturnOutcome
  note?: string
  by?: string
  at: string
}

export interface HandoverContract extends HandoverRequest {
  at: string
  /** The step or rule that asked for a person. */
  source: 'journey' | 'always_human'
  returned?: HandoverReturn
}

export const DEFAULT_HANDOVER_REASON = 'The guest asked for a person.'
export const DEFAULT_QUEUE = 'support'

const ROUTING_PRIORITY: Record<HandoverPriority, number> = { low: 1, medium: 2, high: 3, critical: 4 }

const LEGACY_PRIORITY: Record<string, HandoverPriority> = {
  normal: 'medium',
  urgent: 'high',
}

export const RETURN_LABELS: Record<ReturnOutcome, string> = {
  resolved: 'Resolved',
  needs_bot: 'Back to the bot',
  needs_follow_up: 'Needs follow-up',
}

/** The priority a step names, or undefined when it names one the contract does not have. */
export function handoverPriority(raw: unknown): HandoverPriority | undefined {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return 'medium'
  if ((HANDOVER_PRIORITIES as readonly string[]).includes(value)) return value as HandoverPriority
  return LEGACY_PRIORITY[value]
}

export function handoverContext(raw: unknown): HandoverContext | undefined {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return 'full_transcript'
  return (HANDOVER_CONTEXTS as readonly string[]).includes(value) ? value as HandoverContext : undefined
}

export function handoverList(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[,\n]/)
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** Captured answers worth passing on: not internal (_x), not empty, not objects. */
function capturedValues(flow: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(flow)) {
    if (key.startsWith('_') || key === 'handed_over') continue
    if (value == null || typeof value === 'object') continue
    const text = clip(String(value), 200)
    if (text) out[key] = text
  }
  return out
}

/**
 * The request a Handover step makes. Older steps saved team and note; they become
 * the queue and the reason. `fill` resolves {{tokens}} in the reason and summary.
 */
export function handoverFromConfig(
  config: Record<string, unknown>,
  flow: Record<string, unknown> = {},
  fill: (text: string) => string = (text) => text,
): HandoverRequest {
  const priority = handoverPriority(config['priority']) ?? 'medium'
  const named = handoverList(config['variables'])
  const captured = capturedValues(flow)
  let variables = captured
  if (named.length) {
    variables = {}
    for (const name of named) {
      const key = name.replace(/^flow\./, '')
      if (captured[key]) variables[key] = captured[key]
    }
  }
  const queuePriority = Number(config['queuePriority'])
  return {
    reason: clip(fill(String(config['reason'] ?? config['note'] ?? '')), 300) || DEFAULT_HANDOVER_REASON,
    priority,
    tags: handoverList(config['tags']),
    summary: clip(fill(String(config['summary'] ?? '')), 600),
    variables,
    routing: {
      queue: String(config['queue'] ?? config['team'] ?? '').trim() || DEFAULT_QUEUE,
      skills: handoverList(config['skills']),
      priority: Number.isFinite(queuePriority) && queuePriority > 0 ? Math.round(queuePriority) : ROUTING_PRIORITY[priority],
    },
    context: handoverContext(config['context']) ?? 'full_transcript',
  }
}

/** The request the always-human word list makes when the guest uses one of its words. */
export function alwaysHumanRequest(word: string): HandoverRequest {
  return {
    reason: `The guest wrote “${word}”, which is on the always-human list.`,
    priority: 'high',
    tags: ['always-human'],
    summary: '',
    variables: {},
    routing: { queue: DEFAULT_QUEUE, skills: [], priority: ROUTING_PRIORITY.high },
    context: 'full_transcript',
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The first word or phrase on the list the guest used, matched as whole words in any case. */
export function alwaysHumanMatch(text: string, words: readonly string[]): string | undefined {
  const heard = text.toLowerCase()
  for (const word of words) {
    const phrase = word.trim().toLowerCase()
    if (!phrase) continue
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(phrase).replace(/\s+/g, '\\s+')}(?=$|[^\\p{L}\\p{N}])`, 'u')
    if (pattern.test(heard)) return word.trim()
  }
  return undefined
}

function spokenKey(key: string): string {
  return key.replace(/[_.]+/g, ' ').trim()
}

/** A short note for the person picking the chat up, written from the guest's own lines. */
export function handoverSummary(guestLines: readonly string[], variables: Record<string, string>): string {
  const lines = guestLines.map((line) => clip(line, 160)).filter(Boolean)
  const parts: string[] = []
  if (lines[0]) parts.push(`Opened with “${lines[0]}”.`)
  if (lines.length > 1) parts.push(`Latest: “${lines[lines.length - 1]}”.`)
  const known = Object.entries(variables).slice(0, 6).map(([key, value]) => `${spokenKey(key)}: ${value}`)
  if (known.length) parts.push(`Known: ${known.join('; ')}.`)
  return clip(parts.join(' '), 600) || 'The guest has not written anything yet.'
}
