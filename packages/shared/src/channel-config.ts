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

/** Keys never sent back to the browser: the secret fields plus what BotStudio generates. */
export function channelSecretKeys(kind: string): string[] {
  if (!isOptionalChannelKind(kind)) return []
  return [...CHANNEL_FIELDS[kind].filter((field) => field.secret).map((field) => field.key), 'webhookSecret']
}

/** The config the console may see, and which secrets are saved. */
export function maskChannelConfig(kind: string, config: unknown): { config: Record<string, unknown>; secretsSet: string[] } {
  const raw = typeof config === 'object' && config !== null && !Array.isArray(config) ? config as Record<string, unknown> : {}
  const secret = new Set(channelSecretKeys(kind))
  const visible: Record<string, unknown> = {}
  const secretsSet: string[] = []
  for (const [key, value] of Object.entries(raw)) {
    if (!secret.has(key)) visible[key] = value
    else if (String(value ?? '').trim()) secretsSet.push(key)
  }
  return { config: visible, secretsSet }
}

/** A blank field in an edit keeps the saved value, so secrets need not be typed again. */
export function mergeChannelConfig(previous: unknown, incoming: Record<string, unknown>): Record<string, unknown> {
  const base = typeof previous === 'object' && previous !== null && !Array.isArray(previous) ? previous as Record<string, unknown> : {}
  const next = { ...base }
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined || String(value).trim() === '') continue
    next[key] = value
  }
  return next
}

export interface RoutingKey {
  label: string
  /** Null when the key is a secret the console never shows. */
  value: string | null
  how: string
}

/** What an inbound delivery carries that picks this connection out of every other. */
export function channelRoutingKey(kind: string, config: Record<string, unknown>, channelId: string): RoutingKey {
  const value = (key: string) => String(config[key] ?? '').trim() || null
  switch (kind) {
    case 'whatsapp':
      return { label: 'Phone Number ID', value: value('phoneNumberId'), how: 'Meta sends it with every message, and BotStudio routes on it.' }
    case 'sms':
    case 'phone':
      return { label: 'Twilio number', value: value('fromNumber'), how: 'Twilio sends it as "To", and BotStudio routes on it.' }
    case 'telegram':
      return { label: 'Webhook secret', value: null, how: 'BotStudio registers it with Telegram on save and checks it on every delivery. It is never shown.' }
    case 'email':
      return { label: 'From address', value: value('fromAddress'), how: 'Mail must carry the inbound secret; the address picks the connection when several share a secret.' }
    default:
      return { label: 'Channel ID', value: channelId, how: 'The embed script sends it with every message.' }
  }
}

export interface StatusHelp {
  status: number
  /** provider: BotStudio called the provider (Connect, Check). webhook: the provider called BotStudio. */
  where: 'provider' | 'webhook'
  /** The field to fix; null when no field is at fault. */
  field: string | null
  fix: string
}

export const CHANNEL_STATUS_HELP: Record<OptionalChannelKind, StatusHelp[]> = {
  whatsapp: [
    { status: 401, where: 'provider', field: 'accessToken', fix: 'The access token is wrong or expired. Create a permanent token for a Meta System User.' },
    { status: 403, where: 'provider', field: 'accessToken', fix: 'The token works but lacks the whatsapp_business_messaging permission.' },
    { status: 400, where: 'provider', field: 'phoneNumberId', fix: 'No phone number with this ID for this token. Copy the Phone Number ID from API Setup, not the phone number itself.' },
    { status: 404, where: 'provider', field: 'phoneNumberId', fix: 'No phone number with this ID. Copy the Phone Number ID from API Setup.' },
    { status: 403, where: 'webhook', field: 'verifyToken', fix: 'Meta sent a verify token no connection has. Type the same string in Meta\'s webhook form.' },
  ],
  telegram: [
    { status: 401, where: 'provider', field: 'botToken', fix: 'Telegram does not know this token. Copy it again from BotFather.' },
    { status: 404, where: 'provider', field: 'botToken', fix: 'The token is incomplete. It looks like 123456:ABC…, with the part before the colon.' },
    { status: 403, where: 'webhook', field: null, fix: 'The secret header did not match. Save the connection again so BotStudio registers the webhook afresh.' },
  ],
  sms: [
    { status: 401, where: 'provider', field: 'authToken', fix: 'The Account SID and Auth Token do not match. Copy both from the Twilio Console.' },
    { status: 404, where: 'provider', field: 'accountSid', fix: 'No Twilio account with this SID.' },
    { status: 400, where: 'provider', field: 'fromNumber', fix: 'Twilio rejected the number. Use a number on this account, written like +447700900123.' },
  ],
  phone: [
    { status: 401, where: 'provider', field: 'authToken', fix: 'The Account SID and Auth Token do not match. Copy both from the Twilio Console.' },
    { status: 404, where: 'provider', field: 'accountSid', fix: 'No Twilio account with this SID.' },
    { status: 400, where: 'provider', field: 'fromNumber', fix: 'Twilio rejected the number. Use a number on this account, written like +447700900123.' },
  ],
  email: [
    { status: 400, where: 'webhook', field: null, fix: 'The POST is missing from, text or secret.' },
    { status: 403, where: 'webhook', field: 'inboundSecret', fix: 'The secret did not match. Send the Inbound secret as "secret" in the body or the query.' },
  ],
}

export function statusHelp(kind: string, status: number, where: StatusHelp['where'] = 'provider'): StatusHelp | null {
  if (!isOptionalChannelKind(kind)) return null
  return CHANNEL_STATUS_HELP[kind].find((row) => row.status === status && row.where === where) ?? null
}

export function channelFieldLabel(kind: string, key: string | null): string {
  if (!key) return ''
  if (!isOptionalChannelKind(kind)) return key
  return CHANNEL_FIELDS[kind].find((field) => field.key === key)?.label ?? key
}
