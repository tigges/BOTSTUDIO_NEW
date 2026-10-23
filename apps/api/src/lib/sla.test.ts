import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hoursText, isWithinWorkingHours, liveSupportNow, parseInboxPolicy, slaLabel, type InboxPolicy } from './sla.js'

const policy: InboxPolicy = parseInboxPolicy({
  sla: { first_response: '1', resolution: '24' },
  workingHours: { start: '09:00', end: '18:00', timezone: 'Europe/London', awayMessage: 'Away now' },
})

test('a bot with no queue hours stays open around the clock', () => {
  const open = parseInboxPolicy({})
  assert.equal(open.workingHours.enabled, false)
  assert.equal(isWithinWorkingHours(open.workingHours, new Date('2026-09-22T02:00:00Z')), true)
  assert.equal(isWithinWorkingHours(open.workingHours, new Date('2026-09-22T19:30:00Z')), true)
  const turnedOff = parseInboxPolicy({ workingHours: { enabled: false, start: '09:00', end: '18:00', timezone: 'Europe/London' } })
  assert.equal(turnedOff.workingHours.enabled, false)
  assert.equal(isWithinWorkingHours(turnedOff.workingHours, new Date('2026-09-22T19:30:00Z')), true)
})

test('parses inbox settings and keeps a custom away message', () => {
  assert.equal(policy.sla.firstResponseHours, 1)
  assert.equal(policy.sla.resolutionHours, 24)
  assert.equal(policy.workingHours.awayMessage, 'Away now')
  assert.equal(policy.workingHours.enabled, true)
})

test('treats London office hours in September as open at 11:00 and closed at 20:30', () => {
  assert.equal(isWithinWorkingHours(policy.workingHours, new Date('2026-09-22T10:00:00Z')), true)
  assert.equal(isWithinWorkingHours(policy.workingHours, new Date('2026-09-22T19:30:00Z')), false)
})

test('supports an overnight window', () => {
  const overnight = { ...policy.workingHours, start: '22:00', end: '06:00' }
  assert.equal(isWithinWorkingHours(overnight, new Date('2026-09-22T22:30:00Z')), true)
  assert.equal(isWithinWorkingHours(overnight, new Date('2026-09-22T12:00:00Z')), false)
})

test('opening days follow the clock in the team time zone', () => {
  const weekdays = parseInboxPolicy({ workingHours: { start: '09:00', end: '18:00', timezone: 'Europe/London', days: [1, 2, 3, 4, 5] } }).workingHours
  assert.deepEqual(weekdays.days, [1, 2, 3, 4, 5])
  assert.equal(isWithinWorkingHours(weekdays, new Date('2026-09-25T10:00:00Z')), true)
  assert.equal(isWithinWorkingHours(weekdays, new Date('2026-09-26T10:00:00Z')), false)
  const sydney = parseInboxPolicy({ workingHours: { start: '09:00', end: '17:00', timezone: 'Australia/Sydney', days: [1] } }).workingHours
  assert.equal(isWithinWorkingHours(sydney, new Date('2026-09-20T23:30:00Z')), true)
})

test('an overnight window belongs to the day it opened', () => {
  const fridayNights = parseInboxPolicy({ workingHours: { start: '22:00', end: '06:00', timezone: 'UTC', days: [5] } }).workingHours
  assert.equal(isWithinWorkingHours(fridayNights, new Date('2026-09-25T23:00:00Z')), true)
  assert.equal(isWithinWorkingHours(fridayNights, new Date('2026-09-26T03:00:00Z')), true)
  assert.equal(isWithinWorkingHours(fridayNights, new Date('2026-09-26T23:00:00Z')), false)
})

test('the live-support switch beats the schedule', () => {
  const hours = { start: '09:00', end: '18:00', timezone: 'Europe/London', days: [1, 2, 3, 4, 5] }
  const legacy = parseInboxPolicy({ workingHours: hours })
  assert.equal(legacy.liveSupport.enabled, true)
  assert.deepEqual(liveSupportNow(legacy, new Date('2026-09-22T10:00:00Z')), { available: true, state: 'open', hours: 'Mon-Fri 09:00-18:00 (Europe/London)' })
  assert.equal(liveSupportNow(legacy, new Date('2026-09-22T19:30:00Z')).state, 'closed')
  const off = parseInboxPolicy({ workingHours: hours, liveSupport: { enabled: false } })
  assert.deepEqual(liveSupportNow(off, new Date('2026-09-22T10:00:00Z')), { available: false, state: 'off', hours: null })
  const always = parseInboxPolicy({ workingHours: { ...hours, enabled: false }, liveSupport: { enabled: true } })
  assert.deepEqual(liveSupportNow(always, new Date('2026-09-26T03:00:00Z')), { available: true, state: 'open', hours: null })
  assert.equal(parseInboxPolicy({}).liveSupport.enabled, false)
})

test('opening days read as short runs', () => {
  const base = parseInboxPolicy({ workingHours: { start: '09:00', end: '17:30', timezone: 'UTC' } }).workingHours
  assert.equal(hoursText(base), 'Every day 09:00-17:30 (UTC)')
  assert.equal(hoursText({ ...base, days: [1, 2, 3, 4, 5, 6] }), 'Mon-Sat 09:00-17:30 (UTC)')
  assert.equal(hoursText({ ...base, days: [0, 6] }), 'Sat, Sun 09:00-17:30 (UTC)')
  assert.equal(hoursText({ ...base, days: [1, 3, 5] }), 'Mon, Wed, Fri 09:00-17:30 (UTC)')
})

test('shows time left until the first reply', () => {
  const createdAt = new Date('2026-09-22T12:00:00Z')
  const label = slaLabel({
    status: 'active',
    createdAt,
    resolvedAt: null,
    firstResponseDueAt: new Date('2026-09-22T13:00:00Z'),
    resolutionDueAt: new Date('2026-09-23T12:00:00Z'),
    firstRespondedAt: null,
    policy,
    now: new Date('2026-09-22T12:20:00Z'),
  })
  assert.equal(label, '40m left')
})

test('switches the clock to resolution after the first reply', () => {
  const label = slaLabel({
    status: 'active',
    createdAt: new Date('2026-09-22T12:00:00Z'),
    resolvedAt: null,
    firstResponseDueAt: new Date('2026-09-22T13:00:00Z'),
    resolutionDueAt: new Date('2026-09-23T12:00:00Z'),
    firstRespondedAt: new Date('2026-09-22T12:01:00Z'),
    policy,
    now: new Date('2026-09-22T18:00:00Z'),
  })
  assert.equal(label, '18h left')
})

test('marks an open conversation breached once the resolution clock runs out', () => {
  const label = slaLabel({
    status: 'active',
    createdAt: new Date('2026-09-20T12:00:00Z'),
    resolvedAt: null,
    firstResponseDueAt: new Date('2026-09-20T13:00:00Z'),
    resolutionDueAt: new Date('2026-09-21T12:00:00Z'),
    firstRespondedAt: new Date('2026-09-20T12:05:00Z'),
    policy,
    now: new Date('2026-09-22T12:00:00Z'),
  })
  assert.equal(label, 'Breached')
})

test('hides the chip when a conversation is resolved on time', () => {
  const label = slaLabel({
    status: 'resolved',
    createdAt: new Date('2026-09-22T12:00:00Z'),
    resolvedAt: new Date('2026-09-22T15:00:00Z'),
    firstResponseDueAt: new Date('2026-09-22T13:00:00Z'),
    resolutionDueAt: new Date('2026-09-23T12:00:00Z'),
    firstRespondedAt: new Date('2026-09-22T12:05:00Z'),
    policy,
    now: new Date('2026-09-22T16:00:00Z'),
  })
  assert.equal(label, null)
})
