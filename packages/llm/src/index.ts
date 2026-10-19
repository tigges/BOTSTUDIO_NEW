export { LlmAdapter } from './types.js'
export type {
  LlmProvider, LlmMessage, LlmCompleteParams, LlmStreamParams,
  LlmCompleteResult, LlmEmbedParams, LlmEmbedResult,
  LlmClassifyParams, LlmClassifyResult,
} from './types.js'
export { OpenAIProvider } from './providers/openai.js'
export { AnthropicProvider } from './providers/anthropic.js'
export { OllamaProvider, GroqProvider } from './providers/ollama.js'
export {
  DEFAULT_MODELS,
  FallbackProvider,
  LlmChainError,
  currentModelId,
  llmChain,
  modelFamily,
  resolveLlmEnv,
  type LlmFailure,
  type LlmLink,
  type LlmProviderName,
} from './chain.js'

import { LlmAdapter } from './types.js'
import { OpenAIProvider } from './providers/openai.js'
import { OllamaProvider } from './providers/ollama.js'
import {
  DEFAULT_OLLAMA_URL,
  FallbackProvider,
  GEMINI_BASE_URL,
  chainForModel,
  chainOrLocal,
  llmChain,
  resolveLlmEnv,
  type LlmProviderName,
} from './chain.js'

type Env = Record<string, string | undefined>

export function chooseLlmProvider(env: Env = process.env as Env): LlmProviderName {
  return chainOrLocal(env)[0]!.name
}

export function hasCloudLlm(env: Env = process.env as Env): boolean {
  return llmChain(env).some((link) => link.name !== 'ollama')
}

/**
 * The primary LLM adapter (chat / completion).
 * Gemini, then Claude, then any OpenAI or Groq key, then Ollama; each one only runs when the one before it failed.
 * For per-bot model selection use `createLlmAdapterForModel` instead.
 */
export function createLlmAdapter(env: Env = process.env as Env): LlmAdapter {
  return new LlmAdapter(new FallbackProvider(chainOrLocal(env)))
}

/**
 * Route to the provider of the model saved in BotConfig, then the rest of the chain.
 * Retired ids (gemini-2.0-flash, claude-sonnet-4-5, …) run on their current replacement.
 *
 * Model prefix → provider mapping:
 *   gemini-*         → Google AI (GEMINI_API_KEY)
 *   claude-*         → Anthropic (ANTHROPIC_API_KEY)
 *   ollama/*         → Ollama    (OLLAMA_BASE_URL)
 *   gpt-* / o1 / o3  → OpenAI    (OPENAI_API_KEY)
 *   groq/*           → Groq      (GROQ_API_KEY)
 */
export function createLlmAdapterForModel(model: string, env: Env = process.env as Env): LlmAdapter {
  return new LlmAdapter(new FallbackProvider(chainForModel(model, env)))
}

/**
 * Embeddings stay on one provider: vectors from different models cannot be compared,
 * so changing this means re-syncing knowledge. Claude has no embedding model.
 */
export function createEmbeddingAdapter(env: Env = process.env as Env): LlmAdapter {
  const resolved = resolveLlmEnv(env)
  if (resolved['GEMINI_API_KEY']) {
    return new LlmAdapter(new OpenAIProvider(resolved['GEMINI_API_KEY'], GEMINI_BASE_URL), resolved['GEMINI_EMBED_MODEL'] || 'gemini-embedding-2')
  }
  if (resolved['OPENAI_API_KEY']) {
    return new LlmAdapter(new OpenAIProvider(resolved['OPENAI_API_KEY']), resolved['OPENAI_EMBED_MODEL'] || 'text-embedding-3-small')
  }
  return new LlmAdapter(new OllamaProvider(resolved['OLLAMA_BASE_URL'] || DEFAULT_OLLAMA_URL), resolved['OLLAMA_EMBED_MODEL'] || 'nomic-embed-text')
}
