import { numbersMatch, parseChannelConfig } from '@botstudio/shared'

export interface InboundChannel {
  id: string
  kind: string
  isActive: boolean
  config: unknown
}

export function findChannelByConfigKey(
  channels: InboundChannel[],
  kind: string,
  key: string,
  value: string,
  opts?: { activeOnly?: boolean },
): InboundChannel | null {
  const want = value.trim()
  if (!want) return null
  return channels.find((channel) => {
    if (channel.kind !== kind) return false
    if (opts?.activeOnly && !channel.isActive) return false
    const parsed = parseChannelConfig(channel.kind, channel.config)
    if (!parsed) return false
    const got = parsed[key] ?? ''
    if (key === 'fromNumber' || key === 'phoneNumberId') return numbersMatch(got, want) || got === want
    return got === want
  }) ?? null
}

export function findWhatsAppByPhoneNumberId(channels: InboundChannel[], phoneNumberId: string): InboundChannel | null {
  return findChannelByConfigKey(channels, 'whatsapp', 'phoneNumberId', phoneNumberId)
}

export function findWhatsAppByVerifyToken(channels: InboundChannel[], token: string): InboundChannel | null {
  return findChannelByConfigKey(channels, 'whatsapp', 'verifyToken', token)
}

export function findTwilioByNumber(channels: InboundChannel[], kind: 'sms' | 'phone', to: string): InboundChannel | null {
  return findChannelByConfigKey(channels, kind, 'fromNumber', to)
}

export function findTelegramBySecret(channels: InboundChannel[], secret: string): InboundChannel | null {
  return findChannelByConfigKey(channels, 'telegram', 'webhookSecret', secret)
}

export function findEmailInbound(channels: InboundChannel[], secret: string, to?: string): InboundChannel | null {
  const bySecret = findChannelByConfigKey(channels, 'email', 'inboundSecret', secret)
  if (!bySecret) return null
  if (!to?.trim()) return bySecret
  const parsed = parseChannelConfig(bySecret.kind, bySecret.config)
  const fromAddress = parsed?.['fromAddress'] ?? ''
  if (!fromAddress) return bySecret
  if (to.toLowerCase().includes(fromAddress.toLowerCase())) return bySecret
  return bySecret
}

export function telegramText(update: unknown): { chatId: string; fromId: string; name: string; text: string; messageId: string } | null {
  if (typeof update !== 'object' || update === null) return null
  const message = (update as { message?: Record<string, unknown> }).message
  if (!message) return null
  const text = typeof message['text'] === 'string' ? message['text'].trim() : ''
  if (!text) return null
  const chat = message['chat'] as { id?: number | string } | undefined
  const from = message['from'] as { id?: number | string; first_name?: string; last_name?: string } | undefined
  const chatId = chat?.id != null ? String(chat.id) : ''
  if (!chatId) return null
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || chatId
  const fromId = from?.id != null ? String(from.id) : chatId
  const updateId = (update as { update_id?: number | string }).update_id
  const messageId = updateId != null ? `update:${updateId}` : message['message_id'] != null ? `${chatId}:${String(message['message_id'])}` : ''
  return { chatId, fromId, name, text, messageId }
}

export function emailInbound(body: unknown, querySecret?: string): { from: string; to: string; text: string; secret: string; messageId: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const row = body as Record<string, unknown>
  const from = String(row['from'] ?? row['sender'] ?? '').trim()
  const to = String(row['to'] ?? row['recipient'] ?? '').trim()
  const text = String(row['text'] ?? row['plain'] ?? row['body'] ?? '').trim()
  const secret = String(row['secret'] ?? querySecret ?? '').trim()
  if (!from || !text || !secret) return null
  const messageId = String(row['messageId'] ?? row['message_id'] ?? row['Message-Id'] ?? '').trim()
  return { from, to, text, secret, messageId }
}

export function twilioFromForm(body: unknown): Record<string, string> {
  if (typeof body !== 'object' || body === null) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value == null) continue
    out[key] = String(value)
  }
  return out
}

export function spokenFromTwilio(form: Record<string, string>): string {
  return (form['SpeechResult'] || form['Digits'] || form['Body'] || '').trim()
}

export function destinationNumber(form: Record<string, string>): string {
  return (form['To'] || form['Called'] || form['ToZip'] || '').trim()
}
