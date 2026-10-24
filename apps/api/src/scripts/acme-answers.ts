/**
 * The Acme Support Bot on the demo host was imported from a website that did not
 * describe support or payments, so those chapters hold the import's note for the
 * author ("The pages did not state this for support. Edit the line…"). This writes
 * the training company's real answers there, as a new working-copy version.
 *
 * Only a chapter that is still nothing but that note is touched; any edit stays.
 * A live release is never changed.
 */

import { prisma } from '@botstudio/db'
import { isAuthorPlaceholder } from '@botstudio/shared'

interface Node {
  id: string
  type: 'flow-node'
  position: { x: number; y: number }
  data: { kind: string; label: string; config: Record<string, unknown> }
}

interface Edge {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

export interface AnswerGraph {
  nodes: Node[]
  edges: Edge[]
}

function n(id: string, x: number, y: number, kind: string, label: string, config: Record<string, unknown> = {}): Node {
  return { id, type: 'flow-node', position: { x, y }, data: { kind, label, config } }
}

/** Nothing but a start, the note, and an end. */
export function isPlaceholderChapter(graph: unknown): boolean {
  const nodes = (graph as { nodes?: Array<{ data?: { kind?: string; config?: Record<string, unknown> } }> } | null)?.nodes
  if (!Array.isArray(nodes)) return false
  const spoken = nodes.filter((node) => node.data?.kind === 'send_message' || node.data?.kind === 'ask_question')
  if (spoken.length === 0) return false
  const others = nodes.filter((node) => !['send_message', 'ask_question', 'trigger_start', 'start', 'end_flow'].includes(node.data?.kind ?? ''))
  return others.length === 0 && spoken.every((node) => isAuthorPlaceholder(String(node.data?.config?.['text'] ?? node.data?.config?.['question'] ?? '')))
}

interface Door {
  handle: string
  label: string
  intent: string
  phrases: string[]
  /** An opening line, an optional question, and the closing line. */
  say: { open: string; ask?: { question: string; variable: string }; close?: string }
}

/** One route per door; a miss goes where `fallback` goes. */
function routerChapter(doors: Door[], fallback: Door): AnswerGraph {
  const nodes: Node[] = [n('start', 80, 200, 'trigger_start', 'Start')]
  const edges: Edge[] = [{ id: 'e-start', source: 'start', target: 'route' }]
  const routes = doors.map((door) => ({ handle: door.handle, label: door.label, intent: door.intent, phrases: door.phrases }))
  nodes.push(n('route', 300, 200, 'route_topic', 'What they need', { routes }))
  const entry = new Map<string, string>()
  doors.forEach((door, index) => {
    const y = 60 + index * 160
    const say = door.say
    const chain: Node[] = [n(`say-${door.handle}`, 560, y, 'send_message', door.label, { text: say.open })]
    if (say.ask) chain.push(n(`ask-${door.handle}`, 800, y, 'ask_question', 'Ask', { question: say.ask.question, variable: say.ask.variable }))
    if (say.close) chain.push(n(`close-${door.handle}`, 1040, y, 'send_message', 'Confirm', { text: say.close }))
    chain.push(n(`end-${door.handle}`, 1280, y, 'end_flow', 'End'))
    nodes.push(...chain)
    chain.slice(1).forEach((next, i) => edges.push({ id: `e-${door.handle}-${i}`, source: chain[i]!.id, target: next.id }))
    entry.set(door.handle, chain[0]!.id)
  })
  for (const door of doors) edges.push({ id: `e-${door.handle}`, source: 'route', target: entry.get(door.handle)!, sourceHandle: door.handle })
  edges.push({ id: 'e-other', source: 'route', target: entry.get(fallback.handle)!, sourceHandle: 'other' })
  return { nodes, edges }
}

const ORDER_STATUS: Door = {
  handle: 'status',
  label: 'Order status',
  intent: 'Where an order is, or when it will arrive',
  phrases: ['where is my order', 'where is the order', 'track', 'tracking', 'has not come', 'order status'],
  say: {
    open: 'I can check where your order is and its delivery status.',
    ask: { question: 'What is the order number?', variable: 'order_number' },
    close: 'Thanks. I have noted order {{order_number}}. Orders ship within two working days, and the delivery status and tracking link are in your confirmation email. If it is late, a teammate will confirm the latest status in this chat.',
  },
}

/** Answers in place: the runtime follows one chapter jump per turn, and this chapter is already the jump. */
export function supportChapter(): AnswerGraph {
  return routerChapter([
    { handle: 'address', label: 'Change the address', intent: 'Change the delivery address on an order', phrases: ['address', 'deliver to', 'wrong address'],
      say: { open: 'I can update the delivery address before the order ships.', ask: { question: 'What is the order number and the new address?', variable: 'new_address' }, close: 'Thanks. I have noted the new address. A teammate will confirm the change if the parcel has already left.' } },
    { handle: 'cancel', label: 'Cancel an order', intent: 'Cancel an order', phrases: ['cancel'],
      say: { open: 'I can cancel an order that has not shipped yet.', ask: { question: 'What is the order number?', variable: 'order_number' }, close: 'Thanks. I have asked to cancel order {{order_number}}. You will get a confirmation by email.' } },
    { handle: 'return', label: 'Return or replace', intent: 'Something arrived damaged or wrong, or they want a return or refund', phrases: ['cracked', 'broken', 'damaged', 'faulty', 'wrong item', 'return', 'refund', 'replace', 'replacement'],
      say: { open: 'Sorry it arrived like that. I can arrange a return, a replacement or a refund for the order.', ask: { question: 'What is the order number?', variable: 'order_number' }, close: 'Thanks. I have logged a return for order {{order_number}}. A teammate will confirm the replacement or refund in this chat.' } },
    { handle: 'password', label: 'Sign in', intent: 'Cannot sign in or needs a new password', phrases: ['password', 'log in', 'login', 'sign in'],
      say: { open: 'Use "Forgot password" on the sign-in page and we will email you a reset link. It works for 30 minutes.' } },
    ORDER_STATUS,
  ], ORDER_STATUS)
}

export function paymentsChapter(): AnswerGraph {
  const billing: Door = {
    handle: 'billing',
    label: 'Invoices and charges',
    intent: 'An invoice, a charge, seats or billing on the account',
    phrases: ['invoice', 'charge', 'charged', 'billing', 'bill', 'seats', 'payment', 'refund'],
    say: {
      open: 'I can help with invoices, charges and billing on your account.',
      ask: { question: 'Which invoice or account should I look at?', variable: 'invoice' },
      close: 'Thanks. I have noted {{invoice}}. A billing teammate will confirm the details in this chat.',
    },
  }
  return routerChapter([
    billing,
    { handle: 'identity', label: 'Identity check', intent: 'Verifying who they are', phrases: ['verify', 'verification', 'identity', 'id check'],
      say: { open: 'We check identity with a secure link sent by email, so nothing personal is asked in this chat. A teammate can send a new link if yours has expired.' } },
  ], billing)
}

const CHAPTERS: Record<string, () => AnswerGraph> = {
  'Support': supportChapter,
  'Payments and identity': paymentsChapter,
}

export async function ensureAcmeAnswers(botId: string) {
  const flows = await prisma.flow.findMany({
    where: { botId },
    select: { id: true, name: true, tenantId: true, versions: { orderBy: { version: 'desc' }, take: 1 } },
  })
  const written: string[] = []
  for (const flow of flows) {
    const build = CHAPTERS[flow.name]
    const latest = flow.versions[0]
    if (!build || !latest || !isPlaceholderChapter(latest.graph)) continue
    await prisma.flowVersion.create({
      data: {
        tenantId: flow.tenantId,
        flowId: flow.id,
        version: latest.version + 1,
        status: 'draft',
        environmentId: latest.environmentId,
        graph: build() as object,
      },
    })
    written.push(flow.name)
  }
  return { status: 'ok' as const, written }
}
