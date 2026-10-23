import { useEffect, useRef } from 'react'
import { ApiError, preview } from './api'

const POLL_MS = 4000

export interface TeamReplyEvents {
  onReply: (reply: { id: string; text: string }) => void
  /** The team resolved the chat or handed it back to the bot. */
  onReturn: (status: string) => void
}

/**
 * While a test chat sits in the Inbox, fetch what the team says there.
 * Stops when the chat is gone or the team lets go of it.
 */
export function useTeamReplies(botId: string | null | undefined, chatId: string | null | undefined, events: TeamReplyEvents) {
  const eventsRef = useRef(events)
  eventsRef.current = events

  useEffect(() => {
    if (!botId || !chatId) return
    let stopped = false
    let after: string | undefined
    let wasHeld = false
    const seen = new Set<string>()

    async function poll() {
      try {
        const { data } = await preview.inboxChat(botId!, chatId!, after)
        if (stopped) return
        for (const reply of data.replies) {
          if (seen.has(reply.id)) continue
          seen.add(reply.id)
          after = reply.at
          eventsRef.current.onReply(reply)
        }
        if (data.held) wasHeld = true
        else if (wasHeld || data.status === 'resolved') {
          stopped = true
          eventsRef.current.onReturn(data.status)
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) stopped = true
      }
    }

    void poll()
    const timer = window.setInterval(() => { if (!stopped) void poll() }, POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [botId, chatId])
}
