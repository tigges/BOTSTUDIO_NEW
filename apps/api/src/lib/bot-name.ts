const BOT_NAME_MAX = 80

/** The name in the top bar. Blank and overlong names are rejected. */
export function normalizedBotName(raw: unknown): { ok: true; name: string } | { ok: false; message: string } {
  if (typeof raw !== 'string') return { ok: false, message: 'Enter a name for this bot.' }
  const name = raw.trim()
  if (!name) return { ok: false, message: 'Enter a name for this bot.' }
  if (name.length > BOT_NAME_MAX) {
    return { ok: false, message: `Enter a name up to ${BOT_NAME_MAX} characters.` }
  }
  return { ok: true, name }
}
