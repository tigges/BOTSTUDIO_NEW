import type { LlmProvider, LlmCompleteParams, LlmCompleteResult, LlmEmbedParams, LlmEmbedResult, LlmStreamParams } from '../types.js'

export class OpenAIProvider implements LlmProvider {
  constructor(private apiKey: string, private baseUrl = 'https://api.openai.com/v1') {}

  async complete(params: LlmCompleteParams): Promise<LlmCompleteResult> {
    const start = Date.now()
    const messages = params.systemPrompt
      ? [{ role: 'system', content: params.systemPrompt }, ...params.messages]
      : params.messages

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: params.model ?? 'gpt-4o',
        messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 2048,
      }),
    })

    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`)

    const data = await res.json() as { choices: Array<{ message: { content: string } }>; model: string; usage: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } } }
    return {
      content: data.choices[0]?.message.content ?? '',
      model: data.model,
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      cachedTokens: data.usage.prompt_tokens_details?.cached_tokens,
      reasoningTokens: data.usage.completion_tokens_details?.reasoning_tokens,
      durationMs: Date.now() - start,
    }
  }

  async stream(params: LlmStreamParams): Promise<LlmCompleteResult> {
    const start = Date.now()
    const messages = params.systemPrompt
      ? [{ role: 'system', content: params.systemPrompt }, ...params.messages]
      : params.messages

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: params.model ?? 'gpt-4o',
        messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 2048,
        stream: true,
        stream_options: { include_usage: true },
      }),
    })

    if (!res.ok) throw new Error(`OpenAI stream error ${res.status}: ${await res.text()}`)
    if (!res.body) throw new Error('OpenAI: no response body for streaming')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let modelName = params.model ?? 'gpt-4o'
    let inputTokens = 0
    let outputTokens = 0
    let cachedTokens: number | undefined
    let reasoningTokens: number | undefined
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (jsonStr === '[DONE]') continue
        try {
          const evt = JSON.parse(jsonStr) as {
            model?: string
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>
            usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } }
          }
          if (evt.model) modelName = evt.model
          const delta = evt.choices?.[0]?.delta?.content
          if (delta) {
            fullText += delta
            params.onChunk(delta)
          }
          if (evt.usage) {
            inputTokens = evt.usage.prompt_tokens
            outputTokens = evt.usage.completion_tokens
            cachedTokens = evt.usage.prompt_tokens_details?.cached_tokens
            reasoningTokens = evt.usage.completion_tokens_details?.reasoning_tokens
          }
        } catch { /* skip */ }
      }
    }

    return { content: fullText, model: modelName, inputTokens, outputTokens, cachedTokens, reasoningTokens, durationMs: Date.now() - start }
  }

  async embed(params: LlmEmbedParams): Promise<LlmEmbedResult> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: params.model ?? 'text-embedding-3-small', input: params.texts }),
    })
    if (!res.ok) throw new Error(`OpenAI embed error ${res.status}: ${await res.text()}`)
    const data = await res.json() as { data: Array<{ embedding: number[] }>; model: string; usage?: { prompt_tokens?: number } }
    return { embeddings: data.data.map((d) => d.embedding), model: data.model || (params.model ?? 'text-embedding-3-small'), inputTokens: data.usage?.prompt_tokens }
  }
}
