import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DENTAL_BLUEPRINT, DENTAL_CHAPTERS } from '@botstudio/shared'
import { REFERENCE_CHATS, playReferenceChat, referenceJourney } from './dental-reference-chats.js'

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
