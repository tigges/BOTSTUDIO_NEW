import type { LlmProvider, LlmCompleteParams, LlmCompleteResult, LlmEmbedParams, LlmEmbedResult, LlmStreamParams } from '../types.js'

export class AnthropicProvider implements LlmProvider {
  constructor(private apiKey: string) {}

  async complete(params: LlmCompleteParams): Promise<LlmCompleteResult> {
    const start = Date.now()
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: params.model ?? 'claude-sonnet-5-5',
        messages: params.messages.filter((m) => m.role !== 'system'),
        system: params.systemPrompt ?? params.messages.find((m) => m.role === 'system')?.content,
        max_tokens: params.maxTokens ?? 2048,
        temperature: params.temperature ?? 0.7,
      }),
    })

    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`)

    const data = await res.json() as { content: Array<{ text: string }>; model: string; usage: { input_tokens: number; output_tokens: number } }
    return {
      content: data.content[0]?.text ?? '',
      model: data.model,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      durationMs: Date.now() - start,
    }
  }

  async stream(params: LlmStreamParams): Promise<LlmCompleteResult> {
    const start = Date.now()
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: params.model ?? 'claude-sonnet-5-5',
        messages: params.messages.filter((m) => m.role !== 'system'),
        system: params.systemPrompt ?? params.messages.find((m) => m.role === 'system')?.content,
        max_tokens: params.maxTokens ?? 2048,
        temperature: params.temperature ?? 0.7,
        stream: true,
      }),
    })

    if (!res.ok) throw new Error(`Anthropic stream error ${res.status}: ${await res.text()}`)
    if (!res.body) throw new Error('Anthropic: no response body for streaming')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let modelName = params.model ?? 'claude-sonnet-5-5'
    let inputTokens = 0
    let outputTokens = 0

    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (jsonStr === '[DONE]') continue
        try {
          const evt = JSON.parse(jsonStr) as {
            type: string
            index?: number
            delta?: { type: string; text?: string }
            message?: { model: string; usage: { input_tokens: number } }
            usage?: { output_tokens: number }
          }
          if (evt.type === 'message_start' && evt.message) {
            modelName = evt.message.model
            inputTokens = evt.message.usage.input_tokens
          } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
            fullText += evt.delta.text
            params.onChunk(evt.delta.text)
          } else if (evt.type === 'message_delta' && evt.usage) {
            outputTokens = evt.usage.output_tokens
          }
        } catch { /* skip malformed SSE lines */ }
      }
    }

    return {
      content: fullText,
      model: modelName,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - start,
    }
  }

  async embed(_params: LlmEmbedParams): Promise<LlmEmbedResult> {
    throw new Error('Anthropic does not provide embeddings. Use OpenAI or a dedicated embedding service.')
  }
}
