import { maskChannelConfig } from '@ybot/shared'

/** The connection as the console sees it: secrets removed, with the names of the ones that are saved. */
export function publicChannel<T extends { kind: string; config: unknown }>(row: T): Omit<T, 'config'> & { config: Record<string, unknown>; secretsSet: string[] } {
  const masked = maskChannelConfig(row.kind, row.config)
  return { ...row, config: masked.config, secretsSet: masked.secretsSet }
}
