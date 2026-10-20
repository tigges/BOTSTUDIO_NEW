/**
 * Content guardrails: rules about what may be said, checked on guest messages,
 * bot replies or both. One policy is active per bot.
 *
 * Business constraints (require / limit / block before an action) are a
 * different rule type that belongs to flow steps; they never share this list.
 */

import { DEFAULT_QUEUE, ROUTING_PRIORITY, type HandoverRequest } from './handover.js'
import { findPersonalData, PERSONAL_DATA_KINDS, type CustomPattern } from './privacy.js'

export const GUARDRAIL_ACTIONS = ['warn', 'block', 'redact', 'escalate', 'reask'] as const
export type GuardrailAction = (typeof GUARDRAIL_ACTIONS)[number]

export const GUARDRAIL_ACTION_LABELS: Record<GuardrailAction, string> = {
  warn: 'Warn',
  block: 'Block',
  redact: 'Redact',
  escalate: 'Escalate',
  reask: 'Reask',
}

export const GUARDRAIL_ACTION_HINTS: Record<GuardrailAction, string> = {
  warn: 'Let it through and flag the message in the Inbox.',
  block: 'Stop it and reply with the rule’s message instead.',
  redact: 'Replace the matching words with [redacted] and carry on.',
  escalate: 'Hand the chat to a person.',
  reask: 'Guest messages: ask the guest to rephrase. Bot replies: write the answer again once, then block.',
}

export const GUARDRAIL_SIDES = ['input', 'output', 'both'] as const
export type GuardrailSide = (typeof GUARDRAIL_SIDES)[number]

export const GUARDRAIL_SIDE_LABELS: Record<GuardrailSide, string> = {
  input: 'Guest messages',
  output: 'Bot replies',
  both: 'Both',
}

export type GuardrailCheck =
  | { kind: 'words'; words: string[] }
  | { kind: 'pattern'; pattern: string }
  | { kind: 'personal_data'; kinds: string[] }

export const GUARDRAIL_CHECK_LABELS: Record<GuardrailCheck['kind'], string> = {
  words: 'Words or phrases',
  pattern: 'Pattern',
  personal_data: 'Personal data',
}

export interface GuardrailRule {
  id: string
  name: string
  side: GuardrailSide
  check: GuardrailCheck
  action: GuardrailAction
  /** What the bot says when the rule blocks or asks again. Empty uses the default line. */
  message: string
  enabled: boolean
}

export const BLOCKED_INPUT_LINE = 'I can’t help with that here. Is there something else I can do for you?'
export const BLOCKED_OUTPUT_LINE = 'I can’t share that. Is there something else I can help with?'
export const REASK_LINE = 'Could you put that another way?'
export const REDACTED = '[redacted]'

/** New rules start on Warn so turning one on never silently stops live chats. */
export function newGuardrailRule(partial: Partial<GuardrailRule> & { id: string }): GuardrailRule {
  return {
    name: '',
    side: 'input',
    check: { kind: 'words', words: [] },
    action: 'warn',
    message: '',
    enabled: true,
    ...partial,
  }
}

function checkOf(raw: unknown): GuardrailCheck {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  if (row['kind'] === 'pattern') return { kind: 'pattern', pattern: typeof row['pattern'] === 'string' ? row['pattern'] : '' }
  if (row['kind'] === 'personal_data') {
    const kinds = Array.isArray(row['kinds']) ? (row['kinds'] as unknown[]).filter((k): k is string => typeof k === 'string') : []
    return { kind: 'personal_data', kinds }
  }
  const words = Array.isArray(row['words']) ? (row['words'] as unknown[]).filter((w): w is string => typeof w === 'string') : []
  return { kind: 'words', words: words.map((w) => w.trim()).filter(Boolean) }
}

export function parseGuardrailRules(raw: unknown): GuardrailRule[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const action = (GUARDRAIL_ACTIONS as readonly string[]).includes(row['action'] as string) ? row['action'] as GuardrailAction : 'warn'
    const side = (GUARDRAIL_SIDES as readonly string[]).includes(row['side'] as string) ? row['side'] as GuardrailSide : 'input'
    return [{
      id: typeof row['id'] === 'string' && row['id'] ? row['id'] : `rule-${index + 1}`,
      name: typeof row['name'] === 'string' ? row['name'] : '',
      side,
      check: checkOf(row['check']),
      action,
      message: typeof row['message'] === 'string' ? row['message'] : '',
      enabled: row['enabled'] !== false,
    }]
  })
}

export interface GuardrailIssue {
  ruleId: string
  field: 'name' | 'check' | 'message'
  message: string
}

export function guardrailIssues(rules: GuardrailRule[]): GuardrailIssue[] {
  const issues: GuardrailIssue[] = []
  for (const rule of rules) {
    const label = rule.name.trim() || 'This rule'
    if (!rule.name.trim()) issues.push({ ruleId: rule.id, field: 'name', message: 'Give the rule a name, for example "No competitor names".' })
    if (rule.check.kind === 'words' && rule.check.words.length === 0) {
      issues.push({ ruleId: rule.id, field: 'check', message: `${label} has no words to look for. Add at least one word or phrase.` })
    }
    if (rule.check.kind === 'pattern') {
      const pattern = rule.check.pattern
      let valid = true
      try { new RegExp(pattern) } catch { valid = false }
      if (!pattern) issues.push({ ruleId: rule.id, field: 'check', message: `${label} has an empty pattern. Enter one, for example \\bpromo code\\b.` })
      else if (pattern.length > 200) issues.push({ ruleId: rule.id, field: 'check', message: `${label}: the pattern is longer than 200 characters. Shorten it.` })
      else if (!valid) issues.push({ ruleId: rule.id, field: 'check', message: `${label}: the pattern is not valid. Check the brackets and escapes.` })
      else if (new RegExp(pattern).test('')) issues.push({ ruleId: rule.id, field: 'check', message: `${label}: the pattern matches empty text. Make it require at least one character.` })
    }
    if (rule.check.kind === 'personal_data' && rule.check.kinds.length === 0) {
      issues.push({ ruleId: rule.id, field: 'check', message: `${label} looks for no kind of personal data. Pick at least one.` })
    }
    if (rule.message.length > 500) issues.push({ ruleId: rule.id, field: 'message', message: `${label}: the message is longer than 500 characters. Shorten it.` })
  }
  return issues
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Where a rule matches in the text. */
export function ruleMatches(rule: GuardrailRule, text: string, custom: CustomPattern[] = []): Array<[number, number]> {
  if (!text) return []
  const check = rule.check
  if (check.kind === 'words') {
    if (check.words.length === 0) return []
    const regex = new RegExp(`(?<![\\p{L}\\p{N}])(?:${check.words.map(escapeRegex).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
    return [...text.matchAll(regex)].map((m) => [m.index!, m.index! + m[0].length])
  }
  if (check.kind === 'pattern') {
    let regex: RegExp
    try { regex = new RegExp(check.pattern, 'gi') } catch { return [] }
    if (regex.test('')) return []
    regex.lastIndex = 0
    return [...text.matchAll(regex)].map((m) => [m.index!, m.index! + m[0].length])
  }
  const wanted = new Set(check.kinds)
  const all = wanted.has('any')
  return findPersonalData(text, custom)
    .filter((span) => all || wanted.has(span.kind) || (!(PERSONAL_DATA_KINDS as readonly string[]).includes(span.kind) && wanted.has('custom')))
    .map((span) => [span.start, span.end])
}

export interface GuardrailHit {
  ruleId: string
  name: string
  action: GuardrailAction
}

export interface GuardrailDecision {
  /** The message with every Redact match replaced, whatever the outcome. */
  outcome: 'allow' | 'block' | 'escalate' | 'reask'
  text: string
  hits: GuardrailHit[]
  /** The line to say for block or reask. */
  line?: string
  /** The rule that decided a non-allow outcome. */
  rule?: GuardrailHit
}

const RANK: Record<GuardrailAction, number> = { block: 4, escalate: 3, reask: 2, redact: 1, warn: 0 }

function appliesTo(rule: GuardrailRule, side: 'input' | 'output'): boolean {
  return rule.enabled && (rule.side === 'both' || rule.side === side)
}

/** Checks one message against the active rules. The strongest action wins: block, escalate, reask, redact, warn. */
export function evaluateGuardrails(
  text: string,
  side: 'input' | 'output',
  rules: GuardrailRule[],
  custom: CustomPattern[] = [],
): GuardrailDecision {
  const hits: Array<{ rule: GuardrailRule; ranges: Array<[number, number]> }> = []
  for (const rule of rules) {
    if (!appliesTo(rule, side)) continue
    const ranges = ruleMatches(rule, text, custom)
    if (ranges.length) hits.push({ rule, ranges })
  }
  const asHit = (rule: GuardrailRule): GuardrailHit => ({ ruleId: rule.id, name: rule.name, action: rule.action })
  if (hits.length === 0) return { outcome: 'allow', text, hits: [] }
  const strongest = hits.reduce((best, hit) => (RANK[hit.rule.action] > RANK[best.rule.action] ? hit : best))
  const all = hits.map((hit) => asHit(hit.rule))
  const redacted = redactRanges(text, hits.filter((hit) => hit.rule.action === 'redact').flatMap((hit) => hit.ranges))
  const action = strongest.rule.action
  if (action === 'block') {
    return { outcome: 'block', text: redacted, hits: all, rule: asHit(strongest.rule), line: strongest.rule.message.trim() || (side === 'input' ? BLOCKED_INPUT_LINE : BLOCKED_OUTPUT_LINE) }
  }
  if (action === 'escalate') return { outcome: 'escalate', text: redacted, hits: all, rule: asHit(strongest.rule) }
  if (action === 'reask') return { outcome: 'reask', text: redacted, hits: all, rule: asHit(strongest.rule), line: strongest.rule.message.trim() || REASK_LINE }
  return { outcome: 'allow', text: redacted, hits: all }
}

function redactRanges(text: string, ranges: Array<[number, number]>): string {
  let out = ''
  let at = 0
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start < at) {
      at = Math.max(at, end)
      continue
    }
    out += text.slice(at, start) + REDACTED
    at = end
  }
  return out + text.slice(at)
}

/** Replies must be held back until checked when any reply rule can change them. */
export function holdsReplies(rules: GuardrailRule[]): boolean {
  return rules.some((rule) => appliesTo(rule, 'output') && rule.action !== 'warn')
}

/** A guardrail asked for a person. */
export function guardrailHandoverRequest(hit: GuardrailHit, side: 'input' | 'output'): HandoverRequest {
  return {
    reason: side === 'input'
      ? `The guest’s message matched the guardrail “${hit.name}”.`
      : `The bot’s reply matched the guardrail “${hit.name}”, so it was not sent.`,
    priority: 'high',
    tags: ['guardrail'],
    summary: '',
    variables: {},
    routing: { queue: DEFAULT_QUEUE, skills: [], priority: ROUTING_PRIORITY.high },
    context: 'full_transcript',
  }
}
