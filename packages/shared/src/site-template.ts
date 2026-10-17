/**
 * A public site becomes a draft map: brand names come off unless keepBrand is set,
 * and the remaining journey is a cluster (hair studios, software vendors, CRM, email).
 * Website import reads pages. Optimizations can still save a parked starter from a site.
 */

import { assistantGreeting, greetingWelcomeGraph } from './greeting-welcome.js'
import { supportUseCaseFlows, type StarterFlow } from './flow-templates.js'
import type { ScannedPage } from './website-scan.js'
import { extractPlanTiers, planChoices, planSummary } from './plan-tiers.js'
import { emailFollowUpFlow, planWalkFlow } from './plan-walk.js'

export type ClusterId = 'hair' | 'commerce' | 'software' | 'crm' | 'email' | 'custom'

export interface SiteTopic {
  flowName: string
  choice: string
  phrases: string[]
  question: string
  answer: string
  blurb: string
  /** plans = which-plan walk. email = ask for a follow-up address, then sales. */
  walk?: 'plans' | 'email'
  choices?: Array<{ title: string; phrases: string[]; say: string }>
}

export interface PreviewDoor {
  title: string
  flowName: string
  blurb: string
}

export interface SiteTemplatePack {
  id: string
  tag: string
  welcomeName: string
  greeting: string
  doors: PreviewDoor[]
  flows: StarterFlow[]
  intents: Array<{ name: string; description: string; utterances: string[]; responses: Array<{ text: string }> }>
  faqs: Array<{ question: string; answer: string; tags: string[] }>
}

export interface LearnedTemplateSpec {
  clusterId: ClusterId
  title: string
  body: string
  welcomeName: string
  packTag: string
  greeting: string
  followUp: string
  menu: string
  topics: SiteTopic[]
  sourceUrl: string
  sourceHost: string
}

const BRANDS: Array<[RegExp, string]> = [
  [/\bCevro(?:\s+AI)?\b/gi, 'the platform'],
  [/\bWinpot\b/gi, 'a customer'],
  [/\bSweepNext\b/gi, 'a customer'],
  [/\bAlpha Affiliates\b/gi, 'a partner'],
  [/\bHubSpot(?:'s)?\b/gi, 'the CRM'],
  [/\bMarketing Hub(?:®)?\b/gi, 'marketing'],
  [/\bSales Hub(?:®)?\b/gi, 'sales'],
  [/\bService Hub(?:®)?\b/gi, 'service'],
  [/\bContent Hub(?:™)?\b/gi, 'content'],
  [/\bData Hub(?:™)?\b/gi, 'data'],
  [/\bRevenue Hub(?:™)?\b/gi, 'billing'],
  [/\bSmart CRM(?:™)?\b/gi, 'the customer record'],
  [/\bAgent Hub(?:™)?\b/gi, 'agents'],
  [/\bGmail\b/gi, 'the inbox'],
  [/\bGoogle Workspace\b/gi, 'the workspace'],
  [/\bGemini in (?:the inbox|Gmail)\b/gi, 'the inbox assistant'],
  [/\bGemini\b/gi, 'the assistant'],
  [/\biGaming\b/gi, 'software'],
]

/** Drop named brands so a crawl can sit in the start wizard as a template. */
export function abstractBrand(text: string): string {
  let out = text
  for (const [pattern, replacement] of BRANDS) {
    out = out.replace(pattern, replacement)
  }
  return out
    .replace(/\bthe the\b/gi, 'the')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+([.,!?])/g, '$1')
    .trim()
}

const CLUSTER_HINTS: Array<[ClusterId, RegExp]> = [
  ['hair', /\b(hair|salon|beauty|stylist|colour|balayage|haircut)\b/i],
  ['crm', /\b(hubspot|crm|pipeline|marketing automation|sales hub)\b/i],
  // After CRM: inbox sites name gmail/inbox. Bare "email" is CRM plan copy ("Email and in-app chat").
  ['email', /\b(gmail|inbox|mailbox|compose)\b/i],
  ['software', /\b(cevro|operator|kyc|vendor|integration|platform|saas|chatbots?|hybrid agents?|agent workforce|website widgets?|bots answer)\b/i],
  ['commerce', /\b(shipping|return policy|order tracking|checkout)\b/i],
]

const CLUSTER_RANK: ClusterId[] = ['crm', 'email', 'software', 'commerce', 'hair']

function hintHits(pattern: RegExp, text: string): number {
  return [...text.matchAll(new RegExp(pattern.source, 'gi'))].length
}

/**
 * A salon word on a product page is usually a sample (Hair & Spa on BotStudio).
 * Hair only wins when it is the only match, or the page names the studio often.
 */
export function suggestCluster(text: string): ClusterId {
  const blob = `${text}`
  const scored = CLUSTER_HINTS
    .map(([id, pattern]) => [id, hintHits(pattern, blob)] as const)
    .filter(([, n]) => n > 0)
  if (scored.length === 0) return 'custom'
  const hair = scored.find(([id]) => id === 'hair')?.[1] ?? 0
  const product = scored.filter(([id]) => id !== 'hair')
  if (product.length > 0) {
    const bestProduct = product.reduce((best, row) => (row[1] > best[1] ? row : best))
    if (hair >= 4 && hair > bestProduct[1] * 2) return 'hair'
    product.sort((a, b) => b[1] - a[1] || CLUSTER_RANK.indexOf(a[0]) - CLUSTER_RANK.indexOf(b[0]))
    return product[0]![0]
  }
  return hair > 0 ? 'hair' : 'custom'
}

function handleFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function companyLabel(companyName: string): string {
  return companyName.trim() || 'your company'
}

function answerFlow(topic: SiteTopic, tag: string): StarterFlow {
  const y = 120
  return {
    name: topic.flowName,
    description: 'Template answer from a public site, with brand names left off. Edit the line to match your business.',
    tags: [tag, 'template', 'faq'],
    publish: true,
    graph: {
      nodes: [
        { id: 'start', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: topic.flowName, config: {} } },
        { id: 'say', type: 'flow-node', position: { x: 340, y }, data: { kind: 'send_message', label: 'Answer', config: { text: topic.answer } } },
        { id: 'end', type: 'flow-node', position: { x: 640, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'say', sourceHandle: 'out' },
        { id: 'e2', source: 'say', target: 'end' },
      ],
    },
  }
}

function chapterFor(
  topic: SiteTopic,
  tag: string,
  companyName: string,
  personaName?: string | null,
  salesFlow?: string,
): StarterFlow {
  if (topic.walk === 'email' || topic.flowName === 'Book a demo') {
    return emailFollowUpFlow({
      name: topic.flowName,
      tag,
      companyName,
      personaName,
    })
  }
  if (topic.walk === 'plans' && topic.choices && topic.choices.length >= 2) {
    return planWalkFlow({
      name: topic.flowName,
      tag,
      choices: topic.choices,
      salesFlow,
    }) ?? answerFlow(topic, tag)
  }
  if (topic.flowName === 'Talk to a person') {
    const found = supportUseCaseFlows().find((flow) => flow.name === 'Talk to a person')
    if (found) return { ...found, publish: true, tags: [...found.tags, tag, 'template'] }
  }
  return answerFlow(topic, tag)
}

export function doorsFromTopics(topics: SiteTopic[]): PreviewDoor[] {
  return topics.map((topic) => ({
    title: topic.choice,
    flowName: topic.flowName,
    blurb: topic.blurb,
  }))
}

export function siteTemplatePack(input: {
  id: string
  tag: string
  welcomeName: string
  companyName: string
  personaName?: string | null
  greeting: string
  followUp: string
  menu: string
  topics: SiteTopic[]
}): SiteTemplatePack {
  const topics = input.topics
  const routes = topics.map((topic) => ({
    handle: handleFor(topic.flowName),
    phrases: topic.phrases,
    flowName: topic.flowName,
  }))
  const welcome: StarterFlow = {
    name: input.welcomeName,
    description: `Greets visitors, then opens the usual doors for ${companyLabel(input.companyName)}`,
    tags: ['welcome', 'routing', input.tag],
    publish: true,
    graph: greetingWelcomeGraph({
      greeting: input.greeting,
      followUp: input.followUp,
      routes,
      menu: input.menu,
      choices: topics.map((topic) => topic.choice),
    }),
  }
  const salesFlow = topics.find((topic) => topic.walk === 'email' || /demo/i.test(topic.flowName))?.flowName
  const flows: StarterFlow[] = [welcome, ...topics.map((topic) => chapterFor(topic, input.tag, input.companyName, input.personaName, salesFlow))]
  return {
    id: input.id,
    tag: input.tag,
    welcomeName: input.welcomeName,
    greeting: input.greeting,
    doors: doorsFromTopics(topics),
    flows,
    intents: topics.map((topic) => ({
      name: topic.flowName,
      description: topic.question,
      utterances: topic.phrases,
      responses: [{ text: topic.answer }],
    })),
    faqs: topics.map((topic) => ({
      question: topic.question,
      answer: topic.answer,
      tags: [input.tag, handleFor(topic.flowName)],
    })),
  }
}

export interface PlannedSiteFlow extends StarterFlow {
  publish: boolean
}

export interface SiteImportPlan {
  flows: PlannedSiteFlow[]
  intents: SiteTemplatePack['intents']
  faqs: SiteTemplatePack['faqs']
}

/** What an import should add. Existing names stay. A published welcome stays the widget entry. */
export function planSiteImport(input: {
  pack: SiteTemplatePack
  existingFlowNames: string[]
  existingIntentNames: string[]
  existingQuestions: string[]
  publishedWelcome: boolean
}): SiteImportPlan {
  const existing = new Set(input.existingFlowNames)
  const flows: PlannedSiteFlow[] = []
  const welcome = input.pack.flows.find((flow) => flow.name === input.pack.welcomeName)
  const draftName = `${input.pack.welcomeName.replace(/ welcome$/i, '')} draft`
  for (const flow of input.pack.flows) {
    if (flow.name === input.pack.welcomeName) continue
    if (existing.has(flow.name)) continue
    flows.push({ ...flow, publish: true })
  }
  if (welcome && !input.publishedWelcome && !existing.has(input.pack.welcomeName)) {
    flows.unshift({ ...welcome, publish: true })
  } else if (welcome && !existing.has(draftName) && (input.publishedWelcome || existing.has(input.pack.welcomeName))) {
    flows.push({
      ...welcome,
      name: draftName,
      description: 'Template greeting. Publish it when you want the widget to use it. Your current welcome stays until then.',
      publish: false,
    })
  }
  const intentNames = new Set(input.existingIntentNames)
  const questions = new Set(input.existingQuestions)
  return {
    flows,
    intents: input.pack.intents.filter((intent) => !intentNames.has(intent.name)),
    faqs: input.pack.faqs.filter((faq) => !questions.has(faq.question)),
  }
}

function clip(value: string, max = 280): string {
  const tidy = abstractBrand(value.replace(/\s+/g, ' ').trim())
  if (tidy.length <= max) return tidy
  return `${tidy.slice(0, max - 1).replace(/\s+\S*$/, '')}.`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function talkTopic(company: string): SiteTopic {
  return {
    flowName: 'Talk to a person',
    choice: 'Talk to a person',
    phrases: ['talk to a person', 'speak to someone', 'human', 'agent'],
    question: 'How do I talk to a person?',
    answer: `I am passing this chat to the ${company} team. Someone will continue here.`,
    blurb: 'A person takes over',
  }
}

/** Nav chrome, a11y suffixes, and campaign stats are not an answer. */
function isNavChrome(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (/\ba11y\b/i.test(t)) return true
  if (/\bsign in\b/i.test(t) && /\bstart free\b/i.test(t)) return true
  if (/skip to (?:main )?content/i.test(t)) return true
  if (/opens in a new tab/i.test(t)) return true
  if (/see all /i.test(t) && /case stud/i.test(t)) return true
  if (/play video/i.test(t) && t.length < 160) return true
  if (/^view more\b/i.test(t)) return true
  if (/[™®]/.test(t) && /learn more/i.test(t)) return true
  if (/\d+%\s+(?:more|improvement|increase)/i.test(t)) return true
  if (/\?\s*$/.test(t)) return true
  if (/\|\s*\S+/.test(t) && t.length < 80 && !/[.!?]$/.test(t)) return true
  const words = t.split(' ').filter(Boolean)
  const firstWords = words.slice(0, 3)
  if (firstWords.length === 3 && firstWords.every((word) => /^[A-Z][a-z]{1,16}$/.test(word))) return true
  if (/^[A-Z][a-z]{1,16}\s+[A-Z][a-z]{1,16}\s/.test(t) && !/,/.test(t.slice(0, 48))) {
    const extraTitle = words.slice(2, 6).some((word) => /^[A-Z][a-z]{1,16}$/.test(word))
    if (extraTitle || t.length < 90) return true
  }
  const titleRuns = words.filter((word) => /^[A-Z][a-z]{0,16}$/.test(word))
  if (titleRuns.length >= 5 && titleRuns.length / Math.max(words.length, 1) >= 0.5) return true
  if (!/[.!?']/.test(t) && /(?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+){3,}/.test(t) && t.length < 200) return true
  return false
}

function splitCopy(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function pricingPage(page: ScannedPage): boolean {
  return /pric|\/plans?\b/i.test(`${page.url} ${page.title}`)
}

function titleCaseHost(host: string): string {
  const stem = host.split('.')[0] ?? 'the product'
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}

const JUNK_SITE_PATH = /\/(?:investor|investors|shareholder|shareholders|governance|annual-report|code-of-conduct|conduct|computershare|equiniti|sustainability)(?:\/|$)/i

function pathOf(page: ScannedPage): string {
  try {
    return new URL(page.url).pathname.toLowerCase()
  } catch {
    return page.url.toLowerCase()
  }
}

function isHomePage(page: ScannedPage): boolean {
  const path = pathOf(page)
  return path === '/' || path === ''
}

function isJunkSitePage(page: ScannedPage): boolean {
  if (JUNK_SITE_PATH.test(pathOf(page))) return true
  if (isHomePage(page)) return false
  const head = `${page.title} ${page.text.slice(0, 280)}`
  return /computershare|shareview|ordinary shares|adr holding|investor relations/i.test(head)
}

function isJunkAnswer(text: string): boolean {
  if (isNavChrome(text)) return true
  return /computershare|shareview|ordinary shares|code of conduct|adr holding|equiniti|holders of ordinary|possible findings are subject|mitigation plans/i.test(text)
}

function titleFromPage(page: ScannedPage): string {
  if (isHomePage(page)) return 'What we do'
  if (pricingPage(page)) return 'Plans'
  const stem = (pathOf(page).split('/').filter(Boolean).pop() ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/\.html?$/, '')
  const fromTitle = page.title.replace(/\s*[|–—•].*$/, '').replace(/\s*-\s*[^-]+$/, '').trim()
  if (fromTitle && fromTitle.length >= 3 && fromTitle.length <= 42 && !/^home$/i.test(fromTitle)) return fromTitle
  if (stem) return stem.replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
  return 'About'
}

function leadFromPage(page: ScannedPage): string | null {
  let best: { text: string; score: number } | null = null
  for (const part of splitCopy(page.text)) {
    if (part.length < 32 || part.length > 280) continue
    if (isJunkAnswer(part)) continue
    let score = 8
    if (/[.!?]$/.test(part)) score += 3
    if (part.length >= 48 && part.length <= 160) score += 2
    if (part.length > 180) score -= 2
    if (/^["“]|we are pleased|join hands/i.test(part)) score -= 10
    if (/^don't |^do not /i.test(part)) score -= 8
    if (!best || score > best.score) best = { text: part, score }
  }
  if (!best || best.score < 4) return null
  return clip(best.text)
}

function siteMentionsDemo(pages: ScannedPage[]): boolean {
  return pages.some((page) => /book a demo|get a demo|request a demo|schedule a demo|talk to sales/i.test(`${page.title} ${page.text}`))
}

function phrasesForDoor(name: string): string[] {
  const clean = name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const words = clean.split(' ').filter((word) => word.length > 3)
  return [...new Set([clean, ...words.slice(0, 3)].filter(Boolean))]
}

function uniqueFlowName(name: string, used: Set<string>): string | null {
  const base = name.trim() || 'About'
  if (!used.has(base)) return base
  return null
}

/**
 * Read public pages and draft a map from those pages — not from a cluster seed list.
 * One useful page becomes one chapter. Investor/legal copy stays off. Book a demo and a
 * plan walk land only when the site actually has them.
 */
export function draftClusteredTemplate(input: {
  pages: ScannedPage[]
  companyName: string
  personaName?: string | null
  clusterId?: ClusterId
  keepBrand?: boolean
}): LearnedTemplateSpec {
  const pages = input.pages.filter((page) => page.text.trim().length > 0)
  const branded = pages.map((page) => ({
    ...page,
    title: abstractBrand(page.title),
    text: abstractBrand(page.text),
  }))
  const working = input.keepBrand ? pages : branded
  const clusterId = input.clusterId && input.clusterId !== 'custom'
    ? input.clusterId
    : suggestCluster(`${input.pages.map((page) => `${page.text} ${page.url}`).join('\n')}`)
  const company = companyLabel(input.companyName)
  const persona = input.personaName?.trim()
  const greeting = persona
    ? clusterId === 'hair'
      ? `Hi, I'm ${persona} at ${company}. What's your name?`
      : `Hi, I'm ${persona} at ${company}.`
    : assistantGreeting(company)
  const pricingPages = working.filter((page) => pricingPage(page))
  const tiers = clusterId === 'hair' || clusterId === 'email' ? [] : extractPlanTiers(pricingPages.map((page) => page.text).join('\n'))
  const topics: SiteTopic[] = []
  const used = new Set<string>()
  for (const page of working) {
    if (isJunkSitePage(page)) continue
    if (pricingPage(page) && tiers.length >= 2) continue
    const found = leadFromPage(page)
    if (!found) continue
    const name = uniqueFlowName(titleFromPage(page), used)
    if (!name) continue
    used.add(name)
    topics.push({
      flowName: name,
      choice: name,
      phrases: phrasesForDoor(name),
      question: `What about ${name.toLowerCase()}?`,
      answer: found,
      blurb: clip(found, 80),
    })
    if (topics.length >= 8) break
  }
  if (tiers.length >= 2) {
    topics.push({
      flowName: 'Plans and pricing',
      choice: 'Plans',
      phrases: ['pricing', 'plans', 'how much', 'cost', 'plan'],
      question: 'Which plan are you asking about?',
      answer: planSummary(tiers),
      blurb: tiers.map((tier) => (tier.price ? `${tier.name} ${tier.price}` : tier.name)).join(', '),
      walk: 'plans',
      choices: planChoices(tiers),
    })
  }
  if (clusterId !== 'hair' && clusterId !== 'email' && siteMentionsDemo(working)) {
    topics.push({
      flowName: 'Book a demo',
      choice: 'A demo',
      phrases: ['demo', 'book a demo', 'get a demo', 'talk to sales'],
      question: 'How do I book a demo?',
      answer: `I'll take one email, then someone from ${company} sales continues here.`,
      blurb: 'Email, then sales',
      walk: 'email',
    })
  }
  topics.push(talkTopic(company))
  const sourceUrl = pages[0]?.url ?? input.pages[0]?.url ?? ''
  const host = hostOf(sourceUrl)
  const title = titleCaseHost(host) || company
  return {
    clusterId: clusterId === 'custom' ? 'software' : clusterId,
    title,
    body: `From ${host || 'a public site'}. Chapters follow the pages that were read.`,
    welcomeName: `${company} welcome`,
    packTag: clusterId === 'custom' ? 'software' : clusterId,
    greeting,
    followUp: `Hi {{contact.name}}. What do you need help with?`,
    menu: `I can help with ${topics.filter((topic) => topic.flowName !== 'Talk to a person').map((topic) => topic.choice.toLowerCase()).join(', ')}, or a person on the team.`,
    topics,
    sourceUrl,
    sourceHost: host,
  }
}

export function packFromLearned(spec: LearnedTemplateSpec, companyName: string, personaName?: string | null): SiteTemplatePack {
  const voice = personaName?.trim()
  const greeting = voice
    ? /what's your name/i.test(spec.greeting)
      ? `Hi, I'm ${voice} at ${companyLabel(companyName)}. What's your name?`
      : `Hi, I'm ${voice} at ${companyLabel(companyName)}.`
    : spec.greeting.replace(/\bat .+\./, `at ${companyLabel(companyName)}.`)
  return siteTemplatePack({
    id: 'learned',
    tag: spec.packTag,
    welcomeName: spec.welcomeName,
    companyName,
    personaName,
    greeting,
    followUp: spec.followUp,
    menu: spec.menu,
    topics: spec.topics.map((topic) => ({
      ...topic,
      answer: topic.answer.replace(/\byour company\b/gi, companyLabel(companyName)),
    })),
  })
}
