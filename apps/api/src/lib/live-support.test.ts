import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keepLiveSupportSwitch, liveSupportView, withLiveSupport } from './live-support.js'

const saved = {
  sla: { first_response: 1, resolution: 24 },
  workingHours: { enabled: true, start: '09:00', end: '18:00', timezone: 'Europe/London', awayMessage: 'Back soon' },
  alwaysHuman: ['complaint'],
}

test('turning live support off keeps the schedule and every other setting', () => {
  const next = withLiveSupport(saved, { enabled: false })
  assert.deepEqual(next['liveSupport'], { enabled: false })
  assert.deepEqual(next['alwaysHuman'], ['complaint'])
  assert.equal((next['workingHours'] as { awayMessage: string }).awayMessage, 'Back soon')
  const view = liveSupportView(next, new Date('2026-09-22T10:00:00Z'))
  assert.equal(view.enabled, false)
  assert.equal(view.followHours, true)
  assert.equal(view.state, 'off')
})

test('on around the clock, then limited to weekday hours', () => {
  const always = withLiveSupport({}, { enabled: true, followHours: false })
  assert.equal(liveSupportView(always, new Date('2026-09-26T03:00:00Z')).state, 'open')
  const weekdays = withLiveSupport(always, { followHours: true, days: [1, 2, 3, 4, 5], start: '08:30', end: '17:00' })
  const saturday = liveSupportView(weekdays, new Date('2026-09-26T10:00:00Z'))
  assert.equal(saturday.state, 'closed')
  assert.equal(saturday.hours, 'Mon-Fri 08:30-17:00 (Europe/London)')
  assert.equal(liveSupportView(weekdays, new Date('2026-09-25T10:00:00Z')).available, true)
})

test('saving Inbox settings without the switch keeps the switch', () => {
  const before = withLiveSupport(saved, { enabled: false })
  const after = keepLiveSupportSwitch(before, { ...saved })
  assert.deepEqual(after['liveSupport'], { enabled: false })
  assert.deepEqual(keepLiveSupportSwitch(before, { liveSupport: { enabled: true } })['liveSupport'], { enabled: true })
  assert.equal(keepLiveSupportSwitch(saved, { ...saved })['liveSupport'], undefined)
})
