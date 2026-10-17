/**
 * Start wizard: name, then how to start (scan a site, paste a sample, or blank).
 * Baked templates stay in this file for packs and tests, but they are not offered
 * as a start path until we bring them back.
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
import { CRM_PLAN_TIERS, planChoices, planSummary } from './plan-tiers.js'

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

/** `template` stays on the type so parked wizard UI still typechecks. It is not in START_OPTIONS. */
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
  'hair-studio': { persona: 'Bella', accent: '#059669', role: 'Receptionist', genre: 'Hair and Spa Salon' },
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
  { id: 'hair', title: 'Hair and Spa Salon', body: 'Studios like Bella. A greeting, then where you are, the hours, the prices, or a booking.' },
  { id: 'commerce', title: 'Commerce', body: 'Orders, shipping, returns, plans, and a person on the team.' },
  { id: 'software', title: 'Software vendors', body: 'Product, support, accounts, payments, safety, onboarding, integrations, pricing, status, the API, and a demo.' },
  { id: 'crm', title: 'CRM & sales', body: 'Marketing, sales, service, contacts, meetings, tickets, reporting, plans, billing, and a demo.' },
  { id: 'email', title: 'Email & inbox', body: 'Inbox, compose, search, labels, filters, attachments, security, storage, mobile, and privacy.' },
  { id: 'custom', title: 'Custom', body: 'Scan a website, paste a conversation, or start from a blank welcome.' },
]

function withIdentity(item: Omit<StartTemplate, 'persona' | 'accent' | 'role'>): StartTemplate {
  const identity = identityFor(item.id)
  return { ...item, persona: identity.persona, accent: identity.accent, role: identity.role }
}

/** Parked: not listed in START_OPTIONS or GET /start-catalog. Packs stay for tests and POST start=. */
export const BAKED_TEMPLATES: StartTemplate[] = [
  withIdentity({
    id: 'hair-studio',
    clusterId: 'hair',
    title: 'Hair and Spa Salon',
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
    body: 'What the product does, then support, accounts, payments, safety, onboarding, integrations, pricing, status, the API, and a demo.',
    tag: 'From cevro.ai',
    source: { host: 'cevro.ai', note: 'Public crawl. Brand names and customer stories are left off.' },
  }),
  withIdentity({
    id: 'crm-platform',
    clusterId: 'crm',
    title: 'CRM platform',
    body: 'Marketing, sales, service, contacts, and Free through Enterprise plans. A demo asks for one email, then sales continues.',
    tag: 'From hubspot.com',
    source: { host: 'hubspot.com', note: 'Public crawl. Product brand names are left off.' },
  }),
  withIdentity({
    id: 'inbox-assistant',
    clusterId: 'email',
    title: 'Inbox assistant',
    body: 'Inbox, compose, search, labels, filters, attachments, security, chat, storage, mobile, and privacy. The sign-in wall is left off; this is the public product map.',
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
      answer: `${name} is AI customer support for software teams. It takes the usual queue — accounts, payments, identity checks, and safety — and passes a chat to a person when a person should take it.`,
      blurb: 'The product in one line',
    },
    {
      flowName: 'Support',
      choice: 'Support',
      phrases: ['support', 'customer support', 'help desk', 'queue', 'csat', 'sla'],
      question: 'How does support work?',
      answer: 'Support can take the queue around the clock and keep the tone steady. A person still takes over when the guest asks, or when a check needs a person.',
      blurb: 'The queue, then a person',
    },
    {
      flowName: 'Accounts',
      choice: 'Accounts',
      phrases: ['account', 'login', 'sign in', 'password', 'reset password', 'locked out'],
      question: 'How do accounts and login work?',
      answer: 'I can help with a login, a password reset, or a locked account. I never ask for the password in this chat. If a reset needs a person, I pass it on.',
      blurb: 'Login, password, locked out',
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
      flowName: 'Onboarding',
      choice: 'Get started',
      phrases: ['onboarding', 'get started', 'setup', 'go live', 'implementation'],
      question: 'How do we get started?',
      answer: 'Onboarding is a short setup: connect the inbox, set the tone, then a first live week. I can note who should join the kickoff.',
      blurb: 'Setup, then a first live week',
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
      flowName: 'Pricing',
      choice: 'Pricing',
      phrases: ['pricing', 'how much', 'cost', 'plan', 'quote'],
      question: 'What does it cost?',
      answer: 'Pricing follows the volume of conversations and which checks you turn on. I can note a quote request for the team.',
      blurb: 'Volume, then a quote',
    },
    {
      flowName: 'Status',
      choice: 'Status',
      phrases: ['status', 'outage', 'incident', 'downtime', 'is it down'],
      question: 'Is there an outage?',
      answer: 'I can check whether anything is degraded. If you are seeing an error, tell me what you clicked and I will note it for the team.',
      blurb: 'Incidents and downtime',
    },
    {
      flowName: 'API',
      choice: 'API',
      phrases: ['api', 'developer', 'docs', 'webhook', 'sdk'],
      question: 'Is there an API?',
      answer: 'There is an API and webhooks for the inbox, the customer record, and events. I can note which endpoint you need, and a person can share the docs.',
      blurb: 'Docs, webhooks, events',
    },
    {
      flowName: 'Book a demo',
      choice: 'A demo',
      phrases: ['demo', 'book a demo', 'schedule', 'request demo', 'roi'],
      question: 'How do I book a demo?',
      answer: 'I can ask sales to follow up. One email, then a person from the team continues.',
      blurb: 'Email, then sales',
      walk: 'email',
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
      phrases: ['marketing', 'leads', 'campaign', 'attract', 'convert', 'forms', 'landing page'],
      question: 'How does marketing work?',
      answer: `${name} helps the team attract the right leads, run campaigns, and see what converted. Forms, landing pages, and email sit on the same customer record.`,
      blurb: 'Leads, campaigns, forms',
    },
    {
      flowName: 'Sales',
      choice: 'Sales',
      phrases: ['sales', 'pipeline', 'deals', 'prospect', 'opportunity'],
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
      flowName: 'Contacts',
      choice: 'Contacts',
      phrases: ['contact', 'contacts', 'company record', 'customer record', 'crm record'],
      question: 'Where do contacts live?',
      answer: 'People and companies share one record. Activity from marketing, sales, and service lands on it, so the next person sees the same history.',
      blurb: 'People, companies, one record',
    },
    {
      flowName: 'Meetings',
      choice: 'Meetings',
      phrases: ['meeting', 'meetings', 'calendar', 'book a meeting', 'availability'],
      question: 'How do meetings work?',
      answer: 'You can share an availability link and book a meeting onto the same record. I can note a time, and the team confirms it.',
      blurb: 'Availability, then a booking',
    },
    {
      flowName: 'Tickets',
      choice: 'Tickets',
      phrases: ['ticket', 'tickets', 'case', 'open a ticket'],
      question: 'How do tickets work?',
      answer: 'A ticket keeps the question, the customer, and the next step together. I can note a new ticket, or find an open one if you have the number.',
      blurb: 'Open, find, and follow a case',
    },
    {
      flowName: 'Reporting',
      choice: 'Reporting',
      phrases: ['report', 'reporting', 'dashboard', 'analytics', 'pipeline report'],
      question: 'What can I see in reports?',
      answer: 'Dashboards cover pipeline, campaign results, and ticket health. Tell me which view you need and I will point you to it, or note a custom report for the team.',
      blurb: 'Pipeline, campaigns, tickets',
    },
    {
      flowName: 'Integrations',
      choice: 'Integrations',
      phrases: ['integration', 'connect', 'gmail', 'outlook', 'slack', 'zapier'],
      question: 'What does it connect to?',
      answer: 'Mail, calendar, ads, and chat tools can sit on the same record. Tell me which tool you use and I will note it for the team.',
      blurb: 'Mail, calendar, ads, chat',
    },
    {
      flowName: 'Plans and pricing',
      choice: 'Plans',
      phrases: ['pricing', 'plans', 'free', 'starter', 'cost', 'professional', 'enterprise', 'how much'],
      question: 'Which plan are you asking about?',
      answer: planSummary(CRM_PLAN_TIERS),
      blurb: 'Free, Starter, Professional, Enterprise',
      walk: 'plans',
      choices: planChoices(CRM_PLAN_TIERS),
    },
    {
      flowName: 'Billing',
      choice: 'Billing',
      phrases: ['billing', 'invoice', 'receipt', 'card', 'payment method', 'subscription'],
      question: 'How does billing work?',
      answer: 'Billing is monthly or yearly on the workspace. I can explain the invoice, a card update, or a plan change. I never ask for a full card number in this chat.',
      blurb: 'Invoices and the workspace plan',
    },
    {
      flowName: 'Login',
      choice: 'Login',
      phrases: ['login', 'sign in', 'password', 'two factor', '2fa', 'sso'],
      question: 'How do I sign in?',
      answer: 'Sign in with email, SSO, or two-factor. I can help with a reset. I never ask for the password in this chat.',
      blurb: 'Password, SSO, two-factor',
    },
    {
      flowName: 'Book a demo',
      choice: 'A demo',
      phrases: ['demo', 'book a demo', 'get a demo', 'talk to sales'],
      question: 'How do I book a demo?',
      answer: 'I can ask sales to follow up. One email, then a person from the team continues.',
      blurb: 'Email, then sales',
      walk: 'email',
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
      phrases: ['inbox', 'mail', 'messages', 'catch up', 'unread'],
      question: 'How does the inbox work?',
      answer: 'The inbox is for reading and catching up. Unread sits at the top. Long threads can be summarised so you see the point without scrolling the whole history.',
      blurb: 'Unread, catch up, summaries',
    },
    {
      flowName: 'Compose',
      choice: 'Compose',
      phrases: ['compose', 'write', 'reply', 'draft', 'send', 'undo send'],
      question: 'How do I write a message?',
      answer: 'Compose a new message or reply in the thread. Undo send gives you a few seconds to pull it back. Suggested replies are a starting point — you send the line in your own words.',
      blurb: 'Write, reply, undo send',
    },
    {
      flowName: 'Search',
      choice: 'Search',
      phrases: ['search', 'find', 'look up', 'where is the email'],
      question: 'How do I find a message?',
      answer: 'Search in your own words. I can look for a person, a subject, a date, or a detail in the thread and point you to it.',
      blurb: 'Person, subject, or a detail',
    },
    {
      flowName: 'Labels',
      choice: 'Labels',
      phrases: ['label', 'labels', 'folder', 'folders', 'star', 'important'],
      question: 'How do labels work?',
      answer: 'Labels group mail without moving it out of the inbox. Star or mark important for the things you want back. I can explain how to file a thread.',
      blurb: 'File a thread without losing it',
    },
    {
      flowName: 'Filters',
      choice: 'Filters',
      phrases: ['filter', 'filters', 'rules', 'auto file', 'skip the inbox'],
      question: 'Can I file mail automatically?',
      answer: 'Filters can label, archive, or forward mail as it arrives. Tell me the from-address and what you want done, and I will note the rule.',
      blurb: 'Rules as mail arrives',
    },
    {
      flowName: 'Attachments',
      choice: 'Attachments',
      phrases: ['attachment', 'attachments', 'file', 'drive', 'pdf'],
      question: 'How do attachments work?',
      answer: 'You can attach a file or link a doc from the same account. Large files stay as a link. I never ask you to paste a password to open one.',
      blurb: 'Files and linked docs',
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
      flowName: 'Storage',
      choice: 'Storage',
      phrases: ['storage', 'quota', 'mailbox full', 'space', 'how much space'],
      question: 'How much space do I have?',
      answer: 'Mail, files, and photos share the same storage. If the mailbox is full, delete large attachments or empty spam. I can explain how to see what is using space.',
      blurb: 'Quota and a full mailbox',
    },
    {
      flowName: 'Mobile',
      choice: 'Mobile',
      phrases: ['mobile', 'phone', 'app', 'offline', 'notifications'],
      question: 'Does it work on a phone?',
      answer: 'The phone app can read, send, and search, including some mail offline. Notifications follow the same inbox. I can help with a missing notification.',
      blurb: 'Phone app and offline',
    },
    {
      flowName: 'Privacy',
      choice: 'Privacy',
      phrases: ['privacy', 'ads', 'scan my mail', 'who can read'],
      question: 'Who can read my mail?',
      answer: 'This product does not use the contents of your mail to sell ads. I never ask you to paste a message that should stay private.',
      blurb: 'Mail is not used to sell ads',
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
      menu: 'I can help with what we do, support, accounts, payments, safety, onboarding, integrations, pricing, status, the API, a demo, or a person on the team.',
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
      menu: 'I can help with marketing, sales, service, contacts, meetings, tickets, reporting, integrations, plans, billing, login, a demo, or a person on the team.',
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
      menu: 'I can help with the inbox, compose, search, labels, filters, attachments, security, chat, storage, mobile, privacy, or a person on the team.',
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
      doors: pack.intents.map((intent) => ({
        title: intent.name,
        flowName: intent.name,
        blurb: intent.responses[0]?.text ?? intent.description,
      })),
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
      }))),
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
