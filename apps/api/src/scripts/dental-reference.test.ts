import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DENTAL_BLUEPRINT, DENTAL_CHAPTERS } from '@botstudio/shared'
import { REFERENCE_CHATS, playReferenceChat, referenceJourney } from './dental-reference-chats.js'
import { isFirstDentalWelcome, withCurrentOffer } from './dental-reference.js'

const journey = referenceJourney(DENTAL_BLUEPRINT.sample())
const ids = { tenantId: 't', botId: 'harbour-dental-ref' }
const at = new Date('2026-10-20T10:00:00.000Z')

test('every reference patient gets the blueprint\'s own replies, and a person only where the journey hands over', async () => {
  const handedOver = new Set<string>()
  for (const chat of REFERENCE_CHATS) {
    const played = await playReferenceChat(chat, journey, ids, at)
    const bot = played.lines.filter((line) => line.role === 'bot').map((line) => line.text)
    assert.ok(bot.length > 0, `${chat.id}: the bot said nothing`)
    assert.ok(bot.every((text) => !text.includes("didn't catch")), `${chat.id}: ${bot.join(' / ')}`)
    if (played.state.status === 'escalated') handedOver.add(chat.id)
    if (chat.person) assert.equal(played.state.status, 'escalated', `${chat.id} has a person's replies but never reached one`)
  }
  assert.deepEqual([...handedOver].sort(), ['hdref-chat-crown', 'hdref-chat-knocked-out', 'hdref-chat-nervous', 'hdref-chat-swelling'])
})

test('the reference chats visit every chapter, so Journey Traffic has a count on each', async () => {
  const seen = new Set<string>()
  for (const chat of REFERENCE_CHATS) {
    const played = await playReferenceChat(chat, journey, ids, at)
    for (const line of played.lines) if (line.chapter) seen.add(line.chapter)
  }
  const missing = Object.values(DENTAL_CHAPTERS).filter((name) => !seen.has(name))
  assert.deepEqual(missing, [])
})

test('only the untouched first welcome is replaced on the reference bot', () => {
  const first = {
    nodes: [
      { id: 'ask', data: { kind: 'ask_question', config: { question: 'What can I help with: a booking, a dental problem, prices, or something else?' } } },
      { id: 'again', data: { kind: 'ask_question', config: { question: "Sorry, I didn't catch that. Is it a booking, tooth pain, prices, or something else?" } } },
    ],
    edges: [],
  }
  assert.equal(isFirstDentalWelcome(first), true)
  const edited = { ...first, nodes: [first.nodes[0]] }
  assert.equal(isFirstDentalWelcome(edited), false)
  const current = DENTAL_BLUEPRINT.bundle(DENTAL_BLUEPRINT.sample()).flows.find((flow) => flow.name === DENTAL_CHAPTERS.welcome)!.graph
  assert.equal(isFirstDentalWelcome(current), false)
  assert.match(JSON.stringify(current), /Hi, I'm Nova from Harbour Dental\./)
  assert.match(JSON.stringify(current), /What can I help you with today\?/)
  assert.doesNotMatch(JSON.stringify(current), /didn't catch/)
})

test('the old "tooth pain" offer becomes the bot\'s own topic offer; an edited offer stays', () => {
  const fresh = DENTAL_BLUEPRINT.bundle(DENTAL_BLUEPRINT.sample()).flows.find((flow) => flow.name === DENTAL_CHAPTERS.welcome)!.graph
  const offer = (question: string) => ({
    nodes: [
      { id: 'hello', data: { kind: 'send_message', config: { text: 'Hi, I\'m Nova from Harbour Dental.' } } },
      { id: 'again', data: { kind: 'ask_question', config: { question, variable: 'request' } } },
    ],
    edges: [{ id: 'e1', source: 'hello', target: 'again' }],
  })
  const upgraded = withCurrentOffer(offer('I can help you with a booking, tooth pain, or prices. What would you like?'), fresh) as ReturnType<typeof offer>
  assert.equal(upgraded.nodes[1]!.data.config.question, 'I can help you with a booking, an urgent problem, or prices. What would you like?')
  assert.equal(upgraded.nodes[1]!.data.config.variable, 'request')
  assert.deepEqual(upgraded.nodes[0], offer('').nodes[0])
  assert.equal(upgraded.edges.length, 1)
  assert.equal(withCurrentOffer(offer('Booking, pain or prices?'), fresh), null)
  assert.equal(withCurrentOffer(fresh, fresh), null)
})
