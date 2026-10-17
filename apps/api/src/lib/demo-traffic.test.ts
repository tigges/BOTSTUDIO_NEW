import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { QUALIFY_COLOUR, UPSELL_CUT } from '@ybot/shared'
import {
  ACME_TRAFFIC_CHATS,
  BELLA_TRAFFIC_CHATS,
  BELLA_TRAFFIC_TICKETS,
  trafficConversationId,
  trafficSlot,
  trafficTicketId,
} from './demo-traffic.js'

test('Bella traffic follows the colour booking walk, not a promotion', () => {
  const colour = BELLA_TRAFFIC_CHATS.find((chat) => chat.chapter === 'Book an appointment')
  assert.ok(colour)
  assert.equal(colour.lines.some((line) => line.text === QUALIFY_COLOUR), true)
  assert.equal(colour.lines.some((line) => line.text === UPSELL_CUT), true)
  const spoken = BELLA_TRAFFIC_CHATS.flatMap((chat) => chat.lines.map((line) => line.text)).join('\n')
  assert.equal(/50%|Every Tuesday/i.test(spoken), false)
  assert.equal(BELLA_TRAFFIC_CHATS.some((chat) => chat.chapter === 'Salon hours'), true)
  assert.equal(BELLA_TRAFFIC_CHATS.some((chat) => chat.chapter === 'Services and prices'), true)
  assert.equal(BELLA_TRAFFIC_TICKETS.some((ticket) => /booking/i.test(ticket.subject)), true)
})

test('Acme traffic stays on the named support chapters', () => {
  const chapters = ACME_TRAFFIC_CHATS.map((chat) => chat.chapter)
  assert.deepEqual(chapters, ['Order Status', 'Return Request', 'Billing', 'Talk to a person'])
})

test('traffic ids are stable for the same hour so a rerun does not duplicate', () => {
  const at = new Date('2026-10-16T20:10:00.000Z')
  assert.equal(trafficSlot(at), '2026-10-16-20')
  assert.equal(trafficConversationId('bella', '2026-10-16-20', 0), 'traffic-bella-convo-2026-10-16-20-1')
  assert.equal(trafficTicketId('acme', '2026-10-16-20', 1), 'traffic-acme-ticket-2026-10-16-20-2')
})

test('the traffic module does not write journeys, flows, or workflows', () => {
  const source = readFileSync(new URL('./demo-traffic.ts', import.meta.url), 'utf8')
  assert.equal(/prisma\.flow[\w]*\./.test(source), false)
  assert.equal(/prisma\.flowVersion/.test(source), false)
  assert.equal(/prisma\.automationRule/.test(source), false)
  assert.equal(/installHairStudioPack|publishNamed|ensureWelcomeRouter/.test(source), false)
  assert.match(source, /pinOwnedInbox/)
})
