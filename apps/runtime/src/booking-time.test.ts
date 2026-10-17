import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hoursFromCatalog, parseOpeningHours, takeBookingTime } from '@ybot/shared'

const YUZU_HOURS = 'Yuzu is open Tuesday to Friday 10am to 8pm. Saturday 9am to 6pm. Monday and Sunday closed.'
const BELLA_HOURS = 'Bella Hair Studio is open Monday to Saturday, 09:00 to 18:00. You can message any time.'
const SATURDAY = new Date('2026-10-17T12:00:00')
const FRIDAY = new Date('2026-10-16T12:00:00')

test('Yuzu hours keep Monday and Sunday closed, and Bella hours survive a comma', () => {
  const yuzu = parseOpeningHours(YUZU_HOURS)
  assert.equal(yuzu.sunday, 'closed')
  assert.equal(yuzu.monday, 'closed')
  assert.deepEqual(yuzu.tuesday, { open: 10, close: 20 })
  assert.deepEqual(yuzu.saturday, { open: 9, close: 18 })

  const bella = parseOpeningHours(BELLA_HOURS)
  assert.deepEqual(bella.monday, { open: 9, close: 18 })
  assert.deepEqual(bella.saturday, { open: 9, close: 18 })
  assert.equal(bella.sunday, undefined)
})

test('a mistyped tomorrow still offers slots with the stylist, then a clock confirms the day', () => {
  const asked = takeBookingTime({
    heard: 'tomoeeow',
    hoursText: YUZU_HOURS,
    stylist: 'senior',
    now: SATURDAY,
  })
  assert.equal(asked.spoken, undefined)
  assert.equal(asked.day, 'tuesday')
  assert.deepEqual(asked.slots, ['11am', '2pm', '5pm'])
  assert.match(asked.ask ?? '', /closed Sunday/)
  assert.match(asked.ask ?? '', /Tuesday with a senior stylist I have 11am, 2pm, or 5pm/)
  assert.equal(/tomoeeow/i.test(asked.ask ?? ''), false)

  const picked = takeBookingTime({
    heard: '11am',
    previousDay: asked.day,
    hoursText: YUZU_HOURS,
    stylist: 'senior',
    now: SATURDAY,
    offered: asked.slots,
  })
  assert.equal(picked.spoken, 'Tuesday at 11am')
  assert.equal(picked.ask, undefined)

  const fromChip = takeBookingTime({
    heard: '11',
    previousDay: asked.day,
    hoursText: YUZU_HOURS,
    now: SATURDAY,
    offered: asked.slots,
  })
  assert.equal(fromChip.spoken, 'Tuesday at 11am')
})

test('tomorrow on an open day keeps the word tomorrow, and afternoon filters the slots', () => {
  const tomorrow = takeBookingTime({
    heard: 'tomoeoow',
    hoursText: YUZU_HOURS,
    stylist: 'junior',
    now: FRIDAY,
  })
  assert.equal(tomorrow.day, 'tomorrow')
  assert.deepEqual(tomorrow.slots, ['10am', '2pm', '5pm'])
  assert.match(tomorrow.ask ?? '', /Tomorrow with a junior stylist I have 10am, 2pm, or 5pm/)

  const confirmed = takeBookingTime({
    heard: '10am',
    previousDay: 'tomorrow',
    hoursText: YUZU_HOURS,
    now: FRIDAY,
  })
  assert.equal(confirmed.spoken, 'tomorrow at 10am')

  const afternoon = takeBookingTime({
    heard: 'Tuesday afternoon',
    hoursText: YUZU_HOURS,
    stylist: 'senior',
    now: SATURDAY,
  })
  assert.equal(afternoon.day, 'tuesday')
  assert.deepEqual(afternoon.slots, ['12pm', '2pm', '3pm'])
  assert.match(afternoon.ask ?? '', /Tuesday with a senior stylist I have 12pm, 2pm, or 3pm/)
})

test('hoursFromCatalog reads the hours fact', () => {
  const hours = hoursFromCatalog({
    facts: [{ id: 'hours', kind: 'studio', title: 'Hours', phrases: ['hours'], fact: YUZU_HOURS }],
  })
  assert.equal(hours, YUZU_HOURS)
})
