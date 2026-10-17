import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Flag, Loader2, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import { Avatar, Button, cn } from '@ybot/ui'
import { runJourneyPreview, type FlowGraph, type JourneyPreviewSnapshot } from '@ybot/runtime'
import {
  applyChatFindings,
  findingsFromChat,
  type ChatFinding,
  type ChatOptimizeNote,
  type StudioCatalog,
} from '@ybot/shared'
import { ChatText } from '../../components/ChatText'

export interface JourneyTestChapter {
  name: string
  graph: FlowGraph
}

interface ChatLine {
  id: string
  role: 'user' | 'assistant'
  content: string
  chapter?: string
}

/**
 * The guest starts at the welcome. Each handoff continues in the next chapter
 * when that chapter is on the current map.
 */
export function JourneyTest({
  botName,
  avatarUrl,
  chapters,
  startChapter,
  environmentLabel,
  chapterKey,
  catalog,
  onChapter,
  onClose,
  onApply,
}: {
  botName: string
  avatarUrl?: string | null
  chapters: JourneyTestChapter[]
  startChapter: string
  environmentLabel: string
  chapterKey: string
  catalog?: StudioCatalog
  onChapter: (name: string) => void
  onClose: () => void
  onApply?: (changes: JourneyTestChapter[]) => Promise<void> | void
}) {
  const [messages, setMessages] = useState<ChatLine[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pane, setPane] = useState<'chat' | 'review'>('chat')
  const [overlay, setOverlay] = useState<Record<string, FlowGraph>>({})
  const [notes, setNotes] = useState<ChatOptimizeNote[]>([])
  const [flagged, setFlagged] = useState<Set<string>>(new Set())
  const [noteDraft, setNoteDraft] = useState('')
  const [applyError, setApplyError] = useState('')
  const [applying, setApplying] = useState(false)
  const sessionRef = useRef<JourneyPreviewSnapshot | undefined>(undefined)
  const chaptersRef = useRef(chapters)
  const catalogRef = useRef(catalog)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const liveChapters = useMemo(
    () => chapters.map((chapter) => (overlay[chapter.name] ? { ...chapter, graph: overlay[chapter.name]! } : chapter)),
    [chapters, overlay],
  )
  catalogRef.current = catalog
  chaptersRef.current = liveChapters

  const findings = useMemo(
    () => findingsFromChat({
      lines: messages.map((line) => ({ role: line.role, content: line.content, chapter: line.chapter })),
      chapters: liveChapters,
      notes,
    }),
    [messages, liveChapters, notes],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pane])

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
      setMessages((prev) => prev.map((line) => (
        line.id === assistantId ? { ...line, content: reply, chapter: result.chapter } : line
      )))
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
    chaptersRef.current = chapters
    setMessages([])
    setInput('')
    setPane('chat')
    setOverlay({})
    setNotes([])
    setFlagged(new Set())
    setNoteDraft('')
    setApplyError('')
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
        setMessages([{ id: 'open', role: 'assistant', content: reply, chapter: result.chapter }])
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
    setPane('chat')
    setApplyError('')
    onChapter(startChapter)
    void turn('', true)
  }

  function flagLine(line: ChatLine) {
    setFlagged((prev) => {
      const next = new Set(prev)
      next.add(line.id)
      return next
    })
    setNotes((prev) => {
      if (prev.some((note) => note.lineContent === line.content && note.text.startsWith('This turn'))) return prev
      return [...prev, { lineContent: line.content, text: `This turn should change: ${line.content.slice(0, 120)}` }]
    })
  }

  function addNote() {
    const text = noteDraft.trim()
    if (!text) return
    const last = [...messages].reverse().find((line) => line.content.trim())
    setNotes((prev) => [...prev, { lineContent: last?.content ?? '', text }])
    setNoteDraft('')
  }

  async function replayGuestLines(lines: string[]) {
    sessionRef.current = undefined
    busyRef.current = false
    setMessages([])
    onChapter(startChapter)
    await turn('', true)
    for (const line of lines) {
      await turn(line, false)
    }
  }

  async function applyFindings(selected: ChatFinding[]) {
    const applyable = selected.filter((finding) => finding.applyable)
    if (applyable.length === 0) {
      setPane('chat')
      return
    }
    setApplying(true)
    setApplyError('')
    const next = applyChatFindings({
      chapters: liveChapters,
      findings: applyable,
    })
    const changed = next.chapters.filter((chapter, index) => chapter.graph !== liveChapters[index]?.graph)
    const patch: Record<string, FlowGraph> = { ...overlay }
    for (const chapter of changed) patch[chapter.name] = chapter.graph as FlowGraph
    setOverlay(patch)
    chaptersRef.current = chapters.map((chapter) => (patch[chapter.name] ? { ...chapter, graph: patch[chapter.name]! } : chapter))
    const guestLines = messages.filter((line) => line.role === 'user' && line.content.trim()).map((line) => line.content)
    try {
      if (changed.length > 0) await onApply?.(changed.map((chapter) => ({ name: chapter.name, graph: chapter.graph as FlowGraph })))
      setPane('chat')
      await replayGuestLines(guestLines)
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Could not save those chart edits.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-surface)]" data-testid="journey-test">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Avatar name={botName} src={avatarUrl} size="xs" />
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">{botName}</p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {pane === 'review' ? 'Review this chat' : `This journey · ${environmentLabel}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={cn('rounded-md p-1.5 hover:bg-[var(--bg-hover)]', pane === 'review' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]')}
            title="Review this chat"
            onClick={() => setPane((open) => (open === 'review' ? 'chat' : 'review'))}
          >
            <Sparkles size={13} />
          </button>
          <button type="button" className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" title="Reset chat" onClick={reset}>
            <RotateCcw size={13} />
          </button>
          <button type="button" className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" title="Hide test" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
      </div>
      {pane === 'review' ? (
        <ReviewPane
          findings={findings}
          notes={notes}
          noteDraft={noteDraft}
          applyError={applyError}
          applying={applying}
          onNoteDraft={setNoteDraft}
          onAddNote={addNote}
          onApply={(items) => { void applyFindings(items) }}
          onBack={() => setPane('chat')}
        />
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.map((line) => (
              <div key={line.id} className={cn('flex gap-2', line.role === 'user' ? 'justify-end' : 'justify-start')}>
                {line.role === 'assistant' && <Avatar name={botName} src={avatarUrl} size="xs" className="mt-1 shrink-0" />}
                <div className="flex max-w-[85%] flex-col items-stretch gap-1">
                  <div
                    className={cn(
                      'rounded-2xl px-3 py-2 text-sm leading-relaxed',
                      line.role === 'user'
                        ? 'rounded-tr-sm bg-[var(--accent)] text-white'
                        : 'rounded-tl-sm border border-[var(--border)] bg-[var(--bg-overlay)] text-[var(--text-primary)]',
                      flagged.has(line.id) && 'ring-1 ring-[var(--accent)]',
                    )}
                  >
                    {line.content ? <ChatText text={line.content} /> : (loading && (
                      <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                        <Loader2 size={12} className="animate-spin" />
                        Thinking…
                      </span>
                    ))}
                  </div>
                  {line.content && (
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1 self-end text-[10px]',
                        flagged.has(line.id) ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                      )}
                      title="To wizard"
                      onClick={() => flagLine(line)}
                    >
                      <Flag size={10} /> To wizard
                    </button>
                  )}
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
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="text-[10px] text-[var(--text-muted)]">Starts at the welcome and follows each handoff.</p>
              <button
                type="button"
                className="text-[10px] font-medium text-[var(--accent)] hover:underline"
                onClick={() => setPane('review')}
              >
                Review this chat
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ReviewPane({
  findings,
  notes,
  noteDraft,
  applyError,
  applying,
  onNoteDraft,
  onAddNote,
  onApply,
  onBack,
}: {
  findings: ChatFinding[]
  notes: ChatOptimizeNote[]
  noteDraft: string
  applyError: string
  applying: boolean
  onNoteDraft: (value: string) => void
  onAddNote: () => void
  onApply: (findings: ChatFinding[]) => void
  onBack: () => void
}) {
  const applyable = findings.filter((finding) => finding.applyable)
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="journey-chat-wizard">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
          Suggestions come from this last walk. Apply edits the working copy, then replays the same guest lines.
        </p>
        {findings.length === 0 && (
          <p className="text-[12px] text-[var(--text-muted)]">Nothing to change from this chat yet. Flag a turn or add a note.</p>
        )}
        {findings.map((finding) => (
          <div key={finding.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2.5">
            <p className="text-[12px] font-semibold text-[var(--text-primary)]">{finding.title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{finding.detail}</p>
            {finding.applyable && (
              <Button
                size="sm"
                className="mt-2"
                disabled={applying}
                onClick={() => onApply([finding])}
              >
                Apply
              </Button>
            )}
          </div>
        ))}
        <div className="rounded-xl border border-[var(--border)] px-3 py-2.5">
          <p className="text-[12px] font-semibold text-[var(--text-primary)]">A note to the wizard</p>
          {notes.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {notes.map((note, index) => (
                <li key={`${note.text}-${index}`} className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{note.text}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex items-center gap-2">
            <input
              value={noteDraft}
              onChange={(event) => onNoteDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onAddNote()
                }
              }}
              placeholder="What should this chat do instead?"
              aria-label="Note to the wizard"
              className="h-8 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
            <Button size="sm" variant="secondary" onClick={onAddNote} disabled={!noteDraft.trim()}>Add</Button>
          </div>
        </div>
        {applyError && <p className="text-[12px] text-[var(--danger)]">{applyError}</p>}
      </div>
      <div className="shrink-0 space-y-2 border-t border-[var(--border)] px-3 py-3">
        <Button
          size="md"
          className="w-full"
          disabled={applying || applyable.length === 0}
          onClick={() => onApply(applyable)}
        >
          {applying ? <Loader2 size={13} className="animate-spin" /> : null}
          {applyable.length > 1 ? 'Apply all and replay' : 'Apply and replay'}
        </Button>
        <button type="button" className="w-full text-center text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={onBack}>
          Back to chat
        </button>
      </div>
    </div>
  )
}
