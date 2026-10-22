import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHANNEL_FIELDS,
  channelConfigReady,
  channelWebhookPath,
  parseChannelConfig,
} from '@botstudio/shared'

test('optional channels need every credential field', () => {
  assert.deepEqual(parseChannelConfig('web', {}), {})
  assert.equal(parseChannelConfig('facebook', {}), null)
  assert.equal(parseChannelConfig('whatsapp', { phoneNumberId: '1' }), null)
  assert.ok(parseChannelConfig('whatsapp', {
    phoneNumberId: '1555',
    accessToken: 'token',
    verifyToken: 'verify',
  }))
  assert.ok(parseChannelConfig('sms', {
    accountSid: 'ACxx',
    authToken: 'tok',
    fromNumber: '+447700900123',
  }))
  assert.ok(parseChannelConfig('telegram', { botToken: '123:ABC' }))
  assert.ok(parseChannelConfig('phone', {
    accountSid: 'ACxx',
    authToken: 'tok',
    fromNumber: '+447700900123',
  }))
  assert.ok(parseChannelConfig('email', {
    fromAddress: 'hello@studio.com',
    inboundSecret: 'secret12',
  }))
  assert.equal(channelConfigReady('sms', {}), false)
  assert.equal(CHANNEL_FIELDS.sms.length, 3)
  assert.equal(channelWebhookPath('telegram'), '/api/v1/webhooks/telegram')
})

test('parse keeps extra keys such as a telegram webhook secret', () => {
  const parsed = parseChannelConfig('telegram', { botToken: '123:ABC', webhookSecret: 'hidden' })
  assert.equal(parsed?.['webhookSecret'], 'hidden')
})
