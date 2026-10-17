/** Credentials and webhook paths for optional channels. Website chat has none. */

export const OPTIONAL_CHANNEL_KINDS = ['whatsapp', 'sms', 'telegram', 'phone', 'email'] as const
export type OptionalChannelKind = (typeof OPTIONAL_CHANNEL_KINDS)[number]

export interface ChannelField {
  key: string
  label: string
  placeholder: string
  hint: string
  secret?: boolean
}

export const CHANNEL_FIELDS: Record<OptionalChannelKind, ChannelField[]> = {
  whatsapp: [
    { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '1234567890', hint: 'Meta for Developers → WhatsApp → API Setup' },
    { key: 'accessToken', label: 'Access Token', placeholder: 'EAAxxxxxxx…', hint: 'Permanent token from a Meta System User', secret: true },
    { key: 'verifyToken', label: 'Verify Token', placeholder: 'my-secret-verify-token', hint: 'The same string you enter in the Meta webhook form' },
  ],
  sms: [
    { key: 'accountSid', label: 'Twilio Account SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', hint: 'Twilio Console → Account' },
    { key: 'authToken', label: 'Auth Token', placeholder: 'your auth token', hint: 'Twilio Console → Account', secret: true },
    { key: 'fromNumber', label: 'From number', placeholder: '+447700900123', hint: 'The Twilio number guests text' },
  ],
  telegram: [
    { key: 'botToken', label: 'Bot token', placeholder: '123456:ABC…', hint: 'From BotFather /newbot', secret: true },
  ],
  phone: [
    { key: 'accountSid', label: 'Twilio Account SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', hint: 'Twilio Console → Account' },
    { key: 'authToken', label: 'Auth Token', placeholder: 'your auth token', hint: 'Twilio Console → Account', secret: true },
    { key: 'fromNumber', label: 'Voice number', placeholder: '+447700900123', hint: 'The Twilio number guests call' },
  ],
  email: [
    { key: 'fromAddress', label: 'From address', placeholder: 'hello@studio.com', hint: 'Replies are sent from this address' },
    { key: 'inboundSecret', label: 'Inbound secret', placeholder: 'a shared secret', hint: 'The inbound mail webhook must send this secret', secret: true },
  ],
}

export const CHANNEL_WEBHOOK_HINT: Record<OptionalChannelKind, string> = {
  whatsapp: 'Subscribe to the messages field in Meta.',
  sms: 'Set this URL as the incoming message webhook on the Twilio number.',
  telegram: 'BotStudio sets this webhook after Connect. You can also set it with setWebhook.',
  phone: 'Set this URL as the voice webhook on the Twilio number.',
  email: 'POST from, to, text, and secret to this URL when mail arrives.',
}

export function isOptionalChannelKind(kind: string): kind is OptionalChannelKind {
  return (OPTIONAL_CHANNEL_KINDS as readonly string[]).includes(kind)
}

export function channelWebhookPath(kind: string): string {
  return `/api/v1/webhooks/${kind}`
}

export function channelConfigReady(kind: string, config: Record<string, string> | unknown): boolean {
  return parseChannelConfig(kind, config) !== null
}

/** Required fields plus any extra string keys (webhook secrets, and so on). */
export function parseChannelConfig(kind: string, config: unknown): Record<string, string> | null {
  if (kind === 'web') return {}
  if (!isOptionalChannelKind(kind)) return null
  if (typeof config !== 'object' || config === null) return null
  const raw = config as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue
    const text = String(value).trim()
    if (text) out[key] = text
  }
  for (const field of CHANNEL_FIELDS[kind]) {
    if (!out[field.key]) return null
  }
  return out
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

export function configValue(config: Record<string, string> | null | undefined, key: string): string {
  return config?.[key]?.trim() ?? ''
}

export function numbersMatch(left: string, right: string): boolean {
  const a = digitsOnly(left)
  const b = digitsOnly(right)
  return a.length > 0 && a === b
}
