import React, { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw, Send, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { Avatar, Button, cn } from '@botstudio/ui'
import type { FlowGraph } from '@botstudio/runtime'
import type { StudioCatalog } from '@botstudio/shared'
import { preview, type TestChatState } from '../../lib/api'
import { joinNotes, testChatNote, testToolNote } from '../../lib/test-chat-format'
import { ChatText } from '../../components/ChatText'

export interface JourneyTestChapter {
  name: string
  graph: FlowGraph
}

export type StepVote = 'up' | 'down'

export interface JourneyTestLine {
  role: 'user' | 'assistant'
  content: string
  chapter?: string
}

interface ChatLine extends JourneyTestLine {
  id: string
  /** What happened beyond the bot's words (a handover, an outcome). Not part of the chat. */
  note?: boolean
}

function chatLines(lines: ChatLine[]): JourneyTestLine[] {
  return lines.filter((line) => !line.note).map((line) => ({ role: line.role, content: line.content, chapter: line.chapter }))
}

/**
 * The guest starts at the welcome. Header thumbs rate the chapter the guest is in.
 * Every turn runs on the server through the same stages as a live chat, over this working copy.
 */
export function JourneyTest({
  botId,
  botName,
  avatarUrl,
  chapters,
  startChapter,
  environmentLabel,
  chapterKey,
  catalog,
  votes = {},
  replayKey,
  replayLines,
  onChapter,
  onVote,
  onClose,
}: {
  /** Empty while a new bot is still a draft. */
  botId?: string | null
  botName: string
  avatarUrl?: string | null
  chapters: JourneyTestChapter[]
  startChapter: string
  environmentLabel: string
  chapterKey: string
  catalog?: StudioCatalog
  votes?: Record<string, StepVote>
  replayKey?: number
  replayLines?: string[]
  onChapter: (name: string) => void
  onVote?: (input: { chapter: string; vote: StepVote; lines: JourneyTestLine[] }) => void
  onClose: () => void
}) {
  const [messages, setMessages] = useState<ChatLine[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentChapter, setCurrentChapter] = useState(startChapter)
  const stateRef = useRef<TestChatState | undefined>(undefined)
  const chaptersRef = useRef(chapters)
  const catalogRef = useRef(catalog)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const replaySeen = useRef(0)
  chaptersRef.current = chapters
  catalogRef.current = catalog

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function setChapter(name: string) {
    setCurrentChapter(name)
    onChapter(name)
  }

  async function walk(text: string, state?: TestChatState) {
    const result = await preview.journey(botId, {
      chapters: chaptersRef.current,
      startChapter,
      message: text,
      environmentLabel,
      state,
      catalog: catalogRef.current,
    })
    const turn = result.data
    stateRef.current = turn.state
    const note = joinNotes(testToolNote(turn.tools), testChatNote(state, turn.state, turn.path))
    return { ...turn, note: note ? [{ id: `n_${Date.now()}`, role: 'assistant' as const, content: note, note: true }] : [] }
  }

  function botLine(path: string, text: string): string {
    if (text) return text
    return path === 'held' || path === 'handover' ? '' : 'I don’t have a next line for that.'
  }

  async function turn(text: string, opening: boolean) {
    if ((!text && !opening) || busyRef.current) return
    busyRef.current = true
    setLoading(true)
    const assistantId = `a_${Date.now()}`
    setMessages((prev) => opening
      ? [...prev, { id: assistantId, role: 'assistant', content: '' }]
      : [...prev, { id: `u_${Date.now()}`, role: 'user', content: text }, { id: assistantId, role: 'assistant', content: '' }])
    try {
      const result = await walk(text, stateRef.current)
      setChapter(result.chapter || startChapter)
      const reply = botLine(result.path, result.text)
      setMessages((prev) => [
        ...prev.flatMap((line) => {
          if (line.id !== assistantId) return [line]
          return reply ? [{ ...line, content: reply, chapter: result.chapter }] : []
        }),
        ...result.note,
      ])
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
    stateRef.current = undefined
    busyRef.current = false
    setMessages([])
    setInput('')
    setChapter(startChapter)
    void (async () => {
      busyRef.current = true
      setLoading(true)
      try {
        const result = await walk('', undefined)
        if (cancel) return
        setChapter(result.chapter || startChapter)
        const reply = botLine(result.path, result.text)
        setMessages([...(reply ? [{ id: 'open', role: 'assistant' as const, content: reply, chapter: result.chapter }] : []), ...result.note])
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

  useEffect(() => {
    if (!replayKey || replayKey === replaySeen.current) return
    replaySeen.current = replayKey
    const lines = replayLines ?? []
    void (async () => {
      stateRef.current = undefined
      busyRef.current = false
      setMessages([])
      setChapter(startChapter)
      await turn('', true)
      for (const line of lines) await turn(line, false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey])

  function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    void turn(text, false)
  }

  function reset() {
    stateRef.current = undefined
    busyRef.current = false
    setInput('')
    setMessages([])
    setChapter(startChapter)
    void turn('', true)
  }

  const stepVote = votes[currentChapter]
  const rated = Object.entries(votes)

  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-surface)]" data-testid="journey-test">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={botName} src={avatarUrl} size="xs" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">{botName}</p>
            <p className="truncate text-[11px] text-[var(--text-muted)]">This step · {currentChapter}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onVote && (
            <>
          <button
            type="button"
            className={cn(
              'rounded-md p-1.5 hover:bg-[var(--bg-hover)]',
              stepVote === 'up' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
            )}
            title={`This step is good: ${currentChapter}`}
            disabled={loading || !currentChapter}
            onClick={() => onVote({
              chapter: currentChapter,
              vote: 'up',
              lines: chatLines(messages),
            })}
          >
            <ThumbsUp size={13} />
          </button>
          <button
            type="button"
            className={cn(
              'rounded-md p-1.5 hover:bg-[var(--bg-hover)]',
              stepVote === 'down' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
            )}
            title={`This step needs work: ${currentChapter}`}
            disabled={loading || !currentChapter}
            data-testid="journey-step-down"
            onClick={() => onVote({
              chapter: currentChapter,
              vote: 'down',
              lines: chatLines(messages),
            })}
          >
            <ThumbsDown size={13} />
          </button>
            </>
          )}
          <button type="button" className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" title="Reset chat" onClick={reset}>
            <RotateCcw size={13} />
          </button>
          <button type="button" className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" title="Hide test" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
      </div>
      {rated.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-[var(--border)] px-4 py-2" data-testid="journey-step-votes">
          {rated.map(([name, mark]) => (
            <span
              key={name}
              className={cn(
                'rounded-lg border px-1.5 py-0.5 text-[10px]',
                name === currentChapter
                  ? 'border-[var(--accent)] text-[var(--text-primary)]'
                  : 'border-[var(--border)] text-[var(--text-muted)]',
              )}
            >
              {name} · {mark === 'up' ? 'good' : 'look'}
            </span>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((line) => line.note ? (
          <p key={line.id} className="px-2 text-center text-[11px] leading-relaxed text-[var(--text-muted)]" data-testid="journey-test-note">
            {line.content}
          </p>
        ) : (
          <div key={line.id} className={cn('flex gap-2', line.role === 'user' ? 'justify-end' : 'justify-start')}>
            {line.role === 'assistant' && <Avatar name={botName} src={avatarUrl} size="xs" className="mt-1 shrink-0" />}
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
        <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
          {onVote ? `Thumbs rate ${currentChapter}. Runs like a live chat; nothing reaches the Inbox.` : 'Runs like a live chat from the welcome; nothing reaches the Inbox.'}
        </p>
      </div>
    </div>
  )
}
