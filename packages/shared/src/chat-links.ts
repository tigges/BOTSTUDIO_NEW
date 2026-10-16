/**
 * Booking hosts belong in chat as a named link, never as a long URL.
 * Old copies that still say "Book on Phorest: https://…" are rewritten at display time.
 */

export const BOOKING_HOSTS: Array<{ host: string; label: string }> = [
  { host: 'phorest.com', label: 'Phorest' },
  { host: 'fresha.com', label: 'Fresha' },
  { host: 'booksy.com', label: 'Booksy' },
  { host: 'calendly.com', label: 'Calendly' },
  { host: 'setmore.com', label: 'Setmore' },
  { host: 'simplybook.me', label: 'SimplyBook' },
  { host: 'vagaro.com', label: 'Vagaro' },
  { host: 'squareup.com', label: 'Square' },
  { host: 'square.site', label: 'Square' },
]

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'link'; href: string; label: string }

const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
const BOOK_ON = /\bBook on ([A-Za-z][\w .'-]*):\s*(https?:\/\/[^\s]+)/gi
const BARE_URL = /https?:\/\/[^\s<>]+/g

export function namedLink(label: string, url: string): string {
  return `[${label}](${url})`
}

export function bookingLabelForUrl(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    const known = BOOKING_HOSTS.find((item) => host === item.host || host.endsWith(`.${item.host}`))
    return known?.label
  } catch {
    return undefined
  }
}

/** Booking-host names mentioned in a chart, so the journey can label them as workflows. */
export function bookingWorkflowsIn(graph: unknown): string[] {
  const blob = JSON.stringify(graph ?? '').toLowerCase()
  const found: string[] = []
  const seen = new Set<string>()
  for (const host of BOOKING_HOSTS) {
    if (!blob.includes(host.host)) continue
    if (seen.has(host.label)) continue
    seen.add(host.label)
    found.push(host.label)
  }
  return found
}

export function rewriteChatLinks(text: string): string {
  const placeholders: string[] = []
  const hide = (value: string) => value.replace(MD_LINK, (full) => {
    placeholders.push(full)
    return `\u0000${placeholders.length - 1}\u0000`
  })
  let next = hide(text)
  next = next.replace(BOOK_ON, (_all, label: string, url: string) => namedLink(String(label).trim(), url))
  next = hide(next)
  next = next.replace(BARE_URL, (url) => {
    const cleaned = url.replace(/[),.;]+$/, '')
    const label = bookingLabelForUrl(cleaned)
    return label ? namedLink(label, cleaned) : url
  })
  return next.replace(/\u0000(\d+)\u0000/g, (_, index: string) => placeholders[Number(index)] ?? '')
}

export function chatParts(text: string): ChatPart[] {
  const rewritten = rewriteChatLinks(text)
  const parts: ChatPart[] = []
  const matcher = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
  let last = 0
  for (const match of rewritten.matchAll(matcher)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ type: 'text', text: rewritten.slice(last, index) })
    parts.push({ type: 'link', href: match[2] ?? '', label: match[1] ?? '' })
    last = index + match[0].length
  }
  if (last < rewritten.length) parts.push({ type: 'text', text: rewritten.slice(last) })
  return parts.filter((part) => part.type === 'link' || part.text.length > 0)
}

/** The same line without markup, so a map chip can say "Phorest" instead of a URL. */
export function chatPlain(text: string): string {
  return chatParts(text).map((part) => (part.type === 'link' ? part.label : part.text)).join('')
}
