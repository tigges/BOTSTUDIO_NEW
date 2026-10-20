/**
 * What each test run says and what it expects back. Fixed scenarios are the
 * regression set; generated visitors add variety. Harbour Dental lines are
 * checked against the blueprint offline in scenarios.test.ts, so a blueprint
 * change that breaks one fails CI before it fails a scheduled run.
 */

import type { HandoverPriority, ReturnOutcome } from '@ybot/shared'

export interface Visitor {
  first: string
  last: string
  phone: string
}

export interface ToolStep {
  tool: string
  /** `$firstSlot` in a value is replaced by the first slot an earlier step returned. */
  args: Record<string, unknown>
  /** `sources`: ok, and every passage names the document it came from. */
  expect: 'ok' | 'empty' | 'error' | 'sources'
}

/** What the person in the Inbox does once the chat reaches them. */
export interface PersonScript {
  claim: boolean
  tools?: ToolStep[]
  replies: string[]
  /** The visitor's answers to the person, sent through the widget while the person holds the chat. */
  visitorReplies?: string[]
  /** Missing: the person keeps the chat open. */
  returnAs?: ReturnOutcome
  note?: string
  /** After `needs_bot`: the visitor carries on with the bot. */
  thenVisitor?: string[]
  thenSays?: string[]
}

export interface ScenarioExpect {
  ends?: 'handed_over' | 'bot'
  source?: 'journey' | 'always_human' | 'guardrail'
  priority?: HandoverPriority
  says?: string[]
  neverSays?: string[]
  /** Behaviour rather than wording, for bots people edit in the console: what the reply must contain. */
  mentions?: Array<{ what: string; pattern: RegExp }>
  /** The bot raised a ticket for reception. */
  ticket?: boolean
  /** At least one model call was billed to the chat. */
  usesModel?: boolean
}

export interface Scenario {
  id: string
  title: string
  visitor: (who: Visitor) => string[]
  expect: ScenarioExpect
  person?: PersonScript
  csat?: 1 | -1
  /** A stable session, so the same contact comes back run after run. */
  returning?: boolean
}

export interface GeneratedVisitor {
  persona: string
  goal: string
}

export interface TargetPlan {
  scenarios: Scenario[]
  generated: GeneratedVisitor[]
  /** Run the Inbox person script; off for workspaces the runner does not sign in to as a person. */
  inbox: boolean
  /** Personal details the scenarios type. No model call in a run chat may carry them in plain text. */
  sentinels: string[]
}

const VISITORS: Visitor[] = [
  { first: 'Sophie', last: 'Allen', phone: '07700 900101' },
  { first: 'Grace', last: 'Liu', phone: '07700 900103' },
  { first: 'Daniel', last: 'Brooks', phone: '07700 900106' },
  { first: 'Ana', last: 'Costa', phone: '07700 900107' },
  { first: 'Kwame', last: 'Mensah', phone: '07700 900108' },
  { first: 'Isla', last: 'Murray', phone: '07700 900109' },
  { first: 'Ravi', last: 'Kumar', phone: '07700 900110' },
  { first: 'Freya', last: 'Hughes', phone: '07700 900111' },
]

/** Synthetic contact details typed into chats that reach a model. */
export const PII = { phone: '07700 900123', email: 'grace.liu@example.com', acmeEmail: 'sam.patel@example.com' }

/** A small seeded generator, so the same seed picks the same visitors and personas. */
export function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

export function pickVisitor(random: () => number): Visitor {
  return VISITORS[Math.floor(random() * VISITORS.length)]!
}

export function pick<T>(items: T[], count: number, random: () => number): T[] {
  const pool = [...items]
  const out: T[] = []
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!)
  return out
}

const NEXT_WEEKDAY = (from = new Date()): string => {
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1))
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1)
  return day.toISOString().slice(0, 10)
}

const NEXT_SUNDAY = (from = new Date()): string => {
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1))
  while (day.getUTCDay() !== 0) day.setUTCDate(day.getUTCDate() + 1)
  return day.toISOString().slice(0, 10)
}

export function dentalScenarios(now = new Date()): Scenario[] {
  return [
    {
      id: 'check-up-booking',
      title: 'Books a check-up after saying hi',
      visitor: (v) => ['hi', 'I need a check-up', 'Tuesday morning', `${v.first} ${v.last}`, v.phone],
      expect: { ends: 'bot', says: ['Reception will call you'], neverSays: ["didn't catch"], ticket: true },
      csat: 1,
    },
    {
      id: 'new-patient',
      title: 'New patient says thanks mid-question, then books',
      visitor: (v) => ['Are you taking new patients?', 'thanks!', 'yes please', 'Thursday afternoon', `${v.first} ${v.last}`, v.phone],
      expect: { ends: 'bot', says: ['£85', "You're welcome", 'Reception will call you'], neverSays: ["didn't catch"], ticket: true },
    },
    {
      id: 'hygiene-hello',
      title: 'Says hello while the bot waits for a time',
      visitor: (v) => ['I would like to book a hygiene clean', 'hello', 'next Monday after 3', `${v.first} ${v.last}`, v.phone],
      expect: { ends: 'bot', says: ['Hi! Which days and times usually suit you?'], neverSays: ["didn't catch"], ticket: true },
    },
    {
      id: 'knocked-out',
      title: 'Knocked-out tooth: critical handover, reception books an emergency slot',
      visitor: () => ['My son knocked his front tooth out playing football', 'yes, the tooth came out completely'],
      expect: { ends: 'handed_over', source: 'journey', priority: 'critical', says: ['999'] },
      person: {
        claim: true,
        tools: [
          { tool: 'Find free appointment slots', args: { visit_type: 'emergency', date: NEXT_SUNDAY(now) }, expect: 'empty' },
          { tool: 'Find free appointment slots', args: { visit_type: 'emergency', date: NEXT_WEEKDAY(now) }, expect: 'ok' },
          { tool: 'Hold an appointment', args: { slot_id: '$firstSlot', patient_name: '{visitor}', phone: '{phone}' }, expect: 'ok' },
          { tool: 'Hold an appointment', args: { slot_id: '$firstSlot', patient_name: 'Someone Else', phone: '07700 900999' }, expect: 'error' },
        ],
        replies: ["Hi, it's reception at Harbour Dental. Keep the tooth in a glass of milk and come straight in. I've held the first emergency slot for your son."],
        visitorReplies: ['Thank you so much, we are on our way'],
        returnAs: 'resolved',
        note: 'Emergency slot held for the patient.',
      },
      csat: 1,
    },
    {
      id: 'nervous',
      title: 'Nervous patient asks for a person and gets a follow-up call',
      visitor: () => ["I'm really nervous about the dentist, can I talk to someone first?"],
      expect: { ends: 'handed_over', source: 'journey' },
      person: {
        claim: true,
        tools: [{ tool: 'Search the patient guide', args: { query: 'What happens at the first visit for a new patient?' }, expect: 'sources' }],
        replies: ['Lots of our patients feel the same. Dr Patel offers a 20-minute chat with no treatment, just to meet. Would a call tomorrow help?'],
        visitorReplies: ['Yes, a call tomorrow after 5 would be great'],
        returnAs: 'needs_follow_up',
        note: 'Dr Patel to call tomorrow after 5pm.',
      },
    },
    {
      id: 'crown-back-to-bot',
      title: 'Crown quote: reception answers, then hands back to the bot',
      visitor: () => ['Can I speak to someone about a quote for a crown?'],
      expect: { ends: 'handed_over', source: 'journey' },
      person: {
        claim: true,
        tools: [{ tool: 'Estimate monthly finance', args: { price: 680, months: 6 }, expect: 'ok' }],
        replies: ['Crowns start from £680. Finance starts at £1,000, so a single crown is paid on the day. Anything else the assistant can help with?'],
        returnAs: 'needs_bot',
        thenVisitor: ['What time do you open on Saturday?'],
        thenSays: ['Saturday'],
      },
    },
    {
      id: 'complaint',
      title: 'An always-human word skips the bot',
      visitor: () => ['I want to make a complaint'],
      expect: { ends: 'handed_over', source: 'always_human', priority: 'high' },
      person: {
        claim: true,
        replies: ["I'm sorry to hear that. I'm the practice manager. Could you tell me what happened?"],
        visitorReplies: ['I waited 40 minutes past my appointment time last week'],
        returnAs: 'needs_follow_up',
        note: 'Practice manager to call about the waiting time.',
      },
    },
    {
      id: 'swelling-waits',
      title: 'Swelling goes to the team and waits in the queue',
      visitor: () => ['hello', 'My face is swelling on one side and my tooth really hurts'],
      expect: { ends: 'handed_over', source: 'always_human' },
    },
    {
      id: 'aligner-prices',
      title: 'Aligner price and finance from the price list',
      visitor: () => ['How much are clear aligners?', 'Can I pay monthly?', 'no thanks'],
      expect: { ends: 'bot', says: ['£2,950', '0% finance'] },
      csat: 1,
    },
    {
      id: 'bot-question',
      title: 'Asks if it is a bot, then a price, then rates it down',
      visitor: () => ['are you a bot?', 'How much is teeth whitening?', 'no thanks'],
      expect: { ends: 'bot', says: ['virtual assistant', '£395'] },
      csat: -1,
    },
    {
      id: 'care-plans',
      title: 'Care plans, then a follow-up question the model answers',
      visitor: () => ['Do you have a monthly care plan?', `Which plan has two hygiene visits a year? You can reach me on ${PII.phone} or ${PII.email}`],
      expect: { says: ['£10.50'], usesModel: true },
    },
    {
      id: 'cancel',
      title: 'Cancels an appointment for reception',
      visitor: (v) => ['I need to cancel my appointment on Friday', `${v.first} ${v.last}`, 'Friday 2pm', 'cancel it'],
      expect: { ends: 'bot', says: ["passed this to reception"], ticket: true },
    },
    {
      id: 'saturday-hours',
      title: 'Saturday opening hours',
      visitor: () => ['What time do you open on Saturday?', 'no thanks'],
      expect: { ends: 'bot', says: ['Saturday 8am to 1pm'] },
    },
    {
      id: 'implant',
      title: 'What an implant involves',
      visitor: () => ['What does getting an implant involve?', 'no thanks'],
      expect: { ends: 'bot', says: ['titanium post', '£2,650'] },
    },
    {
      id: 'medical-details',
      title: 'Medical details in chat are kept out of the record',
      visitor: () => ['I am on blood thinners, can I still have a tooth out?'],
      expect: { neverSays: ['blood thinners'] },
    },
    {
      id: 'returning-patient',
      title: 'The same patient comes back and books again',
      visitor: () => ['hi', 'I need a check-up', 'weekday mornings', 'Sophie Allen', '07700 900101'],
      expect: { ends: 'bot', says: ['Reception will call you'], ticket: true },
      returning: true,
    },
    {
      id: 'opened-only',
      title: 'Opens the chat and leaves',
      visitor: () => [],
      expect: {},
    },
  ]
}

export const DENTAL_VISITORS: GeneratedVisitor[] = [
  { persona: 'A retired teacher, polite and a little formal.', goal: 'Find out whether the practice makes dentures and roughly what they cost.' },
  { persona: 'A busy parent typing on a phone: short messages, the odd typo.', goal: 'Book check-ups for two children, after school if possible.' },
  { persona: 'A student watching every pound.', goal: 'Find the cheapest way to get a hygiene clean, and whether a care plan is worth it.' },
  { persona: 'Someone who chipped a front tooth at the weekend and is worried about how it looks.', goal: 'Get seen soon and learn whether bonding could fix it.' },
  { persona: 'A shift worker who can only come early or late.', goal: 'Find the earliest weekday opening time and whether Saturdays are open.' },
  { persona: 'Someone moving to Bristol next month.', goal: 'Register as a new patient and know what the first visit costs.' },
  { persona: 'A grandparent asking on behalf of a grandchild.', goal: 'Find out from what age children can be seen and whether it is free on a plan.' },
]

const UNDERSTOOD = ["didn't catch", 'something went wrong']
const TIME = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}:\d{2}\b/i
const PRICE = /[£$€]\s?\d+/

export function bellaScenarios(): Scenario[] {
  return [
    { id: 'colour', title: 'Colour booking', visitor: () => ['color', 'red full head'], expect: { neverSays: UNDERSTOOD, mentions: [{ what: 'a follow-up question', pattern: /\?/ }] } },
    { id: 'hours', title: 'Opening hours', visitor: () => ['What are your opening hours?'], expect: { neverSays: UNDERSTOOD, mentions: [{ what: 'opening times', pattern: TIME }] } },
    { id: 'cut-price', title: 'Cut price', visitor: () => ['how much is a haircut'], expect: { neverSays: UNDERSTOOD, mentions: [{ what: 'a price', pattern: PRICE }] } },
    { id: 'cancel', title: 'Cancel appointment', visitor: () => ['I need to cancel my appointment tomorrow.'], expect: { neverSays: [...UNDERSTOOD, 'What would you like done'], mentions: [{ what: 'the cancellation', pattern: /cancel/i }] } },
    { id: 'reschedule', title: 'Move an appointment', visitor: () => ['Can I move my appointment to Friday?'], expect: { neverSays: [...UNDERSTOOD, 'What would you like done'], mentions: [{ what: 'moving the appointment', pattern: /move|reschedul|change|new time|which/i }] } },
  ]
}

export function acmeScenarios(): Scenario[] {
  return [
    { id: 'order', title: 'Where is my order', visitor: () => ['Where is my order?', '1001'], expect: { neverSays: UNDERSTOOD, mentions: [{ what: 'the order status', pattern: /on its way|shipped|deliver|status/i }] } },
    { id: 'return', title: 'Damaged kettle return', visitor: () => ['The kettle in my order arrived cracked.'], expect: { neverSays: UNDERSTOOD, mentions: [{ what: 'the order or a return', pattern: /order|return|refund|replace/i }] } },
    { id: 'billing', title: 'Unrecognised seats on the invoice', visitor: () => [`Our last invoice has two seats I do not recognise. My email is ${PII.acmeEmail}`], expect: { neverSays: UNDERSTOOD, mentions: [{ what: 'the invoice', pattern: /invoice|charge|billing|account/i }] } },
    { id: 'hours', title: 'Opening hours', visitor: () => ['What are your opening hours?'], expect: { neverSays: UNDERSTOOD, mentions: [{ what: 'opening times', pattern: TIME }] } },
    { id: 'person', title: 'Asks for a person', visitor: () => ['I would like to talk to someone on the team.'], expect: { neverSays: ['something went wrong'], mentions: [{ what: 'the team', pattern: /team|person|agent|someone|human|colleague/i }] } },
  ]
}

export function planFor(target: 'harbour-dental' | 'bella' | 'acme', now = new Date()): TargetPlan {
  const sentinels = [PII.phone, PII.email, PII.acmeEmail, ...VISITORS.map((v) => v.phone)]
  if (target === 'harbour-dental') return { scenarios: dentalScenarios(now), generated: DENTAL_VISITORS, inbox: true, sentinels }
  if (target === 'bella') return { scenarios: bellaScenarios(), generated: [], inbox: false, sentinels }
  return { scenarios: acmeScenarios(), generated: [], inbox: false, sentinels }
}
