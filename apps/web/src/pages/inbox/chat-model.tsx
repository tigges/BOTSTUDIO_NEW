import React from 'react'
import { Clock, Globe, Mail, MessageCircle, Phone } from 'lucide-react'
import { cn } from '@botstudio/ui'
import { GUARDRAIL_ACTION_LABELS, type GuardrailHit } from '@botstudio/shared'
import type * as api from '../../lib/api'
import { chatMarkup, chatText } from '../../lib/chat-text'

export type ConvoStatus = 'active' | 'resolved' | 'escalated' | 'pending' | 'bot'

export interface Convo {
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
  testRun?: boolean
  labels?: string[]
  email?: string
  phone?: string
  location?: string
}

export interface ChatLine {
  id: string
  from: 'user' | 'bot' | 'agent'
  name: string
  text: string
  time: string
  isNote?: boolean
  tool?: api.ToolNote
  guardrails?: GuardrailHit[]
  sources?: api.KnowledgeSourceRef[]
}

export function formatRelative(iso?: string) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 2) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** A chat a Journey Test handed over has no contact; its subject says it is a test. */
export function chatName(c: Pick<api.Conversation, 'contact' | 'subject'>): string {
  if (c.contact?.displayName) return c.contact.displayName
  if (c.subject?.startsWith('Journey Test')) return 'Journey Test'
  return 'Unknown'
}

export function toConvo(c: api.Conversation, members: Array<{ id: string; displayName: string }>): Convo {
  return {
    id: c.id,
    name: chatName(c),
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
    testRun: Boolean(c.testRunId),
    labels: c.labels?.map((l) => l.label?.name ?? '') ?? [],
    email: c.contact?.email,
    phone: c.contact?.phone,
  }
}

export function toLines(convo: api.Conversation | undefined): ChatLine[] {
  return (convo?.messages ?? []).map((m) => ({
    id: m.id,
    from: (m.authorKind ?? m.direction === 'inbound' ? 'user' : 'agent') as ChatLine['from'],
    name: m.authorKind === 'user' ? convo!.contact?.displayName ?? 'User' : m.authorKind === 'bot' ? 'BotStudio' : 'Agent',
    text: chatMarkup(m.content?.text, convo?.contact?.displayName),
    time: new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    isNote: Boolean(m.content?.internal),
    tool: m.content?.tool,
    guardrails: m.content?.guardrails,
    sources: m.content?.sources,
  }))
}

const GUARDRAIL_STRENGTH: Record<GuardrailHit['action'], number> = { block: 4, escalate: 3, reask: 2, redact: 1, warn: 0 }

export function guardrailFlag(hits: GuardrailHit[]): string {
  const first = [...hits].sort((a, b) => GUARDRAIL_STRENGTH[b.action] - GUARDRAIL_STRENGTH[a.action])[0]!
  const more = hits.length > 1 ? ` +${hits.length - 1}` : ''
  return `${GUARDRAIL_ACTION_LABELS[first.action]}: ${first.name}${more}`
}

export function SlaChip({ sla }: { sla?: string }) {
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

export function TestRunChip() {
  return (
    <span
      title="Opened by a scheduled test run, not a real visitor. Removed after 14 days."
      className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--bg-overlay)] text-[var(--text-secondary)] border border-[var(--border)]"
    >
      Test run
    </span>
  )
}

export function ChannelIcon({ ch }: { ch: string }) {
  const icons: Record<string, React.ReactNode> = {
    web: <Globe size={11} />,
    whatsapp: <MessageCircle size={11} />,
    sms: <Phone size={11} />,
    email: <Mail size={11} />,
  }
  return <span className="text-[var(--text-muted)]">{icons[ch] ?? <Globe size={11} />}</span>
}
