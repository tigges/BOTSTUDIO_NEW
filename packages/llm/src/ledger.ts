import type { LlmCompleteParams, LlmCompleteResult, LlmEmbedParams, LlmEmbedResult, LlmProvider, LlmStreamParams } from './types.js'

export type LlmOperation = 'complete' | 'stream' | 'embed'

/** One provider call, as it reaches the ledger. Who asked is added by the recorder. */
export interface LlmCallRecord {
  provider: string
  model: string
  operation: LlmOperation
  inputTokens: number
  cachedTokens: number
  completionTokens: number
  reasoningTokens: number
  outputTokens: number
  latencyMs: number
  /** Streams only: time until the first text arrived. */
  ttftMs: number | null
  /** Null when the model has no known price. */
  costUsd: number | null
  ok: boolean
  error: string | null
}

export type LlmRecorder = (record: LlmCallRecord) => void

let recorder: LlmRecorder | null = null

/** The API installs one recorder; every provider call is reported to it. */
export function setLlmRecorder(next: LlmRecorder | null): void {
  recorder = next
}

/** Sees the text of every chat call as it leaves for the provider, after personal data became tokens. */
export type LlmOutboundWatch = (text: string) => void

let outboundWatch: LlmOutboundWatch | null = null

export function setLlmOutboundWatch(next: LlmOutboundWatch | null): void {
  outboundWatch = next
}

function watchOutbound(params: { messages: LlmCompleteParams['messages']; systemPrompt?: string }): void {
  if (!outboundWatch) return
  try {
    const parts = [params.systemPrompt ?? '', ...params.messages.map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))]
    outboundWatch(parts.join('\n'))
  } catch { /* a watch never breaks a reply */ }
}

function report(record: LlmCallRecord): void {
  if (!recorder) return
  try {
    recorder(record)
  } catch { /* the ledger never breaks a reply */ }
}

/** USD per million tokens. List prices; LLM_PRICING_JSON on the server overrides or adds models. */
export interface ModelPrice {
  input: number
  cached?: number
  output: number
}

const LIST_PRICES: Array<[RegExp, ModelPrice]> = [
  [/^gemini-embedding/, { input: 0.15, output: 0 }],
  [/^gemini-.*flash-lite/, { input: 0.1, cached: 0.025, output: 0.4 }],
  [/^gemini-.*flash/, { input: 0.3, cached: 0.075, output: 2.5 }],
  [/^gemini-.*pro/, { input: 1.25, cached: 0.31, output: 10 }],
  [/^claude-.*haiku/, { input: 1, cached: 0.1, output: 5 }],
  [/^claude-.*sonnet/, { input: 3, cached: 0.3, output: 15 }],
  [/^claude-.*opus/, { input: 5, cached: 0.5, output: 25 }],
  [/^text-embedding-3-small/, { input: 0.02, output: 0 }],
  [/^text-embedding-3-large/, { input: 0.13, output: 0 }],
  [/^gpt-4o-mini/, { input: 0.15, cached: 0.075, output: 0.6 }],
  [/^gpt-4o/, { input: 2.5, cached: 1.25, output: 10 }],
  [/^llama-3\.3-70b/, { input: 0.59, output: 0.79 }],
]

function overrides(): Record<string, ModelPrice> {
  const raw = process.env['LLM_PRICING_JSON']
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, ModelPrice>
  } catch {
    return {}
  }
}

export function priceFor(provider: string, model: string): ModelPrice | null {
  const own = overrides()[model]
  if (own) return own
  if (provider === 'ollama') return { input: 0, output: 0 }
  const bare = model.replace(/^models\//, '')
  return LIST_PRICES.find(([pattern]) => pattern.test(bare))?.[1] ?? null
}

export function costFor(provider: string, model: string, tokens: { input: number; cached: number; output: number }): number | null {
  const price = priceFor(provider, model)
  if (!price) return null
  const fresh = Math.max(0, tokens.input - tokens.cached)
  const usd = (fresh * price.input + tokens.cached * (price.cached ?? price.input) + tokens.output * price.output) / 1_000_000
  return Math.round(usd * 1e8) / 1e8
}

function tokenRecord(
  provider: string,
  model: string,
  result: { inputTokens?: number; cachedTokens?: number; reasoningTokens?: number; outputTokens?: number },
) {
  const input = result.inputTokens ?? 0
  const cached = Math.min(result.cachedTokens ?? 0, input)
  const output = result.outputTokens ?? 0
  const reasoning = Math.min(result.reasoningTokens ?? 0, output)
  return {
    inputTokens: input,
    cachedTokens: cached,
    completionTokens: output - reasoning,
    reasoningTokens: reasoning,
    outputTokens: output,
    costUsd: costFor(provider, model, { input, cached, output }),
  }
}

function failed(provider: string, model: string, operation: LlmOperation, started: number, error: unknown): LlmCallRecord {
  return {
    provider,
    model,
    operation,
    inputTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    outputTokens: 0,
    latencyMs: Date.now() - started,
    ttftMs: null,
    costUsd: null,
    ok: false,
    error: String((error as Error)?.message ?? error).slice(0, 300),
  }
}

/** Reports every call the inner provider makes, including failures, then passes the result through. */
export class RecordingProvider implements LlmProvider {
  constructor(readonly name: string, private inner: LlmProvider) {}

  async complete(params: LlmCompleteParams): Promise<LlmCompleteResult> {
    const started = Date.now()
    const model = params.model ?? ''
    watchOutbound(params)
    try {
      const result = await this.inner.complete(params)
      const used = result.model || model
      report({ provider: this.name, model: used, operation: 'complete', ...tokenRecord(this.name, used, result), latencyMs: Date.now() - started, ttftMs: null, ok: true, error: null })
      return result
    } catch (error) {
      report(failed(this.name, model, 'complete', started, error))
      throw error
    }
  }

  async stream(params: LlmStreamParams): Promise<LlmCompleteResult> {
    const started = Date.now()
    const model = params.model ?? ''
    let firstAt: number | null = null
    const onChunk = (chunk: string) => {
      if (chunk && firstAt === null) firstAt = Date.now()
      params.onChunk(chunk)
    }
    watchOutbound(params)
    try {
      const result = this.inner.stream
        ? await this.inner.stream({ ...params, onChunk })
        : await this.inner.complete({ messages: params.messages, model: params.model, temperature: params.temperature, maxTokens: params.maxTokens, systemPrompt: params.systemPrompt })
      if (!this.inner.stream) onChunk(result.content)
      const used = result.model || model
      report({
        provider: this.name,
        model: used,
        operation: 'stream',
        ...tokenRecord(this.name, used, result),
        latencyMs: Date.now() - started,
        ttftMs: firstAt === null ? null : firstAt - started,
        ok: true,
        error: null,
      })
      return result
    } catch (error) {
      report({ ...failed(this.name, model, 'stream', started, error), ttftMs: firstAt === null ? null : firstAt - started })
      throw error
    }
  }

  async embed(params: LlmEmbedParams): Promise<LlmEmbedResult> {
    const started = Date.now()
    const model = params.model ?? ''
    try {
      const result = await this.inner.embed(params)
      const used = result.model || model
      report({ provider: this.name, model: used, operation: 'embed', ...tokenRecord(this.name, used, { inputTokens: result.inputTokens }), latencyMs: Date.now() - started, ttftMs: null, ok: true, error: null })
      return result
    } catch (error) {
      report(failed(this.name, model, 'embed', started, error))
      throw error
    }
  }
}
