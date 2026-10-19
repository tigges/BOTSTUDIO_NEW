import { prisma } from '@ybot/db'
import { NAME_QUESTION, fillNameTokens, spokenFirstName, usableContactName } from '@ybot/shared'

const CHAT_NAME = 'chatName'

export interface VisitorName {
  id?: string
  displayName?: string | null
  metadata?: unknown
}

export interface NamePlan {
  /** First name for {{contact.name}}, or "there". */
  spoken: string
  /** This turn is only the thanks. Do not run the flow on the name itself. */
  thanks?: string
  displayName?: string
  metadata?: Record<string, unknown>
}

export function contactMeta(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}

interface ChatNameState {
  conversationId: string
  spoken?: string
  nameAsked?: boolean
  awaitingName?: boolean
}

/** A name belongs to this conversation only. A stored contact name does not open the next chat. */
function chatName(meta: Record<string, unknown>, conversationId: string): ChatNameState {
  const raw = meta[CHAT_NAME]
  if (!conversationId || !raw || typeof raw !== 'object' || Array.isArray(raw)) return { conversationId }
  const row = raw as Record<string, unknown>
  if (row['conversationId'] !== conversationId) return { conversationId }
  return {
    conversationId,
    spoken: typeof row['spoken'] === 'string' ? row['spoken'] : undefined,
    nameAsked: row['nameAsked'] === true,
    awaitingName: row['awaitingName'] === true,
  }
}

function rememberChat(meta: Record<string, unknown>, state: ChatNameState): Record<string, unknown> {
  return { ...meta, [CHAT_NAME]: state }
}

/**
 * What this visitor line does to the name.
 * A real name given in this chat is kept. A name from an earlier chat is not.
 * "Hi" is not a name. We ask once, then carry on.
 */
export function planNameTurn(
  contact: VisitorName | null | undefined,
  userText: string,
  conversationId = '',
): NamePlan {
  const meta = contactMeta(contact?.metadata)
  const state = chatName(meta, conversationId)
  const known = spokenFirstName(state.spoken)
  if (known) return { spoken: known }

  if (state.awaitingName) {
    const given = usableContactName(userText)
    if (given) {
      const first = given.split(' ')[0]!
      return {
        spoken: first,
        thanks: `Thanks, ${first}.`,
        displayName: given,
        metadata: rememberChat(meta, { conversationId, spoken: first, nameAsked: true, awaitingName: false }),
      }
    }
    return {
      spoken: 'there',
      metadata: rememberChat(meta, { conversationId, nameAsked: true, awaitingName: false }),
    }
  }

  // A first line is a request. A name counts only after this chat asked for one.
  return { spoken: 'there' }
}

/**
 * Thanks ends the turn when nothing is waiting.
 * A chart that asked the name is still waiting, so the saved request can continue.
 */
export function nameThanksEndsTurn(thanks: string | undefined, flowStatus: string | null | undefined): boolean {
  return Boolean(thanks) && flowStatus !== 'waiting_input'
}

/**
 * Drop leftover name tokens. The name is asked only by a flow that uses it
 * (the salon booking); when a line asks, the next reply is kept for this chat.
 */
export function finishBotLines(
  lines: string[],
  contact: VisitorName | null | undefined,
  spoken: string,
  options?: { waiting?: boolean; conversationId?: string },
): { lines: string[]; metadata?: Record<string, unknown> } {
  const cleaned = lines.map((line) => fillNameTokens(line, spoken))
  const meta = contactMeta(contact?.metadata)
  const state = chatName(meta, options?.conversationId ?? '')
  const known = spokenFirstName(spoken) ?? spokenFirstName(state.spoken)
  if (known || state.nameAsked || !contact?.id) return { lines: cleaned }
  if (!cleaned.some((line) => line.includes(NAME_QUESTION))) return { lines: cleaned }
  return {
    lines: cleaned,
    metadata: rememberChat(meta, {
      conversationId: options?.conversationId ?? '',
      nameAsked: true,
      awaitingName: true,
    }),
  }
}

export async function saveContactName(
  contactId: string,
  change: { displayName?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  if (!change.displayName && !change.metadata) return
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      ...(change.displayName ? { displayName: change.displayName } : {}),
      ...(change.metadata ? { metadata: change.metadata as never } : {}),
    },
  })
}

export async function takeNameTurn(conversationId: string, userText: string): Promise<NamePlan & { contact: VisitorName | null }> {
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId },
    select: { contact: { select: { id: true, displayName: true, metadata: true } } },
  })
  const contact = convo?.contact ?? null
  const plan = planNameTurn(contact, userText, conversationId)
  if (contact?.id && (plan.displayName || plan.metadata)) {
    await saveContactName(contact.id, plan).catch(() => {})
  }
  const next: VisitorName | null = contact
    ? {
        id: contact.id,
        displayName: plan.displayName ?? contact.displayName,
        metadata: plan.metadata ?? contact.metadata,
      }
    : null
  return { ...plan, contact: next }
}

/** Rewrite a stored chat line so a missing name never shows the braces. */
export function presentChatText(text: string, displayName: string | null | undefined): string {
  return fillNameTokens(text, displayName)
}
