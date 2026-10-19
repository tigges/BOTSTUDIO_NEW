// ── Core types ────────────────────────────────────────────────────────────────
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmCompleteParams {
  messages: LlmMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  stream?: false
}

export interface LlmStreamParams {
  messages: LlmMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  /** Called for each text chunk as it arrives. */
  onChunk: (chunk: string) => void
}

export interface LlmCompleteResult {
  content: string
  model: string
  inputTokens: number
  outputTokens: number
  /** Part of inputTokens served from the provider's prompt cache. */
  cachedTokens?: number
  /** Part of outputTokens spent on hidden reasoning. */
  reasoningTokens?: number
  durationMs: number
}

export interface LlmEmbedParams {
  texts: string[]
  model?: string
}

export interface LlmEmbedResult {
  embeddings: number[][]
  model: string
  inputTokens?: number
}

export interface LlmClassifyParams {
  categories: string[]
  examples?: Array<{ text: string; category: string }>
}

export interface LlmClassifyResult {
  category: string
  confidence: number
}

// ── Provider interface ────────────────────────────────────────────────────────
export interface LlmProvider {
  complete(params: LlmCompleteParams): Promise<LlmCompleteResult>
  stream?(params: LlmStreamParams): Promise<LlmCompleteResult>
  embed(params: LlmEmbedParams): Promise<LlmEmbedResult>
}

// ── Adapter (wraps provider, adds RAG/classify helpers) ───────────────────────
export class LlmAdapter {
  constructor(private provider: LlmProvider, private defaultModel?: string) {}

  async complete(params: LlmCompleteParams): Promise<LlmCompleteResult> {
    return this.provider.complete({ model: this.defaultModel, ...params })
  }

  /** Stream tokens via onChunk; falls back to a single complete() call if provider doesn't support streaming. */
  async stream(params: LlmStreamParams): Promise<LlmCompleteResult> {
    if (this.provider.stream) {
      return this.provider.stream({ model: this.defaultModel, ...params })
    }
    // Fallback: call complete() and emit full content as single chunk
    const result = await this.provider.complete({
      model: this.defaultModel,
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      systemPrompt: params.systemPrompt,
    })
    params.onChunk(result.content)
    return result
  }

  async embed(params: LlmEmbedParams): Promise<LlmEmbedResult> {
    return this.provider.embed({ model: this.defaultModel, ...params })
  }

  async classify(text: string, params: LlmClassifyParams): Promise<LlmClassifyResult> {
    const systemPrompt = [
      'Classify the user\'s message into exactly one of these categories:',
      params.categories.map((c) => `- ${c}`).join('\n'),
      'Respond with JSON: { "category": "<category>", "confidence": <0.0-1.0> }',
      'Do not output anything else.',
    ].join('\n')

    const result = await this.provider.complete({
      messages: [{ role: 'user', content: text }],
      systemPrompt,
      temperature: 0,
      maxTokens: 64,
    })

    try {
      const parsed = JSON.parse(result.content) as { category: string; confidence: number }
      if (params.categories.includes(parsed.category)) return parsed
    } catch { /* fallthrough */ }

    return { category: 'other', confidence: 0.5 }
  }

  async ragComplete(params: {
    question: string
    context: string[]
    systemPrompt?: string
    model?: string
    onChunk?: (chunk: string) => void
  }): Promise<LlmCompleteResult> {
    const contextBlock = params.context.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')
    const systemPrompt = [
      params.systemPrompt ?? 'You are a helpful assistant.',
      '',
      'Use only the following context to answer the question. If the answer is not in the context, say so.',
      '',
      '--- CONTEXT ---',
      contextBlock,
      '--- END CONTEXT ---',
    ].join('\n')

    if (params.onChunk) {
      return this.stream({
        messages: [{ role: 'user', content: params.question }],
        systemPrompt,
        model: params.model ?? this.defaultModel,
        temperature: 0.2,
        onChunk: params.onChunk,
      })
    }

    return this.provider.complete({
      messages: [{ role: 'user', content: params.question }],
      systemPrompt,
      model: params.model ?? this.defaultModel,
      temperature: 0.2,
    })
  }
}
