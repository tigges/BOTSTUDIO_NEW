/**
 * The three execution settings a bot exposes: model, response length, and when
 * to hand over while a tool keeps the guest waiting. Temperature, the system
 * prompt and token budgets are platform-managed.
 */

export interface ModelGroup {
  label: string
  /** The platform setting that connects the provider. */
  envVar: string
  free?: boolean
  models: Array<{ value: string; label: string; note?: string }>
}

export const MODEL_GROUPS: ModelGroup[] = [
  {
    label: 'Google Gemini',
    envVar: 'GEMINI_API_KEY',
    free: true,
    models: [
      { value: 'gemini-flash-latest', label: 'Gemini Flash', note: 'Recommended: fast, capable, free tier' },
      { value: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite', note: 'Cheapest and fastest' },
    ],
  },
  {
    label: 'Anthropic Claude',
    envVar: 'ANTHROPIC_API_KEY',
    models: [
      { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Best reasoning' },
      { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fast and cheap' },
    ],
  },
  {
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o', note: 'Best quality' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini', note: 'Cost-effective' },
    ],
  },
  {
    label: 'Groq',
    envVar: 'GROQ_API_KEY',
    models: [{ value: 'groq/llama-3.3-70b-versatile', label: 'Llama 3.3 70B' }],
  },
  {
    label: 'Local (Ollama)',
    envVar: 'OLLAMA_BASE_URL',
    free: true,
    models: [
      { value: 'ollama/llama3.2', label: 'Llama 3.2 (local)', note: 'Runs on your own server' },
      { value: 'ollama/mistral', label: 'Mistral (local)' },
    ],
  },
]

export const MODEL_IDS: string[] = MODEL_GROUPS.flatMap((group) => group.models.map((model) => model.value))

export const RESPONSE_LENGTHS = ['short', 'medium', 'long'] as const
export type ResponseLength = typeof RESPONSE_LENGTHS[number]

export interface ResponseLengthRule {
  label: string
  help: string
  /** Appended to the answer prompt. */
  instruction: string
  /** A ceiling well above the instruction, so a reply is never cut off mid-sentence. */
  maxTokens: number
}

export const RESPONSE_LENGTH_RULES: Record<ResponseLength, ResponseLengthRule> = {
  short: {
    label: 'Short',
    help: 'One or two sentences. Suits chat widgets and messaging apps.',
    instruction: 'Keep each reply to one or two short sentences.',
    maxTokens: 400,
  },
  medium: {
    label: 'Medium',
    help: 'A short paragraph. The default.',
    instruction: 'Keep each reply to a short paragraph of at most four sentences.',
    maxTokens: 800,
  },
  long: {
    label: 'Long',
    help: 'Several paragraphs or a list when the question needs it.',
    instruction: 'Answer fully; use a short list when it helps, and stop when the question is answered.',
    maxTokens: 1600,
  },
}

export function responseLength(value: unknown): ResponseLength {
  return (RESPONSE_LENGTHS as readonly string[]).includes(String(value)) ? value as ResponseLength : 'medium'
}

/** What an answer is told about its length, and its token ceiling: the tighter of the setting and any stored budget. */
export function answerLength(value: unknown, storedMaxTokens?: number | null): { instruction: string; maxTokens: number } {
  const rule = RESPONSE_LENGTH_RULES[responseLength(value)]
  const stored = storedMaxTokens && storedMaxTokens > 0 ? storedMaxTokens : rule.maxTokens
  return { instruction: rule.instruction, maxTokens: Math.min(stored, rule.maxTokens) }
}

export const TOOL_WAIT_MIN_SECONDS = 3
export const TOOL_WAIT_MAX_SECONDS = 120

export interface BotSettings {
  model: string
  responseLength: ResponseLength
  /** Hand the chat to a person when a tool has not answered after this many seconds. Null: wait for the tool. */
  toolWaitEscalateSeconds: number | null
}

export type SettingsResult = { ok: true; settings: BotSettings } | { ok: false; field: keyof BotSettings; message: string }

/** Field-named errors for the Bot settings form and the API. */
export function readBotSettings(raw: unknown, models: readonly string[]): SettingsResult {
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const model = String(body['model'] ?? '').trim()
  if (!model) return { ok: false, field: 'model', message: 'Choose a model.' }
  if (models.length && !models.includes(model)) return { ok: false, field: 'model', message: `"${model}" is not a model this BotStudio offers. Choose one from the list.` }
  if (!(RESPONSE_LENGTHS as readonly unknown[]).includes(body['responseLength'])) {
    return { ok: false, field: 'responseLength', message: 'Response length is short, medium or long.' }
  }
  const wait = body['toolWaitEscalateSeconds']
  let seconds: number | null = null
  if (wait !== null && wait !== undefined && wait !== '') {
    const n = Number(wait)
    if (!Number.isInteger(n) || n < TOOL_WAIT_MIN_SECONDS || n > TOOL_WAIT_MAX_SECONDS) {
      return { ok: false, field: 'toolWaitEscalateSeconds', message: `Escalate after ${TOOL_WAIT_MIN_SECONDS} to ${TOOL_WAIT_MAX_SECONDS} whole seconds, or turn it off.` }
    }
    seconds = n
  }
  return { ok: true, settings: { model, responseLength: body['responseLength'] as ResponseLength, toolWaitEscalateSeconds: seconds } }
}

/** The handover a slow tool triggers; the reason names the tool and the wait so the person knows what stalled. */
export function toolWaitHandoverConfig(toolName: string, seconds: number): Record<string, unknown> {
  return {
    reason: `${toolName || 'A tool'} did not answer within ${seconds} seconds, so the bot handed the chat over instead of keeping the guest waiting.`,
    priority: 'high',
    tags: ['tool-wait'],
  }
}
