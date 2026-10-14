import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizedBotName } from './bot-name.js'

test('a bot name is trimmed', () => {
  assert.deepEqual(normalizedBotName('  Yuzu  '), { ok: true, name: 'Yuzu' })
})

test('a blank bot name is rejected', () => {
  assert.equal(normalizedBotName('   ').ok, false)
  assert.equal(normalizedBotName('').ok, false)
  assert.equal(normalizedBotName(null).ok, false)
})

test('a bot name stops at 80 characters', () => {
  assert.equal(normalizedBotName('B'.repeat(80)).ok, true)
  const tooLong = normalizedBotName('B'.repeat(81))
  assert.equal(tooLong.ok, false)
  if (!tooLong.ok) assert.match(tooLong.message, /80/)
})
