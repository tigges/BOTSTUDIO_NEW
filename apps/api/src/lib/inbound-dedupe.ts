/**
 * Providers retry webhooks, and a visitor's browser can resend a message. Each
 * inbound message is handled once per channel and provider message id inside
 * the replay window. The API runs as one container, so the window lives in
 * memory; a restart forgets it.
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

const inbound = new InboundDedupe()

export function firstDelivery(channelId: string, messageId: string | undefined | null): boolean {
  return inbound.first(channelId, messageId)
}
