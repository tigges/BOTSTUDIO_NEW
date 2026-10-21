import assert from 'node:assert/strict'
import { test } from 'node:test'
import { channelRoutingKey, maskChannelConfig, mergeChannelConfig, statusHelp, CHANNEL_STATUS_HELP, CHANNEL_FIELDS } from '@ybot/shared'
import { hideSecrets } from '@ybot/db'
import { publicChannel } from './channel-public.js'
import { providerRequests, twimlGather, twimlMessage } from './channel-outbound.js'
import { whatsAppHeard } from '../routes/channel-webhooks.js'

const wa = {
  id: 'ch_1', kind: 'whatsapp', name: 'WhatsApp', environmentId: 'env_1', isActive: false, allowedDomains: [],
  config: { phoneNumberId: '123', accessToken: 'EAAsecret', verifyToken: 'verify-me', webhookSecret: 'whsec' },
}

test('the console never gets a secret back, only which ones are saved', () => {
  const out = publicChannel(wa)
  assert.deepEqual(out.config, { phoneNumberId: '123', verifyToken: 'verify-me' })
  assert.deepEqual(out.secretsSet.sort(), ['accessToken', 'webhookSecret'])
  assert.ok(!JSON.stringify(out).includes('EAAsecret'))
  assert.deepEqual(maskChannelConfig('web', { title: 'Hi' }), { config: { title: 'Hi' }, secretsSet: [] })
})

test('a blank field in an edit keeps the saved value', () => {
  assert.deepEqual(
    mergeChannelConfig(wa.config, { accessToken: '', phoneNumberId: '456', verifyToken: '  ' }),
    { ...wa.config, phoneNumberId: '456' },
  )
})

test('the audit log hides every channel secret field', () => {
  const logged = JSON.stringify(hideSecrets(wa))
  for (const key of ['accessToken', 'webhookSecret', 'verifyToken']) assert.ok(logged.includes(`"${key}":"[hidden]"`), key)
  for (const [kind, fields] of Object.entries(CHANNEL_FIELDS)) {
    for (const field of fields.filter((f) => f.secret)) {
      assert.equal((hideSecrets({ [field.key]: 'x' }) as Record<string, unknown>)[field.key], '[hidden]', `${kind}.${field.key}`)
    }
  }
})

test('routing keys say what picks the connection, and never show a secret', () => {
  assert.equal(channelRoutingKey('whatsapp', wa.config, 'ch_1').value, '123')
  assert.equal(channelRoutingKey('sms', { fromNumber: '+447700900123' }, 'ch_2').value, '+447700900123')
  assert.equal(channelRoutingKey('telegram', { botToken: 'x' }, 'ch_3').value, null)
  assert.equal(channelRoutingKey('web', {}, 'ch_4').value, 'ch_4')
})

test('every status row points at a real field of that channel', () => {
  for (const [kind, rows] of Object.entries(CHANNEL_STATUS_HELP)) {
    const keys = CHANNEL_FIELDS[kind as keyof typeof CHANNEL_FIELDS].map((field) => field.key)
    for (const row of rows) if (row.field) assert.ok(keys.includes(row.field), `${kind} ${row.status} → ${row.field}`)
  }
  assert.equal(statusHelp('whatsapp', 401)?.field, 'accessToken')
  assert.equal(statusHelp('whatsapp', 403, 'webhook')?.field, 'verifyToken')
  assert.equal(statusHelp('web', 401), null)
})

test('WhatsApp choices go out as interactive buttons, then a list', () => {
  const [buttons] = providerRequests('whatsapp', { phoneNumberId: '123', accessToken: 't' }, '447', [{ type: 'buttons', text: 'Which?', buttons: ['Book', 'Prices'] }])
  const body = JSON.parse(buttons!.body)
  assert.equal(buttons!.url, 'https://graph.facebook.com/v20.0/123/messages')
  assert.equal(body.type, 'interactive')
  assert.deepEqual(body.interactive.action.buttons.map((b: { reply: { title: string } }) => b.reply.title), ['Book', 'Prices'])

  const [list] = providerRequests('whatsapp', { phoneNumberId: '123', accessToken: 't' }, '447', [{ type: 'list', text: 'Which?', button: 'Choose', rows: ['A', 'B', 'C', 'D'] }])
  const listBody = JSON.parse(list!.body)
  assert.equal(listBody.interactive.type, 'list')
  assert.equal(listBody.interactive.action.sections[0].rows.length, 4)
})

test('Telegram choices are a one-time reply keyboard', () => {
  const [req] = providerRequests('telegram', { botToken: 'abc' }, '99', [{ type: 'buttons', text: 'Which?', buttons: ['Book', 'Prices'] }])
  const body = JSON.parse(req!.body)
  assert.deepEqual(body.reply_markup.keyboard, [[{ text: 'Book' }], [{ text: 'Prices' }]])
  assert.equal(body.reply_markup.one_time_keyboard, true)
})

test('a long SMS reply becomes several Message verbs, nothing clipped', () => {
  const text = 'A sentence that makes the reply long. '.repeat(80).trim()
  const xml = twimlMessage({ text })
  const parts = [...xml.matchAll(/<Message>([^<]*)<\/Message>/g)].map((m) => m[1]!)
  assert.ok(parts.length >= 2)
  assert.equal(parts.join(' '), text)
  assert.match(twimlMessage({ text: 'Which?', choices: ['Book', 'Prices'] }), /1\. Book\n2\. Prices/)
  assert.match(twimlGather({ text: 'Which?', choices: ['Book', 'Prices'] }, '/x'), /You can say Book or Prices\./)
})

test('WhatsApp button and list replies are read as the option title', () => {
  assert.equal(whatsAppHeard({ from: '1', id: 'a', timestamp: '0', type: 'text', text: { body: ' hi ' } }), 'hi')
  assert.equal(whatsAppHeard({ from: '1', id: 'b', timestamp: '0', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'choice_1', title: 'Book' } } }), 'Book')
  assert.equal(whatsAppHeard({ from: '1', id: 'c', timestamp: '0', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'choice_4', title: 'Hours' } } }), 'Hours')
  assert.equal(whatsAppHeard({ from: '1', id: 'd', timestamp: '0', type: 'image' }), null)
})
