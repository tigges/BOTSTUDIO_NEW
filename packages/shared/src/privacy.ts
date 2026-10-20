/**
 * Personal data: what counts, how it is found, and how each reader sees it.
 *
 * Models never see personal data. Before every model call it is swapped for a
 * stable token such as [EMAIL_3F9A1C2B] (the API owns the token key). Everyone
 * else reads it through a render mode chosen per reader in the bot's settings.
 */

export const PERSONAL_DATA_KINDS = ['email', 'phone', 'card', 'iban', 'national_id', 'ip'] as const
export type PersonalDataKind = (typeof PERSONAL_DATA_KINDS)[number]

export const PERSONAL_DATA_LABELS: Record<PersonalDataKind, string> = {
  email: 'Email address',
  phone: 'Phone number',
  card: 'Payment card number',
  iban: 'Bank account (IBAN)',
  national_id: 'National ID (NI or SSN)',
  ip: 'IP address',
}

export const PRIVACY_READERS = ['end_user', 'tool_input', 'tool_output', 'logs', 'human_agent'] as const
export type PrivacyReader = (typeof PRIVACY_READERS)[number]

export const PRIVACY_READER_LABELS: Record<PrivacyReader, string> = {
  end_user: 'Guest',
  tool_input: 'Tool input',
  tool_output: 'Tool output',
  logs: 'Logs',
  human_agent: 'Human agent',
}

export const PRIVACY_READER_HINTS: Record<PrivacyReader, string> = {
  end_user: 'What the bot’s replies show the guest.',
  tool_input: 'What a tool receives when the bot calls it.',
  tool_output: 'How tool results are kept in tool runs and the Inbox.',
  logs: 'What server logs keep. Passwords, keys and tokens are always removed.',
  human_agent: 'What people see in the Inbox and in the handoff.',
}

export const RENDER_MODES = ['original', 'mask', 'label', 'token'] as const
export type RenderMode = (typeof RENDER_MODES)[number]

export const RENDER_MODE_LABELS: Record<RenderMode, string> = {
  original: 'Show as written',
  mask: 'Mask (j•••@e•••.com)',
  label: 'Label ([email])',
  token: 'Token ([EMAIL_3F9A1C2B])',
}

export interface CustomPattern {
  /** Shown in labels and tokens, e.g. "order_ref". */
  name: string
  /** JavaScript regular expression, matched case-sensitively. */
  pattern: string
}

export interface PrivacySettings {
  render: Record<PrivacyReader, RenderMode>
  /** Show people in the Inbox personal data as written. Off unless someone turns it on knowingly. */
  revealToAgents: boolean
  custom: CustomPattern[]
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  render: {
    end_user: 'original',
    tool_input: 'original',
    tool_output: 'mask',
    logs: 'mask',
    human_agent: 'mask',
  },
  revealToAgents: false,
  custom: [],
}

export const REVEAL_TO_AGENTS_WARNING =
  'People in the Inbox will see email addresses, phone numbers, card numbers and other personal data exactly as the guest wrote them, including in the handoff summary and webhooks. Only turn this on if your team is allowed to handle that data.'

function isMode(value: unknown): value is RenderMode {
  return typeof value === 'string' && (RENDER_MODES as readonly string[]).includes(value)
}

/** Saved settings with every gap filled from the defaults. A person's view is never "as written" without the reveal toggle. */
export function parsePrivacySettings(raw: unknown): PrivacySettings {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const savedRender = row['render'] && typeof row['render'] === 'object' ? row['render'] as Record<string, unknown> : {}
  const render = { ...DEFAULT_PRIVACY.render }
  for (const reader of PRIVACY_READERS) {
    const mode = savedRender[reader]
    if (isMode(mode)) render[reader] = mode
  }
  if (render.human_agent === 'original') render.human_agent = 'mask'
  const custom = Array.isArray(row['custom'])
    ? (row['custom'] as unknown[]).flatMap((item) => {
        const entry = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        const name = typeof entry['name'] === 'string' ? entry['name'].trim() : ''
        const pattern = typeof entry['pattern'] === 'string' ? entry['pattern'] : ''
        return name && pattern ? [{ name, pattern }] : []
      })
    : []
  return { render, revealToAgents: row['revealToAgents'] === true, custom }
}

/** The mode a reader actually gets. */
export function readerMode(settings: PrivacySettings, reader: PrivacyReader): RenderMode {
  if (reader === 'human_agent' && settings.revealToAgents) return 'original'
  return settings.render[reader]
}

export interface PrivacyIssue {
  field: string
  message: string
}

export function customKind(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'custom'
}

function compileCustom(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'g')
  } catch {
    return null
  }
}

export function privacyIssues(settings: PrivacySettings): PrivacyIssue[] {
  const issues: PrivacyIssue[] = []
  const seen = new Set<string>()
  settings.custom.forEach((entry, index) => {
    const field = `custom.${index}`
    if (!entry.name.trim()) issues.push({ field: `${field}.name`, message: 'Give the pattern a name, for example "Order reference".' })
    const kind = customKind(entry.name)
    if (seen.has(kind)) issues.push({ field: `${field}.name`, message: `Another pattern is already called "${entry.name}". Use a different name.` })
    seen.add(kind)
    const regex = compileCustom(entry.pattern)
    if (entry.pattern.length > 200) issues.push({ field: `${field}.pattern`, message: `"${entry.name}" is longer than 200 characters. Shorten the pattern.` })
    else if (!regex) issues.push({ field: `${field}.pattern`, message: `"${entry.name}" is not a valid pattern. Check the brackets and escapes.` })
    else if (regex.test('')) issues.push({ field: `${field}.pattern`, message: `"${entry.name}" matches empty text. Make the pattern require at least one character.` })
  })
  return issues
}

export interface PersonalDataSpan {
  kind: string
  start: number
  end: number
  value: string
}

/** A token the API put in place of personal data, e.g. [EMAIL_3F9A1C2B]. */
export const PRIVACY_TOKEN = /\[([A-Z][A-Z0-9_]{0,30})_([0-9A-F]{8})\]/g

function luhn(digits: string): boolean {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (iban.length < 15 || iban.length > 34) return false
  const moved = iban.slice(4) + iban.slice(0, 4)
  let rest = 0
  for (const ch of moved) {
    const code = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch
    for (const digit of code) rest = (rest * 10 + Number(digit)) % 97
  }
  return rest === 1
}

const digitCount = (value: string) => value.replace(/\D/g, '').length

const BUILT_INS: Array<{ kind: PersonalDataKind; pattern: RegExp; accept?: (value: string) => boolean }> = [
  { kind: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  {
    kind: 'card',
    pattern: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g,
    accept: (value) => {
      const digits = value.replace(/\D/g, '')
      return digits.length >= 13 && digits.length <= 19 && luhn(digits)
    },
  },
  { kind: 'iban', pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, accept: ibanValid },
  { kind: 'national_id', pattern: /\b(?:[A-CEGHJ-PR-TW-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D]|\d{3}-\d{2}-\d{4})\b/g },
  {
    kind: 'ip',
    pattern: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])/g,
  },
  {
    kind: 'phone',
    pattern: /(?<![\w+])(?:\+\d|\(?0)[\d\s().-]{7,}\d/g,
    accept: (value) => {
      const n = digitCount(value)
      return n >= 10 && n <= 15
    },
  },
]

/** Every piece of personal data in the text, in order, without overlaps. Existing tokens are left alone. */
export function findPersonalData(text: string, custom: CustomPattern[] = []): PersonalDataSpan[] {
  if (!text) return []
  const taken: Array<[number, number]> = []
  for (const match of text.matchAll(PRIVACY_TOKEN)) taken.push([match.index!, match.index! + match[0].length])
  const overlaps = (start: number, end: number) => taken.some(([a, b]) => start < b && end > a)
  const spans: PersonalDataSpan[] = []
  const add = (kind: string, start: number, value: string) => {
    const end = start + value.length
    if (!value || overlaps(start, end)) return
    taken.push([start, end])
    spans.push({ kind, start, end, value })
  }
  for (const rule of BUILT_INS) {
    for (const match of text.matchAll(rule.pattern)) {
      const value = match[0].replace(/[\s.-]+$/, '')
      if (rule.accept && !rule.accept(value)) continue
      add(rule.kind, match.index!, value)
    }
  }
  for (const entry of custom) {
    const regex = compileCustom(entry.pattern)
    if (!regex || regex.test('')) continue
    regex.lastIndex = 0
    for (const match of text.matchAll(regex)) add(customKind(entry.name), match.index!, match[0])
  }
  return spans.sort((a, b) => a.start - b.start)
}

/** j•••@e•••.com, •••• 4242, •••• •••• 23 and so on. Enough to recognise, not enough to use. */
export function maskValue(kind: string, value: string): string {
  if (kind === 'email') {
    const [user = '', domain = ''] = value.split('@')
    const dot = domain.lastIndexOf('.')
    const host = dot > 0 ? domain.slice(0, dot) : domain
    const tld = dot > 0 ? domain.slice(dot) : ''
    return `${user.slice(0, 1)}•••@${host.slice(0, 1)}•••${tld}`
  }
  const digits = value.replace(/\D/g, '')
  if (kind === 'card') return `•••• ${digits.slice(-4)}`
  if (kind === 'phone') return `•••• ••• ${digits.slice(-3)}`
  if (kind === 'iban') {
    const flat = value.replace(/\s+/g, '')
    return `${flat.slice(0, 4)} •••• ${flat.slice(-4)}`
  }
  if (kind === 'ip') return `${value.split('.')[0]}.•••.•••.•••`
  return `${value.slice(0, 1)}•••`
}

export function labelFor(kind: string): string {
  return `[${kind}]`
}

export type TokenFor = (kind: string, value: string) => string

/** Rewrites the personal data in text for one reader. `token` needs the API's token function and falls back to labels without it. */
export function renderPersonalData(
  text: string,
  mode: RenderMode,
  opts: { custom?: CustomPattern[]; tokenFor?: TokenFor } = {},
): string {
  if (mode === 'original' || !text) return text
  const spans = findPersonalData(text, opts.custom)
  if (spans.length === 0) return text
  let out = ''
  let at = 0
  for (const span of spans) {
    out += text.slice(at, span.start)
    if (mode === 'mask') out += maskValue(span.kind, span.value)
    else if (mode === 'token' && opts.tokenFor) out += opts.tokenFor(span.kind, span.value)
    else out += labelFor(span.kind)
    at = span.end
  }
  return out + text.slice(at)
}

/** Applies `renderPersonalData` to every string inside a JSON value. */
export function renderPersonalDataDeep<T>(value: T, render: (text: string) => string): T {
  if (typeof value === 'string') return render(value) as T
  if (Array.isArray(value)) return value.map((item) => renderPersonalDataDeep(item, render)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, renderPersonalDataDeep(item, render)])) as T
  }
  return value
}
