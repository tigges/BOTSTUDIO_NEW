/** Browser storage keys. Builds before the rename used the ybot-* names. */
export const APP_STORAGE_KEY = 'botstudio-app'
export const THEME_STORAGE_KEY = 'botstudio-theme'
export const INBOX_SOUND_KEY = 'botstudio-inbox-sound'

const LEGACY_KEYS: Record<string, string> = {
  'ybot-app': APP_STORAGE_KEY,
  'ybot-theme': THEME_STORAGE_KEY,
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Moves values saved under the old names, so an open session and the theme
 * survive the rename. Runs before the app store reads its saved state.
 */
export function migrateLegacyStorage(storage: KeyValueStorage | undefined = globalThis.localStorage): void {
  if (!storage) return
  try {
    for (const [legacy, current] of Object.entries(LEGACY_KEYS)) {
      const value = storage.getItem(legacy)
      if (value === null) continue
      if (storage.getItem(current) === null) storage.setItem(current, value)
      storage.removeItem(legacy)
    }
  } catch { /* private mode or storage disabled */ }
}

/** The session token the app store saved, for requests made outside apiFetch. */
export function storedToken(storage: KeyValueStorage | undefined = globalThis.localStorage): string | null {
  try {
    const raw = storage?.getItem(APP_STORAGE_KEY)
    if (!raw) return null
    return (JSON.parse(raw) as { state?: { token?: string } })?.state?.token ?? null
  } catch {
    return null
  }
}
