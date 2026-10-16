/**
 * Corporate services starter pack.
 *
 * The web widget speaks the published flow. These answers are written into
 * the flow so a new company can reply to ordinary customer questions without
 * an order system or another website. Intents and FAQs keep the same wording
 * for the knowledge screens. Edit the flow message when the widget should
 * say something new. The wizard is how a company reshapes a flow later.
 */

import { assistantGreeting, greetingWelcomeGraph } from './greeting-welcome.js'
import { returnRequestFlow, starterFlows, supportUseCaseFlows, SUPPORT_USE_CASES, type StarterFlow } from './flow-templates.js'
import { hairStudioPack } from './salon-pack.js'

export const CORPORATE_PACK_ID = 'corporate-services'
export type StarterPackId = 'corporate-services' | 'hair-studio' | 'product-support' | 'crm-platform' | 'inbox-assistant'
export const CORPORATE_WELCOME_NAME = 'Welcome & Routing'
export const CORPORATE_WELCOME_DRAFT = 'Corporate welcome'

export interface CorporateIntent {
  name: string
  description: string
  utterances: string[]
  responses: Array<{ text: string }>
}

export interface CorporateFaq {
  question: string
  answer: string
  tags: string[]
}

interface Topic {
  flowName: string
  choice: string
  phrases: string[]
  question: string
  answer: string
  /** answer = the flow says this and stops. task = the flow collects the rest. */
  kind: 'answer' | 'task'
}

export interface CorporatePack {
  id: typeof CORPORATE_PACK_ID
  name: string
  description: string
  flows: StarterFlow[]
  intents: CorporateIntent[]
  faqs: CorporateFaq[]
}

export interface PlannedFlow extends StarterFlow {
  publish: boolean
}

export interface CorporateImportPlan {
  flows: PlannedFlow[]
  intents: CorporateIntent[]
  faqs: CorporateFaq[]
}

function companyLabel(companyName: string): string {
  const trimmed = companyName.trim()
  return trimmed || 'your company'
}

function handleFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function topicsFor(companyName: string): Topic[] {
  const company = companyLabel(companyName)
  const answers: Topic[] = [
    {
      flowName: 'Opening hours',
      choice: 'Opening hours',
      phrases: ['opening hours', 'business hours', 'when are you open', 'what time do you open', 'hours'],
      question: 'What are your opening hours?',
      answer: `${company} is here on weekdays, 09:00 to 18:00. You can message any time. I still answer outside those hours, and a person replies during them.`,
      kind: 'answer',
    },
    {
      flowName: 'Shipping',
      choice: 'Shipping',
      phrases: ['shipping', 'delivery time', 'how long does delivery', 'when will it arrive'],
      question: 'How long does shipping take?',
      answer: 'Standard delivery takes 3 to 5 business days after the order ships. Faster options are shown at checkout. International orders usually take 7 to 14 business days.',
      kind: 'answer',
    },
    {
      flowName: 'Returns policy',
      choice: 'Returns policy',
      phrases: ['return policy', 'refund policy', 'return window', 'how long can i return'],
      question: 'What is your return policy?',
      answer: 'Most items can be returned within 30 days if they are unused and in the original packaging. Say start a return and I will take the order number. Refunds go back to the original payment method.',
      kind: 'answer',
    },
    {
      flowName: 'Order tracking',
      choice: 'Track an order',
      phrases: ['where is my order', 'track my order', 'order tracking', 'tracking number', 'order status', 'track'],
      question: 'How do I track my order?',
      answer: 'Once an order ships, the tracking link is in the shipping email and under Orders in your account. If you do not have that email, say talk to a person and the team will look it up.',
      kind: 'answer',
    },
    {
      flowName: 'Payments',
      choice: 'Payments',
      phrases: ['payment', 'invoice', 'billing', 'charged', 'payment method'],
      question: 'What payment methods do you accept?',
      answer: 'Invoices are on the account billing page. Cards and the common wallets are accepted. Say talk to a person if a charge needs a person to look at it.',
      kind: 'answer',
    },
    {
      flowName: 'Password reset',
      choice: 'Password reset',
      phrases: ['password', 'log in', 'login', 'sign in', 'locked out', 'cannot log in'],
      question: 'How do I reset my password?',
      answer: `Reset your password from the ${company} sign-in page. Use the email on the account. I never ask for a password in this chat.`,
      kind: 'answer',
    },
    {
      flowName: 'Plans and pricing',
      choice: 'Plans and pricing',
      phrases: ['pricing', 'plans', 'free trial', 'subscription', 'change my plan', 'cancel my subscription'],
      question: 'How do I change my plan?',
      answer: 'Plans are listed on the pricing page. A trial, when one is offered, does not need a card. You can change or cancel a plan from the account billing page. The page shows when the change starts.',
      kind: 'answer',
    },
    {
      flowName: 'Contact the team',
      choice: 'Contact the team',
      phrases: ['contact', 'phone number', 'email address', 'how do i reach'],
      question: 'How do I contact you?',
      answer: `You can keep talking here. I answer the usual questions, and saying talk to a person passes this chat to the ${company} team.`,
      kind: 'answer',
    },
  ]
  const tasks: Topic[] = [
    {
      flowName: 'Cancel order',
      choice: 'Cancel an order',
      phrases: SUPPORT_USE_CASES.find((item) => item.name === 'Cancel order')?.phrases ?? ['cancel my order'],
      question: 'How do I cancel an order?',
      answer: 'I can cancel an order that has not shipped yet.',
      kind: 'task',
    },
    {
      flowName: 'Change address',
      choice: 'Change address',
      phrases: SUPPORT_USE_CASES.find((item) => item.name === 'Change address')?.phrases ?? ['change address'],
      question: 'How do I change my delivery address?',
      answer: 'I can update the delivery address before the order ships.',
      kind: 'task',
    },
    {
      flowName: 'Return Request',
      choice: 'Start a return',
      phrases: ['start a return', 'return an item', 'i want to return', 'send it back'],
      question: 'How do I start a return?',
      answer: 'I can help with returns. Our return window is 30 days from purchase.',
      kind: 'task',
    },
    {
      flowName: 'Talk to a person',
      choice: 'Talk to a person',
      phrases: SUPPORT_USE_CASES.find((item) => item.name === 'Talk to a person')?.phrases ?? ['talk to a person'],
      question: 'How do I talk to a person?',
      answer: 'I am passing this chat to the team. Someone will continue here.',
      kind: 'task',
    },
  ]
  return [...answers, ...tasks]
}

function answerFlow(topic: Topic): StarterFlow {
  const y = 120
  return {
    name: topic.flowName,
    description: 'Benchmark answer. Edit the message to match your business.',
    tags: ['corporate', 'template', 'faq'],
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

function taskFlow(topic: Topic): StarterFlow | undefined {
  if (topic.flowName === 'Return Request') {
    const flow = returnRequestFlow()
    return { ...flow, publish: true, tags: [...flow.tags, 'corporate', 'template'] }
  }
  const found = supportUseCaseFlows().find((flow) => flow.name === topic.flowName)
  if (!found) return undefined
  return { ...found, publish: true, tags: [...found.tags, 'corporate', 'template'] }
}

function welcomeFlow(companyName: string, topics: Topic[]): StarterFlow {
  const company = companyLabel(companyName)
  const routes = topics.map((topic) => ({
    handle: handleFor(topic.flowName),
    phrases: topic.phrases,
    flowName: topic.flowName,
  }))
  return {
    name: CORPORATE_WELCOME_NAME,
    description: `Greets visitors and answers the usual customer questions for ${company}`,
    tags: ['welcome', 'routing', 'corporate'],
    publish: true,
    graph: greetingWelcomeGraph({
      greeting: assistantGreeting(company),
      followUp: 'Hi {{contact.name}}. What do you need help with?',
      routes,
      menu: 'I can help with opening hours, shipping, a return, order tracking, payments, a password, plans, or a person on the team. Tell me which one you need.',
      choices: topics.map((topic) => topic.choice),
    }),
  }
}

export function corporateServicesPack(companyName: string): CorporatePack {
  const topics = topicsFor(companyName)
  const flows: StarterFlow[] = [welcomeFlow(companyName, topics)]
  for (const topic of topics) {
    if (topic.kind === 'answer') flows.push(answerFlow(topic))
    else {
      const task = taskFlow(topic)
      if (task) flows.push(task)
    }
  }
  return {
    id: CORPORATE_PACK_ID,
    name: 'Corporate services',
    description: 'Benchmark flows, intents, and FAQs for a web widget that answers ordinary customer questions.',
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
      tags: ['corporate', handleFor(topic.flowName)],
    })),
  }
}

/** Tag and intent names a remove uses. Flows and FAQs carry the tag. Intents match by name. */
export function starterPackScope(pack: StarterPackId): { tag: string; intentNames: string[] } {
  if (pack === 'hair-studio') {
    return { tag: 'salon', intentNames: hairStudioPack('studio').intents.map((intent) => intent.name) }
  }
  if (pack === 'corporate-services') {
    return { tag: 'corporate', intentNames: corporateServicesPack('company').intents.map((intent) => intent.name) }
  }
  const tag = pack === 'crm-platform' ? 'crm' : pack === 'inbox-assistant' ? 'inbox' : 'software'
  return { tag, intentNames: [] }
}

export function selectPackRemoval<TFlow extends { id: string; tags: string[] }, TIntent extends { id: string; name: string }, TFaq extends { id: string; tags: string[] }>(
  scope: { tag: string; intentNames: string[] },
  records: { flows: TFlow[]; intents: TIntent[]; faqs: TFaq[] },
): { flows: TFlow[]; intents: TIntent[]; faqs: TFaq[] } {
  const names = new Set(scope.intentNames)
  return {
    flows: records.flows.filter((flow) => flow.tags.includes(scope.tag)),
    intents: records.intents.filter((intent) => names.has(intent.name)),
    faqs: records.faqs.filter((faq) => faq.tags.includes(scope.tag)),
  }
}

/** Templates shown when someone starts one flow. Corporate answers come first, then the salon, then vendor maps. */
export function flowCatalog(companyName: string): StarterFlow[] {
  const pack = [...corporateServicesPack(companyName).flows, ...hairStudioPack(companyName).flows]
  const seen = new Set<string>()
  const flows: StarterFlow[] = []
  for (const flow of pack) {
    if (seen.has(flow.name)) continue
    seen.add(flow.name)
    flows.push(flow)
  }
  return [...flows, ...starterFlows(companyName).filter((flow) => !seen.has(flow.name))]
}

/**
 * What an import should add. Existing names stay as they are.
 * A published welcome stays the widget entry. The benchmark greeting
 * is saved as a draft named Corporate welcome.
 */
export function planCorporateImport(input: {
  companyName: string
  existingFlowNames: string[]
  existingIntentNames: string[]
  existingQuestions: string[]
  publishedWelcome: boolean
}): CorporateImportPlan {
  const pack = corporateServicesPack(input.companyName)
  const existing = new Set(input.existingFlowNames)
  const flows: PlannedFlow[] = []
  const welcome = pack.flows.find((flow) => flow.name === CORPORATE_WELCOME_NAME)
  for (const flow of pack.flows) {
    if (flow.name === CORPORATE_WELCOME_NAME) continue
    if (existing.has(flow.name)) continue
    flows.push({ ...flow, publish: true })
  }
  if (welcome && !input.publishedWelcome && !existing.has(CORPORATE_WELCOME_NAME)) {
    flows.unshift({ ...welcome, publish: true })
  } else if (welcome && !existing.has(CORPORATE_WELCOME_DRAFT) && (input.publishedWelcome || existing.has(CORPORATE_WELCOME_NAME))) {
    flows.push({
      ...welcome,
      name: CORPORATE_WELCOME_DRAFT,
      description: 'Benchmark greeting. Publish it in Sandbox when you want the widget to use it. Your current welcome stays until then.',
      publish: false,
    })
  }
  const intentNames = new Set(input.existingIntentNames)
  const questions = new Set(input.existingQuestions)
  return {
    flows,
    intents: pack.intents.filter((intent) => !intentNames.has(intent.name)),
    faqs: pack.faqs.filter((faq) => !questions.has(faq.question)),
  }
}
