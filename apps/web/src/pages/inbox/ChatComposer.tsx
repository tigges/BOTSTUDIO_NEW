import React, { useState } from 'react'
import { MessageCircle, Send, StickyNote, Wrench, Zap } from 'lucide-react'
import { Button, cn } from '@ybot/ui'
import { RunToolPanel } from './RunToolPanel'

type Mode = 'reply' | 'note'

export function ChatComposer(props: {
  chatId: string
  canned: Array<{ id: string; shortcut: string; text: string }>
  sending: boolean
  error?: string
  onSend: (text: string, internal: boolean) => Promise<boolean>
}) {
  const [reply, setReply] = useState('')
  const [mode, setMode] = useState<Mode>('reply')
  const [showTools, setShowTools] = useState(false)
  const [cannedOpen, setCannedOpen] = useState(false)
  const [cannedFilter, setCannedFilter] = useState('')

  const filteredCanned = props.canned.filter((r) =>
    r.shortcut.includes(cannedFilter) || r.text.toLowerCase().includes(cannedFilter.toLowerCase()),
  )

  function onChange(value: string) {
    setReply(value)
    if (value.startsWith('/')) {
      setCannedOpen(true)
      setCannedFilter(value.slice(1))
    } else {
      setCannedOpen(false)
    }
  }

  async function send() {
    if (!reply.trim() || props.sending) return
    if (await props.onSend(reply, mode === 'note')) {
      setReply('')
      setCannedOpen(false)
    }
  }

  return (
    <div className="border-t border-[var(--border)] shrink-0">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <button
          type="button"
          onClick={() => setMode('reply')}
          className={cn('flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium transition-colors', mode === 'reply' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}
        >
          <MessageCircle size={12} /> Reply
        </button>
        <button
          type="button"
          onClick={() => setMode('note')}
          className={cn(
            'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium transition-colors',
            mode === 'note' ? 'bg-[var(--warning-muted,#2d2000)] text-[var(--warning,#fbbf24)] border border-[var(--warning,#fbbf24)]/30' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]',
          )}
        >
          <StickyNote size={12} /> Internal note
        </button>
      </div>

      {showTools && <RunToolPanel conversationId={props.chatId} onClose={() => setShowTools(false)} />}

      {cannedOpen && (
        <div className="mx-4 mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden shadow-[var(--shadow-lg)] max-h-44 overflow-y-auto">
          <div className="px-3 py-1.5 bg-[var(--bg-overlay)] border-b border-[var(--border)]">
            <p className="text-[11px] text-[var(--text-muted)] font-medium">Saved replies</p>
          </div>
          {filteredCanned.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
              {props.canned.length === 0 ? 'No saved replies yet. Add them in Inbox settings.' : `No saved reply matches “/${cannedFilter}”.`}
            </p>
          ) : filteredCanned.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => { setReply(r.text); setCannedOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-[var(--bg-hover)] transition-colors"
            >
              <p className="text-[11px] font-mono text-[var(--accent)]">/{r.shortcut.replace(/^\//, '')}</p>
              <p className="text-xs text-[var(--text-secondary)] truncate">{r.text}</p>
            </button>
          ))}
        </div>
      )}

      <div className={cn(
        'mx-4 mb-3 rounded-[var(--radius-md)] border transition-colors',
        mode === 'note' ? 'border-[var(--warning,#fbbf24)]/40 bg-[var(--warning-muted,#2d2000)]/30' : 'border-[var(--border)] bg-[var(--bg-surface)]',
      )}>
        <textarea
          aria-label={mode === 'note' ? 'Internal note' : 'Reply'}
          placeholder={mode === 'note' ? 'Add an internal note… (not visible to customer)' : 'Type a reply… (type / for saved replies)'}
          value={reply}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send() }}
          rows={3}
          className="w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => { setCannedOpen((open) => !open); setCannedFilter('') }}
              className={cn('p-1.5 rounded hover:bg-[var(--bg-hover)] transition-colors', cannedOpen ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]')}
              title="Saved replies"
              aria-label="Saved replies"
            >
              <Zap size={14} />
            </button>
            <button
              type="button"
              onClick={() => setShowTools((open) => !open)}
              className={cn('p-1.5 rounded hover:bg-[var(--bg-hover)] transition-colors', showTools ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]')}
              title="Run a tool"
              aria-label="Run a tool"
            >
              <Wrench size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            {props.error && <span className="text-[11px] text-[var(--error)]">{props.error}</span>}
            <span className="text-[10px] text-[var(--text-muted)]">⌘↵ to send</span>
            <Button size="sm" disabled={!reply.trim() || props.sending} onClick={() => void send()} variant={mode === 'note' ? 'secondary' : 'default'} className="gap-1.5">
              <Send size={12} />
              {mode === 'note' ? 'Add note' : 'Send'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
