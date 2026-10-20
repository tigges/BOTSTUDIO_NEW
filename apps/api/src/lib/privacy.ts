/**
 * Personal data on the server: stable tokens for models, render modes for every other reader.
 *
 * A token is [KIND_XXXXXXXX], an HMAC of the tenant and the value, so the same
 * email is the same token in every call and every chat of that tenant. Tokens
 * are only ever resolved in memory, from values this process has seen; nothing
 * maps tokens back to values on disk.
 */

import { createHash, createHmac } from 'node:crypto'
import { prisma } from '@ybot/db'
import { setLlmPrivacy } from '@ybot/llm'
import {
  DEFAULT_PRIVACY,
  findPersonalData,
  parsePrivacySettings,
  PRIVACY_TOKEN,
  readerMode,
  renderPersonalData,
  renderPersonalDataDeep,
  type CustomPattern,
  type PrivacyReader,
  type PrivacySettings,
} from '@ybot/shared'
import { currentLlmScope } from './llm-ledger.js'

function tokenKey(): Buffer {
  const raw = process.env['PII_TOKEN_KEY']?.trim() || process.env['SECRETS_KEY']?.trim() || process.env['JWT_SECRET'] || 'dev-secret-change-me'
  return createHash('sha256').update(`ybot-pii:${raw}`).digest()
}

function normalise(kind: string, value: string): string {
  if (kind === 'email') return value.trim().toLowerCase()
  if (kind === 'phone' || kind === 'card') return value.replace(/[^\d+]/g, '')
  if (kind === 'iban' || kind === 'national_id') return value.replace(/\s+/g, '').toUpperCase()
  return value.trim()
}

const VAULT_LIMIT = 20_000
const vault = new Map<string, string>()

function remember(token: string, value: string): void {
  if (vault.has(token)) vault.delete(token)
  vault.set(token, value)
  if (vault.size > VAULT_LIMIT) vault.delete(vault.keys().next().value!)
}

/** The stable token for one value. The same tenant and value always give the same token. */
export function tokenFor(kind: string, value: string, tenantId = currentLlmScope()?.tenantId ?? ''): string {
  const digest = createHmac('sha256', tokenKey()).update(`${tenantId}\u0000${kind}\u0000${normalise(kind, value)}`).digest('hex')
  const token = `[${kind.toUpperCase()}_${digest.slice(0, 8).toUpperCase()}]`
  remember(token, value)
  return token
}

/** Personal data out, tokens in. */
export function protectText(text: string, custom: CustomPattern[] = [], tenantId?: string): string {
  if (!text) return text
  const spans = findPersonalData(text, custom)
  if (spans.length === 0) return text
  let out = ''
  let at = 0
  for (const span of spans) {
    out += text.slice(at, span.start) + tokenFor(span.kind, span.value, tenantId)
    at = span.end
  }
  return out + text.slice(at)
}

/** Tokens this process has issued, back to what was written. Unknown tokens stay as they are. */
export function revealText(text: string): string {
  if (!text || !text.includes('[')) return text
  return text.replace(PRIVACY_TOKEN, (token) => vault.get(token) ?? token)
}

const SETTINGS_TTL_MS = 60_000
const settingsCache = new Map<string, { settings: PrivacySettings; at: number }>()

/** A bot's privacy settings, read from the database at most once a minute. */
export async function loadPrivacy(botId: string | null | undefined): Promise<PrivacySettings> {
  if (!botId) return DEFAULT_PRIVACY
  const cached = settingsCache.get(botId)
  if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.settings
  const row = await prisma.botConfig.findUnique({ where: { botId }, select: { privacy: true } }).catch(() => null)
  const settings = parsePrivacySettings(row?.privacy)
  settingsCache.set(botId, { settings, at: Date.now() })
  return settings
}

/** The cached settings without waiting; defaults when this bot has not been read yet. */
export function privacyNow(botId: string | null | undefined): PrivacySettings {
  return (botId && settingsCache.get(botId)?.settings) || DEFAULT_PRIVACY
}

export function forgetPrivacy(botId: string): void {
  settingsCache.delete(botId)
}

/** Text as one reader may see it. Tokens are resolved first, so every mode starts from what was written. */
export function renderFor(reader: PrivacyReader, text: string, settings: PrivacySettings, tenantId?: string): string {
  const mode = readerMode(settings, reader)
  const plain = revealText(text)
  if (mode === 'original') return plain
  return renderPersonalData(plain, mode, { custom: settings.custom, tokenFor: (kind, value) => tokenFor(kind, value, tenantId) })
}

/** `renderFor` over every string in a JSON value. */
export function renderDeepFor<T>(reader: PrivacyReader, value: T, settings: PrivacySettings, tenantId?: string): T {
  if (readerMode(settings, reader) === 'original') return renderPersonalDataDeep(value, revealText)
  return renderPersonalDataDeep(value, (text) => renderFor(reader, text, settings, tenantId))
}

/** Every model call in this process goes out with personal data swapped for tokens. */
export function installLlmPrivacy(): void {
  setLlmPrivacy({
    protect: (text) => {
      const scope = currentLlmScope()
      return protectText(text, privacyNow(scope?.botId).custom, scope?.tenantId)
    },
    reveal: revealText,
  })
}
