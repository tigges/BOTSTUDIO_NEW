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
    { flowName: 'Stylist', choice: 'Stylist', phrases: ['stylist', 'who will do my hair'], question: 'Can I choose my stylist?', answer: '', blurb: 'Ask for someone by name' },
    { flowName: 'Walk-ins', choice: 'Walk-ins', phrases: ['walk-in', 'walk in'], question: 'Do you take walk-ins?', answer: '', blurb: 'When a chair is free' },
    { flowName: 'Cancellation', choice: 'Cancel', phrases: ['cancel', 'cancellation'], question: 'How do I cancel?', answer: '', blurb: 'Notice, then a confirmation' },
    { flowName: 'Gift voucher', choice: 'Voucher', phrases: ['gift voucher', 'gift card'], question: 'Do you sell gift vouchers?', answer: '', blurb: 'Amounts and how long they last' },
  ],
  commerce: [
    { flowName: 'Shipping', choice: 'Shipping', phrases: ['shipping', 'delivery'], question: 'How long does shipping take?', answer: '', blurb: 'Delivery times' },
    { flowName: 'Returns', choice: 'Returns', phrases: ['return', 'refund'], question: 'What is the return policy?', answer: '', blurb: 'How to send something back' },
    { flowName: 'Orders', choice: 'Orders', phrases: ['order', 'tracking', 'where is my order'], question: 'Where is my order?', answer: '', blurb: 'Tracking and status' },
    { flowName: 'Payments', choice: 'Payments', phrases: ['payment', 'card', 'invoice'], question: 'How do I pay?', answer: '', blurb: 'Cards and invoices' },
    { flowName: 'Account', choice: 'Account', phrases: ['account', 'login', 'password'], question: 'How do I sign in?', answer: '', blurb: 'Login and a reset' },
    { flowName: 'Hours', choice: 'Hours', phrases: ['hours', 'open', 'support hours'], question: 'When is support open?', answer: '', blurb: 'When a person replies' },
    { flowName: 'Plans', choice: 'Plans', phrases: ['pricing', 'plans'], question: 'What are the plans?', answer: '', blurb: 'Plans and pricing' },
    { flowName: 'Warranty', choice: 'Warranty', phrases: ['warranty', 'guarantee', 'broken'], question: 'What is the warranty?', answer: '', blurb: 'What is covered' },
  ],
  software: [
    { flowName: 'Product', choice: 'What we do', phrases: ['product', 'platform', 'what do you do', 'features'], question: 'What does the product do?', answer: '', blurb: 'The product in one line' },
    { flowName: 'Support', choice: 'Support', phrases: ['support', 'help desk', 'queue'], question: 'How does support work?', answer: '', blurb: 'The usual questions, then a person' },
    { flowName: 'Accounts', choice: 'Accounts', phrases: ['account', 'login', 'password', 'sign in'], question: 'How do accounts and login work?', answer: '', blurb: 'Login, password, locked out' },
    { flowName: 'Payments and identity', choice: 'Payments', phrases: ['payment', 'payout', 'kyc', 'verification', 'identity'], question: 'How do payments and identity checks work?', answer: '', blurb: 'Payouts and checks' },
    { flowName: 'Safety', choice: 'Safety', phrases: ['compliance', 'safety', 'responsible', 'guardrail'], question: 'How do you handle safety?', answer: '', blurb: 'Checks on every reply' },
    { flowName: 'Onboarding', choice: 'Get started', phrases: ['onboarding', 'get started', 'setup', 'go live'], question: 'How do we get started?', answer: '', blurb: 'Setup, then a first live week' },
    { flowName: 'Integrations', choice: 'Integrations', phrases: ['integration', 'connect', 'api', 'crm'], question: 'What does it connect to?', answer: '', blurb: 'Helpdesks, CRMs, payments' },
    { flowName: 'Pricing', choice: 'Pricing', phrases: ['pricing', 'how much', 'cost', 'plan'], question: 'What does it cost?', answer: '', blurb: 'Volume, then a quote' },
    { flowName: 'Status', choice: 'Status', phrases: ['status', 'outage', 'incident', 'downtime'], question: 'Is there an outage?', answer: '', blurb: 'Incidents and downtime' },
    { flowName: 'API', choice: 'API', phrases: ['api', 'developer', 'docs', 'webhook'], question: 'Is there an API?', answer: '', blurb: 'Docs, webhooks, events' },
    { flowName: 'Book a demo', choice: 'A demo', phrases: ['demo', 'book a demo', 'schedule'], question: 'How do I book a demo?', answer: '', blurb: 'A day, then the team' },
  ],
  crm: [
    { flowName: 'Marketing', choice: 'Marketing', phrases: ['marketing', 'leads', 'campaign', 'forms'], question: 'How does marketing work?', answer: '', blurb: 'Leads, campaigns, forms' },
    { flowName: 'Sales', choice: 'Sales', phrases: ['sales', 'pipeline', 'deals'], question: 'How does sales work?', answer: '', blurb: 'Pipeline and deals' },
    { flowName: 'Service', choice: 'Service', phrases: ['service', 'support', 'retention'], question: 'How does service work?', answer: '', blurb: 'Support and retention' },
    { flowName: 'Contacts', choice: 'Contacts', phrases: ['contact', 'contacts', 'company record'], question: 'Where do contacts live?', answer: '', blurb: 'People, companies, one record' },
    { flowName: 'Meetings', choice: 'Meetings', phrases: ['meeting', 'calendar', 'book a meeting'], question: 'How do meetings work?', answer: '', blurb: 'Availability, then a booking' },
    { flowName: 'Tickets', choice: 'Tickets', phrases: ['ticket', 'tickets', 'case'], question: 'How do tickets work?', answer: '', blurb: 'Open, find, and follow a case' },
    { flowName: 'Reporting', choice: 'Reporting', phrases: ['report', 'dashboard', 'analytics'], question: 'What can I see in reports?', answer: '', blurb: 'Pipeline, campaigns, tickets' },
    { flowName: 'Integrations', choice: 'Integrations', phrases: ['integration', 'connect', 'gmail', 'outlook'], question: 'What does it connect to?', answer: '', blurb: 'Mail, calendar, ads, chat' },
    { flowName: 'Plans and pricing', choice: 'Plans', phrases: ['pricing', 'plans', 'free'], question: 'What are the plans?', answer: '', blurb: 'Free tools and paid plans' },
    { flowName: 'Billing', choice: 'Billing', phrases: ['billing', 'invoice', 'subscription'], question: 'How does billing work?', answer: '', blurb: 'Invoices and the workspace plan' },
    { flowName: 'Login', choice: 'Login', phrases: ['login', 'sign in', 'password', 'sso'], question: 'How do I sign in?', answer: '', blurb: 'Password, SSO, two-factor' },
    { flowName: 'Book a demo', choice: 'A demo', phrases: ['demo', 'book a demo', 'get a demo'], question: 'How do I book a demo?', answer: '', blurb: 'A walkthrough with the team' },
  ],
  email: [
    { flowName: 'Inbox', choice: 'Inbox', phrases: ['inbox', 'mail', 'messages', 'unread'], question: 'How does the inbox work?', answer: '', blurb: 'Unread, catch up, summaries' },
    { flowName: 'Compose', choice: 'Compose', phrases: ['compose', 'write', 'reply', 'draft', 'undo send'], question: 'How do I write a message?', answer: '', blurb: 'Write, reply, undo send' },
    { flowName: 'Search', choice: 'Search', phrases: ['search', 'find', 'look up'], question: 'How do I find a message?', answer: '', blurb: 'Person, subject, or a detail' },
    { flowName: 'Labels', choice: 'Labels', phrases: ['label', 'folder', 'star'], question: 'How do labels work?', answer: '', blurb: 'File a thread without losing it' },
    { flowName: 'Filters', choice: 'Filters', phrases: ['filter', 'rules', 'auto file'], question: 'Can I file mail automatically?', answer: '', blurb: 'Rules as mail arrives' },
    { flowName: 'Attachments', choice: 'Attachments', phrases: ['attachment', 'file', 'pdf'], question: 'How do attachments work?', answer: '', blurb: 'Files and linked docs' },
    { flowName: 'Security', choice: 'Security', phrases: ['security', 'spam', 'phishing', 'privacy'], question: 'How is mail kept safe?', answer: '', blurb: 'Spam, phishing, privacy' },
    { flowName: 'Chat and calls', choice: 'Chat', phrases: ['chat', 'meet', 'call', 'video'], question: 'Can I chat or call from here?', answer: '', blurb: 'Chat, calls, and docs' },
    { flowName: 'Storage', choice: 'Storage', phrases: ['storage', 'quota', 'mailbox full'], question: 'How much space do I have?', answer: '', blurb: 'Quota and a full mailbox' },
    { flowName: 'Mobile', choice: 'Mobile', phrases: ['mobile', 'phone', 'app', 'offline'], question: 'Does it work on a phone?', answer: '', blurb: 'Phone app and offline' },
    { flowName: 'Privacy', choice: 'Privacy', phrases: ['privacy', 'ads', 'who can read'], question: 'Who can read my mail?', answer: '', blurb: 'Mail is not used to sell ads' },
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
    menu: `I can help with ${topics.filter((topic) => topic.flowName !== 'Talk to a person').map((topic) => topic.choice.toLowerCase()).join(', ')}, or a person on the team.`,
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
