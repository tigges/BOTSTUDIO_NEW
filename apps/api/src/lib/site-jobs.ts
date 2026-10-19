/**
 * Website import compiler: fetched pages plus one model complete() become jobs.
 * The same keys also pick which pages and country shops to fetch.
 * Regex draftWebsiteChat / chooseSitePages stay the fallback when no key is set,
 * the model fails, or the site is a hair studio (authored salon walk).
 */

import { createLlmAdapter, createLlmAdapterForModel } from '@ybot/llm'
import {
  chooseShopHomes,
  chooseSitePages,
  draftClusteredTemplate,
  draftWebsiteChat,
  isJunkAnswer,
  isMissingPage,
  learnedSpecFromJobs,
  suggestCluster,
  websiteChatFromLearnedSpec,
  type LearnedTemplateSpec,
  type ScannedLink,
  type ScannedPage,
  type SiteTopic,
  type WebsiteChatDraft,
} from '@ybot/shared'

const IMPORT_TIMEOUT_MS = 20_000
const FETCH_TIMEOUT_MS = 8_000
const PAGE_CHARS = 1_800
const MAX_JOBS = 8
const PAGE_POOL = 24
const SHOP_POOL = 6

export type CompleteFn = (input: { system: string; user: string }) => Promise<string>

const SYSTEM = [
  'You draft a chatbot map from public web pages.',
  'List the jobs a visitor came to this site to do — not a table of contents.',
  'Use only facts stated on the pages. Copy or lightly paraphrase; do not invent prices, plans, or policies.',
  'Skip 404 pages, cookie banners, investor or shareholder chrome, news article leaves, and nav labels.',
  '3 to 8 jobs. Short names (1-4 words). Each job needs phrases a guest might type, and an answer taken from the pages.',
  'Return JSON only: { "jobs": [{ "name": "", "phrases": [""], "answer": "" }] }',
].join(' ')

export function cloudLlmComplete(timeoutMs = IMPORT_TIMEOUT_MS): CompleteFn | null {
  const env = process.env
  const adapter = env['GEMINI_API_KEY']
    ? createLlmAdapterForModel('gemini-2.0-flash', env)
    : env['GROQ_API_KEY']
      ? createLlmAdapterForModel('groq/llama-3.3-70b-versatile', env)
      : env['OPENAI_API_KEY'] || env['ANTHROPIC_API_KEY']
        ? createLlmAdapter(env)
        : null
  if (!adapter) return null
  return async ({ system, user }) => {
    const result = await Promise.race([
      adapter.complete({
        messages: [{ role: 'user', content: user }],
        systemPrompt: system,
        temperature: 0,
        maxTokens: 2048,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('import model timed out')), timeoutMs)
      }),
    ])
    return result.content
  }
}

export function importLlmComplete(): CompleteFn | null {
  return cloudLlmComplete(IMPORT_TIMEOUT_MS)
}

function pagesPrompt(pages: ScannedPage[]): string {
  return pages
    .filter((page) => !isMissingPage(page) && page.text.trim().length > 40)
    .slice(0, 10)
    .map((page) => {
      const text = page.text.replace(/\s+/g, ' ').trim().slice(0, PAGE_CHARS)
      return `## ${page.title || page.url}\nURL: ${page.url}\n${text}`
    })
    .join('\n\n')
}

function parseJobsPayload(raw: string): Array<{ name?: string; phrases?: unknown; answer?: string }> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { jobs?: unknown }
    return Array.isArray(parsed.jobs) ? parsed.jobs as Array<{ name?: string; phrases?: unknown; answer?: string }> : []
  } catch {
    return []
  }
}

function pageBlob(pages: ScannedPage[]): string {
  return pages.map((page) => `${page.title}\n${page.text}`).join('\n').toLowerCase()
}

export function answerGrounded(answer: string, blob: string): boolean {
  const norm = answer.toLowerCase().replace(/\s+/g, ' ').trim()
  if (norm.length < 24) return false
  if (blob.includes(norm.slice(0, Math.min(80, norm.length)))) return true
  const words = norm.split(/[^a-z0-9]+/).filter((word) => word.length > 3)
  if (words.length === 0) return false
  const hits = words.filter((word) => blob.includes(word)).length
  return hits >= Math.min(6, Math.ceil(words.length * 0.6))
}

function asTopic(row: { name?: string; phrases?: unknown; answer?: string }): SiteTopic | null {
  const name = String(row.name ?? '').replace(/\s+/g, ' ').trim()
  const answer = String(row.answer ?? '').replace(/\s+/g, ' ').trim()
  if (!name || !answer) return null
  if (/page not found|\b404\b/i.test(`${name} ${answer}`)) return null
  const phrases = Array.isArray(row.phrases)
    ? row.phrases.map((item) => String(item).toLowerCase().replace(/\s+/g, ' ').trim()).filter((item) => item.length >= 2)
    : []
  return {
    flowName: name,
    choice: name,
    phrases: phrases.slice(0, 8),
    question: `What about ${name.toLowerCase()}?`,
    answer,
    blurb: answer.slice(0, 80),
  }
}

export async function jobsFromModelPages(
  pages: ScannedPage[],
  complete: CompleteFn,
): Promise<SiteTopic[] | null> {
  const usable = pages.filter((page) => !isMissingPage(page) && page.text.trim().length > 40)
  if (usable.length === 0) return null
  const user = `Pages:\n${pagesPrompt(usable)}\n\nJSON:`
  let raw = ''
  try {
    raw = await complete({ system: SYSTEM, user })
  } catch {
    return null
  }
  const blob = pageBlob(usable)
  const topics: SiteTopic[] = []
  for (const row of parseJobsPayload(raw)) {
    const topic = asTopic(row)
    if (!topic) continue
    if (isJunkAnswer(topic.answer) || isJunkAnswer(topic.flowName)) continue
    if (!answerGrounded(topic.answer, blob)) continue
    topics.push(topic)
    if (topics.length >= MAX_JOBS) break
  }
  return topics.length > 0 ? topics : null
}

const PAGE_PICK_SYSTEM = [
  'You pick which pages a visitor-facing chatbot should read after the homepage.',
  'Return JSON only: { "urls": ["https://..."] }',
  'Only use URLs from the candidate list. Do not invent paths.',
  'Prefer pages that state prices, plans, products, hours, contact, jobs, help, or how to buy.',
  'Skip news articles, sport recaps, investor chrome, cookie banners, and login walls unless nothing else is listed.',
].join(' ')

const SHOP_PICK_SYSTEM = [
  'This group homepage may sell through a country shop.',
  'Return JSON only: { "urls": ["https://..."] }',
  'Pick at most the asked number of shop homepages from the candidate list. Do not invent hosts.',
  'Prefer a UK or English shop when one is listed.',
].join(' ')

function parseUrlList(raw: string, allowed: string[]): string[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let urls: unknown
  try {
    urls = (JSON.parse(trimmed.slice(start, end + 1)) as { urls?: unknown }).urls
  } catch {
    return []
  }
  if (!Array.isArray(urls)) return []
  const byKey = new Map<string, string>()
  for (const href of allowed) {
    byKey.set(href.replace(/\/$/, '').toLowerCase(), href)
  }
  const picked: string[] = []
  const seen = new Set<string>()
  for (const item of urls) {
    const href = String(item ?? '').trim()
    if (!href) continue
    let key = href.replace(/\/$/, '').toLowerCase()
    try { key = new URL(href).href.replace(/\/$/, '').toLowerCase() } catch { /* keep key */ }
    const match = byKey.get(key)
    if (!match || seen.has(match)) continue
    seen.add(match)
    picked.push(match)
  }
  return picked
}

async function pickFromPool(input: {
  pool: string[]
  limit: number
  system: string
  user: string
  complete?: CompleteFn | null
  timeoutMs?: number
}): Promise<string[]> {
  const fallback = input.pool.slice(0, Math.max(0, input.limit))
  if (input.pool.length <= input.limit) return fallback
  const complete = input.complete === undefined ? cloudLlmComplete(input.timeoutMs ?? FETCH_TIMEOUT_MS) : input.complete
  if (!complete) return fallback
  try {
    const raw = await complete({ system: input.system, user: input.user })
    const picked = parseUrlList(raw, input.pool)
    return picked.length > 0 ? picked.slice(0, Math.max(0, input.limit)) : fallback
  } catch {
    return fallback
  }
}

/** Ranked regex pages, then the model picks among that pool. Empty key or a failed model keeps the regex order. */
export async function chooseSitePagesWithModel(input: {
  homeUrl: string
  links: ScannedLink[]
  sitemap?: string[]
  limit: number
  complete?: CompleteFn | null
}): Promise<string[]> {
  const pool = chooseSitePages({
    homeUrl: input.homeUrl,
    links: input.links,
    sitemap: input.sitemap,
    limit: Math.max(input.limit, PAGE_POOL),
  })
  const numbered = pool.map((url, index) => `${index + 1}. ${url}`).join('\n')
  return pickFromPool({
    pool,
    limit: input.limit,
    system: PAGE_PICK_SYSTEM,
    user: `Home: ${input.homeUrl}\nPick up to ${Math.max(0, input.limit)} urls.\nCandidates:\n${numbered}\n\nJSON:`,
    complete: input.complete,
  })
}

/** Ranked country shops, then the model picks among that pool. */
export async function chooseShopHomesWithModel(input: {
  homeUrl: string
  links: ScannedLink[]
  limit?: number
  complete?: CompleteFn | null
}): Promise<string[]> {
  const limit = input.limit ?? 1
  const pool = chooseShopHomes({
    homeUrl: input.homeUrl,
    links: input.links,
    limit: Math.max(limit, SHOP_POOL),
  })
  const numbered = pool.map((url, index) => `${index + 1}. ${url}`).join('\n')
  return pickFromPool({
    pool,
    limit,
    system: SHOP_PICK_SYSTEM,
    user: `Home: ${input.homeUrl}\nPick up to ${Math.max(0, limit)} shop urls.\nCandidates:\n${numbered}\n\nJSON:`,
    complete: input.complete,
  })
}

export async function draftWebsiteChatWithModel(input: {
  pages: ScannedPage[]
  companyName: string
  personaName?: string | null
  complete?: CompleteFn | null
}): Promise<WebsiteChatDraft> {
  const fallback = () => draftWebsiteChat({
    pages: input.pages,
    companyName: input.companyName,
    personaName: input.personaName,
  })
  const cluster = suggestCluster(`${input.pages.map((page) => `${page.text} ${page.url}`).join('\n')}`)
  if (cluster === 'hair') return fallback()
  const complete = input.complete === undefined ? importLlmComplete() : input.complete
  if (!complete) return fallback()
  const jobs = await jobsFromModelPages(input.pages, complete)
  if (!jobs) return fallback()
  const spec = learnedSpecFromJobs({
    pages: input.pages,
    companyName: input.companyName,
    personaName: input.personaName,
    topics: jobs,
    keepBrand: true,
    note: 'Jobs follow what the pages stated. The assistant drafted the map.',
  })
  const company = input.companyName.trim() || 'your company'
  const persona = input.personaName?.trim() || 'the assistant'
  return websiteChatFromLearnedSpec({
    pages: input.pages,
    companyName: company,
    personaName: persona,
    spec,
  })
}

export async function draftSiteSpecWithModel(input: {
  pages: ScannedPage[]
  companyName: string
  personaName?: string | null
  complete?: CompleteFn | null
}): Promise<LearnedTemplateSpec> {
  const fallback = () => draftClusteredTemplate({
    pages: input.pages,
    companyName: input.companyName,
    personaName: input.personaName,
  })
  const cluster = suggestCluster(`${input.pages.map((page) => `${page.text} ${page.url}`).join('\n')}`)
  if (cluster === 'hair') return fallback()
  const complete = input.complete === undefined ? importLlmComplete() : input.complete
  if (!complete) return fallback()
  const jobs = await jobsFromModelPages(input.pages, complete)
  if (!jobs) return fallback()
  return learnedSpecFromJobs({
    pages: input.pages,
    companyName: input.companyName,
    personaName: input.personaName,
    topics: jobs,
    keepBrand: false,
    note: 'Jobs follow what the pages stated. The assistant drafted the map.',
  })
}
