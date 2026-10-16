import React, { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw, Send, X } from 'lucide-react'
import { Avatar, Button, cn } from '@ybot/ui'
import { runJourneyPreview, type FlowGraph, type JourneyPreviewSnapshot } from '@ybot/runtime'
import type { StudioCatalog } from '@ybot/shared'
import { ChatText } from '../../components/ChatText'

export interface JourneyTestChapter {
  name: string
  graph: FlowGraph
}

interface ChatLine {
  id: string
  role: 'user' | 'assistant'
  content: string
}

/**
 * The guest starts at the welcome. Each handoff continues in the next chapter
 * when that chapter is on the current map.
 */
export function JourneyTest({
  botName,
  chapters,
  startChapter,
  environmentLabel,
  chapterKey,
  catalog,
  onChapter,
  onClose,
}: {
  botName: string
  chapters: JourneyTestChapter[]
  startChapter: string
  environmentLabel: string
  chapterKey: string
  catalog?: StudioCatalog
  onChapter: (name: string) => void
  onClose: () => void
}) {
  const [messages, setMessages] = useState<ChatLine[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const sessionRef = useRef<JourneyPreviewSnapshot | undefined>(undefined)
  const chaptersRef = useRef(chapters)
  const catalogRef = useRef(catalog)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  chaptersRef.current = chapters
  catalogRef.current = catalog

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function turn(text: string, opening: boolean) {
    if ((!text && !opening) || busyRef.current) return
    busyRef.current = true
    setLoading(true)
    const assistantId = `a_${Date.now()}`
    setMessages((prev) => opening
      ? [...prev, { id: assistantId, role: 'assistant', content: '' }]
      : [...prev, { id: `u_${Date.now()}`, role: 'user', content: text }, { id: assistantId, role: 'assistant', content: '' }])
    try {
      const result = await runJourneyPreview({
        chapters: chaptersRef.current,
        startChapter,
        message: text,
        environmentLabel,
        session: sessionRef.current,
        catalog: catalogRef.current,
      })
      if (result.session) sessionRef.current = result.session
      onChapter(result.chapter || startChapter)
      const reply = result.text || 'I don’t have a next line for that.'
      setMessages((prev) => prev.map((line) => line.id === assistantId ? { ...line, content: reply } : line))
    } catch {
      setMessages((prev) => prev.map((line) => line.id === assistantId ? { ...line, content: 'This journey could not be walked just now.' } : line))
    } finally {
      busyRef.current = false
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  useEffect(() => {
    let cancel = false
    sessionRef.current = undefined
    busyRef.current = false
    setMessages([])
    setInput('')
    onChapter(startChapter)
    void (async () => {
      busyRef.current = true
      setLoading(true)
      try {
        const result = await runJourneyPreview({
          chapters: chaptersRef.current,
          startChapter,
          message: '',
          environmentLabel,
          catalog: catalogRef.current,
        })
        if (cancel) return
        if (result.session) sessionRef.current = result.session
        onChapter(result.chapter || startChapter)
        const reply = result.text || 'I don’t have a next line for that.'
        setMessages([{ id: 'open', role: 'assistant', content: reply }])
      } catch {
        if (!cancel) setMessages([{ id: 'open', role: 'assistant', content: 'This journey could not be walked just now.' }])
      } finally {
        if (!cancel) {
          busyRef.current = false
          setLoading(false)
          inputRef.current?.focus()
        }
      }
    })()
    return () => { cancel = true }
    // The chapter set and the environment decide which graphs this chat walks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startChapter, environmentLabel, chapterKey])

  function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    void turn(text, false)
  }

  function reset() {
    sessionRef.current = undefined
    busyRef.current = false
    setInput('')
    setMessages([])
    onChapter(startChapter)
    void turn('', true)
  }

  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-surface)]" data-testid="journey-test">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Avatar name={botName} size="xs" />
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">{botName}</p>
            <p className="text-[11px] text-[var(--text-muted)]">This journey · {environmentLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" title="Reset chat" onClick={reset}>
            <RotateCcw size={13} />
          </button>
          <button type="button" className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" title="Hide test" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((line) => (
          <div key={line.id} className={cn('flex gap-2', line.role === 'user' ? 'justify-end' : 'justify-start')}>
            {line.role === 'assistant' && <Avatar name={botName} size="xs" className="mt-1 shrink-0" />}
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                line.role === 'user'
                  ? 'rounded-tr-sm bg-[var(--accent)] text-white'
                  : 'rounded-tl-sm border border-[var(--border)] bg-[var(--bg-overlay)] text-[var(--text-primary)]',
              )}
            >
              {line.content ? <ChatText text={line.content} /> : (loading && (
                <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                  <Loader2 size={12} className="animate-spin" />
                  Thinking…
                </span>
              ))}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="shrink-0 border-t border-[var(--border)] px-3 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 focus-within:border-[var(--accent)]">
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
            placeholder="Type a message…"
            disabled={loading}
            aria-label="Message the journey"
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <Button size="icon-sm" variant={input.trim() ? 'default' : 'ghost'} onClick={send} disabled={!input.trim() || loading} className="shrink-0">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">Starts at the welcome and follows each handoff.</p>
      </div>
    </div>
  )
}
