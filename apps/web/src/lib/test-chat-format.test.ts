import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestChatState } from './api'
import { joinNotes, teamReturnNote, testChatNote, testToolNote } from './test-chat-format'

const open: TestChatState = { status: 'active', outcome: null, handover: null }

const handedOver: TestChatState = {
  status: 'escalated',
  outcome: 'escalated',
  handover: { source: 'always_human', reason: 'The guest wrote “complaint”.', priority: 'high', routing: { queue: 'support', skills: [], priority: 3 } },
}

test('a plain bot turn adds no note', () => {
  assert.equal(testChatNote(open, open, 'journey'), undefined)
})

test('a handover names who asked, why, how urgent and which queue, and points at the Inbox chat', () => {
  const note = testChatNote(open, { ...handedOver, inboxChatId: 'c1' }, 'handover') ?? ''
  assert.match(note, /^Handed to a person by the always-human word/)
  assert.match(note, /complaint/)
  assert.match(note, /Priority high/)
  assert.match(note, /Queue support/)
  assert.match(note, /waiting in the Inbox under Chats/)
  assert.match(note, /replies from the team show here/)
})

test('a handover that could not reach the Inbox says why', () => {
  assert.match(testChatNote(open, handedOver, 'handover') ?? '', /not saved with a Sandbox yet/)
})

test('a held chat tells the tester why the bot is quiet', () => {
  assert.match(testChatNote(open, { ...open, status: 'escalated' }, 'held') ?? '', /bot stays quiet/)
  assert.match(testChatNote(open, { ...open, status: 'escalated', inboxChatId: 'c1' }, 'held') ?? '', /team has this chat in the Inbox/)
})

test('no live support and a finished journey each say so once', () => {
  const kept = { ...open, outcome: 'contained_unresolved' }
  assert.match(testChatNote(open, kept, 'none') ?? '', /live support is off or the team is outside opening hours/)
  assert.equal(testChatNote(kept, kept, 'journey'), undefined)
  assert.equal(testChatNote(open, { ...open, status: 'resolved', outcome: 'contained_resolved' }, 'journey'), 'Resolved by the bot.')
})

test('the team letting go of a test chat says whether it was resolved or handed back', () => {
  assert.match(teamReturnNote('resolved'), /resolved this chat/)
  assert.match(teamReturnNote('active'), /handed the chat back to the bot/)
})

test('tool calls say what ran, what was skipped and what failed', () => {
  const note = testToolNote([
    { toolId: 'a', name: 'lookup_order', ok: true, skipped: false },
    { toolId: 'b', name: 'refund_order', ok: true, skipped: true },
    { toolId: 'c', name: 'crm_note', ok: false, skipped: false, error: 'HTTP 401' },
  ]) ?? ''
  assert.match(note, /Ran lookup_order\./)
  assert.match(note, /Skipped refund_order: it changes data/)
  assert.match(note, /crm_note failed: HTTP 401\. The step took its Error line\./)
  assert.equal(testToolNote([]), undefined)
  assert.equal(joinNotes(undefined, 'Resolved by the bot.'), 'Resolved by the bot.')
})
