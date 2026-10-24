/**
 * Telling the team a chat is waiting for a person: a short tone, a count on the Inbox
 * rail item and in the browser tab. Automated test runs never ring.
 */

import { INBOX_SOUND_KEY } from './storage-keys'

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

/** The chat that just started waiting for a person, or null for any other event. */
export function waitingChatId(evt: unknown): string | null {
  if (!evt || typeof evt !== 'object') return null
  const { event, data } = evt as { event?: unknown; data?: unknown }
  if (event !== 'conversation.created' && event !== 'conversation.updated') return null
  if (!data || typeof data !== 'object') return null
  const chat = data as { id?: unknown; status?: unknown; assignedTo?: unknown; testRunId?: unknown }
  if (typeof chat.id !== 'string' || chat.status !== 'escalated') return null
  if (chat.assignedTo || chat.testRunId) return null
  return chat.id
}

const COUNT_PREFIX = /^\(\d+\)\s+/

/** "(2) BotStudio" while two chats wait; the plain title once they are seen. */
export function titleWithCount(title: string, count: number): string {
  const base = title.replace(COUNT_PREFIX, '')
  return count > 0 ? `(${count}) ${base}` : base
}

/** The badge text: up to 9, then "9+". */
export function badgeText(count: number): string | undefined {
  if (count <= 0) return undefined
  return count > 9 ? '9+' : String(count)
}

/** The tone is on unless someone turned it off in this browser. */
export function handoverSoundOn(storage: KeyValueStorage | undefined = globalThis.localStorage): boolean {
  try { return storage?.getItem(INBOX_SOUND_KEY) !== 'off' } catch { return true }
}

export function setHandoverSound(on: boolean, storage: KeyValueStorage | undefined = globalThis.localStorage): void {
  try { storage?.setItem(INBOX_SOUND_KEY, on ? 'on' : 'off') } catch { /* private mode */ }
}
