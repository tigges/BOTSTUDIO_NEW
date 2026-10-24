import assert from 'node:assert/strict'
import { test } from 'node:test'
import { badgeText, handoverSoundOn, setHandoverSound, titleWithCount, waitingChatId } from './handover-alert'

test('only a chat newly waiting for a person rings; held chats, test runs and other events do not', () => {
  assert.equal(waitingChatId({ event: 'conversation.updated', data: { id: 'c1', status: 'escalated', assignedTo: null, testRunId: null } }), 'c1')
  assert.equal(waitingChatId({ event: 'conversation.created', data: { id: 'c2', status: 'escalated' } }), 'c2')
  assert.equal(waitingChatId({ event: 'conversation.updated', data: { id: 'c3', status: 'escalated', assignedTo: 'u1' } }), null)
  assert.equal(waitingChatId({ event: 'conversation.updated', data: { id: 'c4', status: 'escalated', testRunId: 'run-1' } }), null)
  assert.equal(waitingChatId({ event: 'conversation.created', data: { id: 'c5', status: 'active' } }), null)
  assert.equal(waitingChatId({ event: 'message.created', data: { id: 'm1', status: 'escalated' } }), null)
  assert.equal(waitingChatId({ type: 'pong' }), null)
  assert.equal(waitingChatId(null), null)
})

test('the tab title carries the count and goes back to plain once the chats are seen', () => {
  assert.equal(titleWithCount('BotStudio', 2), '(2) BotStudio')
  assert.equal(titleWithCount('(2) BotStudio', 3), '(3) BotStudio')
  assert.equal(titleWithCount('(3) BotStudio', 0), 'BotStudio')
  assert.equal(badgeText(0), undefined)
  assert.equal(badgeText(4), '4')
  assert.equal(badgeText(12), '9+')
})

test('the tone is on by default and remembers being muted in this browser', () => {
  const saved = new Map<string, string>()
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value) } }
  assert.equal(handoverSoundOn(storage), true)
  setHandoverSound(false, storage)
  assert.equal(handoverSoundOn(storage), false)
  assert.equal(saved.get('botstudio-inbox-sound'), 'off')
  setHandoverSound(true, storage)
  assert.equal(handoverSoundOn(storage), true)
  assert.equal(handoverSoundOn(undefined), true)
})
