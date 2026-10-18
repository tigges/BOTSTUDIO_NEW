/**
 * Reads a few public HTML pages for the new-bot website scan.
 * Private addresses, link-local metadata, and other hosts are refused
 * before any request, including after a redirect.
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { chooseShopHomes, chooseSitePages, isMissingPage, isPricingPage, pageFromHtml, suggestCluster, type ScannedPage } from '@ybot/shared'
import { chooseShopHomesWithModel, chooseSitePagesWithModel } from './site-jobs.js'

export class PublicSiteError extends Error {
  constructor(message: string, readonly code: 'INVALID_URL' | 'BLOCKED' | 'UNREADABLE') {
    super(message)
    this.name = 'PublicSiteError'
  }
}

const MAX_BYTES = 1_500_000
const MAX_PAGES = 10
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

async function fetchDocument(start: URL, allowType: RegExp): Promise<{ url: string; body: string }> {
  let current = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    current.hash = ''
    await assertPublic(current)
    const response = await fetch(current.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml,text/xml',
        'Accept-Language': 'en-GB,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
    if (type && !allowType.test(type)) {
      throw new PublicSiteError('Could not read that site. Check the address and try again.', 'UNREADABLE')
    }
    const body = await readBody(response)
    return { url: current.href, body }
  }
  throw new PublicSiteError('Could not read that site. Check the address and try again.', 'UNREADABLE')
}

async function fetchHtml(start: URL): Promise<{ url: string; html: string }> {
  const document = await fetchDocument(start, /text\/html|application\/xhtml\+xml/i)
  return { url: document.url, html: document.body }
}

/** Homepage links miss pages that only appear in the sitemap. Failures stay empty. */
async function readSitemap(origin: string): Promise<string[]> {
  const queue = [`${origin}/sitemap.xml`, `${origin}/wp-sitemap.xml`]
  const seen = new Set<string>()
  const pages: string[] = []
  const skip = /\/(?:blog|company-news|careers-blog|glossary|case-stud(?:y|ies)|bid\/)/i
  let fetches = 0
  while (queue.length > 0 && fetches < 5 && pages.length < 80) {
    const next = queue.shift()
    if (!next || seen.has(next)) continue
    seen.add(next)
    fetches += 1
    let xml = ''
    try {
      xml = (await fetchDocument(new URL(next), /xml|text\/plain|text\/html/i)).body
    } catch {
      continue
    }
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
      .map((match) => (match[1] ?? '').replace(/&amp;/g, '&'))
      .filter(Boolean)
    if (/<sitemapindex/i.test(xml)) {
      for (const loc of locs) {
        if (/users|taxonom|blog|news/i.test(loc)) continue
        if (!seen.has(loc)) queue.push(loc)
      }
      continue
    }
    for (const loc of locs) {
      if (pages.length >= 80) break
      if (skip.test(loc)) continue
      pages.push(loc)
    }
  }
  return pages
}

function cacheKey(url: URL): string {
  const path = url.pathname.replace(/\/$/, '') || '/'
  return `${url.origin}${path}`
}

/** Homepage, sitemap, and the linked pages that look like prices, questions, or a team page. */
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
  const hair = suggestCluster(`${home.text} ${home.url}`) === 'hair'
  const shops = hair
    ? chooseShopHomes({ homeUrl: home.url, links: home.links, limit: 1 })
    : await chooseShopHomesWithModel({ homeUrl: home.url, links: home.links, limit: 1 })
  const reserve = shops.length > 0 ? 4 : 0
  const sitemap = await readSitemap(new URL(home.url).origin).catch(() => [])
  const pages = [home]
  const sameOriginLimit = Math.max(1, MAX_PAGES - 1 - reserve)
  const linked = hair
    ? chooseSitePages({ homeUrl: home.url, links: home.links, sitemap, limit: sameOriginLimit })
    : await chooseSitePagesWithModel({ homeUrl: home.url, links: home.links, sitemap, limit: sameOriginLimit })
  for (const href of linked) {
    try {
      const next = await fetchHtml(new URL(href))
      const page = pageFromHtml(next.url, next.html)
      if (page.text.length > 40 && !isMissingPage(page)) pages.push(page)
    } catch {
      // A side page can fail. The homepage is enough to draft the map.
    }
    if (pages.length >= MAX_PAGES) break
  }
  const hasPlans = pages.some((page) => isPricingPage(page) && !isMissingPage(page))
  if (!hasPlans && shops[0] && pages.length < MAX_PAGES) {
    try {
      const shopDoc = await fetchHtml(new URL(shops[0]))
      const shopHome = pageFromHtml(shopDoc.url, shopDoc.html)
      if (shopHome.text.length > 40 && !isMissingPage(shopHome)) {
        pages.push(shopHome)
        const shopSitemap = await readSitemap(new URL(shopHome.url).origin).catch(() => [])
        const remaining = MAX_PAGES - pages.length
        const shopLinked = hair
          ? chooseSitePages({ homeUrl: shopHome.url, links: shopHome.links, sitemap: shopSitemap, limit: remaining })
          : await chooseSitePagesWithModel({ homeUrl: shopHome.url, links: shopHome.links, sitemap: shopSitemap, limit: remaining })
        for (const href of shopLinked) {
          try {
            const next = await fetchHtml(new URL(href))
            const page = pageFromHtml(next.url, next.html)
            if (page.text.length > 40 && !isMissingPage(page)) pages.push(page)
          } catch {
            // A shop leaf can fail. The shop homepage may still name plans.
          }
          if (pages.length >= MAX_PAGES) break
        }
      }
    } catch {
      // The country shop can fail. Keep the group pages that did load.
    }
  }
  cache.set(key, { at: Date.now(), pages })
  return pages
}
