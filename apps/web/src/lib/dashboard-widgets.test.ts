import assert from 'node:assert/strict'
import { test } from 'node:test'
import { templateWidgets, widgetMetric } from './dashboard-widgets'

test('saved widgets map onto aggregate metrics, old names included', () => {
  assert.equal(widgetMetric({ metric: 'escalated_rate' }), 'escalated_rate')
  assert.equal(widgetMetric({ metric: 'totalConversations' }), 'conversations')
  assert.equal(widgetMetric({ metric: 'totalContacts' }), null)
  assert.equal(widgetMetric(undefined), null)
})

test('a template creates real widgets; blank creates none', () => {
  assert.deepEqual(templateWidgets('blank'), [])
  assert.deepEqual(templateWidgets('handover').map((w) => w.metric), ['conversations', 'escalated_rate', 'abandoned_rate', 'csat_score'])
  assert.equal(templateWidgets('handover')[1]!.title, 'Escalated')
})
