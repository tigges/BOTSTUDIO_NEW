/**
 * Orchestrator contracts: the Router step and the Deterministic / AI switch on flow steps.
 * The canvas, the publish check and the runtime all read these shapes.
 */

export const GUARD_OPERATORS = ['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_set', 'is_empty'] as const
export type GuardOperator = (typeof GUARD_OPERATORS)[number]

export const GUARD_OPERATOR_LABELS: Record<GuardOperator, string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  greater_than: 'is more than',
  less_than: 'is less than',
  is_set: 'is known',
  is_empty: 'is not known',
}

/** A rule a route must pass before it can be picked, such as `vip is yes`. */
export interface RouteGuard {
  field: string
  operator: string
  value: string
}

export interface RouterRoute {
  /** The line on the canvas. Also what the model answers with. */
  handle: string
  label: string
  /** What the guest means on this route. Only the model reads it. */
  intent: string
  /** Words that pick this route without the model. */
  phrases: string[]
  guard?: RouteGuard
  flowName?: string
}

/** The handle every Router keeps for anything no route takes. */
export const FALLBACK_ROUTE = 'other'

export function isGuardOperator(value: unknown): value is GuardOperator {
  return typeof value === 'string' && (GUARD_OPERATORS as readonly string[]).includes(value)
}

function phraseList(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[,\n]/)
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
}

function guardOf(raw: unknown): RouteGuard | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const guard = raw as Record<string, unknown>
  const field = String(guard['field'] ?? '').trim()
  const operator = String(guard['operator'] ?? '').trim()
  if (!field && !operator) return undefined
  return { field, operator, value: String(guard['value'] ?? '').trim() }
}

/** The routes in the order the author put them. The fallback is never one of them. */
export function routerRoutes(config: Record<string, unknown> | undefined): RouterRoute[] {
  const raw = config?.['routes']
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const route = item as Record<string, unknown>
    const handle = String(route['handle'] ?? '').trim()
    if (!handle || handle === FALLBACK_ROUTE) return []
    const flowName = typeof route['flowName'] === 'string' ? route['flowName'] : undefined
    const guard = guardOf(route['guard'])
    return [{
      handle,
      label: String(route['label'] ?? '').trim() || handle,
      intent: String(route['intent'] ?? '').trim(),
      phrases: phraseList(route['phrases']),
      ...(guard ? { guard } : {}),
      ...(flowName ? { flowName } : {}),
    }]
  })
}

/** Compare one value the way Condition steps and route guards do. */
export function compareValue(actual: unknown, operator: string, expected: string): boolean {
  const text = String(actual ?? '')
  switch (operator) {
    case 'equals': return text === expected
    case 'not_equals': return text !== expected
    case 'contains': return text.toLowerCase().includes(expected.toLowerCase())
    case 'greater_than': return parseFloat(text) > parseFloat(expected)
    case 'less_than': return parseFloat(text) < parseFloat(expected)
    case 'is_set': return text !== '' && text !== 'undefined' && text !== 'null'
    case 'is_empty': return text === '' || text === 'undefined' || text === 'null'
    default: return false
  }
}

function lookup(vars: Record<string, unknown>, path: string): unknown {
  if (path in vars) return vars[path]
  return path.split('.').reduce<unknown>((value, key) => (
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
  ), vars)
}

/** A route without a guard is always open. A broken guard keeps the route shut. */
export function guardPasses(guard: RouteGuard | undefined, vars: Record<string, unknown>): boolean {
  if (!guard) return true
  if (!guard.field || !isGuardOperator(guard.operator)) return false
  return compareValue(lookup(vars, guard.field.replace(/^flow\./, '')), guard.operator, guard.value)
}

/** How a route is decided, for the canvas: which parts are rules and which part the model reads. */
export function routeDecision(route: RouterRoute): { rules: string[]; model: string } {
  const rules: string[] = []
  if (route.guard) {
    const operator = isGuardOperator(route.guard.operator) ? GUARD_OPERATOR_LABELS[route.guard.operator] : route.guard.operator
    const value = route.guard.operator === 'is_set' || route.guard.operator === 'is_empty' ? '' : ` ${route.guard.value}`
    rules.push(`only when ${route.guard.field} ${operator}${value}`)
  }
  if (route.phrases.length) rules.push(`words: ${route.phrases.slice(0, 4).join(', ')}${route.phrases.length > 4 ? '…' : ''}`)
  const model = !route.phrases.length && route.guard && !route.intent
    ? ''
    : route.intent || `the route name “${route.label}”`
  return { rules, model }
}

// ── Deterministic / AI steps ─────────────────────────────────────────────────

export type StepMode = 'deterministic' | 'ai'

/** Steps that always talk through the model. */
export const AI_STEP_KINDS: ReadonlySet<string> = new Set(['llm_generate', 'llm_prompt'])
/** Steps the author can switch between a fixed question and a model-led conversation. */
export const SWITCHABLE_STEP_KINDS: ReadonlySet<string> = new Set(['ask_question'])

export const AI_MAX_TURNS = 20
export const AI_DEFAULT_TURNS = 5

export function stepMode(kind: string, config: Record<string, unknown> | undefined): StepMode {
  if (AI_STEP_KINDS.has(kind)) return 'ai'
  if (SWITCHABLE_STEP_KINDS.has(kind) && config?.['mode'] === 'ai') return 'ai'
  return 'deterministic'
}

export interface AiStepContract {
  goal: string
  exitWhen: string
  maxTurns: number
}

export type AiStepField = keyof AiStepContract

/** The goal, exit condition and turn limit an AI step needs, and which of them are missing. */
export function aiStepContract(config: Record<string, unknown> | undefined): { contract: AiStepContract; missing: AiStepField[] } {
  const goal = String(config?.['goal'] ?? '').trim()
  const exitWhen = String(config?.['exitWhen'] ?? '').trim()
  const turns = Number(config?.['maxTurns'])
  const maxTurns = Number.isInteger(turns) && turns >= 1 && turns <= AI_MAX_TURNS ? turns : 0
  const missing: AiStepField[] = []
  if (!goal) missing.push('goal')
  if (!exitWhen) missing.push('exitWhen')
  if (!maxTurns) missing.push('maxTurns')
  return { contract: { goal, exitWhen, maxTurns }, missing }
}

/** The model's answer on one AI turn. */
export interface AiTurn {
  reply: string
  done: boolean
  value?: string
}

/** Read the model's JSON. Prose without JSON is a reply that has not met the exit condition. */
export function parseAiTurn(content: string): AiTurn {
  const text = content.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
      const reply = String(parsed['reply'] ?? '').trim()
      const value = parsed['value'] == null ? undefined : String(parsed['value']).trim() || undefined
      return { reply, done: parsed['done'] === true || parsed['done'] === 'true', ...(value ? { value } : {}) }
    } catch { /* prose below */ }
  }
  return { reply: text, done: false }
}
