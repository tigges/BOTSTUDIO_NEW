import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contextLine, held, priorityTone, returnedLine, routingLine, showsHandover, sourceLine } from './handover-format'

test('priority colours rise with urgency', () => {
  assert.equal(priorityTone('critical'), 'error')
  assert.equal(priorityTone('high'), 'warning')
  assert.equal(priorityTone('medium'), 'info')
  assert.equal(priorityTone('low'), 'muted')
  assert.equal(priorityTone(undefined), 'info')
})

test('routing reads as one line', () => {
  assert.equal(routingLine({ queue: 'stylists', skills: ['colour', 'correction'], priority: 4 }), 'Queue stylists · Skills colour, correction · Queue priority 4')
  assert.equal(routingLine({ queue: '', skills: [], priority: 2 }), 'Queue support · Queue priority 2')
  assert.equal(routingLine(undefined), 'Queue support')
})

test('the card says what travels and where the handover came from', () => {
  assert.equal(contextLine(undefined), 'Full transcript travels with this chat.')
  assert.match(contextLine('summary_only'), /^Summary only/)
  assert.equal(sourceLine('always_human'), 'Always-human word')
  assert.equal(sourceLine('journey'), 'Journey step')
})

test('a hand-back names the outcome, the person and the note', () => {
  const line = returnedLine({ returned: { outcome: 'needs_follow_up', at: '2026-10-19T18:00:00Z', note: 'Call on Monday' } }, 'Sarah K')
  assert.match(line ?? '', /^Needs follow-up by Sarah K, .+: Call on Monday$/)
  assert.equal(returnedLine({}), undefined)
})

test('the card shows for a handover or a chat a person holds', () => {
  assert.equal(showsHandover({ status: 'resolved', handover: { reason: 'Refund' } }), true)
  assert.equal(showsHandover({ status: 'active', assignedTo: 'u1' }), true)
  assert.equal(showsHandover({ status: 'active', assignedTo: null }), false)
  assert.equal(held({ status: 'resolved', assignedTo: 'u1' }), false)
})
