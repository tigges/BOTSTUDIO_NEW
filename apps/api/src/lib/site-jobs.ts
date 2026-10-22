/**
 * Website import compiler: fetched pages plus one model complete() become jobs.
 * The same keys also pick which pages and country shops to fetch.
 * Regex draftWebsiteChat / chooseSitePages stay the fallback when no key is set,
 * the model fails, or the site is a hair studio (authored salon walk).
 */

import { LlmAdapter, llmChain, type LlmProvider } from '@botstudio/llm'
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
} from '@botstudio/shared'

const IMPORT_TIMEOUT_MS = 45_000
const FETCH_TIMEOUT_MS = 8_000
const PAGE_CHARS = 1_800
const MAX_JOBS = 8
const SHINGLE = 8
const CHROME_WORDS = 4_000
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

/** How the map was drafted, in words the builder can act on. */
export interface ImportReport {
  by: 'model' | 'pages'
  why: string
}

interface ImportProvider {
  name: string
  model: string
  modelEnv: string
  provider: LlmProvider
}

/** Every provider the API has, in the same order as chat (Gemini, Claude, OpenAI, Groq, Ollama). */
export function importProviders(env: Record<string, string | undefined> = process.env): ImportProvider[] {
  return llmChain(env).map((link) => ({ name: link.label, model: link.model, modelEnv: link.modelEnv, provider: link.provider }))
}

export function importProviderName(env: Record<string, string | undefined> = process.env): string | null {
  return importProviders(env)[0]?.name ?? null
}

/** Each provider that was tried and why it gave nothing. */
export class ImportModelError extends Error {
  constructor(readonly failures: Array<{ name: string; model: string; modelEnv?: string; error: unknown }>) {
    super(failures.map((failure) => `${failure.name} (${failure.model}): ${String((failure.error as Error)?.message ?? failure.error).slice(0, 200)}`).join('; '))
  }
}

function failureWords(err: unknown, model?: string, modelEnv?: string): string {
  const message = String((err as Error)?.message ?? err)
  if (/timed out/i.test(message)) return `took longer than ${IMPORT_TIMEOUT_MS / 1000} seconds`
  const status = message.match(/\b([45]\d\d)\b/)?.[1]
  if (status === '429') return 'is rate limited (HTTP 429)'
  if (status === '401' || status === '403') return `rejected the key (HTTP ${status})`
  if (status === '404' && model) {
    return `has no model called ${model} (HTTP 404). Set ${modelEnv ?? 'the model'} on the API to a current model`
  }
  if (!status && /fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(message)) return 'could not be reached'
  return status ? `did not answer (HTTP ${status})` : 'did not answer'
}

export function modelFailureWhy(err: unknown, fallbackName: string): string {
  if (err instanceof ImportModelError) {
    return err.failures.map((failure) => `${failure.name} ${failureWords(failure.error, failure.model, failure.modelEnv)}.`).join(' ')
  }
  return `${fallbackName} ${failureWords(err)}.`
}

export type ChainedComplete = CompleteFn & { answeredBy?: string }

/** Tries each provider in turn inside one time budget, so one retired model does not end the import. */
export function cloudLlmComplete(timeoutMs = IMPORT_TIMEOUT_MS, env: Record<string, string | undefined> = process.env): ChainedComplete | null {
  const providers = importProviders(env)
  if (providers.length === 0) return null
  const complete: ChainedComplete = async ({ system, user }) => {
    const deadline = Date.now() + timeoutMs
    const failures: Array<{ name: string; model: string; modelEnv: string; error: unknown }> = []
    for (const provider of providers) {
      const left = deadline - Date.now()
      if (left <= 0) {
        failures.push({ name: provider.name, model: provider.model, modelEnv: provider.modelEnv, error: new Error('import model timed out') })
        break
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([
          new LlmAdapter(provider.provider, provider.model).complete({
            messages: [{ role: 'user', content: user }],
            systemPrompt: system,
            temperature: 0,
            maxTokens: 2048,
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('import model timed out')), left)
          }),
        ])
        complete.answeredBy = provider.name
        return result.content
      } catch (error) {
        failures.push({ name: provider.name, model: provider.model, modelEnv: provider.modelEnv, error })
      } finally {
        clearTimeout(timer)
      }
    }
    throw new ImportModelError(failures)
  }
  return complete
}

export function importLlmComplete(): ChainedComplete | null {
  return cloudLlmComplete(IMPORT_TIMEOUT_MS)
}

/**
 * Menus and footers repeat on every page and fill the first PAGE_CHARS of each.
 * Runs of SHINGLE words seen on two or more pages move behind the homepage's own copy
 * and drop from the other pages, so the model reads what each page says.
 */
export function pageTextsWithoutChrome(pages: ScannedPage[]): string[] {
  const words = pages.map((page) => page.text.replace(/\s+/g, ' ').trim().split(' ').slice(0, CHROME_WORDS))
  if (pages.length < 2) return words.map((list) => list.join(' '))
  const pagesWith = new Map<string, number>()
  const keysOf = words.map((list) => {
    const keys: string[] = []
    for (let i = 0; i + SHINGLE <= list.length; i += 1) keys.push(list.slice(i, i + SHINGLE).join(' ').toLowerCase())
    for (const key of new Set(keys)) pagesWith.set(key, (pagesWith.get(key) ?? 0) + 1)
    return keys
  })
  return words.map((list, index) => {
    const shared = new Uint8Array(list.length)
    keysOf[index]!.forEach((key, at) => {
      if ((pagesWith.get(key) ?? 0) >= 2) shared.fill(1, at, at + SHINGLE)
    })
    const own = list.filter((_, at) => !shared[at]).join(' ')
    if (own.length < 40) return list.join(' ')
    if (index > 0) return own
    return `${own} ${list.filter((_, at) => shared[at]).join(' ')}`.trim()
  })
}

function pagesPrompt(pages: ScannedPage[]): string {
  const usable = pages
    .filter((page) => !isMissingPage(page) && page.text.trim().length > 40)
    .slice(0, 10)
  const texts = pageTextsWithoutChrome(usable)
  return usable
    .map((page, index) => `## ${page.title || page.url}\nURL: ${page.url}\n${texts[index]!.slice(0, PAGE_CHARS)}`)
    .join('\n\n')
}

function hostOf(pages: ScannedPage[]): string {
  try {
    return new URL(pages[0]?.url ?? '').host
  } catch {
    return 'unknown site'
  }
}

function warnImport(pages: ScannedPage[], reason: string): void {
  console.warn(`[site-jobs] ${hostOf(pages)}: ${reason}. Using the page compiler.`)
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
  onMiss?: (why: string) => void,
): Promise<SiteTopic[] | null> {
  const fallbackName = importProviderName() ?? 'The AI model'
  const usable = pages.filter((page) => !isMissingPage(page) && page.text.trim().length > 40)
  if (usable.length === 0) {
    warnImport(pages, 'no readable pages for the model')
    onMiss?.('No page had enough text for the AI model to read.')
    return null
  }
  const user = `Pages:\n${pagesPrompt(usable)}\n\nJSON:`
  let raw = ''
  try {
    raw = await complete({ system: SYSTEM, user })
  } catch (err) {
    warnImport(pages, `the model call failed (${String((err as Error)?.message ?? err).slice(0, 200)})`)
    onMiss?.(modelFailureWhy(err, fallbackName))
    return null
  }
  const model = (complete as ChainedComplete).answeredBy ?? fallbackName
  const blob = pageBlob(usable)
  const rows = parseJobsPayload(raw)
  const topics: SiteTopic[] = []
  let junk = 0
  let ungrounded = 0
  for (const row of rows) {
    const topic = asTopic(row)
    if (!topic) {
      junk += 1
      continue
    }
    if (isJunkAnswer(topic.answer) || isJunkAnswer(topic.flowName)) {
      junk += 1
      continue
    }
    if (!answerGrounded(topic.answer, blob)) {
      ungrounded += 1
      continue
    }
    topics.push(topic)
    if (topics.length >= MAX_JOBS) break
  }
  if (topics.length > 0) return topics
  warnImport(pages, rows.length === 0
    ? `the model reply held no jobs (${raw.length} chars)`
    : `the model listed ${rows.length} jobs; ${junk} were empty or junk and ${ungrounded} were not stated on the pages`)
  onMiss?.(rows.length === 0
    ? `${model} replied without any topics.`
    : `${model} listed ${rows.length} topics, but none matched what the pages state.`)
  return null
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
  report?: (report: ImportReport) => void
}): Promise<WebsiteChatDraft> {
  const fallback = (why: string) => {
    input.report?.({ by: 'pages', why })
    return draftWebsiteChat({
      pages: input.pages,
      companyName: input.companyName,
      personaName: input.personaName,
    })
  }
  const cluster = suggestCluster(`${input.pages.map((page) => `${page.text} ${page.url}`).join('\n')}`)
  if (cluster === 'hair') return fallback('Hair studios get the authored salon map.')
  const complete = input.complete === undefined ? importLlmComplete() : input.complete
  if (!complete) {
    if (input.complete === undefined) warnImport(input.pages, 'no Gemini, Claude or Ollama is set')
    return fallback('No AI model is set on the server. Add GEMINI_API_KEY or ANTHROPIC_API_KEY, or point OLLAMA_BASE_URL at an Ollama server.')
  }
  let miss = 'The AI model gave no usable topics.'
  const jobs = await jobsFromModelPages(input.pages, complete, (why) => { miss = why })
  if (!jobs) return fallback(miss)
  const answeredBy = (complete as ChainedComplete).answeredBy ?? importProviderName() ?? 'The AI model'
  input.report?.({ by: 'model', why: `${answeredBy} drafted ${jobs.length} ${jobs.length === 1 ? 'topic' : 'topics'} from the pages.` })
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
  if (!complete) {
    if (input.complete === undefined) warnImport(input.pages, 'no Gemini, Groq, OpenAI or Anthropic key is set')
    return fallback()
  }
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
