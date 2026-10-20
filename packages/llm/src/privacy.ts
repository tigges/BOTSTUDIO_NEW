import type { LlmCompleteParams, LlmCompleteResult, LlmEmbedParams, LlmEmbedResult, LlmProvider, LlmStreamParams } from './types.js'

/**
 * Models never see personal data. The API installs one filter: `protect` swaps
 * personal data for stable tokens before the call, `reveal` turns tokens in the
 * model's answer back into what the guest wrote.
 */
export interface LlmPrivacy {
  protect(text: string): string
  reveal(text: string): string
}

let privacy: LlmPrivacy | null = null

export function setLlmPrivacy(next: LlmPrivacy | null): void {
  privacy = next
}

export function currentLlmPrivacy(): LlmPrivacy | null {
  return privacy
}

/** Longest token the reveal step must wait for, e.g. [NATIONAL_ID_3F9A1C2B]. */
const MAX_TOKEN = 48

/** Holds back a possibly cut-off token at the end of a chunk so reveal always sees whole tokens. */
export class StreamRevealer {
  private pending = ''

  constructor(private readonly reveal: (text: string) => string) {}

  push(chunk: string): string {
    const text = this.pending + chunk
    const open = text.lastIndexOf('[')
    if (open >= 0 && !text.includes(']', open) && text.length - open <= MAX_TOKEN && /^\[[A-Z0-9_]*$/.test(text.slice(open))) {
      this.pending = text.slice(open)
      return this.reveal(text.slice(0, open))
    }
    this.pending = ''
    return this.reveal(text)
  }

  flush(): string {
    const rest = this.pending
    this.pending = ''
    return this.reveal(rest)
  }
}

function protectParams<T extends { messages: LlmCompleteParams['messages']; systemPrompt?: string }>(params: T, filter: LlmPrivacy): T {
  return {
    ...params,
    systemPrompt: params.systemPrompt === undefined ? undefined : filter.protect(params.systemPrompt),
    messages: params.messages.map((message) => ({ ...message, content: filter.protect(message.content) })),
  }
}

/** Wraps a provider so every call goes out protected and comes back revealed. */
export class PrivacyProvider implements LlmProvider {
  constructor(private readonly inner: LlmProvider) {}

  async complete(params: LlmCompleteParams): Promise<LlmCompleteResult> {
    const filter = privacy
    if (!filter) return this.inner.complete(params)
    const result = await this.inner.complete(protectParams(params, filter))
    return { ...result, content: filter.reveal(result.content) }
  }

  get stream(): LlmProvider['stream'] {
    const inner = this.inner
    if (!inner.stream) return undefined
    return async (params: LlmStreamParams): Promise<LlmCompleteResult> => {
      const filter = privacy
      if (!filter) return inner.stream!(params)
      const revealer = new StreamRevealer((text) => filter.reveal(text))
      const result = await inner.stream!({
        ...protectParams(params, filter),
        onChunk: (chunk) => {
          const out = revealer.push(chunk)
          if (out) params.onChunk(out)
        },
      })
      const rest = revealer.flush()
      if (rest) params.onChunk(rest)
      return { ...result, content: filter.reveal(result.content) }
    }
  }

  embed(params: LlmEmbedParams): Promise<LlmEmbedResult> {
    const filter = privacy
    if (!filter) return this.inner.embed(params)
    return this.inner.embed({ ...params, texts: params.texts.map((text) => filter.protect(text)) })
  }
}
