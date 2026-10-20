import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateConditions } from './automation-engine.js'

const ctx = { tenantId: 't', botId: 'b', conversationId: 'c' }

test('a thumbs-down rule saved with a numeric rating fires on -1 and not on +1', () => {
  const rule = JSON.stringify([{ field: 'csat_rating', operator: 'equals', value: -1 }])
  assert.equal(evaluateConditions(rule, { ...ctx, csatRating: -1 }), true)
  assert.equal(evaluateConditions(rule, { ...ctx, csatRating: 1 }), false)
})

test('string, boolean and numeric condition values compare the same way', () => {
  assert.equal(evaluateConditions(JSON.stringify([{ field: 'csat_rating', operator: 'equals', value: '-1' }]), { ...ctx, csatRating: -1 }), true)
  assert.equal(evaluateConditions(JSON.stringify([{ field: 'has_comment', operator: 'equals', value: true }]), { ...ctx, hasComment: true }), true)
  assert.equal(evaluateConditions(JSON.stringify([{ field: 'message_count', operator: 'greater_than', value: 3 }]), { ...ctx, messageCount: 5 }), true)
  assert.equal(evaluateConditions('', ctx), true)
})
