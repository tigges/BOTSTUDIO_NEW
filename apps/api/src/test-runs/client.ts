/**
 * HTTP client for a test run: the public chat exactly as the website widget
 * calls it (Server-Sent Events), and the console API as a signed-in person.
 * Public chat calls are spaced out to stay under the per-visitor rate limit.
 */

export interface ChatTurn {
  conversationId: string
  text: string
  /** A person holds the chat; the bot stayed quiet. */
  live: boolean
  ended: boolean
  /** The server had already handled this message id and did not answer again. */
  duplicate: boolean
  status: number
  ms: number
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class RunClient {
  private token = ''
  private lastPublic = 0

  constructor(
    readonly baseUrl: string,
    private opts: { publicGapMs?: number; origin?: string; userAgent?: string } = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  setToken(token: string) {
    this.token = token
  }

  private headers(extra: Record<string, string> = {}, auth = true): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'User-Agent': this.opts.userAgent ?? 'BotStudio test run',
      ...(auth && this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(this.opts.origin ? { Origin: this.opts.origin } : {}),
      ...extra,
    }
  }

  async json<T = unknown>(method: string, path: string, body?: unknown, opts: { auth?: boolean; allow?: number[] } = {}): Promise<{ status: number; data: T }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers({}, opts.auth !== false),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    let parsed: unknown = text
    try { parsed = text ? JSON.parse(text) : null } catch { /* plain text */ }
    if (!res.ok && !(opts.allow ?? []).includes(res.status)) {
      const message = (parsed as { error?: { message?: string } } | null)?.error?.message ?? (typeof parsed === 'string' ? parsed.slice(0, 200) : res.statusText)
      throw new ApiError(res.status, parsed, `${method} ${path} answered ${res.status}: ${message}`)
    }
    const data = parsed && typeof parsed === 'object' && 'data' in (parsed as object) ? (parsed as { data: T }).data : parsed as T
    return { status: res.status, data }
  }

  async login(email: string, password: string): Promise<{ userId: string; tenantId: string }> {
    const { data } = await this.json<{ token: string; user: { id: string; tenantId: string } }>('POST', '/api/v1/auth/login', { email, password }, { auth: false })
    this.setToken(data.token)
    return { userId: data.user.id, tenantId: data.user.tenantId }
  }

  private async pacePublic() {
    const gap = this.opts.publicGapMs ?? 2_200
    const wait = this.lastPublic + gap - Date.now()
    if (wait > 0) await sleep(wait)
    this.lastPublic = Date.now()
  }

  /** One visitor turn through the public chat, read to the end of the stream. */
  async chat(channelId: string, input: { sessionId: string; conversationId?: string; message?: string; messageId?: string; runToken: string }): Promise<ChatTurn> {
    await this.pacePublic()
    const started = Date.now()
    const body = {
      sessionId: input.sessionId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.message === undefined ? { opening: true } : { message: input.message }),
      ...(input.messageId ? { messageId: input.messageId } : {}),
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.baseUrl}/api/v1/public/chat/${channelId}`, {
        method: 'POST',
        headers: this.headers({ 'x-test-run': input.runToken }, false),
        body: JSON.stringify(body),
      })
      if (res.status === 429 && attempt < 3) {
        await sleep(20_000)
        continue
      }
      if (!res.ok || !res.body) {
        return { conversationId: input.conversationId ?? '', text: '', live: false, ended: false, duplicate: false, status: res.status, ms: Date.now() - started }
      }
      const raw = await res.text()
      let conversationId = input.conversationId ?? ''
      let text = ''
      let live = false
      let ended = false
      let duplicate = false
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6)) as { conversationId?: string; chunk?: string; done?: boolean; live?: boolean; ended?: boolean; duplicate?: boolean }
          if (event.conversationId) conversationId = event.conversationId
          if (event.duplicate) duplicate = true
          if (event.chunk) text += event.chunk
          if (event.done) { live = Boolean(event.live); ended = Boolean(event.ended) }
        } catch { /* partial line */ }
      }
      return { conversationId, text, live, ended, duplicate, status: res.status, ms: Date.now() - started }
    }
  }

  /** What a person has written to this visitor, as the widget polls for it. */
  async replies(channelId: string, conversationId: string, sessionId: string) {
    return this.json<{ live: boolean; replies: Array<{ id: string; text: string }> }>(
      'GET', `/api/v1/public/chat/${channelId}/${conversationId}/replies?session=${encodeURIComponent(sessionId)}`, undefined, { auth: false },
    ).then((res) => res.data)
  }

  async csat(channelId: string, conversationId: string, rating: 1 | -1, comment?: string) {
    await this.pacePublic()
    return this.json('POST', `/api/v1/public/csat/${channelId}`, { conversationId, rating, ...(comment ? { comment } : {}) }, { auth: false })
  }
}

export async function waitFor<T>(probe: () => Promise<T | undefined>, opts: { timeoutMs?: number; everyMs?: number } = {}): Promise<T | undefined> {
  const until = Date.now() + (opts.timeoutMs ?? 20_000)
  for (;;) {
    const value = await probe().catch(() => undefined)
    if (value !== undefined) return value
    if (Date.now() >= until) return undefined
    await sleep(opts.everyMs ?? 2_000)
  }
}
