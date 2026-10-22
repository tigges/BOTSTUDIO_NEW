import { sendEmail } from './email.js'
import { parseChannelConfig, renderForChannel, splitText, CHANNEL_LIMITS, type ChannelSend, type RichMessage } from '@botstudio/shared'

/** A bot reply as the turn produced it: the text, and the open question's choices if any. */
export interface OutboundReply {
  text: string
  choices?: string[]
}

export interface ProviderRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export function richFromReply(reply: OutboundReply | string): RichMessage {
  const { text, choices } = typeof reply === 'string' ? { text: reply, choices: undefined } : reply
  return choices?.length ? { type: 'quick_replies', text, replies: choices } : { type: 'text', text }
}

function whatsappBody(to: string, send: ChannelSend): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to }
  if (send.type === 'buttons') {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: send.text },
        action: { buttons: send.buttons.map((title, index) => ({ type: 'reply', reply: { id: `choice_${index + 1}`, title } })) },
      },
    }
  }
  if (send.type === 'list') {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: send.text },
        action: { button: send.button, sections: [{ title: 'Options', rows: send.rows.map((title, index) => ({ id: `choice_${index + 1}`, title })) }] },
      },
    }
  }
  return { ...base, type: 'text', text: { preview_url: false, body: send.text } }
}

function telegramBody(chatId: string, send: ChannelSend): Record<string, unknown> {
  if (send.type === 'buttons' || send.type === 'list') {
    const options = send.type === 'buttons' ? send.buttons : send.rows
    return {
      chat_id: chatId,
      text: send.text,
      reply_markup: { keyboard: options.map((text) => [{ text }]), one_time_keyboard: true, resize_keyboard: true },
    }
  }
  return { chat_id: chatId, text: send.text }
}

/** The provider calls one reply needs, in order. Email and phone are not HTTP sends and return none. */
export function providerRequests(kind: string, config: Record<string, string>, to: string, sends: ChannelSend[]): ProviderRequest[] {
  const json = { 'Content-Type': 'application/json' }
  if (kind === 'whatsapp') {
    const url = `https://graph.facebook.com/${config['apiVersion'] || 'v20.0'}/${config['phoneNumberId']}/messages`
    const headers = { ...json, Authorization: `Bearer ${config['accessToken']}` }
    return sends.map((send) => ({ url, headers, body: JSON.stringify(whatsappBody(to, send)) }))
  }
  if (kind === 'telegram') {
    const url = `https://api.telegram.org/bot${config['botToken']}/sendMessage`
    return sends.map((send) => ({ url, headers: json, body: JSON.stringify(telegramBody(to, send)) }))
  }
  if (kind === 'sms') {
    const sid = config['accountSid'] ?? ''
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`
    const headers = {
      Authorization: `Basic ${Buffer.from(`${sid}:${config['authToken'] ?? ''}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    return sends.map((send) => ({ url, headers, body: new URLSearchParams({ To: to, From: config['fromNumber'] ?? '', Body: send.text }).toString() }))
  }
  return []
}

const PROVIDER: Record<string, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram', sms: 'Twilio SMS' }

export async function sendChannelReply(kind: string, config: unknown, to: string, reply: OutboundReply | string): Promise<void> {
  const parsed = parseChannelConfig(kind, config)
  const text = typeof reply === 'string' ? reply : reply.text
  if (!parsed || !to.trim() || !text.trim()) return
  const message = richFromReply(reply)
  if (kind === 'email') {
    const { sends } = renderForChannel(message, 'email')
    const text = sends.map((send) => send.text).join('\n\n')
    await sendEmail({ to, subject: 'A reply from the studio', text, html: `<p>${escapeHtml(text).replace(/\n/g, '<br/>')}</p>` })
    return
  }
  if (kind !== 'whatsapp' && kind !== 'telegram' && kind !== 'sms') return
  const { sends } = renderForChannel(message, kind)
  for (const request of providerRequests(kind, parsed, to, sends)) {
    const res = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body })
    if (!res.ok) {
      const detail = await res.json().catch(() => null) as { error?: { message?: string } } | null
      throw new Error(`${PROVIDER[kind]} send HTTP ${res.status}${detail?.error?.message ? `: ${detail.error.message}` : ''}`)
    }
  }
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** A text reply over SMS: one Message per 1,600-character part, choices numbered. */
export function twimlMessage(reply: OutboundReply | string): string {
  const { sends } = renderForChannel(richFromReply(reply), 'sms')
  const messages = sends.map((send) => `<Message>${xmlEscape(send.text)}</Message>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${messages}</Response>`
}

/** A spoken reply: long text becomes several Say verbs, choices are read out. */
export function twimlGather(reply: OutboundReply | string, action: string): string {
  const { sends } = renderForChannel(richFromReply(reply), 'phone')
  const says = sends.map((send) => `<Say>${xmlEscape(send.text)}</Say>`).join('')
  const url = xmlEscape(action)
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech dtmf" action="${url}" method="POST" timeout="6" speechTimeout="auto">${says}</Gather><Say>I did not catch that. Goodbye.</Say></Response>`
}

export function twimlHangup(say: string): string {
  const says = splitText(say, CHANNEL_LIMITS.phone.textMax).map((text) => `<Say>${xmlEscape(text)}</Say>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${says}<Hangup/></Response>`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
