/**
 * Eval suites: scripted test chats with checks. A suite marked as a gate
 * must pass before a release reaches guests.
 *
 * Every check is decided by code from the transcript and the chat's end
 * state, so a run costs only the bot's own model calls.
 */

export const EVAL_CHECK_KINDS = ['says', 'never_says', 'ends', 'reaches_chapter', 'not_blocked'] as const
export type EvalCheckKind = (typeof EVAL_CHECK_KINDS)[number]

export const EVAL_ENDINGS = ['handed_over', 'resolved', 'still_open'] as const
export type EvalEnding = (typeof EVAL_ENDINGS)[number]

export type EvalCheck =
  | { kind: 'says'; text: string }
  | { kind: 'never_says'; text: string }
  | { kind: 'ends'; ending: EvalEnding }
  | { kind: 'reaches_chapter'; chapter: string }
  | { kind: 'not_blocked' }

export const EVAL_CHECK_LABELS: Record<EvalCheckKind, string> = {
  says: 'The bot says',
  never_says: 'The bot never says',
  ends: 'The chat ends',
  reaches_chapter: 'The chat reaches the chapter',
  not_blocked: 'No reply is stopped by a guardrail',
}

export const EVAL_ENDING_LABELS: Record<EvalEnding, string> = {
  handed_over: 'with a person',
  resolved: 'resolved by the bot',
  still_open: 'still open with the bot',
}

export interface EvalScenario {
  id: string
  name: string
  /** What the guest types, in order. The bot's greeting comes first on its own. */
  turns: string[]
  checks: EvalCheck[]
}

export interface EvalLine {
  role: 'guest' | 'bot'
  text: string
  /** Bot lines: which stage answered (journey, answer, handover, guardrail, …) and the chapter it was in. */
  path?: string
  chapter?: string
}

export interface EvalObserved {
  transcript: EvalLine[]
  status: 'active' | 'resolved' | 'escalated'
}

export interface EvalCheckResult {
  check: EvalCheck
  passed: boolean
  detail: string
}

export interface EvalScenarioResult {
  scenarioId: string
  name: string
  passed: boolean
  checks: EvalCheckResult[]
  transcript: EvalLine[]
  /** The chat could not be run at all, e.g. the model was unreachable. */
  error?: string
}

export const EVAL_LIMITS = { scenarios: 50, turns: 12, checks: 10, text: 500 } as const

export function describeCheck(check: EvalCheck): string {
  switch (check.kind) {
    case 'says': return `${EVAL_CHECK_LABELS.says} “${check.text}”`
    case 'never_says': return `${EVAL_CHECK_LABELS.never_says} “${check.text}”`
    case 'ends': return `${EVAL_CHECK_LABELS.ends} ${EVAL_ENDING_LABELS[check.ending]}`
    case 'reaches_chapter': return `${EVAL_CHECK_LABELS.reaches_chapter} “${check.chapter}”`
    case 'not_blocked': return EVAL_CHECK_LABELS.not_blocked
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseCheck(raw: unknown): EvalCheck | null {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  switch (row['kind']) {
    case 'says': return { kind: 'says', text: str(row['text']) }
    case 'never_says': return { kind: 'never_says', text: str(row['text']) }
    case 'ends': {
      const ending = (EVAL_ENDINGS as readonly string[]).includes(str(row['ending'])) ? str(row['ending']) as EvalEnding : 'still_open'
      return { kind: 'ends', ending }
    }
    case 'reaches_chapter': return { kind: 'reaches_chapter', chapter: str(row['chapter']) }
    case 'not_blocked': return { kind: 'not_blocked' }
    default: return null
  }
}

export function parseEvalScenarios(raw: unknown): EvalScenario[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item, index) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const turns = Array.isArray(row['turns']) ? (row['turns'] as unknown[]).map(str) : []
    const checks = Array.isArray(row['checks']) ? (row['checks'] as unknown[]).map(parseCheck).filter((c): c is EvalCheck => c !== null) : []
    return [{ id: str(row['id']) || `s${index + 1}`, name: str(row['name']), turns, checks }]
  })
}

export interface EvalIssue {
  scenarioId: string
  field: 'name' | 'turns' | 'checks'
  message: string
}

export function evalIssues(scenarios: EvalScenario[]): EvalIssue[] {
  const issues: EvalIssue[] = []
  if (scenarios.length > EVAL_LIMITS.scenarios) {
    issues.push({ scenarioId: scenarios[EVAL_LIMITS.scenarios]!.id, field: 'name', message: `A suite holds up to ${EVAL_LIMITS.scenarios} scenarios. Split it into two suites.` })
  }
  for (const scenario of scenarios) {
    const label = scenario.name.trim() || 'This scenario'
    if (!scenario.name.trim()) issues.push({ scenarioId: scenario.id, field: 'name', message: 'Give the scenario a name, for example "Books a cut for Saturday".' })
    const turns = scenario.turns.filter((turn) => turn.trim())
    if (turns.length === 0) issues.push({ scenarioId: scenario.id, field: 'turns', message: `${label} has no guest messages. Add what the guest types.` })
    if (scenario.turns.length > EVAL_LIMITS.turns) issues.push({ scenarioId: scenario.id, field: 'turns', message: `${label} has more than ${EVAL_LIMITS.turns} guest messages. Shorten it.` })
    if (scenario.turns.some((turn) => turn.length > EVAL_LIMITS.text)) issues.push({ scenarioId: scenario.id, field: 'turns', message: `${label}: a guest message is longer than ${EVAL_LIMITS.text} characters.` })
    if (scenario.checks.length === 0) issues.push({ scenarioId: scenario.id, field: 'checks', message: `${label} has no checks. Add at least one, for example "The bot says".` })
    if (scenario.checks.length > EVAL_LIMITS.checks) issues.push({ scenarioId: scenario.id, field: 'checks', message: `${label} has more than ${EVAL_LIMITS.checks} checks.` })
    for (const check of scenario.checks) {
      if ((check.kind === 'says' || check.kind === 'never_says') && !check.text.trim()) {
        issues.push({ scenarioId: scenario.id, field: 'checks', message: `${label}: "${EVAL_CHECK_LABELS[check.kind]}" needs the words to look for.` })
      }
      if (check.kind === 'reaches_chapter' && !check.chapter.trim()) {
        issues.push({ scenarioId: scenario.id, field: 'checks', message: `${label}: pick the chapter the chat should reach.` })
      }
    }
  }
  return issues
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
}

function ending(status: EvalObserved['status']): EvalEnding {
  return status === 'escalated' ? 'handed_over' : status === 'resolved' ? 'resolved' : 'still_open'
}

/** Decides every check of one scenario from what the test chat did. */
export function judgeScenario(scenario: EvalScenario, observed: EvalObserved): EvalCheckResult[] {
  const botLines = observed.transcript.filter((line) => line.role === 'bot')
  const said = botLines.map((line) => normalise(line.text))
  return scenario.checks.map((check): EvalCheckResult => {
    switch (check.kind) {
      case 'says': {
        const passed = said.some((line) => line.includes(normalise(check.text)))
        return { check, passed, detail: passed ? 'Found in a bot reply.' : 'No bot reply contains these words.' }
      }
      case 'never_says': {
        const index = said.findIndex((line) => line.includes(normalise(check.text)))
        return { check, passed: index < 0, detail: index < 0 ? 'Not in any bot reply.' : `Bot reply ${index + 1} contains these words.` }
      }
      case 'ends': {
        const actual = ending(observed.status)
        return { check, passed: actual === check.ending, detail: `The chat ended ${EVAL_ENDING_LABELS[actual]}.` }
      }
      case 'reaches_chapter': {
        const chapters = [...new Set(botLines.map((line) => line.chapter).filter((c): c is string => Boolean(c)))]
        const passed = chapters.some((chapter) => normalise(chapter) === normalise(check.chapter))
        return { check, passed, detail: passed ? 'Reached.' : chapters.length ? `Chapters reached: ${chapters.join(', ')}.` : 'No chapter was reached.' }
      }
      case 'not_blocked': {
        const index = botLines.findIndex((line) => line.path === 'guardrail')
        return { check, passed: index < 0, detail: index < 0 ? 'No reply was stopped.' : `Bot reply ${index + 1} was stopped by a guardrail.` }
      }
    }
  })
}

export function scenarioPassed(checks: EvalCheckResult[], error?: string): boolean {
  return !error && checks.length > 0 && checks.every((check) => check.passed)
}
