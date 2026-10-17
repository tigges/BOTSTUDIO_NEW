/**
 * Adds inbox chats and tickets for the live demo accounts.
 * Does not create, edit, or publish journeys, flows, or workflows.
 */

import { prisma } from '@ybot/db'

export const TRAFFIC_PREFIX = 'traffic-'
export const TRAFFIC_KEEP = 48

type Line = { role: 'user' | 'bot'; text: string }
type ChatTemplate = { subject: string; chapter: string; lines: Line[] }
type TicketTemplate = { subject: string; description: string; priority: string }

/** Bella Hair Studio blueprint — lines follow the current salon journey. */
export const BELLA_TRAFFIC_CHATS: ChatTemplate[] = [
  {
    subject: 'Colour booking',
    chapter: 'Book an appointment',
    lines: [
      { role: 'user', text: 'color' },
      { role: 'bot', text: 'What colour work are you thinking of — roots, a full head, or highlights?' },
      { role: 'user', text: 'red full head' },
      { role: 'bot', text: 'Would you like a cut with the colour as well?' },
    ],
  },
  {
    subject: 'Opening hours',
    chapter: 'Salon hours',
    lines: [
      { role: 'user', text: 'What are your opening hours?' },
      { role: 'bot', text: 'We are open Monday to Saturday, 9 am to 6 pm. You can message any time. Shall I book a time?' },
    ],
  },
  {
    subject: 'Cut price',
    chapter: 'Services and prices',
    lines: [
      { role: 'user', text: 'how much is a haircut' },
      { role: 'bot', text: 'Cuts start from £35. Shall I book that?' },
    ],
  },
  {
    subject: 'Cancel appointment',
    chapter: 'Cancel appointment',
    lines: [
      { role: 'user', text: 'I need to cancel my appointment tomorrow.' },
      { role: 'bot', text: 'I can note that cancellation. What name is the appointment under?' },
    ],
  },
]

export const BELLA_TRAFFIC_TICKETS: TicketTemplate[] = [
  {
    subject: 'Booking for Thursday afternoon',
    description: 'Colour: red full head. Asked for a cut with it. Senior stylist preferred.',
    priority: 'medium',
  },
  {
    subject: 'Colour correction consult',
    description: 'Guest asked to fix a home dye. Studio needs to see the hair before quoting.',
    priority: 'high',
  },
]

/** Acme training company — orders, returns, billing. */
export const ACME_TRAFFIC_CHATS: ChatTemplate[] = [
  {
    subject: 'Where is order AC-20441',
    chapter: 'Order Status',
    lines: [
      { role: 'user', text: 'Where is my order AC-20441?' },
      { role: 'bot', text: 'AC-20441 left the warehouse yesterday and arrives Thursday.' },
    ],
  },
  {
    subject: 'Damaged kettle return',
    chapter: 'Return Request',
    lines: [
      { role: 'user', text: 'The kettle in my order arrived cracked.' },
      { role: 'bot', text: 'Sorry about that. I can start a return and email a label today.' },
    ],
  },
  {
    subject: 'Invoice for extra seats',
    chapter: 'Billing',
    lines: [
      { role: 'user', text: 'Our last invoice has two seats I do not recognise.' },
      { role: 'bot', text: 'Those seats were added on the 12th. I can ask billing to send the breakdown.' },
    ],
  },
  {
    subject: 'Speak to a person',
    chapter: 'Talk to a person',
    lines: [
      { role: 'user', text: 'I would like to talk to someone on the team.' },
      { role: 'bot', text: 'I am passing this chat to Sarah. She will pick up the chat shortly.' },
    ],
  },
]

export const ACME_TRAFFIC_TICKETS: TicketTemplate[] = [
  {
    subject: 'Return: damaged kettle',
    description: 'Inbound chat asked for a return label on a cracked kettle.',
    priority: 'high',
  },
  {
    subject: 'Billing: unrecognised seats',
    description: 'Guest asked billing to explain two extra seats on the last invoice.',
    priority: 'medium',
  },
]

const BELLA_GUESTS = ['Maya Chen', 'Luca Rossi', 'Priya Shah', 'Owen Blake', 'Hannah Cole', 'Yusuf Ali']
const ACME_GUESTS = ['Riley Adams', 'Jordan Lee', 'Casey Ng', 'Samira Holt', 'Noah Price', 'Eden Ward']

export function trafficSlot(at = new Date()): string {
  const iso = at.toISOString()
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}`
}

export function trafficConversationId(account: string, slot: string, index: number): string {
  return `${TRAFFIC_PREFIX}${account}-convo-${slot}-${index + 1}`
}

export function trafficTicketId(account: string, slot: string, index: number): string {
  return `${TRAFFIC_PREFIX}${account}-ticket-${slot}-${index + 1}`
}

interface DemoTarget {
  account: string
  tenantId: string
  botId: string
  environmentId: string
  channelId: string
  chats: ChatTemplate[]
  tickets: TicketTemplate[]
  guests: string[]
}

async function bellaTarget(): Promise<DemoTarget | null> {
  const bot = await prisma.bot.findUnique({ where: { id: 'bella-bot' } })
  if (!bot) return null
  const environment = await prisma.environment.findFirst({
    where: { botId: bot.id, kind: 'production' },
  }) ?? await prisma.environment.findFirst({ where: { botId: bot.id } })
  if (!environment) return null
  const channel = await prisma.channel.findFirst({
    where: { botId: bot.id, environmentId: environment.id, kind: 'web' },
    orderBy: { createdAt: 'asc' },
  })
  if (!channel) return null
  return {
    account: 'bella',
    tenantId: bot.tenantId,
    botId: bot.id,
    environmentId: environment.id,
    channelId: channel.id,
    chats: BELLA_TRAFFIC_CHATS,
    tickets: BELLA_TRAFFIC_TICKETS,
    guests: BELLA_GUESTS,
  }
}

async function acmeTarget(): Promise<DemoTarget | null> {
  const owner = await prisma.user.findFirst({
    where: { email: { in: ['charles@acme.com', 'demo@acme.com'] } },
    orderBy: { createdAt: 'asc' },
  })
  if (!owner) return null
  const bot = await prisma.bot.findFirst({
    where: { tenantId: owner.tenantId, name: 'Acme Support Bot' },
  }) ?? await prisma.bot.findFirst({ where: { tenantId: owner.tenantId }, orderBy: { createdAt: 'asc' } })
  if (!bot) return null
  const environment = await prisma.environment.findFirst({
    where: { botId: bot.id, kind: 'production' },
  }) ?? await prisma.environment.findFirst({ where: { botId: bot.id } })
  if (!environment) return null
  const channel = await prisma.channel.findFirst({
    where: { botId: bot.id, environmentId: environment.id },
    orderBy: { createdAt: 'asc' },
  })
  if (!channel) return null
  return {
    account: 'acme',
    tenantId: bot.tenantId,
    botId: bot.id,
    environmentId: environment.id,
    channelId: channel.id,
    chats: ACME_TRAFFIC_CHATS,
    tickets: ACME_TRAFFIC_TICKETS,
    guests: ACME_GUESTS,
  }
}

async function insertChat(target: DemoTarget, template: ChatTemplate, slot: string, index: number, at: Date) {
  const id = trafficConversationId(target.account, slot, index)
  const existing = await prisma.conversation.findUnique({ where: { id } })
  if (existing) return { chats: 0, tickets: 0 }
  const contactId = `${id}-contact`
  const guest = target.guests[index % target.guests.length]!
  await prisma.contact.upsert({
    where: { id: contactId },
    update: { displayName: guest },
    create: {
      id: contactId,
      tenantId: target.tenantId,
      displayName: guest,
      email: `${id}@example.com`,
      channelId: target.channelId,
    },
  })
  const createdAt = new Date(at.getTime() - (index + 1) * 12 * 60 * 1000)
  await prisma.conversation.create({
    data: {
      id,
      tenantId: target.tenantId,
      botId: target.botId,
      environmentId: target.environmentId,
      channelId: target.channelId,
      contactId,
      status: 'active',
      subject: template.subject,
      createdAt,
    },
  })
  let stamp = createdAt
  for (const line of template.lines) {
    stamp = new Date(stamp.getTime() + 45_000)
    await prisma.message.create({
      data: {
        tenantId: target.tenantId,
        conversationId: id,
        direction: line.role === 'user' ? 'inbound' : 'outbound',
        authorKind: line.role,
        content: { text: line.text },
        createdAt: stamp,
      },
    })
  }
  return { chats: 1, tickets: 0 }
}

async function insertTicket(target: DemoTarget, template: TicketTemplate, slot: string, index: number, conversationId: string | undefined) {
  const id = trafficTicketId(target.account, slot, index)
  const existing = await prisma.ticket.findUnique({ where: { id } })
  if (existing) return 0
  await prisma.ticket.create({
    data: {
      id,
      tenantId: target.tenantId,
      conversationId: conversationId ?? null,
      subject: template.subject,
      description: template.description,
      status: 'open',
      priority: template.priority,
      tags: ['demo-traffic', target.account, 'inbox'],
    },
  })
  return 1
}

async function pinOwnedInbox(botId: string, prefix: string) {
  const result = await prisma.conversation.updateMany({
    where: { botId, id: { startsWith: `${prefix}-convo-` } },
    data: { updatedAt: new Date() },
  })
  return result.count
}

async function pruneTraffic(botId: string) {
  const rows = await prisma.conversation.findMany({
    where: { botId, id: { startsWith: TRAFFIC_PREFIX } },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  const stale = rows.slice(TRAFFIC_KEEP).map((row) => row.id)
  if (stale.length === 0) return 0
  await prisma.ticket.deleteMany({ where: { conversationId: { in: stale } } })
  await prisma.conversation.deleteMany({ where: { id: { in: stale } } })
  return stale.length
}

async function fillTarget(target: DemoTarget, at: Date) {
  const slot = trafficSlot(at)
  let chats = 0
  let tickets = 0
  const conversationIds: string[] = []
  for (let i = 0; i < target.chats.length; i++) {
    const added = await insertChat(target, target.chats[i]!, slot, i, at)
    chats += added.chats
    conversationIds.push(trafficConversationId(target.account, slot, i))
  }
  for (let i = 0; i < target.tickets.length; i++) {
    tickets += await insertTicket(target, target.tickets[i]!, slot, i, conversationIds[i])
  }
  const pruned = await pruneTraffic(target.botId)
  const pinned = await pinOwnedInbox(target.botId, target.account === 'bella' ? 'enrich-bella' : 'enrich-acme')
  return { account: target.account, chats, tickets, pruned, pinned }
}

/**
 * One batch of demo traffic. Safe to call again in the same hour — existing
 * traffic ids are left as they are. Journeys, flows, and workflows are not read
 * for writing.
 */
export async function addDemoTraffic(at = new Date()) {
  const bella = await bellaTarget()
  const acme = await acmeTarget()
  const accounts = []
  if (bella) accounts.push(await fillTarget(bella, at))
  if (acme) accounts.push(await fillTarget(acme, at))
  return {
    slot: trafficSlot(at),
    accounts,
    skipped: [
      ...bella ? [] : ['bella'],
      ...acme ? [] : ['acme'],
    ],
  }
}
