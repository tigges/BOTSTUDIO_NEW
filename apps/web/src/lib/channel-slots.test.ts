import assert from 'node:assert/strict'
import { test } from 'node:test'
import { channelStatus, pickChannel, slotsForEnvironment } from './channel-slots.ts'

const sandboxWeb = { id: 'web-test', kind: 'web', environmentId: 'sandbox', isActive: true }
const liveWeb = { id: 'web-live', kind: 'web', environmentId: 'prod', isActive: true }
const sandboxWa = { id: 'wa', kind: 'whatsapp', environmentId: 'sandbox', isActive: true }
const sandboxEmail = { id: 'email', kind: 'email', environmentId: 'sandbox', isActive: false }

test('each kind appears once, including idle SMS, Telegram, and phone', () => {
  const slots = slotsForEnvironment([sandboxWeb, liveWeb, sandboxWa, sandboxEmail], 'sandbox')
  assert.deepEqual(slots.map((slot) => slot.kind), ['web', 'whatsapp', 'sms', 'telegram', 'phone', 'email'])
  assert.equal(slots.filter((slot) => slot.kind === 'web').length, 1)
  assert.equal(slots.find((slot) => slot.kind === 'web')?.channel?.id, 'web-test')
  assert.equal(slots.find((slot) => slot.kind === 'web')?.status, 'active')
  assert.equal(slots.find((slot) => slot.kind === 'whatsapp')?.status, 'active')
  assert.equal(slots.find((slot) => slot.kind === 'email')?.status, 'inactive')
  assert.equal(slots.find((slot) => slot.kind === 'sms')?.status, 'idle')
  assert.equal(slots.find((slot) => slot.kind === 'telegram')?.status, 'idle')
  assert.equal(slots.find((slot) => slot.kind === 'phone')?.status, 'idle')
})

test('test and live website chat still make one card', () => {
  const slots = slotsForEnvironment([sandboxWeb, liveWeb, sandboxWa], 'prod')
  assert.equal(slots.filter((slot) => slot.kind === 'web').length, 1)
  assert.equal(slots.find((slot) => slot.kind === 'web')?.channel?.id, 'web-live')
  assert.equal(slots.find((slot) => slot.kind === 'whatsapp')?.channel?.id, 'wa')
  assert.equal(pickChannel([sandboxWeb, liveWeb], 'web', 'sandbox')?.id, 'web-test')
})

test('a connected channel on the other layer still fills the card', () => {
  const slots = slotsForEnvironment([liveWeb, sandboxWa], 'prod')
  assert.equal(slots.find((slot) => slot.kind === 'web')?.channel?.id, 'web-live')
  assert.equal(slots.find((slot) => slot.kind === 'whatsapp')?.channel?.id, 'wa')
})

test('website chat cannot sit idle even without a row', () => {
  assert.equal(channelStatus('web', null), 'active')
  assert.equal(channelStatus('whatsapp', null), 'idle')
  assert.equal(channelStatus('phone', { isActive: false }), 'inactive')
})
