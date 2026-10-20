import { renderPersonalDataDeep } from '@ybot/shared'
import { loadPrivacy, renderFor } from './privacy.js'
import { presentChatText } from './visitor-name.js'

/** How a person in the Inbox sees chat text: the bot's Human agent render mode. */
export type AgentView = (text: string) => string

const asIs: AgentView = (text) => text

/** The Human agent view for one bot's chats. */
export async function agentViewFor(botId: string | null | undefined, tenantId: string): Promise<AgentView> {
  const settings = await loadPrivacy(botId)
  return (text) => renderFor('human_agent', text, settings, tenantId)
}

/** One view per bot, for lists that mix bots. */
export async function agentViewsFor(botIds: Array<string | null | undefined>, tenantId: string): Promise<(botId: string | null | undefined) => AgentView> {
  const unique = [...new Set(botIds.filter((id): id is string => Boolean(id)))]
  const views = new Map(await Promise.all(unique.map(async (id) => [id, await agentViewFor(id, tenantId)] as const)))
  const fallback = await agentViewFor(null, tenantId)
  return (botId) => (botId && views.get(botId)) || fallback
}

function presentContent(content: unknown, displayName: string | null | undefined, view: AgentView): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const row = content as Record<string, unknown>
  if (typeof row['text'] !== 'string') return content
  const named = presentChatText(row['text'], displayName)
  const text = view(named)
  const tool = row['tool'] && typeof row['tool'] === 'object' ? renderPersonalDataDeep(row['tool'], view) : row['tool']
  if (text === row['text'] && tool === row['tool']) return content
  return { ...row, text, ...(row['tool'] !== undefined ? { tool } : {}) }
}

function presentMessage<T extends { content: unknown }>(message: T, displayName: string | null | undefined, view: AgentView): T {
  const content = presentContent(message.content, displayName, view)
  if (content === message.content) return message
  return { ...message, content }
}

type ContactFields = { displayName?: string | null; email?: string | null; phone?: string | null }

function presentContact<C extends ContactFields | null | undefined>(contact: C, view: AgentView): C {
  if (!contact) return contact
  return {
    ...contact,
    ...(typeof contact.email === 'string' ? { email: view(contact.email) } : {}),
    ...(typeof contact.phone === 'string' ? { phone: view(contact.phone) } : {}),
  }
}

/** Every inbox read uses the same name rule as a new chat, and the bot's Human agent view of personal data. */
export function presentConversation<T extends { contact?: ContactFields | null; messages?: Array<{ content: unknown }>; handover?: unknown }>(
  conversation: T,
  view: AgentView = asIs,
): T {
  const name = conversation.contact?.displayName
  return {
    ...conversation,
    ...(conversation.contact ? { contact: presentContact(conversation.contact, view) } : {}),
    ...(conversation.messages ? { messages: conversation.messages.map((message) => presentMessage(message, name, view)) } : {}),
    ...(conversation.handover && typeof conversation.handover === 'object' ? { handover: renderPersonalDataDeep(conversation.handover, view) } : {}),
  }
}

export function presentMessages<T extends { content: unknown }>(
  messages: T[],
  displayName: string | null | undefined,
  view: AgentView = asIs,
): T[] {
  return messages.map((message) => presentMessage(message, displayName, view))
}
