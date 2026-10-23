import assert from 'node:assert/strict'
import { test } from 'node:test'
import { liveSupportLabel, savedDays, savedLiveSupport, toggleDay } from './live-support-format'

test('the header says whether a handed-over chat reaches a person now', () => {
  assert.equal(liveSupportLabel({ state: 'off', hours: null }).tone, 'off')
  assert.equal(liveSupportLabel({ state: 'open', hours: null }).short, 'Live support on')
  const closed = liveSupportLabel({ state: 'closed', hours: 'Mon-Fri 09:00-18:00 (Europe/London)' })
  assert.equal(closed.tone, 'closed')
  assert.match(closed.detail, /Mon-Fri 09:00-18:00/)
})

test('older saved settings read as on once a schedule was saved', () => {
  assert.equal(savedLiveSupport({}), false)
  assert.equal(savedLiveSupport({ workingHours: { start: '09:00', end: '18:00' } }), true)
  assert.equal(savedLiveSupport({ workingHours: { enabled: false, start: '09:00', end: '18:00' } }), false)
  assert.equal(savedLiveSupport({ workingHours: { start: '09:00', end: '18:00' }, liveSupport: { enabled: false } }), false)
  assert.equal(savedLiveSupport({ liveSupport: { enabled: true } }), true)
})

test('opening days default to every day and never go empty', () => {
  assert.deepEqual(savedDays({}), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(savedDays({ workingHours: { days: [5, 1, 1, 9] } }), [1, 5])
  assert.deepEqual(toggleDay([1, 2], 2), [1])
  assert.deepEqual(toggleDay([1], 1), [1])
  assert.deepEqual(toggleDay([1], 0), [0, 1])
})
