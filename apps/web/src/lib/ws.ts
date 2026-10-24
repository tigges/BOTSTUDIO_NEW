/**
 * WebSocket client for real-time tenant events.
 *
 * Exports:
 *  - useTenantWS()  — singleton WS connection, auto-reconnects
 *  - useConversationWS(conversationId) — subscribe to messages for a specific convo
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { buildWsUrl } from './api'
import { useAppStore } from '../store/app'

type WsEvent = {
  event: 'message.created'
  data: { id: string; conversationId: string; direction: string; authorKind: string; content: { text: string }; createdAt: string }
} | {
  event: 'message.chunk'
  data: { conversationId: string; chunk: string }
} | {
  event: 'conversation.created' | 'conversation.updated'
  data: { id: string; status?: string; assignedTo?: string | null; testRunId?: string | null }
} | {
  type: 'connected'
  tenantId: string
} | {
  type: 'pong'
}

type Listener = (evt: WsEvent) => void

// Module-level singleton so all components share one socket
let globalWs: WebSocket | null = null
let globalListeners = new Set<Listener>()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let lastToken = ''

function connectWs(token: string) {
  if (globalWs && globalWs.readyState <= WebSocket.OPEN) return
  if (!token) return

  lastToken = token
  const url = buildWsUrl(token)
  const ws = new WebSocket(url)
  globalWs = ws

  ws.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data as string) as WsEvent
      for (const l of globalListeners) l(evt)
    } catch { /* ignore */ }
  }

  ws.onopen = () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  }

  ws.onclose = () => {
    globalWs = null
    // Reconnect after 3 s
    reconnectTimer = setTimeout(() => connectWs(lastToken), 3000)
  }

  ws.onerror = () => ws.close()
}

export function useTenantWS() {
  const token = useAppStore((s) => s.token)

  useEffect(() => {
    if (!token || import.meta.env.VITE_DEMO_MODE === 'true') return
    connectWs(token)
    const ping = setInterval(() => {
      if (globalWs?.readyState === WebSocket.OPEN) {
        globalWs.send(JSON.stringify({ type: 'ping' }))
      }
    }, 25_000)
    return () => clearInterval(ping)
  }, [token])

  const subscribe = useCallback((listener: Listener) => {
    globalListeners.add(listener)
    return () => { globalListeners.delete(listener) }
  }, [])

  return { subscribe }
}

/**
 * Returns real-time messages for a given conversation.
 * `streamingText` accumulates token chunks while a bot is replying.
 */
export function useConversationWS(conversationId: string | null) {
  const [newMessage, setNewMessage] = useState<{ event: 'message.created'; data: { id: string; conversationId: string; direction: string; authorKind: string; content: { text: string }; createdAt: string } } | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const { subscribe } = useTenantWS()
  const streamRef = useRef('')

  useEffect(() => {
    if (!conversationId) return
    streamRef.current = ''

    const unsub = subscribe((evt) => {
      if ('event' in evt && evt.event === 'message.created' && evt.data.conversationId === conversationId) {
        setStreamingText('')
        streamRef.current = ''
        setNewMessage(evt as { event: 'message.created'; data: { id: string; conversationId: string; direction: string; authorKind: string; content: { text: string }; createdAt: string } })
      }
      if ('event' in evt && evt.event === 'message.chunk' && evt.data.conversationId === conversationId) {
        streamRef.current += evt.data.chunk
        setStreamingText(streamRef.current)
      }
    })
    return unsub
  }, [conversationId, subscribe])

  return { newMessage, streamingText }
}
