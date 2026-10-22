import { RETURN_LABELS, type HandoverContract, type HandoverPriority } from '@botstudio/shared'

export type Tone = 'muted' | 'info' | 'warning' | 'error'

export function priorityTone(priority: HandoverPriority | undefined): Tone {
  if (priority === 'critical') return 'error'
  if (priority === 'high') return 'warning'
  if (priority === 'low') return 'muted'
  return 'info'
}

export function sourceLine(source: HandoverContract['source'] | undefined): string {
  if (source === 'always_human') return 'Always-human word'
  if (source === 'guardrail') return 'Guardrail'
  return 'Journey step'
}

export function routingLine(routing: HandoverContract['routing'] | undefined): string {
  if (!routing) return 'Queue support'
  const parts = [`Queue ${routing.queue || 'support'}`]
  if (routing.skills?.length) parts.push(`Skills ${routing.skills.join(', ')}`)
  if (routing.priority != null) parts.push(`Queue priority ${routing.priority}`)
  return parts.join(' · ')
}

export function contextLine(context: HandoverContract['context'] | undefined): string {
  return context === 'summary_only'
    ? 'Summary only: webhooks get this summary, not the transcript.'
    : 'Full transcript travels with this chat.'
}

export function returnedLine(handover: Partial<HandoverContract> | null | undefined, who?: string): string | undefined {
  const back = handover?.returned
  if (!back) return undefined
  const when = new Date(back.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const by = who ? ` by ${who}` : ''
  return `${RETURN_LABELS[back.outcome]}${by}, ${when}${back.note ? `: ${back.note}` : ''}`
}

/** The card shows for a handed-over chat, and for any chat a person holds so they can hand it back. */
export function showsHandover(chat: { status: string; assignedTo?: string | null; handover?: Partial<HandoverContract> | null } | undefined): boolean {
  if (!chat) return false
  return Boolean(chat.handover?.reason) || held(chat)
}

export function held(chat: { status: string; assignedTo?: string | null }): boolean {
  return chat.status === 'escalated' || (chat.status === 'active' && Boolean(chat.assignedTo))
}
