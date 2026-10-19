import type { AuthProfileKind } from '@ybot/shared'
import { openSecret } from './secrets.js'

export interface AuthSettings {
  /** api_key and custom_header: header that carries the secret. */
  headerName?: string
  /** api_key: send the key as this query parameter instead of a header. */
  queryParam?: string
  /** basic: the username. The password is the secret. */
  username?: string
  /** custom_header: text before the secret, for example "Token ". */
  prefix?: string
}

export interface AuthProfileRow {
  id: string
  name: string
  kind: string
  settings: unknown
  secretEnc: string | null
  secretHint: string | null
  createdAt: Date
  updatedAt: Date
}

export interface AppliedAuth {
  headers: Record<string, string>
  query: Record<string, string>
  /** The plaintext secret, only so callers can scrub it from errors. Never log or return it. */
  secret?: string
}

export function settingsOf(profile: Pick<AuthProfileRow, 'settings'>): AuthSettings {
  const raw = (profile.settings ?? {}) as Record<string, unknown>
  const pick = (k: string) => (typeof raw[k] === 'string' && (raw[k] as string).trim() ? (raw[k] as string).trim() : undefined)
  return { headerName: pick('headerName'), queryParam: pick('queryParam'), username: pick('username'), prefix: typeof raw['prefix'] === 'string' ? (raw['prefix'] as string) : undefined }
}

/** Headers and query parameters for one outgoing call. Resolved at call time only. */
export function applyAuthProfile(profile: Pick<AuthProfileRow, 'kind' | 'settings' | 'secretEnc'> | null | undefined): AppliedAuth {
  if (!profile) return { headers: {}, query: {} }
  if (!profile.secretEnc) throw new Error('The Auth Profile on this tool has no secret yet. Add it under Tools → Auth Profiles.')
  const secret = openSecret(profile.secretEnc)
  const settings = settingsOf(profile)
  switch (profile.kind as AuthProfileKind) {
    case 'bearer':
      return { headers: { Authorization: `Bearer ${secret}` }, query: {}, secret }
    case 'basic':
      return { headers: { Authorization: `Basic ${Buffer.from(`${settings.username ?? ''}:${secret}`).toString('base64')}` }, query: {}, secret }
    case 'api_key':
      if (settings.queryParam) return { headers: {}, query: { [settings.queryParam]: secret }, secret }
      return { headers: { [settings.headerName ?? 'X-API-Key']: secret }, query: {}, secret }
    case 'custom_header':
      return { headers: { [settings.headerName ?? 'Authorization']: `${settings.prefix ?? ''}${secret}` }, query: {}, secret }
    default:
      throw new Error(`Auth Profile type "${profile.kind}" is not supported.`)
  }
}

/** The shape the console sees. The secret itself never leaves the server. */
export function publicAuthProfile(row: AuthProfileRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    settings: settingsOf(row),
    hasSecret: Boolean(row.secretEnc),
    secretHint: row.secretHint,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
