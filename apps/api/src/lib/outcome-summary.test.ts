import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summariseOutcomes } from './outcome-summary.js'

test('three buckets over finished chats; open chats sit outside every rate', () => {
  const summary = summariseOutcomes([
    { outcome: 'contained_resolved', count: 28 },
    { outcome: 'contained_partial', count: 4 },
    { outcome: 'contained_unresolved', count: 2 },
    { outcome: 'escalated', count: 5 },
    { outcome: 'abandoned', count: 1 },
    { outcome: null, count: 3 },
  ])
  assert.equal(summary.finished, 40)
  assert.equal(summary.open, 3)
  assert.deepEqual(summary.buckets, { contained: 34, escalated: 5, abandoned: 1 })
  assert.deepEqual(summary.rates, { contained: 85, resolvedByBot: 70, escalated: 12.5, abandoned: 2.5 })
})

test('escalation is counted, not inferred from containment', () => {
  const summary = summariseOutcomes([
    { outcome: 'contained_resolved', count: 6 },
    { outcome: 'abandoned', count: 4 },
  ])
  assert.equal(summary.rates.contained, 60)
  assert.equal(summary.rates.escalated, 0)
})

test('no finished chats means no rate, not zero', () => {
  const summary = summariseOutcomes([{ outcome: null, count: 7 }])
  assert.equal(summary.finished, 0)
  assert.equal(summary.open, 7)
  assert.deepEqual(summary.rates, { contained: null, resolvedByBot: null, escalated: null, abandoned: null })
})

test('an unknown outcome value is treated as still open', () => {
  const summary = summariseOutcomes([{ outcome: 'something_else', count: 2 }, { outcome: 'escalated', count: 1 }])
  assert.equal(summary.open, 2)
  assert.equal(summary.finished, 1)
})
