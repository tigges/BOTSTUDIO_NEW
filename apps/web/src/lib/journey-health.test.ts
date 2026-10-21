import assert from 'node:assert/strict'
import { test } from 'node:test'
import { busierEnvironment, journeySummary, outcomeLine } from './journey-health'

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
    'No Sandbox chats started a chapter in the last 30 days. Chats in "Test this journey" are not counted.',
  )
  assert.equal(
    journeySummary({ chats: 40, bot: 36, person: 3, open: 1 }, 'Production', 30),
    '40 chats on Production in the last 30 days: 36 resolved by the bot (90%), 3 handed to the team, 1 still open.',
  )
})

test('the summary adds up to the Inbox: chats that never started a chapter and test runs are named', () => {
  assert.equal(
    journeySummary({ chats: 40, bot: 36, person: 3, open: 1 }, 'Production', 30, { unstarted: 5, testRuns: 12 }),
    '40 chats on Production in the last 30 days: 36 resolved by the bot (90%), 3 handed to the team, 1 still open. '
      + '5 more chats never started a chapter (greeting only, or sent straight to a person). Includes 12 chats from scheduled test runs.',
  )
  assert.equal(
    journeySummary(undefined, 'Sandbox', 30, { unstarted: 1 }),
    'No Sandbox chats started a chapter in the last 30 days. Chats in "Test this journey" are not counted. 1 chat never started a chapter (greeting only, or sent straight to a person).',
  )
})

test('an empty environment points to the one with chats', () => {
  const environments = [{ id: 'sand', kind: 'sandbox', name: 'Sandbox' }, { id: 'prod', kind: 'production', name: 'Production' }]
  assert.deepEqual(busierEnvironment({ prod: 77 }, environments, 'sand'), { kind: 'production', name: 'Production', chats: 77 })
  assert.equal(busierEnvironment({ prod: 77, sand: 2 }, environments, 'sand'), undefined)
  assert.equal(busierEnvironment({}, environments, 'sand'), undefined)
  assert.equal(busierEnvironment(undefined, environments, 'sand'), undefined)
})
