import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SandboxHolds, sandboxSlots, type SandboxHold, type SandboxSlot } from './practice-sandbox.js'

test('slots: weekdays have the full list, Saturdays mornings only, Sundays nothing', () => {
  const wednesday = sandboxSlots('check-up', '2026-10-21')
  assert.equal(wednesday.status, 200)
  assert.deepEqual((wednesday.body as SandboxSlot[]).map((s) => s.slot_id), ['S-1021-0900', 'S-1021-1030', 'S-1021-1400', 'S-1021-1615'])
  const saturday = sandboxSlots('check-up', '2026-10-24').body as SandboxSlot[]
  assert.ok(saturday.length > 0 && saturday.every((s) => s.start < '12:00'))
  assert.deepEqual(sandboxSlots('emergency', '2026-10-25').body, [])
  assert.deepEqual(sandboxSlots('Check-Up', '2026-10-21').body, wednesday.body)
})

test('slots: a bad visit type or date is a 400 that names the field', () => {
  const type = sandboxSlots('massage', '2026-10-21')
  assert.equal(type.status, 400)
  assert.match((type.body as { error: string }).error, /^type must be/)
  for (const date of ['21/10/2026', '2026-02-30', '']) {
    const bad = sandboxSlots('hygiene', date)
    assert.equal(bad.status, 400, date)
    assert.match((bad.body as { error: string }).error, /^date must be/)
  }
})

test('holds: same key repeats the hold, another patient gets a 409, and the hold expires', () => {
  let clock = Date.parse('2026-10-21T10:00:00Z')
  const holds = new SandboxHolds(() => clock)
  const body = { slot_id: 'S-1021-0900', patient_name: 'Sophie Allen', phone: '07700 900101' }
  const first = holds.hold(body, 'key-1')
  assert.equal(first.status, 201)
  const held = first.body as SandboxHold
  assert.match(held.hold, /^H-[0-9A-F]{5}$/)
  assert.equal(held.expires, '2026-10-21T10:15:00.000Z')
  assert.deepEqual(holds.hold(body, 'key-1'), { status: 200, body: held })
  const clash = holds.hold({ ...body, patient_name: 'Someone Else' }, 'key-2')
  assert.equal(clash.status, 409)
  assert.equal((clash.body as { error: string }).error, 'That slot was just taken. Pick another time.')
  clock += 15 * 60_000
  assert.equal(holds.hold({ ...body, patient_name: 'Someone Else' }, 'key-2').status, 201)
})

test('holds: missing fields are a 422 and an unknown slot is a 404', () => {
  const holds = new SandboxHolds()
  const missing = holds.hold({ slot_id: 'S-1021-0900' }, undefined)
  assert.equal(missing.status, 422)
  assert.equal((missing.body as { error: string }).error, 'Missing patient_name, phone.')
  assert.equal(holds.hold({ slot_id: 'tomorrow', patient_name: 'A', phone: '1' }, undefined).status, 404)
})
