/**
 * Start wizard: name, then how to start (scan, sample, blank, or a template).
 * Templates are the mapped cases (hair studio, CRM, software, inbox).
 * Each template has its own persona, avatar colour, and kind of conversation.
 */

import { assistantGreeting } from './greeting-welcome.js'
import { corporateServicesPack } from './corporate-pack.js'
import { hairStudioPack, SALON_WELCOME_NAME } from './salon-pack.js'
import {
  doorsFromTopics,
  packFromLearned,
  siteTemplatePack,
  type ClusterId,
  type LearnedTemplateSpec,
  type PreviewDoor,
  type SiteTemplatePack,
  type SiteTopic,
} from './site-template.js'

export type BotStart =
  | 'hair-studio'
  | 'corporate'
  | 'product-support'
  | 'crm-platform'
  | 'inbox-assistant'
  | 'website'
  | 'sample'
  | 'blank'
  | 'learned'

export const BOT_STARTS: BotStart[] = [
  'hair-studio',
  'corporate',
  'product-support',
  'crm-platform',
  'inbox-assistant',
  'website',
  'sample',
  'blank',
  'learned',
]

export interface StartCluster {
  id: ClusterId
  title: string
  body: string
}

export interface StartTemplate {
  id: BotStart | 'learned'
  clusterId: ClusterId
  title: string
  body: string
  tag: string
  persona: string
  accent: string
  role: string
  source?: { host: string; note: string }
}

export type StartPath = 'template' | 'website' | 'sample' | 'blank'

export interface StartOption {
  id: StartPath
  title: string
  body: string
  tag: string
}

export interface TemplateIdentity {
  persona: string
  accent: string
  role: string
  genre: string
}

export const START_OPTIONS: StartOption[] = [
  {
    id: 'template',
    title: 'From a template',
    body: 'Hair studio, CRM, software, inbox, or commerce — then the map for that kind of conversation.',
    tag: 'Mapped cases',
  },
  {
    id: 'website',
    title: 'Scan my website',
    body: 'We read the public pages it links to, then draft a greeting that asks one thing at a time.',
    tag: 'Draft only',
  },
  {
    id: 'sample',
    title: 'An example conversation',
    body: 'Paste a chat. It becomes the welcome guests hear.',
    tag: 'Draft only',
  },
  {
    id: 'blank',
    title: 'A blank welcome',
    body: 'One empty chart. You write the first line in the editor.',
    tag: 'Editor',
  },
]

const FALLBACK_IDENTITY: TemplateIdentity = {
  persona: '',
  accent: '#4f46e5',
  role: 'Assistant',
  genre: 'Custom',
}

export const TEMPLATE_IDENTITIES: Record<string, TemplateIdentity> = {
  'hair-studio': { persona: 'Bella', accent: '#059669', role: 'Front desk', genre: 'Hair studio' },
  corporate: { persona: 'Cal', accent: '#2563eb', role: 'Customer care', genre: 'Commerce' },
  'product-support': { persona: 'Aria', accent: '#7c3aed', role: 'Product support', genre: 'Software' },
  'crm-platform': { persona: 'Maya', accent: '#ea580c', role: 'Customer platform', genre: 'CRM' },
  'inbox-assistant': { persona: 'Jules', accent: '#0d9488', role: 'Inbox', genre: 'Email' },
  website: { persona: 'Bella', accent: '#4f46e5', role: 'Assistant', genre: 'Your site' },
  sample: { persona: '', accent: '#64748b', role: 'Assistant', genre: 'Custom' },
  blank: { persona: '', accent: '#64748b', role: 'Assistant', genre: 'Custom' },
}

const CLUSTER_TO_START: Record<string, string> = {
  hair: 'hair-studio',
  commerce: 'corporate',
  software: 'product-support',
  crm: 'crm-platform',
  email: 'inbox-assistant',
}

export function identityFor(start?: string | null): TemplateIdentity {
  const key = start && TEMPLATE_IDENTITIES[start] ? start : CLUSTER_TO_START[start ?? '']
  return TEMPLATE_IDENTITIES[key ?? ''] ?? FALLBACK_IDENTITY
}

export function personaAvatar(name: string, accent: string): string {
  const letter = (name.trim()[0] || '?').toUpperCase()
  const fill = /^#[0-9A-Fa-f]{6}$/.test(accent) ? accent : FALLBACK_IDENTITY.accent
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="${fill}"/><text x="32" y="41" text-anchor="middle" font-size="28" fill="#ffffff" font-family="system-ui,sans-serif">${letter}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function voiceFor(start: BotStart, personaName?: string | null): string {
  return personaName?.trim() || identityFor(start).persona
}

export const START_CLUSTERS: StartCluster[] = [
  { id: 'hair', title: 'Hair & beauty', body: 'Studios like Bella. A greeting, then where you are, the hours, the prices, or a booking.' },
  { id: 'commerce', title: 'Commerce', body: 'Orders, shipping, returns, plans, and a person on the team.' },
  { id: 'software', title: 'Software vendors', body: 'Product, support, payments, safety, and a demo. Improved as more vendor sites are read.' },
  { id: 'crm', title: 'CRM & sales', body: 'Marketing, sales, service, plans, and a demo.' },
  { id: 'email', title: 'Email & inbox', body: 'Inbox, compose, search, and keeping mail safe.' },
  { id: 'custom', title: 'Custom', body: 'Scan a website, paste a conversation, or start from a blank welcome.' },
]

function withIdentity(item: Omit<StartTemplate, 'persona' | 'accent' | 'role'>): StartTemplate {
  const identity = identityFor(item.id)
  return { ...item, persona: identity.persona, accent: identity.accent, role: identity.role }
}

export const BAKED_TEMPLATES: StartTemplate[] = [
  withIdentity({
    id: 'hair-studio',
    clusterId: 'hair',
    title: 'Hair studio',
    body: 'The same kind of conversation as Bella. A greeting, then a booking, a price, the hours, or where the studio is.',
    tag: 'Like Bella',
  }),
  withIdentity({
    id: 'corporate',
    clusterId: 'commerce',
    title: 'Corporate services',
    body: 'Orders, shipping, returns, plans and pricing, and a handoff to the team.',
    tag: 'Shop & support',
  }),
  withIdentity({
    id: 'product-support',
    clusterId: 'software',
    title: 'Software support',
    body: 'What the product does, support, payments and identity, safety, integrations, and a demo.',
    tag: 'From cevro.ai',
    source: { host: 'cevro.ai', note: 'Public crawl. Brand names and customer stories are left off.' },
  }),
  withIdentity({
    id: 'crm-platform',
    clusterId: 'crm',
    title: 'CRM platform',
    body: 'Marketing, sales, service, plans, and a demo — the usual doors on a customer platform.',
    tag: 'From hubspot.com',
    source: { host: 'hubspot.com', note: 'Public crawl. Product brand names are left off.' },
  }),
  withIdentity({
    id: 'inbox-assistant',
    clusterId: 'email',
    title: 'Inbox assistant',
    body: 'Inbox, compose, search, and security. The sign-in wall is left off; this is the public product map.',
    tag: 'From gmail.com',
    source: { host: 'gmail.com', note: 'Public about page. The signed-in inbox is not readable, so this is the public product journey.' },
  }),
]

export function templatesInCluster(clusterId: ClusterId, learned: StartTemplate[] = []): StartTemplate[] {
  return [...BAKED_TEMPLATES, ...learned].filter((item) => item.clusterId === clusterId)
}

function companyLabel(name: string): string {
  return name.trim() || 'your company'
}

function softwareTopics(company: string): SiteTopic[] {
  const name = companyLabel(company)
  return [
    {
      flowName: 'Product',
      choice: 'What we do',
      phrases: ['product', 'platform', 'what do you do', 'features', 'what is this'],
      question: 'What does the product do?',
      answer: `${name} is AI customer support for software teams. It handles the usual questions end to end — accounts, payments, identity checks, and safety — and passes a chat to a person when a person should take it.`,
      blurb: 'AI support across the usual questions',
    },
    {
      flowName: 'Support',
      choice: 'Support',
      phrases: ['support', 'customer support', 'help desk', 'queue', 'csat'],
      question: 'How does support work?',
      answer: 'Support can take the queue around the clock and keep the tone steady. A person still takes over when the guest asks, or when a check needs a person.',
      blurb: 'The queue, then a person if needed',
    },
    {
      flowName: 'Payments and identity',
      choice: 'Payments',
      phrases: ['payment', 'payout', 'withdrawal', 'kyc', 'verification', 'identity', 'source of funds'],
      question: 'How do payments and identity checks work?',
      answer: 'Payments and identity checks are a workflow. I can explain the steps and collect what the team needs. A person confirms anything that needs a person.',
      blurb: 'Payouts, verification, then a person',
    },
    {
      flowName: 'Safety',
      choice: 'Safety',
      phrases: ['compliance', 'safety', 'responsible', 'rg', 'guardrail', 'audit'],
      question: 'How do you handle safety?',
      answer: 'Safety checks run on every reply. Sensitive details stay off the transcript when a rule says they should. If a message needs a person, I pass it on.',
      blurb: 'Checks on every reply',
    },
    {
      flowName: 'Integrations',
      choice: 'Integrations',
      phrases: ['integration', 'connect', 'api', 'crm', 'helpdesk', 'pam'],
      question: 'What does it connect to?',
      answer: 'The platform connects to helpdesks, CRMs, and payment providers. Tell me which system you use and I will note it for the team.',
      blurb: 'Helpdesks, CRMs, payments',
    },
    {
      flowName: 'Book a demo',
      choice: 'A demo',
      phrases: ['demo', 'book a demo', 'schedule', 'request demo', 'roi'],
      question: 'How do I book a demo?',
      answer: 'I can note a demo. What is a good day, and who should the team talk to?',
      blurb: 'A day, then the team',
    },
    {
      flowName: 'Talk to a person',
      choice: 'Talk to a person',
      phrases: ['talk to a person', 'speak to someone', 'human', 'contact sales'],
      question: 'How do I talk to a person?',
      answer: `I am passing this chat to the ${name} team. Someone will continue here.`,
      blurb: 'A person takes over',
    },
  ]
}

function crmTopics(company: string): SiteTopic[] {
  const name = companyLabel(company)
  return [
    {
      flowName: 'Marketing',
      choice: 'Marketing',
      phrases: ['marketing', 'leads', 'campaign', 'attract', 'convert'],
      question: 'How does marketing work?',
      answer: `${name} helps the team attract the right leads, run campaigns, and see what converted. Content and automation sit on the same customer record.`,
      blurb: 'Leads and campaigns',
    },
    {
      flowName: 'Sales',
      choice: 'Sales',
      phrases: ['sales', 'pipeline', 'deals', 'prospect'],
      question: 'How does sales work?',
      answer: 'Sales keeps the pipeline on the same customer record. The team can prospect, follow up, and close without jumping tools.',
      blurb: 'Pipeline and deals',
    },
    {
      flowName: 'Service',
      choice: 'Service',
      phrases: ['service', 'support', 'retention', 'help desk', 'customer agent'],
      question: 'How does service work?',
      answer: 'Service answers the usual questions and hands a chat to a person with the record attached. Health and follow-ups sit next to the tickets.',
      blurb: 'Support and retention',
    },
    {
      flowName: 'Plans and pricing',
      choice: 'Plans',
      phrases: ['pricing', 'plans', 'free', 'starter', 'cost'],
      question: 'What are the plans?',
      answer: 'There is a free set of tools and paid plans for marketing, sales, and service. A small-business bundle puts the starter edition of each together. I can note which plan you are asking about.',
      blurb: 'Free tools and paid plans',
    },
    {
      flowName: 'Book a demo',
      choice: 'A demo',
      phrases: ['demo', 'book a demo', 'get a demo', 'talk to sales'],
      question: 'How do I book a demo?',
      answer: 'I can note a demo of the customer platform. What is a good day, and which team should we start with — marketing, sales, or service?',
      blurb: 'A walkthrough with the team',
    },
    {
      flowName: 'Talk to a person',
      choice: 'Talk to a person',
      phrases: ['talk to a person', 'contact sales', 'human'],
      question: 'How do I talk to a person?',
      answer: `I am passing this chat to the ${name} team. Someone will continue here.`,
      blurb: 'A person takes over',
    },
  ]
}

function inboxTopics(company: string): SiteTopic[] {
  const name = companyLabel(company)
  return [
    {
      flowName: 'Inbox',
      choice: 'Inbox',
      phrases: ['inbox', 'mail', 'messages', 'catch up'],
      question: 'How does the inbox work?',
      answer: 'The inbox is for reading and catching up. Long threads can be summarised so you see the point without scrolling the whole history.',
      blurb: 'Catch up on mail',
    },
    {
      flowName: 'Compose',
      choice: 'Compose',
      phrases: ['compose', 'write', 'reply', 'draft', 'send'],
      question: 'How do I write a message?',
      answer: 'Compose a new message or reply in the thread. Suggested replies are a starting point — you send the line in your own words.',
      blurb: 'Write and reply',
    },
    {
      flowName: 'Search',
      choice: 'Search',
      phrases: ['search', 'find', 'look up', 'where is the email'],
      question: 'How do I find a message?',
      answer: 'Search in your own words. I can look for a person, a subject, or a detail in the thread and point you to it.',
      blurb: 'Find a thread',
    },
    {
      flowName: 'Security',
      choice: 'Security',
      phrases: ['security', 'spam', 'phishing', 'privacy', 'encryption', 'password'],
      question: 'How is mail kept safe?',
      answer: 'Mail is encrypted in transit. Spam and dangerous links are filtered before they reach the inbox. I never ask for a password in this chat.',
      blurb: 'Spam, phishing, privacy',
    },
    {
      flowName: 'Chat and calls',
      choice: 'Chat',
      phrases: ['chat', 'meet', 'call', 'video', 'docs'],
      question: 'Can I chat or call from here?',
      answer: 'You can start a chat, a video call, or a shared doc from the inbox so the thread and the conversation stay together.',
      blurb: 'Chat, calls, and docs',
    },
    {
      flowName: 'Talk to a person',
      choice: 'Talk to a person',
      phrases: ['talk to a person', 'human', 'support'],
      question: 'How do I talk to a person?',
      answer: `I am passing this chat to the ${name} team. Someone will continue here.`,
      blurb: 'A person takes over',
    },
  ]
}

function packGreeting(start: BotStart, company: string, personaName?: string | null): string {
  const voice = voiceFor(start, personaName)
  return voice ? `Hi, I'm ${voice} at ${company}.` : assistantGreeting(company)
}

export function bakedPack(
  start: BotStart,
  companyName: string,
  personaName?: string | null,
): SiteTemplatePack | null {
  const company = companyLabel(companyName)
  const greeting = packGreeting(start, company, personaName)
  const voice = voiceFor(start, personaName) || null
  if (start === 'product-support') {
    const topics = softwareTopics(company)
    return siteTemplatePack({
      id: 'product-support',
      tag: 'software',
      welcomeName: 'Product welcome',
      companyName: company,
      personaName: voice,
      greeting,
      followUp: 'Hi {{contact.name}}. What do you need help with?',
      menu: 'I can help with what we do, support, payments, safety, integrations, a demo, or a person on the team.',
      topics,
    })
  }
  if (start === 'crm-platform') {
    const topics = crmTopics(company)
    return siteTemplatePack({
      id: 'crm-platform',
      tag: 'crm',
      welcomeName: 'CRM welcome',
      companyName: company,
      personaName: voice,
      greeting,
      followUp: 'Hi {{contact.name}}. What do you need help with?',
      menu: 'I can help with marketing, sales, service, plans, a demo, or a person on the team.',
      topics,
    })
  }
  if (start === 'inbox-assistant') {
    const topics = inboxTopics(company)
    return siteTemplatePack({
      id: 'inbox-assistant',
      tag: 'inbox',
      welcomeName: 'Inbox welcome',
      companyName: company,
      personaName: voice,
      greeting,
      followUp: 'Hi {{contact.name}}. What do you need help with?',
      menu: 'I can help with the inbox, compose, search, security, chat, or a person on the team.',
      topics,
    })
  }
  return null
}

export function startPreview(input: {
  start: BotStart
  companyName: string
  personaName?: string | null
  learned?: LearnedTemplateSpec | null
  scanDoors?: PreviewDoor[]
  scanGreeting?: string
  sample?: string
}): { greeting: string; doors: PreviewDoor[]; note?: string } {
  const company = companyLabel(input.companyName)
  const voice = voiceFor(input.start, input.personaName)
  if (input.start === 'learned' && input.learned) {
    const pack = packFromLearned(input.learned, company, input.personaName)
    return { greeting: pack.greeting, doors: pack.doors, note: input.learned.body }
  }
  if (input.start === 'website') {
    return {
      greeting: input.scanGreeting ?? (voice ? `Hi, I'm ${voice} at ${company}. What's your name?` : assistantGreeting(company)),
      doors: input.scanDoors ?? [],
    }
  }
  if (input.start === 'sample') {
    return { greeting: input.sample?.trim() || 'Paste a line from the conversation.', doors: [] }
  }
  if (input.start === 'blank') {
    return { greeting: 'Write the first line.', doors: [] }
  }
  if (input.start === 'hair-studio') {
    const pack = hairStudioPack(company, voice || undefined)
    const welcome = pack.flows.find((flow) => flow.name === SALON_WELCOME_NAME)
    return {
      greeting: `Hi, I'm ${voice || 'Bella'} at ${company}. What's your name?`,
      doors: [
        { title: 'Where we are', flowName: 'Location', blurb: 'Address' },
        { title: 'Hours', flowName: 'Salon hours', blurb: 'When we are open' },
        { title: 'Services', flowName: 'Services and prices', blurb: 'Cuts, colour, prices' },
        { title: 'Book', flowName: 'Book an appointment', blurb: 'A time, then a confirmation' },
      ],
      note: welcome?.description,
    }
  }
  if (input.start === 'corporate') {
    const pack = corporateServicesPack(company, voice || undefined)
    return {
      greeting: packGreeting('corporate', company, voice),
      doors: doorsFromTopics(pack.intents.map((intent) => ({
        flowName: intent.name,
        choice: intent.name,
        phrases: intent.utterances,
        question: intent.description,
        answer: intent.responses[0]?.text ?? '',
        blurb: intent.description,
      }))).slice(0, 8),
    }
  }
  const pack = bakedPack(input.start, company, voice)
  if (pack) return { greeting: pack.greeting, doors: pack.doors }
  return { greeting: assistantGreeting(company), doors: [] }
}

export function startWalkChapters(input: {
  start: BotStart
  companyName: string
  personaName?: string | null
  learned?: LearnedTemplateSpec | null
}): Array<{ name: string; graph: object }> {
  const company = companyLabel(input.companyName)
  const voice = voiceFor(input.start, input.personaName)
  if (input.start === 'learned' && input.learned) {
    return packFromLearned(input.learned, company, voice || null).flows.map((flow) => ({ name: flow.name, graph: flow.graph }))
  }
  if (input.start === 'hair-studio') {
    return hairStudioPack(company, voice || undefined).flows.map((flow) => ({ name: flow.name, graph: flow.graph }))
  }
  if (input.start === 'corporate') {
    return corporateServicesPack(company, voice || undefined).flows.map((flow) => ({ name: flow.name, graph: flow.graph }))
  }
  const pack = bakedPack(input.start, company, voice)
  return pack ? pack.flows.map((flow) => ({ name: flow.name, graph: flow.graph })) : []
}
