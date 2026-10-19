import assert from 'node:assert/strict'
import { test } from 'node:test'
import { journeySummary, outcomeLine } from './journey-health'

test('a chapter with no chats shows a dash, never zero', () => {
  assert.deepEqual(outcomeLine(undefined), { label: '—', detail: 'No chats yet' })
  assert.deepEqual(outcomeLine({ chats: 0, bot: 0, person: 0, open: 0 }), { label: '—', detail: 'No chats yet' })
})

test('a chapter names its denominator and the chats the bot did not close', () => {
  assert.deepEqual(outcomeLine({ chats: 10, bot: 8, person: 1, open: 1 }), {
    label: '8 of 10 chats resolved by the bot',
    detail: '1 handed to the team · 1 still open',
  })
  assert.deepEqual(outcomeLine({ chats: 1, bot: 1, person: 0, open: 0 }), { label: '1 of 1 chat resolved by the bot', detail: '' })
})

test('the summary says which environment it counts and that test chats do not count', () => {
  assert.equal(
    journeySummary(undefined, 'Sandbox', 30),
    'No Sandbox chats in the last 30 days. Chats in "Test this journey" are not counted.',
  )
  assert.equal(
    journeySummary({ chats: 40, bot: 36, person: 3, open: 1 }, 'Production', 30),
    '40 chats on Production in the last 30 days: 36 resolved by the bot (90%), 3 handed to the team, 1 still open.',
  )
})
