import { channelSecretKeys, maskChannelConfig } from '@ybot/shared'

export interface ChannelRow {
  id: string
  kind: string
  name: string
  environmentId: string
  isActive: boolean
  config: unknown
  allowedDomains?: string[] | null
}

const SAVED = 'saved (hidden)'

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** The connection as the console sees it: secrets removed, with the names of the ones that are saved. */
export function publicChannel<T extends ChannelRow>(row: T): Omit<T, 'config'> & { config: Record<string, unknown>; secretsSet: string[] } {
  const masked = maskChannelConfig(row.kind, row.config)
  return { ...row, config: masked.config, secretsSet: masked.secretsSet }
}

/** A flat audit snapshot. Secrets show as saved or not, never their value. */
export function channelSnapshot(row: ChannelRow): Record<string, unknown> {
  const config = asRecord(row.config)
  const secrets = new Set(channelSecretKeys(row.kind))
  const snapshot: Record<string, unknown> = {
    name: row.name,
    kind: row.kind,
    environmentId: row.environmentId,
    isActive: row.isActive,
  }
  if (row.allowedDomains?.length) snapshot['allowedDomains'] = row.allowedDomains.join(', ')
  for (const [key, value] of Object.entries(config)) {
    snapshot[key] = secrets.has(key) ? (String(value ?? '').trim() ? SAVED : null) : value
  }
  return snapshot
}

/** Changed fields, comparing real values so a rotated secret counts as a change even though both sides read "saved". */
export function channelChanges(before: ChannelRow | null, after: ChannelRow | null): string[] {
  const flat = (row: ChannelRow | null): Record<string, unknown> => row
    ? { name: row.name, environmentId: row.environmentId, isActive: row.isActive, allowedDomains: (row.allowedDomains ?? []).join(', '), ...asRecord(row.config) }
    : {}
  const a = flat(before)
  const b = flat(after)
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null))
}

export function channelAudit(before: ChannelRow | null, after: ChannelRow | null) {
  return {
    before: before ? channelSnapshot(before) : null,
    after: after ? channelSnapshot(after) : null,
    changes: channelChanges(before, after),
  }
}
