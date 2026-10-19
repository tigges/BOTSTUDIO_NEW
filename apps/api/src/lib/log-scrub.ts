/**
 * Credentials never reach the logs. This is always on and has no setting.
 * Personal data in log lines follows the bot's "Logs" render mode (mask by default).
 */

import { renderPersonalData, readerMode } from '@ybot/shared'
import { currentLlmScope } from './llm-ledger.js'
import { privacyNow, revealText } from './privacy.js'

const SECRET_PATTERNS: Array<[RegExp, string | ((match: string, ...groups: string[]) => string)]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[secret]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[secret]'],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, (_m, scheme: string) => `${scheme} [secret]`],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g, '[secret]'],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, '[secret]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[secret]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, '[secret]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[secret]'],
  [/\bgsk_[A-Za-z0-9]{20,}/g, '[secret]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[secret]'],
  [/(\/\/[^/\s:@]+:)[^@\s/]+@/g, (_m, prefix: string) => `${prefix}[secret]@`],
  [
    /([?&;\s"']|^)((?:access_|refresh_|id_)?token|api_?key|apikey|key|secret|client_secret|password|passwd|pwd|signature|sig|auth|code)=([^&\s"';]+)/gi,
    (_m, lead: string, name: string) => `${lead}${name}=[secret]`,
  ],
  [
    /("(?:password|passwd|secret|client_secret|api_?key|apikey|access_token|refresh_token|token|authorization|cookie)"\s*:\s*)"[^"]*"/gi,
    (_m, lead: string) => `${lead}"[secret]"`,
  ],
]

/** Removes passwords, keys, tokens and other credentials from text. */
export function scrubSecrets(text: string): string {
  let out = text
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement as (substring: string, ...args: string[]) => string)
  }
  return out
}

/** One log line: credentials always out, personal data as the current bot's Logs mode says. */
export function scrubLogText(text: string): string {
  const scope = currentLlmScope()
  const settings = privacyNow(scope?.botId)
  const mode = readerMode(settings, 'logs')
  const plain = revealText(scrubSecrets(text))
  return mode === 'original' ? plain : renderPersonalData(plain, mode === 'token' ? 'label' : mode, { custom: settings.custom })
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubLogText(value)
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (value instanceof Error) {
    const copy = new Error(scrubLogText(value.message))
    copy.name = value.name
    if (value.stack) copy.stack = scrubLogText(value.stack)
    return copy
  }
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1))
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, scrubValue(item, depth + 1)]))
}

let installed = false

/** Scrubs every console line in this process. */
export function installConsoleScrubbing(): void {
  if (installed) return
  installed = true
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[method].bind(console)
    console[method] = (...args: unknown[]) => original(...args.map((arg) => scrubValue(arg)))
  }
}

/** Fastify/pino options that scrub request URLs, headers and every message. */
export function scrubbingLoggerOptions() {
  return {
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]', 'res.headers["set-cookie"]'],
      censor: '[secret]',
    },
    serializers: {
      req(req: { method?: string; url?: string; hostname?: string; host?: string; ip?: string; socket?: { remotePort?: number } }) {
        return {
          method: req.method,
          url: scrubSecrets(req.url ?? ''),
          host: req.host ?? req.hostname,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        }
      },
      err(err: Error & { code?: string; statusCode?: number }) {
        return {
          type: err.name,
          message: scrubLogText(err.message ?? ''),
          stack: scrubLogText(err.stack ?? ''),
          ...(err.code ? { code: err.code } : {}),
          ...(err.statusCode ? { statusCode: err.statusCode } : {}),
        }
      },
    },
    hooks: {
      logMethod(this: unknown, args: unknown[], method: (...a: unknown[]) => void) {
        method.apply(this, args.map((arg) => scrubValue(arg)))
      },
    },
  }
}
