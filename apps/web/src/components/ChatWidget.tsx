/**
 * ChatWidget — Embedded conversational test widget.
 *
 * Streams responses from POST /api/v1/bots/:botId/preview/chat (SSE).
 * Used in the FlowCanvas "Test Bot" panel and anywhere else you want an
 * interactive preview of a bot without creating real Conversation records.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, Sparkles, Database, X, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { Button, Avatar } from '@ybot/ui'
import { cn } from '@ybot/ui'
import { ChatText } from './ChatText'
import { preview } from '../lib/api'
import { useAppStore } from '../store/app'

const isDemoMode = () => import.meta.env.VITE_DEMO_MODE === 'true'

/** Simulated bot replies for demo mode when no API backend is available. */
const DEMO_REPLIES = [
  "I'm the demo bot! In production I'd search your knowledge base via RAG and answer using Claude. Try adding knowledge sources in Build > Knowledge > Sources.",
  "Great question! When connected to the backend, I use pgvector semantic search over your indexed documents to find the most relevant context, then generate a response with Anthropic Claude.",
  "In a live deployment, my responses are streamed token-by-token via WebSocket so they appear in real time — just like ChatGPT's streaming. Pretty cool, right?",
  "I can handle intents, FAQs, and free-form questions. Connect a knowledge source with some content and I'll give much more useful answers!",
]
let demoReplyIdx = 0

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  ragChunks?: number
}

export interface PreviewGraph {
  nodes: Array<{ id: string; data: { kind: string; label?: string; config?: Record<string, unknown> } }>
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>
}

interface PreviewSnapshot {
  currentNodeId: string
  status: string
  waitingFor?: { nodeId: string; variable: string; type: string; choices?: string[] }
  variables: { flow: Record<string, unknown>; global: Record<string, unknown>; contact: Record<string, unknown> }
}

interface ChatWidgetProps {
  botId: string
  botName?: string
  avatarUrl?: string | null
  systemPrompt?: string
  onClose?: () => void
  className?: string
  autoFocus?: boolean
  /** The chart on screen. Test Bot walks this, one question at a time. */
  flowGraph?: PreviewGraph
}

function welcomeLine(name: string, followsChart: boolean): string {
  if (followsChart) return ''
  if (isDemoMode()) {
    return `Hi! I'm ${name} (demo mode). Type a message to see the streaming chat UI in action. In production, I'd use RAG + Claude to answer from your knowledge base.`
  }
  return `Hi! I'm ${name}. Ask me anything — I'll search my knowledge base and answer.`
}

export function ChatWidget({ botId, botName = 'Bot', avatarUrl, systemPrompt, onClose, className, autoFocus = false, flowGraph }: ChatWidgetProps) {
  const followsChart = Boolean(flowGraph)
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const content = welcomeLine(botName, followsChart)
    return content ? [{ id: 'welcome', role: 'assistant', content }] : []
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [ragStats, setRagStats] = useState<{ chunkCount: number; sourceCount: number } | null>(null)
  const [showStats, setShowStats] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sessionRef = useRef<PreviewSnapshot | undefined>(undefined)
  const graphRef = useRef(flowGraph)
  graphRef.current = flowGraph
  const token = useAppStore((s: { token: string | null }) => s.token)
  const openedRef = useRef(false)

  useEffect(() => {
    if (!token || isDemoMode() || flowGraph) return
    preview.knowledgeStats(botId)
      .then((r) => setRagStats(r.data))
      .catch(() => {})
  }, [botId, token, flowGraph])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!autoFocus) return
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [autoFocus])

  const historyForApi = useCallback((): Array<{ role: 'user' | 'assistant'; content: string }> => {
    return messages
      .filter((m) => m.id !== 'welcome' && !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-10) // keep last 10 turns for context
  }, [messages])

  const busyRef = useRef(false)

  async function deliver(openingText?: string) {
    const opening = openingText !== undefined
    const text = (opening ? openingText : input).trim()
    if (!text || busyRef.current) return

    if (!opening) setInput('')
    busyRef.current = true
    setLoading(true)

    const userMsg: ChatMessage = { id: `u_${Date.now()}`, role: 'user', content: text }
    const assistantId = `a_${Date.now()}`
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', streaming: true }

    setMessages((prev) => opening ? [...prev, assistantMsg] : [...prev, userMsg, assistantMsg])

    // Demo mode: simulate a typed reply without hitting the API
    if (isDemoMode()) {
      const reply = DEMO_REPLIES[demoReplyIdx % DEMO_REPLIES.length]!
      demoReplyIdx++
      let i = 0
      const interval = setInterval(() => {
        i = Math.min(i + 3, reply.length)
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, content: reply.slice(0, i) } : m)
        )
        if (i >= reply.length) {
          clearInterval(interval)
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId ? { ...m, streaming: false, ragChunks: 0 } : m)
          )
          setLoading(false)
          busyRef.current = false
          inputRef.current?.focus()
        }
      }, 25)
      return
    }

    abortRef.current = new AbortController()
    let fullText = ''
    let ragChunks = 0

    try {
      const res = await preview.chatStream(botId, {
        message: text,
        systemPrompt,
        history: opening ? [] : historyForApi(),
        ...(graphRef.current ? { graph: graphRef.current, session: sessionRef.current } : {}),
      })

      if (!res.ok || !res.body) {
        // Non-demo API error — show friendly message
        fullText = res.status === 401
          ? 'Not authenticated. Please sign in again.'
          : 'The bot preview is unavailable right now. Make sure the API is running and an LLM key (GEMINI_API_KEY, GROQ_API_KEY, or a paid key) is configured.'
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, content: fullText, streaming: false } : m)
        )
        setLoading(false)
        busyRef.current = false
        inputRef.current?.focus()
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) continue
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as { text?: string; fullText?: string; ragChunks?: number; message?: string; session?: PreviewSnapshot }
            if (data.session) sessionRef.current = data.session
            if (data.text !== undefined) {
              fullText += data.text
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId ? { ...m, content: fullText } : m)
              )
            }
            if (data.fullText !== undefined) {
              fullText = data.fullText
              ragChunks = data.ragChunks ?? 0
            }
            if (data.message !== undefined) {
              fullText = `I had trouble generating a response. Please try again.`
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      fullText = 'Connection lost. Please check that the API server is running.'
    } finally {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: fullText || "I couldn't generate a response.", streaming: false, ragChunks }
            : m
        )
      )
      setLoading(false)
      busyRef.current = false
      inputRef.current?.focus()
    }
  }

  const deliverRef = useRef(deliver)
  deliverRef.current = deliver

  useEffect(() => {
    if (!followsChart || isDemoMode() || openedRef.current) return
    openedRef.current = true
    void deliverRef.current('hi')
  }, [followsChart])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void deliver()
    }
  }

  function reset() {
    abortRef.current?.abort()
    sessionRef.current = undefined
    busyRef.current = false
    setLoading(false)
    setInput('')
    if (followsChart && !isDemoMode()) {
      setMessages([])
      void deliverRef.current('hi')
      return
    }
    setMessages([{ id: 'welcome', role: 'assistant', content: welcomeLine(botName, false) }])
    inputRef.current?.focus()
  }

  return (
    <div className={cn('flex flex-col bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-elevated)] shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Avatar name={botName} src={avatarUrl} size="xs" />
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--success)] border border-[var(--bg-elevated)]" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">{botName}</p>
            <p className="text-[11px] text-[var(--text-muted)]">{followsChart ? 'This chart' : 'Test Preview'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {ragStats && (
            <button
              onClick={() => setShowStats((s) => !s)}
              className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
              title="Knowledge base stats"
            >
              <Database size={11} />
              <span>{ragStats.chunkCount} chunks</span>
              {showStats ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          )}
          <button
            onClick={reset}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            title="Reset chat"
          >
            <RotateCcw size={13} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Stats panel */}
      {showStats && ragStats && (
        <div className="px-4 py-2 bg-[var(--accent-muted)] border-b border-[var(--border)] flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
          <Sparkles size={11} className="text-[var(--accent)] shrink-0" />
          <span>{ragStats.sourceCount} knowledge {ragStats.sourceCount === 1 ? 'source' : 'sources'}</span>
          <span className="text-[var(--border)]">·</span>
          <span>{ragStats.chunkCount} indexed {ragStats.chunkCount === 1 ? 'chunk' : 'chunks'}</span>
          {ragStats.chunkCount === 0 && (
            <span className="text-[var(--warning,#fbbf24)] ml-1">⚠ No knowledge indexed yet</span>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.map((msg) => (
          <div key={msg.id} className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.role === 'assistant' && (
              <Avatar name={botName} src={avatarUrl} size="xs" className="shrink-0 mt-1" />
            )}
            <div className="max-w-[85%]">
              <div
                className={cn(
                  'rounded-2xl px-3 py-2 text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'rounded-tr-sm bg-[var(--accent)] text-white'
                    : 'rounded-tl-sm bg-[var(--bg-overlay)] text-[var(--text-primary)] border border-[var(--border)]'
                )}
              >
                {msg.content ? <ChatText text={msg.content} /> : (msg.streaming && (
                  <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                    <Loader2 size={12} className="animate-spin" />
                    Thinking…
                  </span>
                ))}
                {msg.streaming && msg.content && (
                  <span className="inline-block w-1 h-4 ml-0.5 bg-current rounded-sm animate-pulse align-middle" />
                )}
              </div>
              {msg.role === 'assistant' && msg.ragChunks !== undefined && msg.ragChunks > 0 && (
                <p className="mt-0.5 text-[10px] text-[var(--text-muted)] pl-1 flex items-center gap-1">
                  <Database size={9} />
                  {msg.ragChunks} knowledge chunk{msg.ragChunks !== 1 ? 's' : ''} used
                </p>
              )}
            </div>
            {msg.role === 'user' && (
              <Avatar name="You" size="xs" className="shrink-0 mt-1" />
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 focus-within:border-[var(--accent)] transition-colors">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            disabled={loading}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <Button
            size="icon-sm"
            variant={input.trim() ? 'default' : 'ghost'}
            onClick={() => void deliver()}
            disabled={!input.trim() || loading}
            className="shrink-0"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
          {followsChart ? 'This chat follows the chart. One question at a time.' : `Powered by BotStudio · RAG + ${import.meta.env.VITE_LLM_LABEL ?? 'Claude'}`}
        </p>
      </div>
    </div>
  )
}
