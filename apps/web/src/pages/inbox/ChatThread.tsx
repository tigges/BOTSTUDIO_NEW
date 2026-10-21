import React, { useEffect, useRef } from 'react'
import { ArrowRightLeft, BookOpen, CheckCheck, ChevronDown, ClipboardList, MoreHorizontal, ShieldAlert, StickyNote, Tag, UserPlus } from 'lucide-react'
import { Avatar, Button, cn } from '@ybot/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@ybot/ui'
import { GUARDRAIL_ACTION_LABELS, type ReturnOutcome } from '@ybot/shared'
import type * as api from '../../lib/api'
import { formatLlmCost, llmCallsLine } from '../../lib/outcome-format'
import { showsHandover } from '../../lib/handover-format'
import { ChatText } from '../../components/ChatText'
import { HandoverCard } from './HandoverCard'
import { ChannelIcon, SlaChip, TestRunChip, guardrailFlag, type ChatLine, type Convo } from './chat-model'

type Member = { id: string; displayName: string }

export function ChatHeader(props: {
  chat: Convo
  detail: api.Conversation | undefined
  members: Member[]
  onAssign: (id: string | null) => void
  onResolve: () => void
  onTransfer: () => void
  onTask: () => void
  onLabels: () => void
}) {
  const { chat } = props
  return (
    <div className="flex h-[var(--topbar-height)] items-center justify-between border-b border-[var(--border)] px-4 shrink-0 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar name={chat.name} size="sm" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{chat.name}</p>
          <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
            <ChannelIcon ch={chat.channel} />
            {chat.channel}
            {chat.assignee
              ? <> · Assigned to <span className="text-[var(--text-secondary)]">{chat.assignee}</span></>
              : <> · <span className="text-[var(--warning,#fbbf24)]">Unassigned</span></>}
            <> · <span title={llmCallsLine(props.detail?.llm)}>Model cost {formatLlmCost(props.detail?.llm)}</span></>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <UserPlus size={13} />
              {chat.assignee ?? 'Assign'}
              <ChevronDown size={11} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Assign to agent</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => props.onAssign(null)}>Unassigned</DropdownMenuItem>
            {props.members.map((member) => (
              <DropdownMenuItem key={member.id} onClick={() => props.onAssign(member.id)}>
                <Avatar name={member.displayName} size="xs" />
                {member.displayName}
                {chat.assigneeId === member.id && <CheckCheck size={13} className="ml-auto text-[var(--accent)]" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant={chat.status === 'resolved' ? 'secondary' : 'default'} size="sm" onClick={props.onResolve}>
          {chat.status === 'resolved' ? 'Reopen' : 'Resolve'}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions"><MoreHorizontal size={15} /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={props.onTransfer}><ArrowRightLeft size={13} /> Transfer conversation</DropdownMenuItem>
            <DropdownMenuItem onClick={props.onTask}><ClipboardList size={13} /> Add a task</DropdownMenuItem>
            <DropdownMenuItem onClick={props.onLabels}><Tag size={13} /> Manage labels</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export function ChatHandover(props: {
  chat: Convo
  detail: api.Conversation | undefined
  members: Member[]
  busy: boolean
  error?: string
  onHandBack: (outcome: ReturnOutcome, note: string) => void
}) {
  if (!props.detail || props.detail.id !== props.chat.id || !showsHandover(props.detail)) return null
  return (
    <HandoverCard
      chat={props.detail}
      memberName={(id) => props.members.find((m) => m.id === id)?.displayName}
      busy={props.busy}
      error={props.error}
      onHandBack={props.onHandBack}
    />
  )
}

export function ChatLabels({ chat }: { chat: Convo }) {
  if (!(chat.labels?.length || chat.testRun)) return null
  return (
    <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-[var(--border)] bg-[var(--bg-surface)]">
      <Tag size={11} className="text-[var(--text-muted)]" />
      {(chat.labels ?? []).map((l) => (
        <span key={l} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--bg-overlay)] text-[var(--text-secondary)] border border-[var(--border)]">{l}</span>
      ))}
      {chat.sla && <SlaChip sla={chat.sla} />}
      {chat.testRun && <TestRunChip />}
    </div>
  )
}

export function ChatMessages({ lines, streamingText, chatId }: { lines: ChatLine[]; streamingText?: string | null; chatId: string }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, chatId, streamingText])

  return (
    <div data-thread="messages" className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {lines.map((msg) => <div key={msg.id}>{msg.isNote ? <NoteBubble msg={msg} /> : <MessageBubble msg={msg} />}</div>)}
      {streamingText && (
        <div className="flex gap-3 px-4 py-2 justify-start">
          <Avatar name="BotStudio" size="xs" />
          <div className="max-w-[70%]">
            <p className="text-[11px] text-[var(--text-muted)] mb-1">BotStudio</p>
            <div className="rounded-2xl rounded-tl-sm px-3 py-2 text-sm bg-[var(--accent-muted)] text-[var(--text-primary)] border border-[var(--accent)]/20">
              {streamingText}
              <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-[var(--accent)] rounded-sm animate-pulse align-middle" />
            </div>
          </div>
        </div>
      )}
      <div ref={end} />
    </div>
  )
}

function NoteBubble({ msg }: { msg: ChatLine }) {
  return (
    <div className="flex gap-2.5 justify-start">
      <Avatar name={msg.name} size="sm" />
      <div className="min-w-0 max-w-[70%]">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">{msg.name}</span>
          <span className="text-[10px] text-[var(--text-muted)]">{msg.time}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--warning-muted,#2d2000)] text-[var(--warning,#fbbf24)] font-medium flex items-center gap-1">
            <StickyNote size={9} /> internal note
          </span>
        </div>
        <div className="rounded-[var(--radius-md)] px-3 py-2 text-sm bg-[var(--warning-muted,#2d2000)] border border-[var(--warning,#fbbf24)]/25 text-[var(--text-primary)]">
          <ChatText text={msg.text} />
          {msg.tool && (
            <details className="mt-1.5 text-[11px]">
              <summary className="cursor-pointer text-[var(--text-muted)]">{msg.tool.ok ? 'Result' : 'Details'}</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--bg-overlay)] p-2 font-mono text-[10px]">
                {JSON.stringify(msg.tool.ok ? msg.tool.output : { args: msg.tool.args, error: msg.tool.error }, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatLine }) {
  return (
    <div className={cn('flex gap-2.5', msg.from === 'user' ? 'flex-row' : 'flex-row-reverse')}>
      <Avatar name={msg.name} size="sm" />
      <div className={cn('max-w-[70%]', msg.from !== 'user' && 'items-end flex flex-col')}>
        <div className={cn('flex items-center gap-2 mb-1', msg.from !== 'user' && 'flex-row-reverse')}>
          <span className="text-xs font-medium text-[var(--text-secondary)]">{msg.name}</span>
          <span className="text-[10px] text-[var(--text-muted)]">{msg.time}</span>
        </div>
        <div className={cn(
          'rounded-[var(--radius-md)] px-3 py-2 text-sm',
          msg.from === 'user'
            ? 'bg-[var(--bg-overlay)] text-[var(--text-primary)]'
            : msg.from === 'bot'
              ? 'bg-[var(--accent-muted)] text-[var(--text-primary)] border border-[var(--accent)]/20'
              : 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border)]',
        )}>
          <ChatText text={msg.text} />
        </div>
        {msg.guardrails && msg.guardrails.length > 0 && (
          <span
            className="mt-1 inline-flex items-center gap-1 rounded-full border border-[var(--warning)]/30 bg-[var(--warning-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--warning)]"
            title={msg.guardrails.map((hit) => `${hit.name}: ${GUARDRAIL_ACTION_LABELS[hit.action]}`).join('\n')}
          >
            <ShieldAlert size={9} /> {guardrailFlag(msg.guardrails)}
          </span>
        )}
        {msg.sources && msg.sources.length > 0 && (
          <p data-testid="answer-sources" className="mt-1 flex flex-wrap items-center justify-end gap-1 text-[10px] text-[var(--text-muted)]">
            <BookOpen size={9} /> From:
            {msg.sources.map((ref) => (
              <span key={ref.documentId} title={`${ref.source}: ${ref.title}`} className="rounded-full border border-[var(--border)] bg-[var(--bg-overlay)] px-1.5 py-0.5 text-[var(--text-secondary)]">
                {ref.title}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}
