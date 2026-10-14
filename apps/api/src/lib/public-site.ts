/**
 * Reads a few public HTML pages for the new-bot website scan.
 * Private addresses, link-local metadata, and other hosts are refused
 * before any request, including after a redirect.
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { pageFromHtml, type ScannedPage } from '@ybot/shared'

export class PublicSiteError extends Error {
  constructor(message: string, readonly code: 'INVALID_URL' | 'BLOCKED' | 'UNREADABLE') {
    super(message)
    this.name = 'PublicSiteError'
  }
}

const MAX_BYTES = 1_500_000
const MAX_PAGES = 4
const MAX_REDIRECTS = 4
const TIMEOUT_MS = 8_000
const CACHE_MS = 5 * 60 * 1000

const cache = new Map<string, { at: number; pages: ScannedPage[] }>()

export function isBlockedIp(ip: string): boolean {
  const bare = ip.toLowerCase().replace(/^\[|\]$/g, '')
  const v4 = bare.startsWith('::ffff:') ? bare.slice(7) : bare
  if (isIP(v4) === 4) {
    const parts = v4.split('.').map((part) => Number(part))
    const a = parts[0] ?? 0
    const b = parts[1] ?? 0
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && (b === 168 || b === 0)) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 198 && (b === 18 || b === 19)) return true
    if (a >= 224) return true
    return false
  }
  if (isIP(bare) === 6) {
    if (bare === '::1' || bare === '::') return true
    if (bare.startsWith('fc') || bare.startsWith('fd') || bare.startsWith('fe80')) return true
    return false
  }
  return false
}

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host === 'metadata.google.internal') return true
  if (isIP(host) || isIP(host.replace(/^::ffff:/, ''))) return isBlockedIp(host)
  return false
}

export function normalizeScanUrl(input: string): URL {
  const trimmed = input.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)) {
    throw new PublicSiteError('Enter a public website address, like https://yuzu.hair.', 'INVALID_URL')
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new PublicSiteError('Enter a public website address, like https://yuzu.hair.', 'INVALID_URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PublicSiteError('Enter a public website address, like https://yuzu.hair.', 'INVALID_URL')
  }
  if (url.username || url.password) {
    throw new PublicSiteError('Enter a public website address, like https://yuzu.hair.', 'INVALID_URL')
  }
  if (blockedHost(url.hostname)) {
    throw new PublicSiteError('That address is not a public website.', 'BLOCKED')
  }
  url.hash = ''
  return url
}

async function assertPublic(url: URL): Promise<void> {
  if (blockedHost(url.hostname)) {
    throw new PublicSiteError('That address is not a public website.', 'BLOCKED')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return
  let records: Array<{ address: string }>
  try {
    records = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new PublicSiteError('Could not read that site. Check the address and try again.', 'UNREADABLE')
  }
  if (records.length === 0 || records.some((record) => isBlockedIp(record.address))) {
    throw new PublicSiteError('That address is not a public website.', 'BLOCKED')
  }
}

async function readBody(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < MAX_BYTES) {
    const step = await reader.read()
    if (step.done) break
    size += step.value.byteLength
    chunks.push(step.value)
  }
  if (size >= MAX_BYTES) await reader.cancel().catch(() => undefined)
  const bytes = new Uint8Array(Math.min(size, MAX_BYTES))
  let offset = 0
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, bytes.length - offset)
    bytes.set(chunk.subarray(0, take), offset)
    offset += take
    if (offset >= bytes.length) break
  }
  return new TextDecoder().decode(bytes)
}

async function fetchHtml(start: URL): Promise<{ url: string; html: string }> {
  let current = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    current.hash = ''
    await assertPublic(current)
    const response = await fetch(current.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; BotStudio/1.0; website scan)',
      },
    }).catch(() => {
      throw new PublicSiteError('Could not read that site. Check the address and try again.', 'UNREADABLE')
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || hop === MAX_REDIRECTS) {
        throw new PublicSiteError('Could not read that site. Check the address and try again.', 'UNREADABLE')
      }
      current = new URL(location, current)
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        throw new PublicSiteError('That address is not a public website.', 'BLOCKED')
      }
      continue
    }
    if (!response.ok) {
      throw new PublicSiteError('Could not read that site. Check the address and try again.', 'UNREADABLE')
    }
    const type = response.headers.get('content-type') ?? ''
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) {
      throw new PublicSiteError('Could not read that site. Check the address and try again.', 'UNREADABLE')
    }
    const html = await readBody(response)
    return { url: current.href, html }
  }
  throw new PublicSiteError('Could not read that site. Check the address and try again.', 'UNREADABLE')
}

function extraPages(page: ScannedPage): string[] {
  let origin = ''
  try { origin = new URL(page.url).origin } catch { return [] }
  const seen = new Set<string>([page.url])
  const ranked: Array<{ href: string; score: number }> = []
  for (const link of page.links) {
    let url: URL
    try { url = new URL(link.href, page.url) } catch { continue }
    if (url.origin !== origin) continue
    url.hash = ''
    if (seen.has(url.href)) continue
    if (/\.(png|jpe?g|gif|svg|css|js|pdf|zip|webp|ico|mp4)(\?|$)/i.test(url.pathname)) continue
    const blob = `${url.pathname} ${link.text}`.toLowerCase()
    const score = ['service', 'price', 'hour', 'contact', 'about', 'visit', 'book', 'menu']
      .reduce((total, word) => total + (blob.includes(word) ? 1 : 0), 0)
    if (url.pathname === '/' || url.pathname === '') continue
    seen.add(url.href)
    ranked.push({ href: url.href, score })
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, MAX_PAGES - 1).map((item) => item.href)
}

function cacheKey(url: URL): string {
  const path = url.pathname.replace(/\/$/, '') || '/'
  return `${url.origin}${path}`
}

/** Homepage, then up to three same-origin pages. The result is reused for a few minutes. */
export async function readPublicSite(input: string): Promise<ScannedPage[]> {
  const start = normalizeScanUrl(input)
  const key = cacheKey(start)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.pages

  const first = await fetchHtml(start)
  const home = pageFromHtml(first.url, first.html)
  if (home.text.length < 40) {
    throw new PublicSiteError('Could not read that site. Check the address and try again.', 'UNREADABLE')
  }
  const pages = [home]
  for (const href of extraPages(home)) {
    try {
      const next = await fetchHtml(new URL(href))
      const page = pageFromHtml(next.url, next.html)
      if (page.text.length > 40) pages.push(page)
    } catch {
      // A side page can fail. The homepage is enough to draft the map.
    }
    if (pages.length >= MAX_PAGES) break
  }
  cache.set(key, { at: Date.now(), pages })
  return pages
}
