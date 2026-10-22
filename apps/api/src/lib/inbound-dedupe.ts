import { KEY_PREFIX, getValkey, isReady } from './valkey.js'

/**
 * Providers retry webhooks, and a visitor's browser can resend a message. Each
 * inbound message is handled once per channel and provider message id inside
 * the replay window. The window lives in Valkey, so every API replica and a
 * restarted API agree on it. While Valkey is unreachable the window falls back
 * to this process's memory: a rare double answer beats dropping a message.
 */

export const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_REMEMBERED = 100_000

export class InboundDedupe {
  private seen = new Map<string, number>()

  constructor(private windowMs = REPLAY_WINDOW_MS, private max = MAX_REMEMBERED) {}

  /** True the first time this message arrives inside the window; false for a replay. */
  first(channelId: string, messageId: string | undefined | null, now = Date.now()): boolean {
    const id = messageId?.trim()
    if (!id) return true
    const key = `${channelId}\u0000${id}`
    const at = this.seen.get(key)
    if (at !== undefined && now - at < this.windowMs) return false
    this.seen.delete(key)
    this.seen.set(key, now)
    this.prune(now)
    return true
  }

  private prune(now: number) {
    for (const [key, at] of this.seen) {
      if (this.seen.size <= this.max && now - at < this.windowMs) break
      this.seen.delete(key)
    }
  }
}

/** `SET key 1 PX window NX`: resolves true only for the first caller inside the window. */
export interface DedupeStore {
  ready(): boolean
  setIfAbsent(key: string, windowMs: number): Promise<boolean>
}

export class SharedDedupe {
  private local: InboundDedupe

  constructor(private store: () => Promise<DedupeStore | null>, private windowMs = REPLAY_WINDOW_MS) {
    this.local = new InboundDedupe(windowMs)
  }

  async first(channelId: string, messageId: string | undefined | null): Promise<boolean> {
    const id = messageId?.trim()
    if (!id) return true
    const store = await this.store().catch(() => null)
    if (store?.ready()) {
      try {
        return await store.setIfAbsent(`${KEY_PREFIX}inbound:${channelId}:${id}`, this.windowMs)
      } catch { /* fall back to memory */ }
    }
    return this.local.first(channelId, id)
  }
}

async function valkeyStore(): Promise<DedupeStore | null> {
  const redis = await getValkey()
  if (!redis) return null
  return {
    ready: () => isReady(redis),
    setIfAbsent: async (key, windowMs) => (await redis.set(key, '1', 'PX', windowMs, 'NX')) === 'OK',
  }
}

const inbound = new SharedDedupe(valkeyStore)

export function firstDelivery(channelId: string, messageId: string | undefined | null): Promise<boolean> {
  return inbound.first(channelId, messageId)
}
