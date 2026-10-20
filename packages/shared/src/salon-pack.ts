/**
 * Hair studio starter pack.
 *
 * Same idea as the corporate pack: the widget speaks the published flow.
 * The prices, hours, and address match the Bella Hair Studio page, so a
 * salon can answer from the first minute and then edit the lines.
 */

import { bookAppointmentFlow } from './booking-walk.js'
import type { CatalogFact, StudioCatalog } from './catalog.js'
import type { StarterFlow } from './flow-templates.js'

export const HAIR_STUDIO_PACK_ID = 'hair-studio'
export const SALON_WELCOME_NAME = 'Salon welcome'

export interface SalonIntent {
  name: string
  description: string
  utterances: string[]
  responses: Array<{ text: string }>
}

export interface SalonFaq {
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
  kind: 'answer' | 'task'
}

export interface SalonPack {
  id: typeof HAIR_STUDIO_PACK_ID
  name: string
  description: string
  flows: StarterFlow[]
  catalog: StudioCatalog
  intents: SalonIntent[]
  faqs: SalonFaq[]
}

export interface PlannedSalonFlow extends StarterFlow {
  publish: boolean
}

export interface SalonImportPlan {
  flows: PlannedSalonFlow[]
  intents: SalonIntent[]
  faqs: SalonFaq[]
}

function companyLabel(companyName: string): string {
  const trimmed = companyName.trim()
  return trimmed || 'the studio'
}

function handleFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function topicsFor(companyName: string): Topic[] {
  const company = companyLabel(companyName)
  return [
    {
      flowName: 'Reschedule',
      choice: 'Move an appointment',
      phrases: ['reschedule my appointment', 'move my appointment', 'change my appointment', 'change my booking', 'move my booking', 'reschedule'],
      question: 'How do I move an appointment?',
      answer: 'I can note a new time. The studio will confirm it in this chat.',
      kind: 'task',
    },
    {
      flowName: 'Consultation',
      choice: 'Book a consultation',
      phrases: ['book a consultation', 'free consultation', 'consultation'],
      question: 'How do I book a consultation?',
      answer: 'A consultation is free and takes about 15 minutes. The studio will confirm the exact time in this chat.',
      kind: 'task',
    },
    {
      flowName: 'Colour correction',
      choice: 'Colour correction',
      phrases: ['book a colour correction', 'colour correction', 'color correction', 'home dye', 'fix my colour', 'fix my color', 'colour gone wrong', 'color gone wrong'],
      question: 'Can you fix a home dye?',
      answer: 'Colour correction needs someone at the studio to see your hair before we plan it. I am passing this chat to the studio.',
      kind: 'task',
    },
    {
      flowName: 'Cancellation policy',
      choice: 'Cancellation policy',
      phrases: ['cancellation policy', 'late cancellation', 'how much notice', 'notice to cancel'],
      question: 'How much notice do you need to cancel?',
      answer: 'Tell the studio at least 24 hours before the appointment if you need to cancel or move it. The studio confirms the change in this chat.',
      kind: 'answer',
    },
    {
      flowName: 'Gift voucher',
      choice: 'Gift voucher',
      phrases: ['gift vouchers', 'gift voucher', 'gift card', 'voucher'],
      question: 'Do you sell gift vouchers?',
      answer: 'Gift vouchers are £25, £50, or £100, and they last 12 months. Share the name to print on it and the studio will email the voucher.',
      kind: 'answer',
    },
    {
      flowName: 'Patch test',
      choice: 'Patch test',
      phrases: ['patch test', 'allergy test', 'skin test'],
      question: 'Do I need a patch test?',
      answer: 'A colour appointment needs a patch test at least 48 hours before if you have not had one here recently. The studio will tell you if your booking needs one.',
      kind: 'answer',
    },
    {
      flowName: 'Running late',
      choice: 'Running late',
      phrases: ['running late', 'i am late', "i'm late"],
      question: 'What if I am running late?',
      answer: 'Tell us your name and how late you will be. The studio will hold the chair when the day allows.',
      kind: 'answer',
    },
    {
      flowName: 'Stylist',
      choice: 'Choose a stylist',
      phrases: ['request a stylist', 'same stylist', 'my stylist', 'who will do my hair', 'stylist'],
      question: 'Can I choose my stylist?',
      answer: 'Tell us the stylist you would like. The studio will check they are in, and will offer another stylist or another time if they are booked.',
      kind: 'answer',
    },
    {
      flowName: 'Book an appointment',
      choice: 'Book an appointment',
      phrases: ['book an appointment', 'book a haircut', 'book a cut', 'book a colour', 'book a color', 'book a balayage', 'book a keratin', 'book a treatment', 'book a skin scrub', 'make an appointment', 'to book', 'booking', 'book', 'appointment', 'go lighter', 'going lighter', 'lighter', 'highlights', 'balayage', 'box dye', 'henna', 'haircut', 'a cut', 'a colour', 'a color', 'keratin', 'skin scrub', 'not sure', 'first visit', 'first time'],
      question: 'How do I book an appointment?',
      answer: 'The studio will confirm the exact time in this chat.',
      kind: 'task',
    },
    {
      flowName: 'Cancel appointment',
      choice: 'Cancel an appointment',
      phrases: ['cancel my appointment', 'cancel my booking', 'cancel appointment', 'cancellation'],
      question: 'How do I cancel an appointment?',
      answer: 'I can note a cancellation. If the time is soon, the studio will confirm it in this chat.',
      kind: 'task',
    },
    {
      flowName: 'Salon hours',
      choice: 'Opening hours',
      phrases: ['opening hours', 'salon hours', 'when are you open', 'what time do you open', 'hours'],
      question: 'What are your opening hours?',
      answer: `${company} is open Monday to Saturday, 09:00 to 18:00. You can message any time. I still answer outside those hours, and the studio replies during them.`,
      kind: 'answer',
    },
    {
      flowName: 'Services and prices',
      choice: 'Services and prices',
      phrases: ['how much', 'how much is', 'how much are', 'how much does', 'prices', 'price list', 'the price', 'pricing', 'what does it cost', 'services', 'service', 'haircut', 'a cut', 'cut', 'trim'],
      question: 'How much is a haircut?',
      answer: `${company} cuts start from £35, colour from £70, treatments from £45, balayage from £90, a skin scrub from £200, and keratin smoothing from £120.`,
      kind: 'answer',
    },
    {
      flowName: 'Walk-ins',
      choice: 'Walk-ins',
      phrases: ['walk-in', 'walk in', 'walk-ins', 'walk ins'],
      question: 'Do you take walk-ins?',
      answer: 'Walk-ins are welcome when a chair is free. A booking is the sure way to keep a time.',
      kind: 'answer',
    },
    {
      flowName: 'Location',
      choice: 'Location',
      phrases: ['where are you', 'address', 'directions', 'where is the salon'],
      question: 'Where are you?',
      answer: `${company} is at 14 Rosewood Lane.`,
      kind: 'answer',
    },
    {
      flowName: 'Talk to the salon',
      choice: 'Talk to the salon',
      phrases: ['talk to the salon', 'speak to a person', 'talk to someone', 'real person', 'receptionist', 'allergic reaction', 'skin reaction', 'make a complaint', 'complaint', 'allergic', 'irritated scalp', 'burning scalp'],
      question: 'How do I talk to someone at the salon?',
      answer: 'I am passing this chat to the studio. Someone will continue here.',
      kind: 'task',
    },
  ]
}

function answerFlow(topic: Topic): StarterFlow {
  const y = 120
  return {
    name: topic.flowName,
    description: 'Benchmark answer for a hair studio. Edit the catalog if the fact changed.',
    tags: ['salon', 'template', 'faq'],
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

export function catalogLookupFlow(input: {
  name: string
  description: string
  kind?: string
  id?: string
  intro: string
  next: string
  doors: Array<{ handle: string; phrases: string[]; flowName: string }>
  tags?: string[]
  publish?: boolean
}): StarterFlow {
  const y = 80
  const lookConfig = { ...(input.kind ? { kind: input.kind } : {}), ...(input.id ? { id: input.id } : {}) }
  const nodes: object[] = [
    { id: 'start', type: 'flow-node', position: { x: 40, y }, data: { kind: 'trigger_start', label: input.name, config: {} } },
    { id: 'look', type: 'flow-node', position: { x: 280, y }, data: { kind: 'lookup_catalog', label: 'Look up', config: lookConfig } },
    { id: 'say', type: 'flow-node', position: { x: 560, y }, data: { kind: 'send_message', label: 'The fact', config: { text: '{{fact}}' } } },
    { id: 'ask', type: 'flow-node', position: { x: 820, y }, data: { kind: 'ask_question', label: 'Next', config: { question: input.next, variable: 'request' } } },
    { id: 'next', type: 'flow-node', position: { x: 1080, y }, data: { kind: 'route_topic', label: 'What next', config: { routes: input.doors.map((door) => ({ handle: door.handle, phrases: door.phrases })) } } },
    { id: 'which', type: 'flow-node', position: { x: 560, y: y + 200 }, data: { kind: 'ask_question', label: 'Which', config: { question: input.intro, variable: 'request' } } },
    { id: 'close', type: 'flow-node', position: { x: 1340, y: y + 240 }, data: { kind: 'send_message', label: 'Close', config: { text: 'I can help with hours, prices, or a booking. What would you like?' } } },
    { id: 'end', type: 'flow-node', position: { x: 1600, y: y + 200 }, data: { kind: 'end_flow', label: 'End', config: {} } },
  ]
  const edges: object[] = [
    { id: 'e-start', source: 'start', target: 'look' },
    { id: 'e-found', source: 'look', target: 'say', sourceHandle: 'found' },
    { id: 'e-miss', source: 'look', target: 'which', sourceHandle: 'other' },
    { id: 'e-say', source: 'say', target: 'ask' },
    { id: 'e-ask', source: 'ask', target: 'next' },
    { id: 'e-which', source: 'which', target: 'look' },
    { id: 'e-next-other', source: 'next', target: 'close', sourceHandle: 'other' },
    { id: 'e-close', source: 'close', target: 'end' },
  ]
  input.doors.forEach((door, index) => {
    const jumpId = `go-${door.handle}`
    nodes.push({
      id: jumpId,
      type: 'flow-node',
      position: { x: 1340, y: y + index * 80 },
      data: { kind: 'execute_flow', label: door.flowName, config: { flowName: door.flowName } },
    })
    edges.push({ id: `e-next-${door.handle}`, source: 'next', target: jumpId, sourceHandle: door.handle })
  })
  return {
    name: input.name,
    description: input.description,
    tags: input.tags ?? ['salon', 'template', 'faq'],
    publish: input.publish ?? true,
    graph: { nodes, edges },
  }
}

export function hairStudioCatalog(companyName: string): StudioCatalog {
  const company = companyLabel(companyName)
  const facts: CatalogFact[] = [
    { id: 'cut', kind: 'service', title: 'A cut', phrases: ['haircut', 'a cut', 'a trim', 'trim', 'fringe', 'how much is a haircut'], fact: `${company} cuts start from £35.`, source: 'Services and prices' },
    { id: 'colour', kind: 'service', title: 'Colour', phrases: ['colour', 'color', 'how much is colour', 'how much is a colour'], fact: `Colour starts from £70.`, source: 'Services and prices' },
    { id: 'treatment', kind: 'service', title: 'A treatment', phrases: ['treatment', 'treatments'], fact: `Treatments start from £45.`, source: 'Services and prices' },
    { id: 'balayage', kind: 'service', title: 'Balayage', phrases: ['balayage'], fact: `Balayage starts from £90.`, source: 'Services and prices' },
    { id: 'scrub', kind: 'service', title: 'A skin scrub', phrases: ['skin scrub'], fact: `A skin scrub starts from £200.`, source: 'Services and prices' },
    { id: 'keratin', kind: 'service', title: 'Keratin', phrases: ['keratin', 'keratin smoothing'], fact: `Keratin smoothing starts from £120.`, source: 'Services and prices' },
    { id: 'location', kind: 'studio', title: 'Location', phrases: ['where are you', 'address', 'directions', 'where is the salon'], fact: `${company} is at 14 Rosewood Lane.`, source: 'Location' },
    { id: 'hours', kind: 'studio', title: 'Hours', phrases: ['opening hours', 'salon hours', 'when are you open', 'what time do you open', 'hours'], fact: `${company} is open Monday to Saturday, 09:00 to 18:00. You can message any time. I still answer outside those hours, and the studio replies during them.`, source: 'Salon hours' },
  ]
  for (const topic of topicsFor(companyName)) {
    if (topic.flowName === 'Services and prices' || topic.flowName === 'Location' || topic.flowName === 'Salon hours') continue
    if (topic.kind !== 'answer') continue
    facts.push({
      id: handleFor(topic.flowName),
      kind: 'policy',
      title: topic.choice,
      phrases: topic.phrases,
      fact: topic.answer,
      source: topic.flowName,
    })
  }
  return { facts }
}

const YES_NEXT = ['yes', 'yeah', 'yep', 'ok', 'okay']
const HOURS_PHRASES = ['hours', 'opening hours', 'when are you open']
const PRICE_PHRASES = ['price', 'prices', 'how much', 'haircut', 'services', 'cut', 'a cut', 'trim']
const LOCATION_PHRASES = ['where', 'address', 'location']
const BOOK_PHRASES = ['book', 'booking']

export function offersHoursNext(next: string): boolean {
  return /hours/i.test(next)
}

/**
 * Yes/ok follow the question just asked. After "Want the hours?" they open
 * Salon hours. After "Shall I book…?" they still open Book.
 */
export function doorsForNextOffer(next: string): Array<{ handle: string; phrases: string[]; flowName: string }> {
  const hoursNext = offersHoursNext(next)
  return [
    {
      handle: 'hours',
      phrases: hoursNext ? [...HOURS_PHRASES, ...YES_NEXT] : HOURS_PHRASES,
      flowName: 'Salon hours',
    },
    { handle: 'prices', phrases: PRICE_PHRASES, flowName: 'Services and prices' },
    { handle: 'location', phrases: LOCATION_PHRASES, flowName: 'Location' },
    {
      handle: 'book',
      phrases: hoursNext ? BOOK_PHRASES : [...BOOK_PHRASES, 'please', ...YES_NEXT],
      flowName: 'Book an appointment',
    },
  ]
}

function pricesChapter(): StarterFlow {
  return catalogLookupFlow({
    name: 'Services and prices',
    description: 'Looks up one price, then offers to book.',
    kind: 'service',
    intro: 'What are you thinking of? A cut, colour, or a treatment — or another.',
    next: 'Shall I book that?',
    doors: doorsForNextOffer('Shall I book that?').filter((door) => door.handle !== 'prices'),
  })
}

function locationChapter(): StarterFlow {
  return catalogLookupFlow({
    name: 'Location',
    description: 'Looks up the address, then offers a next step.',
    id: 'location',
    intro: 'Are you after the address?',
    next: 'Want the hours?',
    doors: doorsForNextOffer('Want the hours?').filter((door) => door.handle !== 'location'),
  })
}

function hoursChapter(): StarterFlow {
  return catalogLookupFlow({
    name: 'Salon hours',
    description: 'Looks up the hours, then offers a next step.',
    id: 'hours',
    intro: 'Are you after the opening hours?',
    next: 'Shall I book a time?',
    doors: doorsForNextOffer('Shall I book a time?').filter((door) => door.handle !== 'hours'),
  })
}

const TIME_PREFERENCE = 'Would Saturday morning or a weekday after 5 suit you? The studio will confirm the exact time in this chat.'
const ARRIVE = 'Please arrive about 10 minutes early. We are at 14 Rosewood Lane. See you soon, {{contact.name}}.'
const NOTICE = "We need at least 24 hours' notice to cancel or move the appointment."

function ask(id: string, x: number, y: number, label: string, question: string, variable: string) {
  return { id, type: 'flow-node', position: { x, y }, data: { kind: 'ask_question', label, config: { question, variable } } }
}

function bookFlow(topic: Topic): StarterFlow {
  return bookAppointmentFlow({
    publish: true,
    tags: ['salon', 'template', 'booking'],
    description: 'Qualifies a colour, then a cut with it, a stylist, a time, and a mobile so the studio can confirm in chat. Edit the lines to match your salon.',
    timeQuestion: TIME_PREFERENCE,
    confirmExtra: `${topic.answer} ${NOTICE} ${ARRIVE}`,
    salonBranches: true,
  })
}

function cancelFlow(topic: Topic): StarterFlow {
  const y = 120
  return {
    name: topic.flowName,
    description: 'Notes a cancellation for the studio to confirm.',
    tags: ['salon', 'template', 'booking'],
    publish: true,
    graph: {
      nodes: [
        { id: 'c1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Cancel', config: {} } },
        { id: 'c2', type: 'flow-node', position: { x: 300, y }, data: { kind: 'send_message', label: 'Intro', config: { text: topic.answer } } },
        { id: 'c3', type: 'flow-node', position: { x: 540, y }, data: { kind: 'ask_question', label: 'Name', config: { question: 'What name is the appointment under?', variable: 'guest_name' } } },
        { id: 'c4', type: 'flow-node', position: { x: 780, y }, data: { kind: 'ask_question', label: 'When', config: { question: 'Which day and time should I cancel?', variable: 'appointment_time' } } },
        { id: 'c5', type: 'flow-node', position: { x: 1020, y }, data: { kind: 'send_message', label: 'Confirm', config: { text: 'I have noted the cancellation for {{guest_name}} on {{appointment_time}}. The studio will confirm it in this chat.' } } },
        { id: 'c6', type: 'flow-node', position: { x: 1260, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
      ],
      edges: [
        { id: 'e1', source: 'c1', target: 'c2', sourceHandle: 'out' },
        { id: 'e2', source: 'c2', target: 'c3' },
        { id: 'e3', source: 'c3', target: 'c4' },
        { id: 'e4', source: 'c4', target: 'c5' },
        { id: 'e5', source: 'c5', target: 'c6' },
      ],
    },
  }
}

function talkFlow(topic: Topic): StarterFlow {
  const y = 120
  return {
    name: topic.flowName,
    description: 'Tells the guest a person is taking over, then hands the chat to the studio',
    tags: ['salon', 'template', 'handover'],
    publish: true,
    graph: {
      nodes: [
        { id: 't1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Talk to the salon', config: {} } },
        { id: 't2', type: 'flow-node', position: { x: 300, y }, data: { kind: 'send_message', label: 'Tell them', config: { text: topic.answer } } },
        { id: 't3', type: 'flow-node', position: { x: 540, y }, data: { kind: 'handover', label: 'Hand to the studio', config: { team: 'salon', priority: 'medium' } } },
        { id: 't4', type: 'flow-node', position: { x: 760, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2', sourceHandle: 'out' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4' },
      ],
    },
  }
}

function rescheduleFlow(topic: Topic): StarterFlow {
  const y = 120
  return {
    name: topic.flowName,
    description: 'Notes a new day. The studio confirms the time. Edit the notice line on Cancellation policy to match your salon.',
    tags: ['salon', 'template', 'booking'],
    publish: true,
    graph: {
      nodes: [
        { id: 'm1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Reschedule', config: {} } },
        { id: 'm2', type: 'flow-node', position: { x: 300, y }, data: { kind: 'send_message', label: 'Intro', config: { text: topic.answer } } },
        { id: 'm3', type: 'flow-node', position: { x: 540, y }, data: { kind: 'ask_question', label: 'Name', config: { question: 'What name is the appointment under?', variable: 'guest_name' } } },
        { id: 'm4', type: 'flow-node', position: { x: 780, y }, data: { kind: 'ask_question', label: 'Current time', config: { question: 'Which day and time is it now?', variable: 'appointment_time' } } },
        { id: 'm5', type: 'flow-node', position: { x: 1020, y }, data: { kind: 'ask_question', label: 'New day', config: { question: 'Which day would you like instead?', variable: 'new_day' } } },
        { id: 'm6', type: 'flow-node', position: { x: 1260, y }, data: { kind: 'send_message', label: 'Confirm', config: { text: 'I have noted a move for {{guest_name}} from {{appointment_time}} to {{new_day}}. The studio will confirm the new time in this chat.' } } },
        { id: 'm7', type: 'flow-node', position: { x: 1500, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
      ],
      edges: [
        { id: 'e1', source: 'm1', target: 'm2', sourceHandle: 'out' },
        { id: 'e2', source: 'm2', target: 'm3' },
        { id: 'e3', source: 'm3', target: 'm4' },
        { id: 'e4', source: 'm4', target: 'm5' },
        { id: 'e5', source: 'm5', target: 'm6' },
        { id: 'e6', source: 'm6', target: 'm7' },
      ],
    },
  }
}

function consultationFlow(topic: Topic): StarterFlow {
  const y = 120
  return {
    name: topic.flowName,
    description: 'Notes a free consultation. The studio confirms the time.',
    tags: ['salon', 'template', 'booking'],
    publish: true,
    graph: {
      nodes: [
        { id: 'n1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Consultation', config: {} } },
        { id: 'n2', type: 'flow-node', position: { x: 300, y }, data: { kind: 'send_message', label: 'Intro', config: { text: topic.answer } } },
        { id: 'n3', type: 'flow-node', position: { x: 540, y }, data: { kind: 'ask_question', label: 'Time', config: { question: TIME_PREFERENCE, variable: 'preferred_day' } } },
        { id: 'n4', type: 'flow-node', position: { x: 780, y }, data: { kind: 'send_message', label: 'Confirm', config: { text: 'I have noted a consultation for {{preferred_day}}. The studio will confirm the exact time in this chat.' } } },
        { id: 'n5', type: 'flow-node', position: { x: 1020, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'out' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e3', source: 'n3', target: 'n4' },
        { id: 'e4', source: 'n4', target: 'n5' },
      ],
    },
  }
}

function taskFlow(topic: Topic): StarterFlow {
  if (topic.flowName === 'Book an appointment') return bookFlow(topic)
  if (topic.flowName === 'Cancel appointment') return cancelFlow(topic)
  if (topic.flowName === 'Reschedule') return rescheduleFlow(topic)
  if (topic.flowName === 'Consultation') return consultationFlow(topic)
  return talkFlow(topic)
}

const WELCOME_DOORS = ['Location', 'Salon hours', 'Services and prices', 'Book an appointment', 'Cancel appointment', 'Reschedule']

/**
 * Short words such as "book" also sit inside "cancel my booking".
 * The welcome only keeps a phrase that does not belong to a chart it does not open.
 */
function phrasesForWelcome(topic: Topic, parked: Topic[]): string[] {
  return topic.phrases.filter((phrase) => {
    const needle = phrase.toLowerCase()
    const needleWords = ` ${needle} `
    return !parked.some((other) => other.phrases.some((item) => {
      const hay = item.toLowerCase()
      return hay !== needle && ` ${hay} `.includes(needleWords)
    }))
  })
}

function welcomeFlow(companyName: string, topics: Topic[], personaName?: string): StarterFlow {
  const company = companyLabel(companyName)
  const persona = personaName?.trim() || 'Bella'
  const greeting = `Hi, I'm ${persona} at ${company}. What's your name?`
  const doors = WELCOME_DOORS.flatMap((name) => {
    const topic = topics.find((item) => item.flowName === name)
    return topic ? [topic] : []
  })
  const parked = topics.filter((topic) => !WELCOME_DOORS.includes(topic.flowName))
  const routes = doors.map((topic) => ({
    handle: handleFor(topic.flowName),
    phrases: phrasesForWelcome(topic, parked),
    flowName: topic.flowName,
  }))
  const y = 80
  const followY = 360
  const nodes: object[] = [
    { id: 'start', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Start', config: {} } },
    { id: 'save', type: 'flow-node', position: { x: 300, y }, data: { kind: 'set_variable', label: 'Keep the request', config: { variable: 'topic', value: '{{_last_user_message}}' } } },
    ask('welcome', 540, y, 'Welcome', greeting, 'guest_name'),
    { id: 'route', type: 'flow-node', position: { x: 820, y }, data: { kind: 'route_topic', label: 'Route', config: { routes } } },
    ask('follow', 820, followY, 'Ask', 'Are you after a price, the hours, or to book?', 'request'),
    { id: 'route2', type: 'flow-node', position: { x: 1100, y: followY }, data: { kind: 'route_topic', label: 'Route the reply', config: { routes } } },
  ]
  const edges: object[] = [
    { id: 'e-start', source: 'start', target: 'save' },
    { id: 'e-save', source: 'save', target: 'welcome' },
    { id: 'e-welcome', source: 'welcome', target: 'route' },
    { id: 'e-other', source: 'route', target: 'follow', sourceHandle: 'other' },
    { id: 'e-follow', source: 'follow', target: 'route2' },
    { id: 'e-other-2', source: 'route2', target: 'follow', sourceHandle: 'other' },
  ]
  doors.forEach((topic, index) => {
    const handle = handleFor(topic.flowName)
    const jumpId = `go-${handle}`
    const row = y + index * 120
    nodes.push({
      id: jumpId,
      type: 'flow-node',
      position: { x: 1280, y: row },
      data: { kind: 'execute_flow', label: topic.flowName, config: { flowName: topic.flowName } },
    })
    edges.push({ id: `e-${handle}`, source: 'route', target: jumpId, sourceHandle: handle })
    edges.push({ id: `e2-${handle}`, source: 'route2', target: jumpId, sourceHandle: handle })
  })
  return {
    name: SALON_WELCOME_NAME,
    description: `One greeting, then where the studio is, the hours, the prices, or a booking for ${company}`,
    tags: ['welcome', 'routing', 'salon'],
    publish: true,
    graph: { nodes, edges },
  }
}

function chapterFor(topic: Topic): StarterFlow {
  if (topic.flowName === 'Services and prices') return pricesChapter()
  if (topic.flowName === 'Location') return locationChapter()
  if (topic.flowName === 'Salon hours') return hoursChapter()
  return topic.kind === 'answer' ? answerFlow(topic) : taskFlow(topic)
}

export function hairStudioPack(companyName: string, personaName?: string): SalonPack {
  const topics = topicsFor(companyName)
  const catalog = hairStudioCatalog(companyName)
  const flows: StarterFlow[] = [welcomeFlow(companyName, topics, personaName)]
  for (const topic of topics) {
    flows.push(chapterFor(topic))
  }
  return {
    id: HAIR_STUDIO_PACK_ID,
    name: 'Hair studio',
    description: 'Benchmark flows, intents, and FAQs for a salon widget. Prices and the address match the Bella demo page.',
    flows,
    catalog,
    intents: topics.map((topic) => ({
      name: topic.flowName,
      description: topic.question,
      utterances: topic.phrases,
      responses: [{ text: topic.answer }],
    })),
    faqs: topics.map((topic) => ({
      question: topic.question,
      answer: topic.answer,
      tags: ['salon', handleFor(topic.flowName)],
    })),
  }
}

/**
 * Existing names stay as they are. A published welcome stays the widget entry.
 * The salon greeting is saved as a draft named Salon welcome.
 */
export function planHairStudioImport(input: {
  companyName: string
  personaName?: string
  existingFlowNames: string[]
  existingIntentNames: string[]
  existingQuestions: string[]
  publishedWelcome: boolean
}): SalonImportPlan {
  const pack = hairStudioPack(input.companyName, input.personaName)
  const existing = new Set(input.existingFlowNames)
  const flows: PlannedSalonFlow[] = []
  const welcome = pack.flows.find((flow) => flow.name === SALON_WELCOME_NAME)
  for (const flow of pack.flows) {
    if (flow.name === SALON_WELCOME_NAME) continue
    if (existing.has(flow.name)) continue
    flows.push({ ...flow, publish: true })
  }
  if (welcome && !input.publishedWelcome && !existing.has(SALON_WELCOME_NAME)) {
    flows.unshift({ ...welcome, publish: true })
  } else if (welcome && !existing.has(SALON_WELCOME_NAME) && input.publishedWelcome) {
    flows.push({
      ...welcome,
      description: 'Benchmark greeting for a hair studio. Publish it in Sandbox when you want the widget to use it. Your current welcome stays until then.',
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
