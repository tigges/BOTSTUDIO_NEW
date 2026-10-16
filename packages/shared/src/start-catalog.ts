/**
 * Start wizard: pick a cluster, then a template.
 * Hair vs corporate are templates inside clusters, not the first choice.
 * Crawled sites (cevro.ai, hubspot.com, gmail/workspace) sit here with brand names off.
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
  source?: { host: string; note: string }
}

export const START_CLUSTERS: StartCluster[] = [
  { id: 'hair', title: 'Hair & beauty', body: 'Studios like Bella. A greeting, then where you are, the hours, the prices, or a booking.' },
  { id: 'commerce', title: 'Commerce', body: 'Orders, shipping, returns, plans, and a person on the team.' },
  { id: 'software', title: 'Software vendors', body: 'Product, support, payments, safety, and a demo. Improved as more vendor sites are read.' },
  { id: 'crm', title: 'CRM & sales', body: 'Marketing, sales, service, plans, and a demo.' },
  { id: 'email', title: 'Email & inbox', body: 'Inbox, compose, search, and keeping mail safe.' },
  { id: 'custom', title: 'Custom', body: 'Scan a website, paste a conversation, or start from a blank welcome.' },
]

export const BAKED_TEMPLATES: StartTemplate[] = [
  {
    id: 'hair-studio',
    clusterId: 'hair',
    title: 'Hair studio',
    body: 'The same kind of conversation as Bella. A greeting, then a booking, a price, the hours, or where the studio is.',
    tag: 'Like Bella',
  },
  {
    id: 'corporate',
    clusterId: 'commerce',
    title: 'Corporate services',
    body: 'Orders, shipping, returns, plans and pricing, and a handoff to the team.',
    tag: 'Shop & support',
  },
  {
    id: 'product-support',
    clusterId: 'software',
    title: 'Software support',
    body: 'What the product does, support, payments and identity, safety, integrations, and a demo.',
    tag: 'From cevro.ai',
    source: { host: 'cevro.ai', note: 'Public crawl. Brand names and customer stories are left off.' },
  },
  {
    id: 'crm-platform',
    clusterId: 'crm',
    title: 'CRM platform',
    body: 'Marketing, sales, service, plans, and a demo — the usual doors on a customer platform.',
    tag: 'From hubspot.com',
    source: { host: 'hubspot.com', note: 'Public crawl. Product brand names are left off.' },
  },
  {
    id: 'inbox-assistant',
    clusterId: 'email',
    title: 'Inbox assistant',
    body: 'Inbox, compose, search, and security. The sign-in wall is left off; this is the public product map.',
    tag: 'From gmail.com',
    source: { host: 'gmail.com', note: 'Public about page. The signed-in inbox is not readable, so this is the public product journey.' },
  },
  {
    id: 'website',
    clusterId: 'custom',
    title: 'Scan my website',
    body: 'We read the public pages it links to, then draft a greeting that asks one thing at a time.',
    tag: 'Draft only',
  },
  {
    id: 'sample',
    clusterId: 'custom',
    title: 'An example conversation',
    body: 'Paste a chat. It becomes the welcome guests hear.',
    tag: 'Draft only',
  },
  {
    id: 'blank',
    clusterId: 'custom',
    title: 'A blank welcome',
    body: 'One empty chart. You write the first line in the editor.',
    tag: 'Editor',
  },
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

export function bakedPack(
  start: BotStart,
  companyName: string,
  personaName?: string | null,
): SiteTemplatePack | null {
  const company = companyLabel(companyName)
  if (start === 'product-support') {
    const topics = softwareTopics(company)
    return siteTemplatePack({
      id: 'product-support',
      tag: 'software',
      welcomeName: 'Product welcome',
      companyName: company,
      personaName,
      greeting: personaName?.trim() ? `Hi, I'm ${personaName.trim()} at ${company}. What's your name?` : assistantGreeting(company),
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
      personaName,
      greeting: personaName?.trim() ? `Hi, I'm ${personaName.trim()} at ${company}. What's your name?` : assistantGreeting(company),
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
      personaName,
      greeting: personaName?.trim() ? `Hi, I'm ${personaName.trim()} at ${company}. What's your name?` : assistantGreeting(company),
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
  const voice = input.personaName?.trim()
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
    const pack = hairStudioPack(company, input.personaName ?? undefined)
    const welcome = pack.flows.find((flow) => flow.name === SALON_WELCOME_NAME)
    return {
      greeting: voice ? `Hi, I'm ${voice} at ${company}. What's your name?` : `Hi, I'm Bella at ${company}. What's your name?`,
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
    const pack = corporateServicesPack(company)
    return {
      greeting: assistantGreeting(company),
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
  const pack = bakedPack(input.start, company, input.personaName)
  if (pack) return { greeting: pack.greeting, doors: pack.doors }
  return { greeting: assistantGreeting(company), doors: [] }
}
