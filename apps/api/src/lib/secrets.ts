import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const VERSION = 'v1'
let warned = false

function key(): Buffer {
  const raw = process.env['SECRETS_KEY']?.trim()
  if (raw) return /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : createHash('sha256').update(raw).digest()
  if (!warned && process.env['NODE_ENV'] === 'production') {
    warned = true
    console.warn('[secrets] SECRETS_KEY is not set; Auth Profile secrets are sealed with a key derived from JWT_SECRET.')
  }
  return createHash('sha256').update(`ybot-secrets:${process.env['JWT_SECRET'] ?? 'dev-secret-change-me'}`).digest()
}

/** AES-256-GCM. The result is safe to store; only `openSecret` reads it back. */
export function sealSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`
}

export function openSecret(sealed: string): string {
  const [version, payload] = sealed.split(':', 2)
  if (version !== VERSION || !payload) throw new Error('This secret was sealed in an unknown format. Enter it again on the Auth Profile.')
  const raw = Buffer.from(payload, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  try {
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('This secret can no longer be read (the server key changed). Enter it again on the Auth Profile.')
  }
}

/** What the console may show: the last four characters of a long secret, nothing of a short one. */
export function secretHint(plain: string): string {
  return plain.length >= 12 ? `••••${plain.slice(-4)}` : '••••'
}

/** Replaces every occurrence of the given secret values. Used on errors and logs. */
export function scrubValues(text: string, secrets: Array<string | undefined>): string {
  let out = text
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[secret]')
  }
  return out
}
