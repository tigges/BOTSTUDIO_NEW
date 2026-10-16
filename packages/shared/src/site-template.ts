/**
 * A public site becomes a starter template: brand names come off,
 * the remaining journey is a cluster (hair studios, software vendors, CRM, email).
 * The start wizard and Optimizations share this shape.
 */

import { assistantGreeting, greetingWelcomeGraph } from './greeting-welcome.js'
import { supportUseCaseFlows, type StarterFlow } from './flow-templates.js'
import type { ScannedPage } from './website-scan.js'

export type ClusterId = 'hair' | 'commerce' | 'software' | 'crm' | 'email' | 'custom'

export interface SiteTopic {
  flowName: string
  choice: string
  phrases: string[]
  question: string
  answer: string
  blurb: string
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

export interface WizardChannel {
  id: string
  label: string
  body: string
  action: 'on' | 'connect' | 'soon'
}

export const WIZARD_CHANNELS: WizardChannel[] = [
  { id: 'web', label: 'Website chat', body: 'Always on. Test and live walk the journey map.', action: 'on' },
  { id: 'whatsapp', label: 'WhatsApp', body: 'Connect a WhatsApp Business number.', action: 'connect' },
  { id: 'sms', label: 'SMS', body: 'Send and receive texts.', action: 'connect' },
  { id: 'email', label: 'Email', body: 'Receive and reply to mail.', action: 'connect' },
  { id: 'facebook', label: 'Messenger', body: 'A Facebook Page inbox.', action: 'soon' },
  { id: 'telegram', label: 'Telegram', body: 'A Telegram bot.', action: 'soon' },
]

export const CONNECTABLE_CHANNELS = WIZARD_CHANNELS.filter((item) => item.action === 'connect').map((item) => item.id)

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
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim()
}

const CLUSTER_HINTS: Array<[ClusterId, RegExp]> = [
  ['hair', /\b(hair|salon|beauty|stylist|colour|balayage|haircut)\b/i],
  ['email', /\b(gmail|inbox|email|mailbox|compose)\b/i],
  ['crm', /\b(hubspot|crm|pipeline|marketing automation|sales hub)\b/i],
  ['software', /\b(cevro|operator|kyc|vendor|integration|platform|saas)\b/i],
  ['commerce', /\b(shipping|return policy|order tracking|checkout)\b/i],
]

export function suggestCluster(text: string): ClusterId {
  const blob = `${text}`
  for (const [id, pattern] of CLUSTER_HINTS) {
    if (pattern.test(blob)) return id
  }
  return 'custom'
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

function chapterFor(topic: SiteTopic, tag: string): StarterFlow {
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
  const flows: StarterFlow[] = [welcome, ...topics.map((topic) => chapterFor(topic, input.tag))]
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

const SEEDS: Record<Exclude<ClusterId, 'custom'>, SiteTopic[]> = {
  hair: [
    { flowName: 'Location', choice: 'Where we are', phrases: ['where are you', 'address'], question: 'Where are you?', answer: '', blurb: 'Address' },
    { flowName: 'Hours', choice: 'Hours', phrases: ['hours', 'open'], question: 'What are your opening hours?', answer: '', blurb: 'When you are open' },
    { flowName: 'Services', choice: 'Services', phrases: ['services', 'prices', 'how much'], question: 'What do you offer?', answer: '', blurb: 'Cuts, colour, prices' },
    { flowName: 'Book an appointment', choice: 'Book', phrases: ['book', 'appointment'], question: 'How do I book?', answer: '', blurb: 'A time, then a confirmation' },
  ],
  commerce: [
    { flowName: 'Shipping', choice: 'Shipping', phrases: ['shipping', 'delivery'], question: 'How long does shipping take?', answer: '', blurb: 'Delivery times' },
    { flowName: 'Returns', choice: 'Returns', phrases: ['return', 'refund'], question: 'What is the return policy?', answer: '', blurb: 'How to send something back' },
    { flowName: 'Orders', choice: 'Orders', phrases: ['order', 'tracking'], question: 'Where is my order?', answer: '', blurb: 'Tracking and status' },
    { flowName: 'Plans', choice: 'Plans', phrases: ['pricing', 'plans'], question: 'What are the plans?', answer: '', blurb: 'Plans and pricing' },
  ],
  software: [
    { flowName: 'Product', choice: 'What we do', phrases: ['product', 'platform', 'what do you do', 'features'], question: 'What does the product do?', answer: '', blurb: 'The product in one line' },
    { flowName: 'Support', choice: 'Support', phrases: ['support', 'help desk', 'queue'], question: 'How does support work?', answer: '', blurb: 'The usual questions, then a person' },
    { flowName: 'Payments and identity', choice: 'Payments', phrases: ['payment', 'payout', 'kyc', 'verification', 'identity'], question: 'How do payments and identity checks work?', answer: '', blurb: 'Payouts and checks' },
    { flowName: 'Safety', choice: 'Safety', phrases: ['compliance', 'safety', 'responsible', 'guardrail'], question: 'How do you handle safety?', answer: '', blurb: 'Checks on every reply' },
    { flowName: 'Integrations', choice: 'Integrations', phrases: ['integration', 'connect', 'api', 'crm'], question: 'What does it connect to?', answer: '', blurb: 'Helpdesks, CRMs, payments' },
    { flowName: 'Book a demo', choice: 'A demo', phrases: ['demo', 'book a demo', 'schedule'], question: 'How do I book a demo?', answer: '', blurb: 'A day, then the team' },
  ],
  crm: [
    { flowName: 'Marketing', choice: 'Marketing', phrases: ['marketing', 'leads', 'campaign'], question: 'How does marketing work?', answer: '', blurb: 'Leads and campaigns' },
    { flowName: 'Sales', choice: 'Sales', phrases: ['sales', 'pipeline', 'deals'], question: 'How does sales work?', answer: '', blurb: 'Pipeline and deals' },
    { flowName: 'Service', choice: 'Service', phrases: ['service', 'support', 'retention'], question: 'How does service work?', answer: '', blurb: 'Support and retention' },
    { flowName: 'Plans and pricing', choice: 'Plans', phrases: ['pricing', 'plans', 'free'], question: 'What are the plans?', answer: '', blurb: 'Free tools and paid plans' },
    { flowName: 'Book a demo', choice: 'A demo', phrases: ['demo', 'book a demo', 'get a demo'], question: 'How do I book a demo?', answer: '', blurb: 'A walkthrough with the team' },
  ],
  email: [
    { flowName: 'Inbox', choice: 'Inbox', phrases: ['inbox', 'mail', 'messages'], question: 'How does the inbox work?', answer: '', blurb: 'Catch up on mail' },
    { flowName: 'Compose', choice: 'Compose', phrases: ['compose', 'write', 'reply', 'draft'], question: 'How do I write a message?', answer: '', blurb: 'Write and reply' },
    { flowName: 'Search', choice: 'Search', phrases: ['search', 'find', 'look up'], question: 'How do I find a message?', answer: '', blurb: 'Find a thread' },
    { flowName: 'Security', choice: 'Security', phrases: ['security', 'spam', 'phishing', 'privacy'], question: 'How is mail kept safe?', answer: '', blurb: 'Spam, phishing, privacy' },
  ],
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

function sentenceFor(text: string, phrases: string[]): string | null {
  const parts = text.split(/(?<=[.!?])\s+/)
  for (const phrase of phrases) {
    const hit = parts.find((part) => part.toLowerCase().includes(phrase.toLowerCase()) && part.length > 24 && part.length < 320)
    if (hit) return clip(hit)
  }
  return null
}

function titleCaseHost(host: string): string {
  const stem = host.split('.')[0] ?? 'the product'
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}

/**
 * Read public pages, drop brand names, and draft a cluster template.
 * Missing facts stay as a line you edit — they do not invent a price or a policy.
 */
export function draftClusteredTemplate(input: {
  pages: ScannedPage[]
  companyName: string
  personaName?: string | null
  clusterId?: ClusterId
}): LearnedTemplateSpec {
  const pages = input.pages.filter((page) => page.text.trim().length > 0)
  const raw = pages.map((page) => page.text).join('\n')
  const text = abstractBrand(raw)
  const clusterId = input.clusterId && input.clusterId !== 'custom' ? input.clusterId : suggestCluster(`${text} ${pages.map((page) => page.url).join(' ')}`)
  const company = companyLabel(input.companyName)
  const persona = input.personaName?.trim()
  const greeting = persona
    ? `Hi, I'm ${persona} at ${company}. What's your name?`
    : assistantGreeting(company)
  const seeds = clusterId === 'custom' ? SEEDS.software : SEEDS[clusterId]
  const topics: SiteTopic[] = []
  for (const seed of seeds) {
    const found = sentenceFor(text, seed.phrases)
    const answer = found ?? `The pages did not state this for ${seed.choice.toLowerCase()}. Edit the line to match ${company}.`
    topics.push({
      ...seed,
      answer,
      blurb: found ? clip(found, 80) : seed.blurb,
    })
  }
  topics.push(talkTopic(company))
  const host = hostOf(pages[0]?.url ?? '')
  const clusterTitle: Record<ClusterId, string> = {
    hair: 'Hair studio',
    commerce: 'Commerce support',
    software: 'Software vendor',
    crm: 'CRM platform',
    email: 'Inbox assistant',
    custom: titleCaseHost(host) || 'From a website',
  }
  const title = clusterTitle[clusterId]
  return {
    clusterId: clusterId === 'custom' ? 'software' : clusterId,
    title,
    body: `From ${host || 'a public site'}. Brand names are left off. Edit the lines to match ${company}.`,
    welcomeName: `${title} welcome`,
    packTag: clusterId === 'custom' ? 'software' : clusterId,
    greeting,
    followUp: `Hi {{contact.name}}. What do you need help with?`,
    menu: `I can help with ${topics.slice(0, 4).map((topic) => topic.choice.toLowerCase()).join(', ')}, or a person on the team.`,
    topics,
    sourceUrl: pages[0]?.url ?? '',
    sourceHost: host,
  }
}

export function packFromLearned(spec: LearnedTemplateSpec, companyName: string, personaName?: string | null): SiteTemplatePack {
  const greeting = personaName?.trim()
    ? `Hi, I'm ${personaName.trim()} at ${companyLabel(companyName)}. What's your name?`
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
