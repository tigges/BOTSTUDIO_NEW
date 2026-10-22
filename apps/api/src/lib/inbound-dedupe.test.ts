import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InboundDedupe, SharedDedupe, type DedupeStore } from './inbound-dedupe.js'

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

function fakeValkey(): DedupeStore & { up: boolean; keys: Map<string, number> } {
  const keys = new Map<string, number>()
  const store = {
    up: true,
    keys,
    ready: () => store.up,
    setIfAbsent: async (key: string, windowMs: number) => {
      if (!store.up) throw new Error('Connection is closed.')
      if (keys.has(key)) return false
      keys.set(key, windowMs)
      return true
    },
  }
  return store
}

test('two replicas sharing Valkey handle a provider retry once', async () => {
  const valkey = fakeValkey()
  const replicaA = new SharedDedupe(async () => valkey, 60_000)
  const replicaB = new SharedDedupe(async () => valkey, 60_000)
  assert.equal(await replicaA.first('wa1', 'wamid.9'), true)
  assert.equal(await replicaB.first('wa1', 'wamid.9'), false, 'the retry reached the other replica')
  assert.deepEqual([...valkey.keys], [['botstudio:inbound:wa1:wamid.9', 60_000]], 'the key expires with the window')
})

test('when Valkey is down or not configured the window falls back to memory', async () => {
  const valkey = fakeValkey()
  valkey.up = false
  const replica = new SharedDedupe(async () => valkey, 60_000)
  assert.equal(await replica.first('sms', 'SM1'), true)
  assert.equal(await replica.first('sms', 'SM1'), false)

  const noValkey = new SharedDedupe(async () => null, 60_000)
  assert.equal(await noValkey.first('sms', 'SM2'), true)
  assert.equal(await noValkey.first('sms', 'SM2'), false)
  assert.equal(await noValkey.first('sms', undefined), true)
})
