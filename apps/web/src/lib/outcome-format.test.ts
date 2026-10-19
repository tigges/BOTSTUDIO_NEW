import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { OutcomeSummary } from './api'
import { containedDetail, formatLlmCost, llmCallsLine, ofFinished, openLine, percentOrDash } from './outcome-format'

const summary: OutcomeSummary = {
  finished: 40,
  open: 3,
  counts: { contained_resolved: 28, contained_partial: 4, contained_unresolved: 2, escalated: 5, abandoned: 1 },
  buckets: { contained: 34, escalated: 5, abandoned: 1 },
  rates: { contained: 85, resolvedByBot: 70, escalated: 12.5, abandoned: 2.5 },
}

test('a rate with no finished chats is a dash, never zero', () => {
  assert.equal(percentOrDash(null), '—')
  assert.equal(percentOrDash(undefined), '—')
  assert.equal(percentOrDash(0), '0.0%')
  assert.equal(percentOrDash(12.5), '12.5%')
})

test('every outcome card names its denominator', () => {
  assert.equal(ofFinished(5, summary), '5 of 40 chats finished')
  assert.equal(ofFinished(0, { ...summary, finished: 0 }), 'No finished chats yet')
  assert.equal(ofFinished(0, undefined), 'No finished chats yet')
  assert.equal(openLine(summary), '3 chats still open, not counted')
  assert.equal(openLine({ ...summary, open: 0 }), '')
})

test('contained explains what was not resolved', () => {
  assert.equal(containedDetail(summary), '28 resolved · 4 left mid-question · 2 not answered')
  assert.equal(containedDetail({ ...summary, counts: { ...summary.counts, contained_partial: 0, contained_unresolved: 0 } }), '28 resolved')
})

test('model cost is a dash without calls and keeps precision for small amounts', () => {
  assert.equal(formatLlmCost(null), '—')
  assert.equal(formatLlmCost({ calls: 0, costUsd: null }), '—')
  assert.equal(formatLlmCost({ calls: 2, costUsd: null }), '—')
  assert.equal(formatLlmCost({ calls: 3, costUsd: 0.00042 }), '$0.0004')
  assert.equal(formatLlmCost({ calls: 3, costUsd: 1.234 }), '$1.23')
  assert.equal(formatLlmCost({ calls: 1, costUsd: 0 }), '$0.00')
  assert.equal(llmCallsLine({ calls: 1 }), '1 model call')
  assert.equal(llmCallsLine(undefined), 'No model calls recorded')
})
