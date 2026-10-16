import assert from 'node:assert/strict'
import { test } from 'node:test'
import { channelStatus, pickChannel, slotsForEnvironment } from './channel-slots.ts'

const sandboxWeb = { id: 'web-test', kind: 'web', environmentId: 'sandbox', isActive: true }
const liveWeb = { id: 'web-live', kind: 'web', environmentId: 'prod', isActive: true }
const sandboxWa = { id: 'wa', kind: 'whatsapp', environmentId: 'sandbox', isActive: true }
const sandboxEmail = { id: 'email', kind: 'email', environmentId: 'sandbox', isActive: false }

test('each kind appears once, and web is always active', () => {
  const slots = slotsForEnvironment([sandboxWeb, liveWeb, sandboxWa, sandboxEmail], 'sandbox')
  assert.deepEqual(slots.map((slot) => slot.kind), ['web', 'whatsapp', 'sms', 'email', 'facebook', 'telegram'])
  assert.equal(slots.filter((slot) => slot.kind === 'web').length, 1)
  assert.equal(slots.find((slot) => slot.kind === 'web')?.channel?.id, 'web-test')
  assert.equal(slots.find((slot) => slot.kind === 'web')?.status, 'active')
  assert.equal(slots.find((slot) => slot.kind === 'whatsapp')?.status, 'active')
  assert.equal(slots.find((slot) => slot.kind === 'email')?.status, 'inactive')
  assert.equal(slots.find((slot) => slot.kind === 'sms')?.status, 'idle')
  assert.equal(slots.find((slot) => slot.kind === 'facebook')?.status, 'idle')
})

test('the production layer uses the live website chat, not a second card', () => {
  const slots = slotsForEnvironment([sandboxWeb, liveWeb, sandboxWa], 'prod')
  assert.equal(slots.find((slot) => slot.kind === 'web')?.channel?.id, 'web-live')
  assert.equal(slots.find((slot) => slot.kind === 'whatsapp')?.status, 'idle')
  assert.equal(pickChannel([sandboxWeb, liveWeb], 'web', 'sandbox')?.id, 'web-test')
})

test('website chat cannot sit idle even without a row', () => {
  assert.equal(channelStatus('web', null), 'active')
  assert.equal(channelStatus('whatsapp', null), 'idle')
  assert.equal(channelStatus('whatsapp', { isActive: false }), 'inactive')
})
