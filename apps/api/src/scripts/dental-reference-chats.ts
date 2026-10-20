/**
 * The Harbour Dental reference bot's sample patients. Each guest line is played
 * through the blueprint's own chapters, so every bot line in the Inbox is what
 * the published journey says. People's replies after a handover are written here.
 */

import { DEFAULT_PRIVACY, DENTAL_BLUEPRINT, type BusinessProfile, type ReturnOutcome, type StudioCatalog } from '@ybot/shared'
import type { FlowGraph } from '@ybot/runtime'
import { runTestTurn, type TestChatDeps, type TestChatState } from '../lib/test-chat.js'

export interface ReferencePatient {
  id: string
  name: string
  email?: string
  phone?: string
  tags: string[]
  /** What the bot remembers for this patient's next chat. */
  memory?: Record<string, string>
}

export interface ReferenceChat {
  id: string
  patient: ReferencePatient
  /** Days before the seed ran, and the hour the guest wrote. */
  daysAgo: number
  hour: number
  guest: string[]
  /** A person answers after the handover. `guest` lines here are the patient's replies to them. */
  person?: Array<{ from: 'agent' | 'guest'; text: string }>
  /** How the person hands it back. Missing: the person still has the chat. */
  returned?: { outcome: ReturnOutcome; note?: string }
  /** The person has picked it up. Missing with no `returned`: it waits in the queue. */
  assigned?: boolean
  labels?: string[]
  /** The Inbox subject when the chat skipped the chapters (an always-human word). */
  subject?: string
  /** Thumbs from the patient after the chat. */
  csat?: 1 | -1
}

const patient = (id: string, name: string, tags: string[], extra: Partial<ReferencePatient> = {}): ReferencePatient => {
  const [first, last] = name.toLowerCase().split(' ')
  return { id, name, email: `${first}.${last}@example.com`, tags, ...extra }
}

export const REFERENCE_CHATS: ReferenceChat[] = [
  {
    id: 'hdref-chat-checkup',
    patient: patient('hdref-contact-sophie', 'Sophie Allen', ['patient'], { phone: '+44 7700 900101', memory: { visit_type: 'check-up', preferred_day: 'Tuesday morning' } }),
    daysAgo: 13, hour: 9,
    guest: ['hi', 'I need a check-up', 'Tuesday morning', 'Sophie Allen', '07700 900101'],
    labels: ['Booking'], csat: 1,
  },
  {
    id: 'hdref-chat-aligners',
    patient: patient('hdref-contact-tom', 'Tom Reid', ['prospect', 'aligners'], { memory: { treatment: 'Clear aligners' } }),
    daysAgo: 12, hour: 20,
    guest: ['How much are clear aligners?', 'Can I pay monthly?', 'no thanks'],
    csat: 1,
  },
  {
    id: 'hdref-chat-knocked-out',
    patient: patient('hdref-contact-priya', 'Priya Shah', ['patient'], { phone: '+44 7700 900102' }),
    daysAgo: 11, hour: 10,
    guest: ['My son knocked his front tooth out playing football', 'yes, the tooth came out completely'],
    person: [
      { from: 'agent', text: "Hi Priya, it's Charles at Harbour Dental. Pop the tooth in a glass of milk and come straight in. We've kept the 11:30 emergency slot for your son." },
      { from: 'guest', text: 'Thank you so much, we are on our way' },
      { from: 'agent', text: "See you shortly. Ask for Dr Okafor at reception." },
    ],
    returned: { outcome: 'resolved', note: 'Seen at 11:30. Tooth re-implanted, review in 2 weeks.' },
    assigned: true,
    labels: ['Emergency'], csat: 1,
  },
  {
    id: 'hdref-chat-saturday',
    patient: patient('hdref-contact-mark', 'Mark Evans', ['patient']),
    daysAgo: 10, hour: 18,
    guest: ['What time do you open on Saturday?', 'no thanks'],
  },
  {
    id: 'hdref-chat-new-patient',
    patient: patient('hdref-contact-grace', 'Grace Liu', ['new patient'], { phone: '+44 7700 900103', memory: { new_patient: 'yes' } }),
    daysAgo: 9, hour: 12,
    guest: ['Are you taking new patients?', 'yes please', 'Thursday afternoon', 'Grace Liu', '07700 900103'],
    labels: ['New patient', 'Booking'], csat: 1,
  },
  {
    id: 'hdref-chat-cancel',
    patient: patient('hdref-contact-daniel', 'Daniel Brooks', ['patient']),
    daysAgo: 8, hour: 8,
    guest: ['I need to cancel my appointment on Friday', 'Daniel Brooks', 'Friday 2pm', 'cancel it'],
  },
  {
    id: 'hdref-chat-nervous',
    patient: patient('hdref-contact-hannah', 'Hannah Wright', ['prospect', 'anxious']),
    daysAgo: 6, hour: 19,
    guest: ["I'm really nervous about the dentist, can I talk to someone first?"],
    person: [
      { from: 'agent', text: "Hi Hannah, I'm Charles from the front desk. Lots of our patients feel the same. Dr Patel offers a 20-minute chat with no treatment, just to meet. Would a call tomorrow help?" },
      { from: 'guest', text: 'Yes, a call tomorrow after 5 would be great' },
      { from: 'agent', text: "Done. Dr Patel will ring you tomorrow after 5pm. I've noted that you'd like to go slowly." },
    ],
    returned: { outcome: 'needs_follow_up', note: 'Dr Patel to call tomorrow after 5pm. Nervous patient, wants an intro chat before any treatment.' },
    assigned: true,
    labels: ['New patient'],
  },
  {
    id: 'hdref-chat-bot-question',
    patient: patient('hdref-contact-olivia', 'Olivia Green', ['prospect']),
    daysAgo: 5, hour: 13,
    guest: ['are you a bot?', 'How much is teeth whitening?', 'no thanks'],
    csat: -1,
  },
  {
    id: 'hdref-chat-plans',
    patient: patient('hdref-contact-james', 'James Cole', ['prospect']),
    daysAgo: 3, hour: 21,
    guest: ['Do you have a monthly care plan?'],
  },
  {
    id: 'hdref-chat-implant',
    patient: patient('hdref-contact-ravi', 'Ravi Kumar', ['prospect', 'implants']),
    daysAgo: 4, hour: 11,
    guest: ['What does getting an implant involve?', 'no thanks'],
  },
  {
    id: 'hdref-chat-hours',
    patient: patient('hdref-contact-ella', 'Ella Morris', ['patient']),
    daysAgo: 2, hour: 7,
    guest: ['Where are you and is there parking?', 'thank you', 'no thanks'],
    csat: 1,
  },
  {
    id: 'hdref-chat-opened',
    patient: patient('hdref-contact-visitor', 'Website visitor', ['visitor']),
    daysAgo: 1, hour: 22,
    guest: [],
  },
  {
    id: 'hdref-chat-swelling',
    patient: patient('hdref-contact-ben', 'Ben Taylor', ['patient'], { phone: '+44 7700 900104' }),
    daysAgo: 0, hour: -2,
    guest: ['hello', 'My face is swelling on one side and my tooth really hurts'],
    subject: 'Swelling and toothache',
    labels: ['Emergency'],
  },
  {
    id: 'hdref-chat-crown',
    patient: patient('hdref-contact-amira', 'Amira Hassan', ['patient'], { phone: '+44 7700 900105' }),
    daysAgo: 0, hour: -1,
    guest: ['Can I speak to someone about a quote for a crown?'],
    person: [
      { from: 'agent', text: "Hi Amira, it's Charles. I'm pulling up Dr Okafor's notes from your last visit now." },
    ],
    assigned: true,
  },
]

export interface PlayedLine {
  role: 'guest' | 'bot'
  text: string
  chapter?: string
}

export interface PlayedChat {
  lines: PlayedLine[]
  state: TestChatState
}

/** The blueprint as it compiles for this profile, with a model that never answers: chapters decide every line. */
export function referenceJourney(profile: BusinessProfile) {
  const bundle = DENTAL_BLUEPRINT.bundle(profile)
  const chapters = bundle.flows.map((flow) => ({ name: flow.name, graph: flow.graph as unknown as FlowGraph }))
  const deps = quietDeps(bundle.catalog, bundle.alwaysHuman, bundle.guardrails.rules)
  return { bundle, chapters, deps }
}

function quietDeps(catalog: StudioCatalog, alwaysHuman: string[], rules: unknown[]): Partial<TestChatDeps> {
  const model = {
    classify: async () => ({ category: 'other', confidence: 0 }),
    embed: async () => ({ embeddings: [[]] }),
    complete: async () => ({ content: '' }),
    stream: async () => {},
  }
  return {
    handoverRules: async () => ({ liveAgents: true, alwaysHuman }),
    answer: async () => {},
    llm: async () => model as never,
    catalog: async () => catalog,
    db: {},
    safety: async () => ({ rules: rules as never, privacy: DEFAULT_PRIVACY }),
  }
}

export async function playReferenceChat(
  chat: ReferenceChat,
  journey: ReturnType<typeof referenceJourney>,
  ids: { tenantId: string; botId: string },
  now: Date,
): Promise<PlayedChat> {
  const base = {
    tenantId: ids.tenantId,
    botId: ids.botId,
    chapters: journey.chapters,
    startChapter: journey.chapters[0]!.name,
    environmentLabel: 'Production',
    catalog: journey.bundle.catalog,
  }
  const deps = { ...journey.deps, now: () => now }
  const lines: PlayedLine[] = []
  let turn = await runTestTurn({ ...base, message: '', opening: true }, deps)
  if (turn.text.trim()) lines.push({ role: 'bot', text: turn.text, chapter: turn.chapter })
  for (const text of chat.guest) {
    if (turn.state.status === 'escalated') break
    lines.push({ role: 'guest', text })
    turn = await runTestTurn({ ...base, message: text, state: turn.state }, deps)
    if (turn.text.trim()) lines.push({ role: 'bot', text: turn.text, chapter: turn.chapter })
  }
  return { lines, state: turn.state }
}
