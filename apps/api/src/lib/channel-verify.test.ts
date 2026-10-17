import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyChannelCredentials, type FetchLike } from './channel-verify.js'

function fakeFetch(table: Record<string, { status: number; body?: unknown }>): FetchLike {
  return async (url) => {
    const hit = Object.entries(table).find(([key]) => url.includes(key))
    const status = hit?.[1].status ?? 404
    const body = hit?.[1].body ?? {}
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  }
}

test('WhatsApp credentials are checked against Graph', async () => {
  const ok = await verifyChannelCredentials('whatsapp', {
    phoneNumberId: '1555',
    accessToken: 'token',
    verifyToken: 'verify',
  }, fakeFetch({ 'graph.facebook.com': { status: 200, body: { display_phone_number: '+1555' } } }))
  assert.equal(ok.ok, true)

  const bad = await verifyChannelCredentials('whatsapp', {
    phoneNumberId: '1555',
    accessToken: 'nope',
    verifyToken: 'verify',
  }, fakeFetch({ 'graph.facebook.com': { status: 401, body: { error: { message: 'Invalid OAuth' } } } }))
  assert.equal(bad.ok, false)
  assert.match(bad.message ?? '', /refused/i)
})

test('Telegram getMe must succeed and a webhook secret is stored', async () => {
  const ok = await verifyChannelCredentials('telegram', { botToken: '123:ABC' }, fakeFetch({
    'api.telegram.org': { status: 200, body: { ok: true, result: { username: 'bella' } } },
  }))
  assert.equal(ok.ok, true)
  assert.ok(ok.extra?.['webhookSecret'])
})

test('Twilio account lookup must succeed for SMS and phone', async () => {
  const fetchImpl = fakeFetch({ 'api.twilio.com': { status: 200, body: { status: 'active' } } })
  const sms = await verifyChannelCredentials('sms', {
    accountSid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    authToken: 'tok',
    fromNumber: '+447700900123',
  }, fetchImpl)
  assert.equal(sms.ok, true)
  const badSid = await verifyChannelCredentials('phone', {
    accountSid: 'not-an-sid',
    authToken: 'tok',
    fromNumber: '+447700900123',
  }, fetchImpl)
  assert.equal(badSid.ok, false)
})

test('email checks the address and a long enough secret, without a network call', async () => {
  const bad = await verifyChannelCredentials('email', { fromAddress: 'not-mail', inboundSecret: 'secret12' })
  assert.equal(bad.ok, false)
  const short = await verifyChannelCredentials('email', { fromAddress: 'hello@studio.com', inboundSecret: 'short' })
  assert.equal(short.ok, false)
  const ok = await verifyChannelCredentials('email', { fromAddress: 'hello@studio.com', inboundSecret: 'secret12' })
  assert.equal(ok.ok, true)
})
