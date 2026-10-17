import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  emailInbound,
  findTelegramBySecret,
  findTwilioByNumber,
  findWhatsAppByPhoneNumberId,
  findWhatsAppByVerifyToken,
  spokenFromTwilio,
  telegramText,
} from './channel-inbound.js'
import { twimlGather, twimlMessage, xmlEscape } from './channel-outbound.js'

const wa = {
  id: 'wa1',
  kind: 'whatsapp',
  isActive: false,
  config: { phoneNumberId: '15550001234', accessToken: 'tok', verifyToken: 'studio-verify' },
}
const sms = {
  id: 'sms1',
  kind: 'sms',
  isActive: true,
  config: { accountSid: 'ACxx', authToken: 'tok', fromNumber: '+44 7700 900123' },
}
const tg = {
  id: 'tg1',
  kind: 'telegram',
  isActive: true,
  config: { botToken: '123:ABC', webhookSecret: 'tg-secret' },
}

test('WhatsApp webhook verify can match a connected channel that is still off', () => {
  assert.equal(findWhatsAppByVerifyToken([wa], 'studio-verify')?.id, 'wa1')
  assert.equal(findWhatsAppByPhoneNumberId([wa], '15550001234')?.isActive, false)
  assert.equal(findWhatsAppByVerifyToken([wa], 'wrong'), null)
})

test('Twilio SMS matches the destination number with or without spaces', () => {
  assert.equal(findTwilioByNumber([sms], 'sms', '+447700900123')?.id, 'sms1')
  assert.equal(findTwilioByNumber([sms], 'sms', '+44 7700 900999'), null)
  assert.equal(spokenFromTwilio({ Body: '  hello  ' }), 'hello')
})

test('Telegram secret header picks the bot, and text comes from the update', () => {
  assert.equal(findTelegramBySecret([tg], 'tg-secret')?.id, 'tg1')
  const heard = telegramText({
    message: { chat: { id: 99 }, from: { id: 7, first_name: 'Sam' }, text: 'hours?' },
  })
  assert.deepEqual(heard, { chatId: '99', fromId: '7', name: 'Sam', text: 'hours?' })
})

test('email inbound needs from, text, and secret', () => {
  assert.equal(emailInbound({ from: 'a@b.c', text: 'hi' }), null)
  const row = emailInbound({ from: 'a@b.c', to: 'hello@studio.com', text: 'hi', secret: 'secret12' })
  assert.equal(row?.from, 'a@b.c')
})

test('TwiML escapes the spoken line', () => {
  assert.match(twimlMessage('A & B <cut>'), /A &amp; B &lt;cut&gt;/)
  assert.match(twimlGather('Hello', 'https://app.botstudio.uk/api/v1/webhooks/phone'), /<Gather/)
  assert.equal(xmlEscape(`it's`), 'it&apos;s')
})
