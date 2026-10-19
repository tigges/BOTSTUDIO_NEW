import type { LlmProvider, LlmCompleteParams, LlmCompleteResult, LlmEmbedParams, LlmEmbedResult, LlmStreamParams } from '../types.js'

// Claude 3, Sonnet/Opus 4.0-4.6 and Haiku 4.5 take sampling settings; newer models answer HTTP 400 to any non-default value.
const TAKES_TEMPERATURE = /^claude-(?:3|(?:sonnet|opus)-4(?:-[0-6])?(?:-\d{8})?$|haiku-4-5)/

// Sonnet 5.x think adaptively when `thinking` is left out; 5.5 switches it off with `between_tools`, 5.0 with `disabled`.
function thinkingOff(model: string): { type: string } | undefined {
  if (/^claude-sonnet-5-5(?:$|-)/.test(model)) return { type: 'between_tools' }
  if (/^claude-sonnet-5(?:$|-\d{8}$)/.test(model)) return { type: 'disabled' }
  return undefined
}

interface AnthropicUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** Anthropic counts cached and cache-writing tokens apart from input_tokens. */
function totalInput(usage: AnthropicUsage): number {
  return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
}

export function anthropicRequest(params: LlmCompleteParams): Record<string, unknown> {
  const model = params.model ?? 'claude-sonnet-5-5'
  const thinking = thinkingOff(model)
  return {
    model,
    messages: params.messages.filter((m) => m.role !== 'system'),
    system: params.systemPrompt ?? params.messages.find((m) => m.role === 'system')?.content,
    max_tokens: params.maxTokens ?? 2048,
    ...(TAKES_TEMPERATURE.test(model) ? { temperature: params.temperature ?? 0.7 } : {}),
    ...(thinking ? { thinking } : {}),
  }
}

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
      body: JSON.stringify(anthropicRequest(params)),
    })

    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`)

    const data = await res.json() as { content: Array<{ type: string; text?: string }>; model: string; usage: AnthropicUsage }
    const content = data.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
    if (!content.trim()) throw new Error(`Anthropic error: ${data.model} returned no text`)
    return {
      content,
      model: data.model,
      inputTokens: totalInput(data.usage),
      outputTokens: data.usage.output_tokens,
      cachedTokens: data.usage.cache_read_input_tokens ?? 0,
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
      body: JSON.stringify({ ...anthropicRequest(params), stream: true }),
    })

    if (!res.ok) throw new Error(`Anthropic stream error ${res.status}: ${await res.text()}`)
    if (!res.body) throw new Error('Anthropic: no response body for streaming')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let modelName = params.model ?? 'claude-sonnet-5-5'
    let inputTokens = 0
    let outputTokens = 0
    let cachedTokens = 0

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
            message?: { model: string; usage: AnthropicUsage }
            usage?: { output_tokens: number }
          }
          if (evt.type === 'message_start' && evt.message) {
            modelName = evt.message.model
            inputTokens = totalInput(evt.message.usage)
            cachedTokens = evt.message.usage.cache_read_input_tokens ?? 0
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
      cachedTokens,
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
