export { LlmAdapter } from './types.js'
export type {
  LlmProvider, LlmMessage, LlmCompleteParams, LlmStreamParams,
  LlmCompleteResult, LlmEmbedParams, LlmEmbedResult,
  LlmClassifyParams, LlmClassifyResult,
} from './types.js'
export { OpenAIProvider } from './providers/openai.js'
export { AnthropicProvider } from './providers/anthropic.js'
export { OllamaProvider, GroqProvider } from './providers/ollama.js'

import { LlmAdapter } from './types.js'
import { OpenAIProvider } from './providers/openai.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { GroqProvider, OllamaProvider } from './providers/ollama.js'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'

export type LlmProviderName = 'gemini' | 'groq' | 'openai' | 'anthropic' | 'ollama'

/**
 * Map a leftover { provider, apiKey } bag onto the env keys createLlmAdapter reads.
 * The widget runner used to pass that shape, which skipped GEMINI_API_KEY on the server.
 */
export function resolveLlmEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const resolved: Record<string, string | undefined> = { ...env }
  if ('provider' in env || 'apiKey' in env) {
    for (const [key, value] of Object.entries(process.env)) {
      if (resolved[key] === undefined) resolved[key] = value
    }
  }
  const provider = String(resolved['provider'] ?? resolved['LLM_PROVIDER'] ?? '').toLowerCase()
  const apiKey = resolved['apiKey'] ?? resolved['LLM_API_KEY']
  if (apiKey) {
    if (provider === 'gemini' || provider === 'google') resolved['GEMINI_API_KEY'] ??= apiKey
    else if (provider === 'groq') resolved['GROQ_API_KEY'] ??= apiKey
    else if (provider === 'anthropic') resolved['ANTHROPIC_API_KEY'] ??= apiKey
    else if (provider !== 'ollama') resolved['OPENAI_API_KEY'] ??= apiKey
  }
  return resolved
}

export function chooseLlmProvider(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): LlmProviderName {
  const resolved = resolveLlmEnv(env)
  if (resolved['GEMINI_API_KEY']) return 'gemini'
  if (resolved['GROQ_API_KEY']) return 'groq'
  if (resolved['OPENAI_API_KEY']) return 'openai'
  if (resolved['ANTHROPIC_API_KEY']) return 'anthropic'
  return 'ollama'
}

export function hasCloudLlm(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): boolean {
  return chooseLlmProvider(env) !== 'ollama'
}

/**
 * Instantiate the primary LLM adapter (used for chat / completion).
 * Gemini Flash, then Groq, then a paid key. Ollama only when no cloud key is set.
 * For per-bot model selection use `createLlmAdapterForModel` instead.
 */
export function createLlmAdapter(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): LlmAdapter {
  const resolved = resolveLlmEnv(env)
  if (resolved['GEMINI_API_KEY']) {
    return new LlmAdapter(new OpenAIProvider(resolved['GEMINI_API_KEY'], GEMINI_BASE_URL), resolved['GEMINI_MODEL'] ?? 'gemini-2.0-flash')
  }
  if (resolved['GROQ_API_KEY']) {
    return new LlmAdapter(new GroqProvider(resolved['GROQ_API_KEY']), resolved['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile')
  }
  if (resolved['OPENAI_API_KEY']) {
    return new LlmAdapter(new OpenAIProvider(resolved['OPENAI_API_KEY']), resolved['OPENAI_MODEL'])
  }
  if (resolved['ANTHROPIC_API_KEY']) {
    return new LlmAdapter(new AnthropicProvider(resolved['ANTHROPIC_API_KEY']), resolved['ANTHROPIC_MODEL'])
  }
  return new LlmAdapter(new OllamaProvider(resolved['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'), resolved['OLLAMA_MODEL'] ?? 'llama3.2')
}

/**
 * Route to the correct provider+model based on the model string saved in BotConfig.
 * Falls back to `createLlmAdapter()` if no provider key is available for that family.
 *
 * Model prefix → provider mapping:
 *   gemini-*         → Google AI (GEMINI_API_KEY)
 *   gpt-* / o1 / o3  → OpenAI   (OPENAI_API_KEY)
 *   claude-*         → Anthropic (ANTHROPIC_API_KEY)
 *   groq/*           → Groq      (GROQ_API_KEY)
 *   ollama/*         → Ollama    (OLLAMA_BASE_URL)
 */
export function createLlmAdapterForModel(
  model: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): LlmAdapter {
  const resolved = resolveLlmEnv(env)
  if (model.startsWith('gemini-')) {
    const key = resolved['GEMINI_API_KEY']
    if (key) return new LlmAdapter(new OpenAIProvider(key, GEMINI_BASE_URL), model)
  }
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o2') || model.startsWith('o3') || model.startsWith('o4')) {
    const key = resolved['OPENAI_API_KEY']
    if (key) return new LlmAdapter(new OpenAIProvider(key), model)
  }
  if (model.startsWith('claude-')) {
    const key = resolved['ANTHROPIC_API_KEY']
    if (key) return new LlmAdapter(new AnthropicProvider(key), model)
  }
  if (model.startsWith('groq/')) {
    const key = resolved['GROQ_API_KEY']
    if (key) return new LlmAdapter(new GroqProvider(key), model.slice(5))
  }
  if (model.startsWith('ollama/')) {
    return new LlmAdapter(
      new OllamaProvider(resolved['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'),
      model.slice(7),
    )
  }
  return createLlmAdapter(resolved)
}

/**
 * Instantiate an embedding adapter.
 * Gemini supports embeddings via its OpenAI-compatible endpoint.
 */
export function createEmbeddingAdapter(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): LlmAdapter {
  const resolved = resolveLlmEnv(env)
  if (resolved['GEMINI_API_KEY']) {
    return new LlmAdapter(new OpenAIProvider(resolved['GEMINI_API_KEY'], GEMINI_BASE_URL), 'text-embedding-004')
  }
  if (resolved['OPENAI_API_KEY']) {
    return new LlmAdapter(new OpenAIProvider(resolved['OPENAI_API_KEY']), resolved['OPENAI_EMBED_MODEL'] ?? 'text-embedding-3-small')
  }
  return new LlmAdapter(new OllamaProvider(resolved['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'), resolved['OLLAMA_EMBED_MODEL'] ?? 'nomic-embed-text')
}
