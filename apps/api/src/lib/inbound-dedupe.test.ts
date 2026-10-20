import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InboundDedupe } from './inbound-dedupe.js'

test('a provider message is handled once per channel inside the replay window', () => {
  const seen = new InboundDedupe(60_000)
  assert.equal(seen.first('wa1', 'wamid.1', 0), true)
  assert.equal(seen.first('wa1', 'wamid.1', 10_000), false)
  assert.equal(seen.first('wa2', 'wamid.1', 10_000), true, 'another channel is a different message')
  assert.equal(seen.first('wa1', 'wamid.1', 70_000), true, 'after the window it counts again')
})

test('messages without a provider id are never dropped', () => {
  const seen = new InboundDedupe(60_000)
  assert.equal(seen.first('sms', undefined, 0), true)
  assert.equal(seen.first('sms', '', 0), true)
  assert.equal(seen.first('sms', '  ', 0), true)
})

test('the remembered set stays bounded', () => {
  const seen = new InboundDedupe(60_000, 3)
  for (const id of ['a', 'b', 'c', 'd']) seen.first('ch', id, 0)
  assert.equal(seen.first('ch', 'a', 1), true, 'the oldest id was forgotten')
  assert.equal(seen.first('ch', 'd', 1), false)
})
