import type { LlmCompleteParams, LlmCompleteResult, LlmEmbedParams, LlmEmbedResult, LlmProvider, LlmStreamParams } from './types.js'
import { LlmAdapter } from './types.js'
import { OpenAIProvider } from './providers/openai.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { GroqProvider, OllamaProvider } from './providers/ollama.js'
import { RecordingProvider } from './ledger.js'

export type LlmProviderName = 'gemini' | 'anthropic' | 'openai' | 'groq' | 'ollama'

type Env = Record<string, string | undefined>

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'
export const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  gemini: 'gemini-flash-latest',
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-4o',
  groq: 'llama-3.3-70b-versatile',
  ollama: 'llama3.2',
}
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

const LABELS: Record<LlmProviderName, string> = {
  gemini: 'Gemini',
  anthropic: 'Claude',
  openai: 'OpenAI',
  groq: 'Groq',
  ollama: 'Ollama',
}

const MODEL_ENV: Record<LlmProviderName, string> = {
  gemini: 'GEMINI_MODEL',
  anthropic: 'ANTHROPIC_MODEL',
  openai: 'OPENAI_MODEL',
  groq: 'GROQ_MODEL',
  ollama: 'OLLAMA_MODEL',
}

const CLOUD_ORDER: LlmProviderName[] = ['gemini', 'anthropic', 'openai', 'groq']

/** Shut down (or deprecated with a date) by the provider; saved bots still carry these ids. */
const RETIRED: Array<[RegExp, string]> = [
  [/^gemini-(?:1\.|2\.0|2\.5)/, DEFAULT_MODELS.gemini],
  [/^claude-(?:2|instant|3)/, DEFAULT_MODELS.anthropic],
  [/^claude-sonnet-4(?:-5|-20\d{6})?(?:-\d{8})?$/, DEFAULT_MODELS.anthropic],
  [/^claude-opus-4(?:-1|-20\d{6})?(?:-\d{8})?$/, DEFAULT_MODELS.anthropic],
  [/^claude-haiku-4-5(?:-\d{8})?$/, 'claude-haiku-5-5'],
]

export function currentModelId(model: string): string {
  for (const [pattern, replacement] of RETIRED) if (pattern.test(model)) return replacement
  return model
}

/** Which provider a saved model id belongs to, and the id that provider expects. */
export function modelFamily(model: string): { name: LlmProviderName; model: string } | null {
  if (model.startsWith('gemini-')) return { name: 'gemini', model: currentModelId(model) }
  if (model.startsWith('claude-')) return { name: 'anthropic', model: currentModelId(model) }
  if (/^(?:gpt-|o[1-9])/.test(model)) return { name: 'openai', model }
  if (model.startsWith('groq/')) return { name: 'groq', model: model.slice(5) }
  if (model.startsWith('ollama/')) return { name: 'ollama', model: model.slice(7) }
  return null
}

/**
 * Map a leftover { provider, apiKey } bag onto the env keys the chain reads.
 * The widget runner used to pass that shape, which skipped GEMINI_API_KEY on the server.
 */
export function resolveLlmEnv(env: Env): Env {
  const resolved: Env = { ...env }
  if ('provider' in env || 'apiKey' in env) {
    for (const [key, value] of Object.entries(process.env)) {
      if (resolved[key] === undefined) resolved[key] = value
    }
  }
  const provider = preferredName(resolved)
  const apiKey = resolved['apiKey'] ?? resolved['LLM_API_KEY']
  if (apiKey) {
    if (provider === 'gemini') resolved['GEMINI_API_KEY'] ??= apiKey
    else if (provider === 'groq') resolved['GROQ_API_KEY'] ??= apiKey
    else if (provider === 'anthropic') resolved['ANTHROPIC_API_KEY'] ??= apiKey
    else if (provider !== 'ollama') resolved['OPENAI_API_KEY'] ??= apiKey
  }
  return resolved
}

function preferredName(env: Env): LlmProviderName | null {
  const raw = String(env['provider'] ?? env['LLM_PROVIDER'] ?? '').toLowerCase().trim()
  if (raw === 'google' || raw === 'gemini') return 'gemini'
  if (raw === 'claude' || raw === 'anthropic') return 'anthropic'
  if (raw === 'openai' || raw === 'groq' || raw === 'ollama') return raw
  return null
}

export interface LlmLink {
  name: LlmProviderName
  label: string
  model: string
  modelEnv: string
  provider: LlmProvider
}

function providerFor(name: LlmProviderName, env: Env): LlmProvider {
  return new RecordingProvider(name, bareProvider(name, env))
}

function bareProvider(name: LlmProviderName, env: Env): LlmProvider {
  switch (name) {
    case 'gemini': return new OpenAIProvider(env['GEMINI_API_KEY']!, GEMINI_BASE_URL)
    case 'anthropic': return new AnthropicProvider(env['ANTHROPIC_API_KEY']!)
    case 'openai': return new OpenAIProvider(env['OPENAI_API_KEY']!)
    case 'groq': return new GroqProvider(env['GROQ_API_KEY']!)
    case 'ollama': return new OllamaProvider(env['OLLAMA_BASE_URL'] || DEFAULT_OLLAMA_URL)
  }
}

function linkFor(name: LlmProviderName, env: Env, model?: string): LlmLink {
  return {
    name,
    label: LABELS[name],
    model: model ?? currentModelId(env[MODEL_ENV[name]] || DEFAULT_MODELS[name]),
    modelEnv: MODEL_ENV[name],
    provider: providerFor(name, env),
  }
}

/**
 * Every configured provider in the order chat and import try them:
 * Gemini, Claude, OpenAI, Groq, then Ollama when OLLAMA_BASE_URL or OLLAMA_MODEL is set.
 * LLM_PROVIDER moves that provider to the front.
 */
export function llmChain(env: Env = process.env as Env): LlmLink[] {
  const resolved = resolveLlmEnv(env)
  const names: LlmProviderName[] = CLOUD_ORDER.filter((name) => {
    if (name === 'gemini') return Boolean(resolved['GEMINI_API_KEY'])
    if (name === 'anthropic') return Boolean(resolved['ANTHROPIC_API_KEY'])
    if (name === 'openai') return Boolean(resolved['OPENAI_API_KEY'])
    return Boolean(resolved['GROQ_API_KEY'])
  })
  if (resolved['OLLAMA_BASE_URL'] || resolved['OLLAMA_MODEL']) names.push('ollama')
  const preferred = preferredName(resolved)
  if (preferred && names.includes(preferred)) names.sort((a, b) => Number(b === preferred) - Number(a === preferred))
  return names.map((name) => linkFor(name, resolved))
}

/** One provider's failure inside a chain. */
export interface LlmFailure {
  label: string
  model: string
  error: unknown
}

export class LlmChainError extends Error {
  constructor(readonly failures: LlmFailure[]) {
    super(failures.map((failure) => `${failure.label} (${failure.model}): ${String((failure.error as Error)?.message ?? failure.error).slice(0, 200)}`).join('; '))
  }
}

/** Tries each link in turn; a later link only runs when the earlier one failed before sending any text. */
export class FallbackProvider implements LlmProvider {
  constructor(readonly links: LlmLink[], private onFallback?: (failure: LlmFailure, next: LlmLink) => void) {}

  private modelFor(link: LlmLink, requested?: string): string {
    const family = requested ? modelFamily(requested) : null
    return family && family.name === link.name ? family.model : link.model
  }

  private async run<T>(attempt: (link: LlmLink, model: string) => Promise<T>, requested?: string, sent?: () => boolean): Promise<T> {
    const failures: LlmFailure[] = []
    for (const [index, link] of this.links.entries()) {
      const model = this.modelFor(link, requested)
      try {
        return await attempt(link, model)
      } catch (error) {
        if (sent?.()) throw error
        const failure = { label: link.label, model, error }
        failures.push(failure)
        const next = this.links[index + 1]
        if (next) (this.onFallback ?? warnFallback)(failure, next)
      }
    }
    throw new LlmChainError(failures)
  }

  complete(params: LlmCompleteParams): Promise<LlmCompleteResult> {
    return this.run((link, model) => link.provider.complete({ ...params, model }), params.model)
  }

  stream(params: LlmStreamParams): Promise<LlmCompleteResult> {
    let sent = false
    const onChunk = (chunk: string) => {
      if (chunk) sent = true
      params.onChunk(chunk)
    }
    return this.run((link, model) => new LlmAdapter(link.provider, model).stream({ ...params, model, onChunk }), params.model, () => sent)
  }

  embed(params: LlmEmbedParams): Promise<LlmEmbedResult> {
    return this.run((link) => link.provider.embed(params))
  }
}

function warnFallback(failure: LlmFailure, next: LlmLink): void {
  const message = String((failure.error as Error)?.message ?? failure.error).slice(0, 160)
  console.warn(`[llm] ${failure.label} (${failure.model}) failed: ${message}. Trying ${next.label} (${next.model}).`)
}

/** The chain, or local Ollama on its default address when nothing is configured. */
export function chainOrLocal(env: Env): LlmLink[] {
  const links = llmChain(env)
  return links.length > 0 ? links : [linkFor('ollama', resolveLlmEnv(env))]
}

/** Put the saved model's provider first, on that model; the rest of the chain stays behind it. */
export function chainForModel(model: string, env: Env): LlmLink[] {
  const resolved = resolveLlmEnv(env)
  const links = chainOrLocal(resolved)
  const family = modelFamily(model)
  if (!family) return links
  const own = links.find((link) => link.name === family.name)
  if (!own && family.name !== 'ollama') return links
  const first = { ...(own ?? linkFor('ollama', resolved)), model: family.model }
  return [first, ...links.filter((link) => link.name !== family.name)]
}
