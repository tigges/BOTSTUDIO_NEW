import { CHANNEL_FIELDS, isOptionalChannelKind } from '@ybot/shared'

export type ConnectionTab = 'overview' | 'credentials' | 'configuration' | 'deployment'

export const CONNECTION_TABS: { id: ConnectionTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'deployment', label: 'Deployment' },
]

/** The credential fields the form starts with: plain values filled in, secrets left blank. */
export function credentialForm(kind: string, config: Record<string, unknown>): Record<string, string> {
  if (!isOptionalChannelKind(kind)) return {}
  const form: Record<string, string> = {}
  for (const field of CHANNEL_FIELDS[kind]) form[field.key] = field.secret ? '' : String(config[field.key] ?? '')
  return form
}

/** The first field that is still empty, counting a saved secret as filled. */
export function missingCredential(kind: string, form: Record<string, string>, secretsSet: readonly string[] = []): string | null {
  if (!isOptionalChannelKind(kind)) return null
  for (const field of CHANNEL_FIELDS[kind]) {
    if ((form[field.key] ?? '').trim()) continue
    if (field.secret && secretsSet.includes(field.key)) continue
    return field.key
  }
  return null
}

/** Only what the user typed or changed; a blank secret keeps the saved one. */
export function credentialPatch(kind: string, form: Record<string, string>, config: Record<string, unknown>): Record<string, string> | null {
  if (!isOptionalChannelKind(kind)) return null
  const patch: Record<string, string> = {}
  for (const field of CHANNEL_FIELDS[kind]) {
    const value = (form[field.key] ?? '').trim()
    if (!value) continue
    if (!field.secret && value === String(config[field.key] ?? '')) continue
    patch[field.key] = value
  }
  return Object.keys(patch).length ? patch : null
}

export function apiErrorField(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const field = (body as Record<string, unknown>)['field']
  return typeof field === 'string' ? field : null
}
