import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Search, Filter, ChevronDown, Paperclip, Smile, Send,
  AlertCircle, Clock, CheckCheck, MoreHorizontal, Tag,
  UserPlus, ArrowRightLeft, Ticket, StickyNote, MessageCircle,
  Phone, Mail, Globe, Hash, ChevronRight, X, Mic,
  Circle, Zap, Star,
} from 'lucide-react'
import { Avatar, Badge, Input, Button, Skeleton } from '@ybot/ui'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from '@ybot/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@ybot/ui'
import { cn } from '@ybot/ui'
import { useConversations, useConversation, useSendMessage, useAssignConversation, useResolveConversation, useCreateConversation } from '../../lib/hooks'
import { useConversationWS, useTenantWS } from '../../lib/ws'
import { useAppStore } from '../../store/app'
import * as api from '../../lib/api'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { claimChat, queueContact } from '../../lib/inbox-nav'
import { ChatText } from '../../components/ChatText'
import { chatMarkup, chatText } from '../../lib/chat-text'
import { useCannedReplies, useTeamMembers, useLabels, useCreateLabel, useCreateTicket } from '../../lib/hooks'

type ConvoStatus = 'active' | 'resolved' | 'escalated' | 'pending' | 'bot'
type View = 'all' | 'mine' | 'unassigned' | 'escalated'
type NoteType = 'reply' | 'note'

const AGENTS = ['Sarah K', 'Mike R', 'Tom B', 'Unassigned']

interface Convo {
  id: string
  name: string
  message: string
  time: string
  status: ConvoStatus
  unread: number
  channel: 'web' | 'whatsapp' | 'sms' | 'email'
  channelId?: string
  channelName?: string
  contactId?: string
  assigneeId?: string | null
  assignee: string | null
  sla?: string
  labels?: string[]
  email?: string
  phone?: string
  location?: string
  previousConvos?: number
}

interface Message {
  id: string
  from: 'user' | 'bot' | 'agent'
  name: string
  text: string
  time: string
  isNote?: boolean
}

const CANNED_RESPONSES = [
  { id: '1', shortcut: '/greeting', text: 'Hi! Thanks for reaching out. How can I help you today?' },
  { id: '2', shortcut: '/thanks', text: "Thank you for your patience! I've resolved the issue. Is there anything else I can help with?" },
  { id: '3', shortcut: '/transfer', text: "I'm going to transfer you to a specialist who can better assist you with this issue." },
  { id: '4', shortcut: '/wait', text: "I'm looking into this for you right now. Please give me a moment." },
  { id: '5', shortcut: '/close', text: "We're glad we could help! This conversation will now be closed. Feel free to reach out anytime." },
]

const LABELS_OPTIONS = ['billing', 'delivery', 'urgent', 'priority', 'technical', 'refund']

function formatRelative(iso?: string) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 2) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function SlaChip({ sla }: { sla?: string }) {
  if (!sla) return null
  const breached = sla === 'Breached'
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
      breached
        ? 'bg-[var(--error-muted)] text-[var(--error)]'
        : 'bg-[var(--warning-muted,#2d2000)] text-[var(--warning,#fbbf24)]'
    )}>
      <Clock size={9} />
      {sla}
    </span>
  )
}

function ChannelIcon({ ch }: { ch: string }) {
  const icons: Record<string, React.ReactNode> = {
    web: <Globe size={11} />,
    whatsapp: <MessageCircle size={11} />,
    sms: <Phone size={11} />,
    email: <Mail size={11} />,
  }
  return <span className="text-[var(--text-muted)]">{icons[ch] ?? <Globe size={11} />}</span>
}

export function ChatsPage() {
  const { data: conversations = [], isLoading: loadingConvos } = useConversations()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sendMessage = useSendMessage()
  const assignConversation = useAssignConversation()
  const resolveConversation = useResolveConversation()
  const createConversation = useCreateConversation()
  const [showNewConvo, setShowNewConvo] = useState(false)
  const [newConvoMessage, setNewConvoMessage] = useState('')
  const selectedBotId = useAppStore((s: { selectedBotId: string | null }) => s.selectedBotId)
  const environmentId = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId)?.environments.find((e) => e.kind === s.selectedEnv)?.id)
  const navigate = useNavigate()
  const currentUserId = useAppStore((s) => s.user?.id)
  const { data: members = [] } = useTeamMembers()
  const { data: canned = [] } = useCannedReplies()
  const { data: labelRows = [] } = useLabels()
  const createLabel = useCreateLabel()
  const createTicketMutation = useCreateTicket()
  const qc = useQueryClient()

  // Connect to WS on mount (establishes tenant-level connection)
  useTenantWS()

  useEffect(() => {
    const pending = claimChat()
    if (pending) {
      setSelectedId(pending)
      return
    }
    if (conversations.length && !selectedId) setSelectedId(conversations[0]?.id ?? null)
  }, [conversations, selectedId])

  const { data: selectedConvo, refetch: refetchConvo } = useConversation(selectedId ?? '')

  // Real-time WS events for the selected conversation
  const { newMessage, streamingText } = useConversationWS(selectedId)

  // When a new bot/agent message arrives, refresh the conversation
  useEffect(() => {
    if (newMessage) refetchConvo()
  }, [newMessage, refetchConvo])

  const [reply, setReply] = useState('')
  const [noteType, setNoteType] = useState<NoteType>('reply')
  const [view, setView] = useState<View>('all')
  const [showCanned, setShowCanned] = useState(false)
  const [cannedFilter, setCannedFilter] = useState('')
  const [showAssign, setShowAssign] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [showTicketDialog, setShowTicketDialog] = useState(false)
  const [showLabelDialog, setShowLabelDialog] = useState(false)
  const [ticketTitle, setTicketTitle] = useState('')
  const [rightPanelSection, setRightPanelSection] = useState<'info' | 'history' | 'labels'>('info')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Map API conversations to local Convo shape
  const convos: Convo[] = conversations.map((c) => ({
    id: c.id,
    name: c.contact?.displayName ?? 'Unknown',
    message: chatText(c.messages?.[c.messages.length - 1]?.content?.text, c.contact?.displayName),
    time: formatRelative(c.updatedAt),
    status: (c.status as ConvoStatus) ?? 'active',
    unread: c.messages?.filter((m) => m.direction === 'inbound').length ?? 0,
    channel: (c.channel?.kind ?? 'web') as Convo['channel'],
    channelId: c.channel?.id,
    channelName: c.channel?.name,
    contactId: c.contact?.id,
    assigneeId: c.assignedTo ?? null,
    assignee: members.find((m) => m.id === c.assignedTo)?.displayName ?? null,
    sla: c.sla ?? undefined,
    labels: c.labels?.map((l) => l.label?.name ?? '') ?? [],
    email: c.contact?.email,
    phone: c.contact?.phone,
  }))

  const messages: Message[] = (selectedConvo?.messages ?? []).map((m) => ({
    id: m.id,
    from: (m.authorKind ?? m.direction === 'inbound' ? 'user' : 'agent') as 'user' | 'bot' | 'agent',
    name: m.authorKind === 'user' ? selectedConvo!.contact?.displayName ?? 'User' : m.authorKind === 'bot' ? 'BotStudio' : 'Agent',
    text: chatMarkup(m.content?.text, selectedConvo?.contact?.displayName),
    time: new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    isNote: Boolean(m.content?.internal),
  }))

  const selected = convos.find((c) => c.id === selectedId) ?? (selectedId ? undefined : convos[0])

  const filteredConvos = convos.filter((c) => {
    if (view === 'mine') return c.assigneeId === currentUserId
    if (view === 'unassigned') return !c.assignee
    if (view === 'escalated') return c.status === 'escalated'
    return true
  })

  const filteredCanned = canned.filter((r) =>
    r.shortcut.includes(cannedFilter) || r.text.toLowerCase().includes(cannedFilter.toLowerCase())
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, selectedId, streamingText])

  function handleReplyChange(val: string) {
    setReply(val)
    if (val.startsWith('/')) {
      setShowCanned(true)
      setCannedFilter(val.slice(1))
    } else {
      setShowCanned(false)
    }
  }

  function applyCanned(text: string) {
    setReply(text)
    setShowCanned(false)
  }

  async function sendReply() {
    if (!reply.trim() || !selectedId) return
    try {
      await sendMessage.mutateAsync({ conversationId: selectedId, text: reply, internal: noteType === 'note' })
    } catch { /* demo mode — no-op */ }
    setReply('')
    setShowCanned(false)
  }

  async function resolveConvo() {
    if (!selectedId) return
    try { await resolveConversation.mutateAsync(selectedId) } catch { /* demo */ }
  }

  async function assignTo(agentId: string | null) {
    if (!selectedId) return
    try { await assignConversation.mutateAsync({ id: selectedId, assignedTo: agentId }) } catch { /* demo */ }
    setShowAssign(false)
    setShowTransfer(false)
  }

  async function createTicket() {
    if (!ticketTitle.trim() || !selectedId) return
    try {
      await createTicketMutation.mutateAsync({ subject: ticketTitle.trim(), priority: 'normal', conversationId: selectedId })
    } catch { /* keep the dialog open on failure */ return }
    setShowTicketDialog(false)
    setTicketTitle('')
  }

  const statusVariant: Record<string, 'info' | 'success' | 'error' | 'warning' | 'muted'> = {
    active: 'info',
    resolved: 'success',
    escalated: 'error',
    pending: 'warning',
    bot: 'muted',
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: conversation list ───────────────────────────── */}
      <div className="flex w-[280px] flex-col border-r border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
        {/* Header + subnav */}
        <div className="border-b border-[var(--border)]">
          <div className="flex items-center justify-between px-4 py-4">
            <h1 className="text-base font-semibold text-[var(--text-primary)]">Inbox</h1>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowNewConvo(true)} title="New conversation">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
            </Button>
          </div>
        </div>

        {/* Views + search */}
        <div className="p-3 space-y-2 border-b border-[var(--border)]">
          <Input placeholder="Search conversations…" leftIcon={<Search size={13} />} />
          <div className="flex gap-1">
            {(['all', 'mine', 'unassigned', 'escalated'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  'flex-1 rounded py-0.5 text-[11px] font-medium capitalize transition-colors',
                  view === v
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Sort + count */}
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">{filteredConvos.length} conversations</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-0.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                Newest <ChevronDown size={10} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Newest first</DropdownMenuItem>
              <DropdownMenuItem>Oldest first</DropdownMenuItem>
              <DropdownMenuItem>SLA: Urgent first</DropdownMenuItem>
              <DropdownMenuItem>Unread first</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Conversation items */}
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
          {loadingConvos
            ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="p-3"><Skeleton className="h-12 w-full rounded-[var(--radius)]" /></div>)
            : filteredConvos.map((conv) => (
            <button
              key={conv.id}
              data-convo-id={conv.id}
              data-selected={selectedId === conv.id ? 'true' : 'false'}
              onClick={() => setSelectedId(conv.id)}
              className={cn(
                'flex w-full items-start gap-2.5 px-3 py-3 text-left transition-colors',
                selectedId === conv.id ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]'
              )}
            >
              <div className="relative shrink-0 mt-0.5">
                <Avatar name={conv.name} size="sm" />
                <span className={cn(
                  'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-surface)]',
                  conv.status === 'active' ? 'bg-[var(--success)]' :
                  conv.status === 'escalated' ? 'bg-[var(--error)]' :
                  conv.status === 'pending' ? 'bg-[var(--warning,#fbbf24)]' :
                  'bg-[var(--text-muted)]'
                )} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{conv.name}</span>
                  <span className="text-[11px] text-[var(--text-muted)] shrink-0">{conv.time}</span>
                </div>
                <p className="mt-0.5 text-[12px] text-[var(--text-muted)] truncate">{conv.message}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <ChannelIcon ch={conv.channel} />
                  {conv.sla && <SlaChip sla={conv.sla} />}
                  {conv.unread > 0 && (
                    <span className="ml-auto text-[10px] font-bold text-white bg-[var(--accent)] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                      {conv.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Centre: chat thread ───────────────────────────────── */}
      {selected ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Thread header */}
          <div className="flex h-[var(--topbar-height)] items-center justify-between border-b border-[var(--border)] px-4 shrink-0 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={selected.name} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">{selected.name}</p>
                <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
                  <ChannelIcon ch={selected.channel} />
                  {selected.channel}
                  {selected.assignee
                    ? <> · Assigned to <span className="text-[var(--text-secondary)]">{selected.assignee}</span></>
                    : <> · <span className="text-[var(--warning,#fbbf24)]">Unassigned</span></>
                  }
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Assign */}
              <DropdownMenu open={showAssign} onOpenChange={setShowAssign}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5">
                    <UserPlus size={13} />
                    {selected.assignee ?? 'Assign'}
                    <ChevronDown size={11} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Assign to agent</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => assignTo(null)}>Unassigned</DropdownMenuItem>
                  {members.map((member) => (
                    <DropdownMenuItem key={member.id} onClick={() => assignTo(member.id)}>
                      <Avatar name={member.displayName} size="xs" />
                      {member.displayName}
                      {selected.assigneeId === member.id && <CheckCheck size={13} className="ml-auto text-[var(--accent)]" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Resolve */}
              <Button
                variant={selected.status === 'resolved' ? 'secondary' : 'default'}
                size="sm"
                onClick={resolveConvo}
              >
                {selected.status === 'resolved' ? 'Reopen' : 'Resolve'}
              </Button>

              {/* More actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm"><MoreHorizontal size={15} /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowTransfer(true)}>
                    <ArrowRightLeft size={13} /> Transfer conversation
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowTicketDialog(true)}>
                    <Ticket size={13} /> Create ticket
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowLabelDialog(true)}>
                    <Tag size={13} /> Manage labels
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive>
                    <X size={13} /> Delete conversation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Label chips */}
          {selected.labels && selected.labels.length > 0 && (
            <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-[var(--border)] bg-[var(--bg-surface)]">
              <Tag size={11} className="text-[var(--text-muted)]" />
              {selected.labels.map((l) => (
                <span key={l} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--bg-overlay)] text-[var(--text-secondary)] border border-[var(--border)]">
                  {l}
                </span>
              ))}
              {selected.sla && <SlaChip sla={selected.sla} />}
            </div>
          )}

          {/* Messages */}
          <div data-thread="messages" className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.map((msg) => (
              <div key={msg.id}>
                {msg.isNote ? (
                  /* Internal note bubble */
                  <div className="flex gap-2.5 justify-start">
                    <Avatar name={msg.name} size="sm" />
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-[var(--text-secondary)]">{msg.name}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{msg.time}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--warning-muted,#2d2000)] text-[var(--warning,#fbbf24)] font-medium flex items-center gap-1">
                          <StickyNote size={9} /> internal note
                        </span>
                      </div>
                      <div className="rounded-[var(--radius-md)] px-3 py-2 text-sm bg-[var(--warning-muted,#2d2000)] border border-[var(--warning,#fbbf24)]/25 text-[var(--text-primary)] max-w-[70%]">
                        <ChatText text={msg.text} />
                      </div>
                    </div>
                  </div>
                ) : (
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
                            : 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border)]'
                      )}>
                        <ChatText text={msg.text} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {/* Streaming bot reply in progress */}
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
            <div ref={messagesEndRef} />
          </div>

          {/* Reply box */}
          <div className="border-t border-[var(--border)] shrink-0">
            {/* Note/reply toggle */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-1">
              <button
                onClick={() => setNoteType('reply')}
                className={cn(
                  'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium transition-colors',
                  noteType === 'reply'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                )}
              >
                <MessageCircle size={12} /> Reply
              </button>
              <button
                onClick={() => setNoteType('note')}
                className={cn(
                  'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium transition-colors',
                  noteType === 'note'
                    ? 'bg-[var(--warning-muted,#2d2000)] text-[var(--warning,#fbbf24)] border border-[var(--warning,#fbbf24)]/30'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                )}
              >
                <StickyNote size={12} /> Internal note
              </button>
            </div>

            {/* Canned response suggestions */}
            {showCanned && filteredCanned.length > 0 && (
              <div className="mx-4 mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden shadow-[var(--shadow-lg)] max-h-44 overflow-y-auto">
                <div className="px-3 py-1.5 bg-[var(--bg-overlay)] border-b border-[var(--border)]">
                  <p className="text-[11px] text-[var(--text-muted)] font-medium">Canned responses</p>
                </div>
                {filteredCanned.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => applyCanned(r.text)}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <p className="text-[11px] font-mono text-[var(--accent)]">{r.shortcut}</p>
                    <p className="text-xs text-[var(--text-secondary)] truncate">{r.text}</p>
                  </button>
                ))}
              </div>
            )}

            <div className={cn(
              'mx-4 mb-3 rounded-[var(--radius-md)] border transition-colors',
              noteType === 'note'
                ? 'border-[var(--warning,#fbbf24)]/40 bg-[var(--warning-muted,#2d2000)]/30'
                : 'border-[var(--border)] bg-[var(--bg-surface)]'
            )}>
              <textarea
                placeholder={noteType === 'note' ? 'Add an internal note… (not visible to customer)' : 'Type a reply… (type / for canned responses)'}
                value={reply}
                onChange={(e) => handleReplyChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply()
                }}
                rows={3}
                className="w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
              <div className="flex items-center justify-between px-2 pb-2">
                <div className="flex items-center gap-0.5">
                  <button className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors" title="Attach file">
                    <Paperclip size={14} />
                  </button>
                  <button className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors" title="Emoji">
                    <Smile size={14} />
                  </button>
                  <button className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors" title="Canned responses">
                    <Zap size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--text-muted)]">⌘↵ to send</span>
                  <Button
                    size="sm"
                    disabled={!reply.trim()}
                    onClick={sendReply}
                    variant={noteType === 'note' ? 'secondary' : 'default'}
                    className="gap-1.5"
                  >
                    <Send size={12} />
                    {noteType === 'note' ? 'Add note' : 'Send'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[var(--text-muted)]">Select a conversation</p>
        </div>
      )}

      {/* ── Right: contact context panel ─────────────────────── */}
      {selected && (
        <div className="w-[260px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-surface)] overflow-y-auto flex flex-col">
          {/* Contact summary */}
          <div className="flex flex-col items-center gap-2 p-4 border-b border-[var(--border)]">
            <Avatar name={selected.name} size="lg" />
            <p className="font-medium text-[var(--text-primary)] text-sm text-center">{selected.name}</p>
            <div className="flex items-center gap-1.5 flex-wrap justify-center">
              <Badge variant={statusVariant[selected.status]} dot>{selected.status}</Badge>
              <Badge variant="muted"><ChannelIcon ch={selected.channel} />{selected.channel}</Badge>
            </div>
          </div>

          {/* Tab strip */}
          <div className="flex border-b border-[var(--border)]">
            {(['info', 'history', 'labels'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setRightPanelSection(s)}
                className={cn(
                  'flex-1 py-2 text-[11px] font-medium capitalize transition-colors',
                  rightPanelSection === s
                    ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {rightPanelSection === 'info' && (
            <div className="p-4 space-y-4">
              {selected.sla && (
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 bg-[var(--bg-overlay)]">
                  <p className="text-[10px] font-medium uppercase text-[var(--text-muted)] mb-1">SLA</p>
                  <SlaChip sla={selected.sla} />
                </div>
              )}
              <div className="space-y-3">
                {[
                  { label: 'Email', value: selected.email, icon: <Mail size={12} /> },
                  { label: 'Phone', value: selected.phone, icon: <Phone size={12} /> },
                  { label: 'Location', value: selected.location, icon: <Globe size={12} /> },
                  { label: 'Channel', value: selected.channelName ?? selected.channel, icon: <MessageCircle size={12} /> },
                  { label: 'Assigned to', value: selected.assignee ?? 'Unassigned', icon: <UserPlus size={12} /> },
                ].filter((item) => item.value).map((item) => (
                  <div key={item.label} className="flex items-start gap-2">
                    <span className="mt-0.5 text-[var(--text-muted)]">{item.icon}</span>
                    <div>
                      <p className="text-[10px] font-medium uppercase text-[var(--text-muted)]">{item.label}</p>
                      <p className="text-xs text-[var(--text-primary)] mt-0.5">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-[var(--border)] space-y-2">
                <Button variant="secondary" size="sm" className="w-full gap-1.5" onClick={() => setShowTicketDialog(true)}>
                  <Ticket size={13} /> Create ticket
                </Button>
                {selected.channel === 'web' && selected.channelId && (
                  <a
                    className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--accent)] hover:bg-[var(--bg-hover)]"
                    href={`/api/v1/widget-test/${selected.channelId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open test widget
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full gap-1.5"
                  disabled={!selected.contactId}
                  onClick={() => {
                    if (!selected.contactId) return
                    queueContact(selected.contactId)
                    void navigate({ to: '/inbox/contacts' })
                  }}
                >
                  <Star size={13} /> View contact profile
                </Button>
              </div>
            </div>
          )}

          {rightPanelSection === 'history' && (
            <div className="p-4">
              {(() => {
                const earlier = convos.filter((c) => c.contactId && c.contactId === selected.contactId && c.id !== selected.id)
                return (
                  <>
                    <p className="text-[11px] text-[var(--text-muted)] mb-3">
                      {earlier.length} other conversation{earlier.length === 1 ? '' : 's'} with this contact
                    </p>
                    {earlier.length > 0 ? (
                      <div className="space-y-2">
                        {earlier.slice(0, 6).map((c) => (
                          <button key={c.id} onClick={() => setSelectedId(c.id)} className="w-full text-left rounded-[var(--radius-md)] border border-[var(--border)] p-2.5 hover:bg-[var(--bg-hover)] transition-colors">
                            <p className="text-xs text-[var(--text-secondary)] truncate">{c.message || 'No message yet'}</p>
                            <p className="text-[10px] text-[var(--text-muted)] mt-1">{c.time}</p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--text-muted)]">No other conversations</p>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          {rightPanelSection === 'labels' && (
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase">Labels</p>
                <button
                  onClick={() => setShowLabelDialog(true)}
                  className="text-[11px] text-[var(--accent)] hover:underline"
                >
                  Edit
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(selected.labels ?? []).length > 0 ? (
                  selected.labels!.map((l) => (
                    <span key={l} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--bg-overlay)] text-[var(--text-secondary)] border border-[var(--border)]">
                      {l}
                    </span>
                  ))
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">No labels added</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Transfer dialog ───────────────────────────────────── */}
      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Transfer conversation</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <p className="text-sm text-[var(--text-secondary)] mb-3">Select an agent or team to transfer this conversation to.</p>
            {members.map((member) => (
              <button
                key={member.id}
                onClick={() => assignTo(member.id)}
                className="flex items-center gap-3 w-full p-3 rounded-[var(--radius-md)] border border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors text-left"
              >
                <Avatar name={member.displayName} size="sm" />
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{member.displayName}</p>
                  <p className="text-xs text-[var(--text-muted)]">{member.email}</p>
                </div>
              </button>
            ))}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* ── Create ticket dialog ──────────────────────────────── */}
      <Dialog open={showTicketDialog} onOpenChange={setShowTicketDialog}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Create ticket</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Ticket title</label>
              <input
                autoFocus
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="e.g. Delivery issue for order #12345"
                value={ticketTitle}
                onChange={(e) => setTicketTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Priority</label>
              <select className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none">
                <option>Normal</option>
                <option>High</option>
                <option>Urgent</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Assign to</label>
              <select className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none">
                <option value="">Unassigned</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
              </select>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowTicketDialog(false)}>Cancel</Button>
            <Button disabled={!ticketTitle.trim()} onClick={createTicket}>Create ticket</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Label dialog ─────────────────────────────────────── */}
      <Dialog open={showLabelDialog} onOpenChange={setShowLabelDialog}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Manage labels</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-wrap gap-2">
              {(labelRows.length ? labelRows.map((row) => row.name) : LABELS_OPTIONS).map((l) => {
                const active = selected?.labels?.includes(l) ?? false
                const label = labelRows.find((row) => row.name === l)
                return (
                  <button
                    key={l}
                    onClick={async () => {
                      if (!selectedId) return
                      const row = label ?? await createLabel.mutateAsync(l)
                      if (active) await api.conversations.labels.remove(selectedId, row.id).catch(() => {})
                      else await api.conversations.labels.add(selectedId, row.id).catch(() => {})
                      void qc.invalidateQueries({ queryKey: ['conversations'] })
                    }}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-sm border transition-colors',
                      active
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                    )}
                  >
                    {l}
                  </button>
                )
              })}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setShowLabelDialog(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New Conversation dialog ──────────────────────────────── */}
      <Dialog open={showNewConvo} onOpenChange={setShowNewConvo}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>New Conversation</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm text-[var(--text-muted)]">
              Start a new outbound conversation. A bot session will be created using the active bot.
            </p>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Opening message (optional)</label>
              <textarea
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 resize-none"
                rows={3}
                placeholder="Hi! How can I help you today?"
                value={newConvoMessage}
                onChange={(e) => setNewConvoMessage(e.target.value)}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewConvo(false)}>Cancel</Button>
            <Button
              disabled={createConversation.isPending || !selectedBotId}
              onClick={async () => {
                if (!selectedBotId) return
                const convo = await createConversation.mutateAsync({
                  botId: selectedBotId,
                  ...(environmentId ? { environmentId } : {}),
                  ...(newConvoMessage.trim() ? { message: newConvoMessage.trim() } : {}),
                })
                setShowNewConvo(false)
                setNewConvoMessage('')
                if (convo?.id) setSelectedId(convo.id)
              }}
            >
              {createConversation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
