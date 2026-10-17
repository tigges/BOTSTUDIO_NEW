import { randomBytes } from 'node:crypto'
import {
  isOptionalChannelKind,
  parseChannelConfig,
  type OptionalChannelKind,
} from '@ybot/shared'

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export interface VerifyResult {
  ok: boolean
  message?: string
  extra?: Record<string, string>
}

function emailLooksRight(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

async function readJson(res: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  const body = await res.json().catch(() => ({}))
  return typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
}

export async function verifyChannelCredentials(
  kind: string,
  config: Record<string, string>,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<VerifyResult> {
  if (!isOptionalChannelKind(kind)) {
    return { ok: false, message: 'This channel kind cannot be connected here.' }
  }
  const parsed = parseChannelConfig(kind, config)
  if (!parsed) return { ok: false, message: 'Fill every field for this channel.' }

  if (kind === 'email') {
    if (!emailLooksRight(parsed['fromAddress'] ?? '')) {
      return { ok: false, message: 'From address needs to look like an email.' }
    }
    if ((parsed['inboundSecret'] ?? '').length < 8) {
      return { ok: false, message: 'Inbound secret needs at least 8 characters.' }
    }
    return { ok: true }
  }

  try {
    if (kind === 'whatsapp') return await verifyWhatsApp(parsed, fetchImpl)
    if (kind === 'telegram') return await verifyTelegram(parsed, fetchImpl)
    if (kind === 'sms' || kind === 'phone') return await verifyTwilio(parsed, fetchImpl)
  } catch (err) {
    const who = kindLabel(kind)
    const detail = err instanceof Error ? err.message : 'network error'
    return { ok: false, message: `Could not reach ${who} (${detail}).` }
  }
  return { ok: false, message: 'This channel kind cannot be connected here.' }
}

function kindLabel(kind: OptionalChannelKind): string {
  if (kind === 'whatsapp') return 'WhatsApp'
  if (kind === 'telegram') return 'Telegram'
  if (kind === 'email') return 'email'
  return 'Twilio'
}

async function verifyWhatsApp(config: Record<string, string>, fetchImpl: FetchLike): Promise<VerifyResult> {
  const id = config['phoneNumberId'] ?? ''
  const token = config['accessToken'] ?? ''
  const res = await fetchImpl(`https://graph.facebook.com/v20.0/${encodeURIComponent(id)}?fields=display_phone_number`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: 'WhatsApp refused that access token.' }
  }
  if (!res.ok) {
    const body = await readJson(res)
    const msg = (body['error'] as { message?: string } | undefined)?.message
    return { ok: false, message: msg ?? `WhatsApp returned HTTP ${res.status}.` }
  }
  return { ok: true }
}

async function verifyTelegram(config: Record<string, string>, fetchImpl: FetchLike): Promise<VerifyResult> {
  const token = config['botToken'] ?? ''
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`)
  const body = await readJson(res)
  if (!res.ok || body['ok'] !== true) {
    return { ok: false, message: 'Telegram refused that bot token.' }
  }
  if (config['webhookSecret']) return { ok: true }
  return { ok: true, extra: { webhookSecret: randomBytes(16).toString('hex') } }
}

async function verifyTwilio(config: Record<string, string>, fetchImpl: FetchLike): Promise<VerifyResult> {
  const sid = config['accountSid'] ?? ''
  const auth = config['authToken'] ?? ''
  if (!sid.startsWith('AC')) {
    return { ok: false, message: 'Twilio Account SID starts with AC.' }
  }
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}` },
  })
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: 'Twilio refused those credentials.' }
  }
  if (!res.ok) {
    return { ok: false, message: `Twilio returned HTTP ${res.status}.` }
  }
  return { ok: true }
}

export async function registerTelegramWebhook(
  config: Record<string, string>,
  webhookUrl: string,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<void> {
  const token = config['botToken']
  const secret = config['webhookSecret']
  if (!token || !secret) return
  await fetchImpl(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, secret_token: secret, drop_pending_updates: false }),
  }).catch(() => {})
}
