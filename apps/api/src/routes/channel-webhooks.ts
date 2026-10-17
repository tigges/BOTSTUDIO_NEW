/**
 * Public inbound webhooks. Providers cannot send a BotStudio session cookie.
 *
 * GET/POST /webhooks/whatsapp  — Meta
 * POST     /webhooks/telegram  — Telegram secret_token header
 * POST     /webhooks/sms       — Twilio SMS
 * POST     /webhooks/phone     — Twilio Voice
 * POST     /webhooks/email     — inbound mail JSON
 */

import type { FastifyInstance } from 'fastify'
import { prisma } from '@ybot/db'
import { getBotReply } from '../lib/bot-engine.js'
import {
  emailInbound,
  findEmailInbound,
  findTelegramBySecret,
  findTwilioByNumber,
  findWhatsAppByPhoneNumberId,
  findWhatsAppByVerifyToken,
  spokenFromTwilio,
  telegramText,
  twilioFromForm,
  destinationNumber,
  type InboundChannel,
} from '../lib/channel-inbound.js'
import { parseWhatsAppConfig, sendText as sendWhatsAppText, markRead } from '../lib/whatsapp-client.js'
import { sendChannelReply, twimlGather, twimlHangup, twimlMessage } from '../lib/channel-outbound.js'

interface WATextMessage {
  from: string
  id: string
  timestamp: string
  type: 'text'
  text: { body: string }
}

interface WAChangeValue {
  messaging_product: string
  metadata: { display_phone_number: string; phone_number_id: string }
  contacts?: Array<{ profile: { name: string }; wa_id: string }>
  messages?: WATextMessage[]
  statuses?: unknown[]
}

interface WAPayload {
  object: string
  entry: Array<{ id: string; changes: Array<{ value: WAChangeValue; field: string }> }>
}

async function loadKind(kind: string): Promise<InboundChannel[]> {
  const rows = await prisma.channel.findMany({ where: { kind } })
  return rows.map((row) => ({ id: row.id, kind: row.kind, isActive: row.isActive, config: row.config }))
}

function publicWebhookUrl(request: { headers: Record<string, unknown>; protocol: string; hostname: string }, path: string): string {
  const proto = String(request.headers['x-forwarded-proto'] ?? request.protocol ?? 'https').split(',')[0]?.trim() || 'https'
  const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? request.hostname).split(',')[0]?.trim()
  return `${proto}://${host}${path}`
}

export async function channelWebhookRoutes(app: FastifyInstance) {
  try {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(String(body))))
      } catch (err) {
        done(err as Error)
      }
    })
  } catch {
    // Already registered on this Fastify instance.
  }

  app.get<{
    Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string }
  }>('/webhooks/whatsapp', async (request, reply) => {
    const mode = request.query['hub.mode']
    const token = request.query['hub.verify_token']
    const challenge = request.query['hub.challenge']
    if (mode !== 'subscribe' || !token) return reply.status(400).send('Bad request')
    const globalToken = process.env['WHATSAPP_VERIFY_TOKEN']
    if (globalToken && token === globalToken) return reply.send(challenge)
    const channels = await loadKind('whatsapp')
    if (findWhatsAppByVerifyToken(channels, token)) return reply.send(challenge)
    return reply.status(403).send('Forbidden')
  })

  app.post('/webhooks/whatsapp', async (request, reply) => {
    reply.status(200).send({ ok: true })
    processWhatsApp(request.body as WAPayload).catch((err) => {
      app.log.error({ err }, '[whatsapp] webhook processing error')
    })
  })

  app.post('/webhooks/telegram', async (request, reply) => {
    const secret = String(request.headers['x-telegram-bot-api-secret-token'] ?? '')
    const channels = await loadKind('telegram')
    const channel = findTelegramBySecret(channels, secret)
    if (!channel) return reply.status(403).send({ ok: false })
    if (!channel.isActive) return reply.status(200).send({ ok: true, idle: true })
    const heard = telegramText(request.body)
    if (!heard) return reply.status(200).send({ ok: true })
    const row = await prisma.channel.findFirst({ where: { id: channel.id } })
    if (!row) return reply.status(200).send({ ok: true })
    try {
      const { reply: botReply } = await getBotReply({
        channelId: row.id,
        botId: row.botId,
        tenantId: row.tenantId,
        userText: heard.text,
        externalId: heard.fromId,
        displayName: heard.name,
      })
      if (botReply.trim()) await sendChannelReply('telegram', row.config, heard.chatId, botReply)
    } catch (err) {
      app.log.error({ err }, '[telegram] inbound error')
    }
    return { ok: true }
  })

  app.post('/webhooks/sms', async (request, reply) => {
    const form = twilioFromForm(request.body)
    const to = destinationNumber(form)
    const text = spokenFromTwilio(form)
    const from = (form['From'] ?? '').trim()
    const channels = await loadKind('sms')
    const channel = findTwilioByNumber(channels, 'sms', to)
    if (!channel) return reply.type('text/xml').send(twimlHangup('This number is not set up.'))
    if (!channel.isActive) return reply.type('text/xml').send(twimlMessage('This number is not taking texts right now.'))
    if (!text || !from) return reply.type('text/xml').send(twimlMessage('I did not catch that.'))
    const row = await prisma.channel.findFirst({ where: { id: channel.id } })
    if (!row) return reply.type('text/xml').send(twimlHangup('This number is not set up.'))
    try {
      const { reply: botReply } = await getBotReply({
        channelId: row.id,
        botId: row.botId,
        tenantId: row.tenantId,
        userText: text,
        externalId: from,
        displayName: from,
      })
      return reply.type('text/xml').send(twimlMessage(botReply || 'Thanks — I will follow up shortly.'))
    } catch (err) {
      app.log.error({ err }, '[sms] inbound error')
      return reply.type('text/xml').send(twimlMessage('Sorry, I am having trouble right now.'))
    }
  })

  app.post('/webhooks/phone', async (request, reply) => {
    const form = twilioFromForm(request.body)
    const to = destinationNumber(form)
    const from = (form['From'] ?? '').trim()
    const callSid = (form['CallSid'] ?? from).trim()
    const heard = spokenFromTwilio(form)
    const action = publicWebhookUrl(request, '/api/v1/webhooks/phone')
    const channels = await loadKind('phone')
    const channel = findTwilioByNumber(channels, 'phone', to)
    if (!channel) return reply.type('text/xml').send(twimlHangup('This number is not set up.'))
    if (!channel.isActive) return reply.type('text/xml').send(twimlHangup('This number is not taking calls right now.'))
    const row = await prisma.channel.findFirst({ where: { id: channel.id } })
    if (!row) return reply.type('text/xml').send(twimlHangup('This number is not set up.'))
    const userText = heard || 'hello'
    try {
      const { reply: botReply } = await getBotReply({
        channelId: row.id,
        botId: row.botId,
        tenantId: row.tenantId,
        userText,
        externalId: callSid,
        displayName: from || 'Caller',
      })
      return reply.type('text/xml').send(twimlGather(botReply || 'How can I help?', action))
    } catch (err) {
      app.log.error({ err }, '[phone] inbound error')
      return reply.type('text/xml').send(twimlHangup('Sorry, I am having trouble right now.'))
    }
  })

  app.post('/webhooks/email', async (request, reply) => {
    const query = request.query as Record<string, string>
    const inbound = emailInbound(request.body, query['secret'])
    if (!inbound) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'from, text, and secret are required.' } })
    const channels = await loadKind('email')
    const channel = findEmailInbound(channels, inbound.secret, inbound.to)
    if (!channel) return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
    if (!channel.isActive) return reply.status(200).send({ ok: true, idle: true })
    const row = await prisma.channel.findFirst({ where: { id: channel.id } })
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    try {
      const { reply: botReply } = await getBotReply({
        channelId: row.id,
        botId: row.botId,
        tenantId: row.tenantId,
        userText: inbound.text,
        externalId: inbound.from,
        displayName: inbound.from,
      })
      if (botReply.trim()) await sendChannelReply('email', row.config, inbound.from, botReply)
    } catch (err) {
      app.log.error({ err }, '[email] inbound error')
    }
    return { ok: true }
  })
}

async function processWhatsApp(payload: WAPayload): Promise<void> {
  if (payload.object !== 'whatsapp_business_account') return
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value
      if (value.statuses?.length) continue
      if (!value.messages?.length) continue
      const channels = await loadKind('whatsapp')
      const channel = findWhatsAppByPhoneNumberId(channels, value.metadata.phone_number_id)
      if (!channel) {
        console.warn(`[whatsapp] no channel found for phoneNumberId=${value.metadata.phone_number_id}`)
        continue
      }
      if (!channel.isActive) continue
      const row = await prisma.channel.findFirst({ where: { id: channel.id } })
      if (!row) continue
      const waConfig = parseWhatsAppConfig(row.config)
      if (!waConfig) continue
      for (const msg of value.messages) {
        if (msg.type !== 'text') {
          await sendWhatsAppText(waConfig, msg.from, 'Thanks for your message! I can currently only process text messages.').catch(() => {})
          continue
        }
        const userText = msg.text.body.trim()
        if (!userText) continue
        const senderName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile.name ?? msg.from
        try {
          await markRead(waConfig, msg.id)
          const { reply: botReply } = await getBotReply({
            channelId: row.id,
            botId: row.botId,
            tenantId: row.tenantId,
            userText,
            externalId: msg.from,
            displayName: senderName,
          })
          if (botReply.trim()) await sendWhatsAppText(waConfig, msg.from, botReply)
        } catch (err) {
          console.error(`[whatsapp] error processing message from ${msg.from}:`, err)
          await sendWhatsAppText(waConfig, msg.from, "Sorry, I'm having trouble right now. Please try again in a moment.").catch(() => {})
        }
      }
    }
  }
}

