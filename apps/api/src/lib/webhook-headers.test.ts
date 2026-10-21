import { test } from 'node:test'
import assert from 'node:assert/strict'
import { webhookHeaders } from './webhook-headers.js'

test('webhooks carry the BotStudio headers and the same values under the old X-YBot names', () => {
  const headers = webhookHeaders({ event: 'conversation.escalated', deliveryId: '42', signature: 'sha256=abc' })
  assert.equal(headers['User-Agent'], 'BotStudio-Webhook/1.0')
  for (const [name, value] of [['Event', 'conversation.escalated'], ['Delivery', '42'], ['Signature', 'sha256=abc']]) {
    assert.equal(headers[`X-BotStudio-${name}`], value)
    assert.equal(headers[`X-YBot-${name}`], value, `legacy X-YBot-${name}`)
  }
  const unsigned = webhookHeaders({ event: 'webhook.test' })
  assert.equal(unsigned['X-BotStudio-Signature'], undefined)
  assert.equal(unsigned['X-YBot-Signature'], undefined)
})
