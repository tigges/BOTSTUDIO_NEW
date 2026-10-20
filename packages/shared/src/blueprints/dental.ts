/**
 * Dental practice blueprint.
 *
 * Modelled on how a real independent practice runs its website (hours, a fee
 * table, monthly care plans, finance, new-patient steps, an emergency line, an
 * online booking portal), with fictional sample values for Harbour Dental.
 *
 * Chapters never hold a price or an hour. They look facts up by id from the
 * catalog, which is compiled from the business details, so editing a price
 * changes the next answer without republishing.
 */

import type { CatalogFact, StudioCatalog } from '../catalog.js'
import type { EvalCheck, EvalScenario } from '../evals.js'
import type { StarterFlow } from '../flow-templates.js'
import type { GuardrailRule } from '../guardrails.js'
import type { ScannedPage } from '../website-scan.js'
import type { Blueprint, BlueprintBundle, DemoScript } from './blueprint.js'
import {
  WEEKDAYS,
  WEEKDAY_NAMES,
  businessDocuments,
  formatFieldValue,
  formatMoney,
  formatPlan,
  formatPrice,
  formatSteps,
  formatWeeklyHours,
  slugFor,
  type BlueprintFieldSpec,
  type BusinessField,
  type BusinessProfile,
  type BusinessValue,
  type OpeningDay,
  type PlanItem,
  type PriceItem,
  type TopicItem,
} from './business.js'
import {
  readAddress,
  readBookingLink,
  readBusinessName,
  readCancellation,
  readDirections,
  readEmergency,
  readFinance,
  readHours,
  readPhone,
  readPlans,
  readPrices,
  readSteps,
  readTopics,
  type VocabularyTerm,
} from './extract.js'

export const DENTAL_BLUEPRINT_ID = 'dental-practice'

export const DENTAL_CHAPTERS = {
  welcome: 'Practice welcome',
  emergency: 'Dental pain or emergency',
  book: 'Book a visit',
  newPatients: 'New patients',
  prices: 'Prices and finance',
  plans: 'Care plans',
  treatments: 'Treatments explained',
  hours: 'Hours and location',
  change: 'Change or cancel',
  talk: 'Talk to a person',
} as const

const C = DENTAL_CHAPTERS

export const DENTAL_FIELDS: BlueprintFieldSpec[] = [
  { key: 'hours', label: 'Opening hours', kind: 'weekly_hours', required: true, help: 'Hours and location answers with these. People in the Inbox answer during them.' },
  { key: 'phone', label: 'Phone number', kind: 'phone', required: true, help: 'Said for emergencies and when a guest wants to call.' },
  { key: 'address', label: 'Address', kind: 'address', required: true, help: 'Hours and location answers with this.' },
  { key: 'getting_here', label: 'Parking and transport', kind: 'text', required: false, help: 'Parking, stations and buses near the practice.' },
  { key: 'fees', label: 'Price list', kind: 'price_list', required: true, help: 'Each line is one answer in Prices and finance. The bot only quotes these prices.' },
  { key: 'care_plans', label: 'Care plans', kind: 'plan_list', required: false, help: 'Monthly plans, their price and what each includes.' },
  { key: 'finance', label: 'Finance and payment', kind: 'text', required: false, help: 'How patients can spread the cost.' },
  { key: 'new_patient', label: 'New patient steps', kind: 'steps', required: true, help: 'What happens before and at the first visit.' },
  { key: 'emergency', label: 'Emergency arrangements', kind: 'text', required: true, help: 'What a patient in pain should do, in and out of hours.' },
  { key: 'booking_link', label: 'Online booking link', kind: 'url', required: false, help: 'Offered after a booking request. The bot never makes up a link.' },
  { key: 'cancellation', label: 'Cancellation policy', kind: 'text', required: false, help: 'Said before a guest changes or cancels.' },
  { key: 'treatments', label: 'Treatments', kind: 'topic_list', required: true, help: 'One short explanation per treatment for Treatments explained.' },
]

/** Words a guest or a website uses for each treatment. Order is the order Treatments explained lists them. */
export const DENTAL_VOCABULARY: VocabularyTerm[] = [
  { name: 'Check-ups', terms: ['check-up', 'check up', 'checkup', 'dental exam', 'exam', 'examination'], prefer: /^(check-?\s?up|existing patient|routine|regular)\b/i },
  { name: 'Hygiene visits', terms: ['hygiene', 'hygienist', 'scale and polish', 'airflow'] },
  { name: 'Fillings', terms: ['filling', 'fillings'] },
  { name: 'Root canal', terms: ['root canal'] },
  { name: 'Crowns', terms: ['crown', 'crowns', 'onlay', 'inlay'] },
  { name: 'Bridges', terms: ['bridge', 'bridges'] },
  { name: 'Dentures', terms: ['denture', 'dentures'] },
  { name: 'Composite bonding', terms: ['bonding'] },
  { name: 'Veneers', terms: ['veneer', 'veneers'] },
  { name: 'Clear aligners', terms: ['aligner', 'aligners', 'invisalign', 'straightening', 'braces', 'six month smiles'] },
  { name: 'Implants', terms: ['implant', 'implants'] },
  { name: 'Teeth whitening', terms: ['whitening', 'whiten', 'enlighten'] },
  { name: 'Extractions', terms: ['extraction', 'extractions', 'wisdom tooth'] },
  { name: 'Anti-snoring device', terms: ['snoring', 'sleep apnoea', 'sleep device'] },
  { name: 'Mouth guards', terms: ['mouth guard', 'mouthguard', 'sports guard'] },
]

/** Price rows that name no treatment borrow their heading; these words count as naming one. */
const PRICE_VOCABULARY: VocabularyTerm[] = [
  ...DENTAL_VOCABULARY,
  { name: 'X-rays', terms: ['x-ray', 'x-rays', 'panoral'] },
  { name: 'Retainers', terms: ['retainer', 'retainers'] },
  { name: 'Sealants', terms: ['sealant', 'sealants'] },
]

export const DENTAL_ALWAYS_HUMAN = [
  'swelling', 'swollen face', 'swollen jaw', "can't swallow", 'cannot swallow', "can't breathe", 'cannot breathe',
  'knocked out', 'heavy bleeding', "won't stop bleeding", 'complaint',
]

export const DENTAL_SAFETY_LINE = "If your face or neck is swelling, you're struggling to breathe or swallow, or bleeding won't stop, call 999 or go to A&E now. Out of hours, NHS 111 can help."

// ── Sample: Harbour Dental (fictional) ───────────────────────────────────────

const HARBOUR_HOURS: OpeningDay[] = [
  { day: 'mon', open: '08:00', close: '18:00' },
  { day: 'tue', open: '08:00', close: '17:00' },
  { day: 'wed', open: '08:00', close: '17:00' },
  { day: 'thu', open: '08:00', close: '17:00' },
  { day: 'fri', open: '08:00', close: '16:00' },
  { day: 'sat', open: '08:00', close: '13:00' },
  { day: 'sun', closed: true },
]

const HARBOUR_FEES: PriceItem[] = [
  { name: 'New patient exam', amount: 85, group: 'Exams' },
  { name: 'Check-up', amount: 45, group: 'Exams' },
  { name: 'Hygiene visit', amount: 85, group: 'Hygiene' },
  { name: 'Check-up and hygiene together', amount: 120, group: 'Hygiene' },
  { name: 'Small X-rays', amount: 12, group: 'Exams' },
  { name: 'Small filling', amount: 115, from: true, group: 'Fillings' },
  { name: 'Large filling', amount: 240, from: true, group: 'Fillings' },
  { name: 'Front tooth root canal', amount: 440, from: true, group: 'Root canal' },
  { name: 'Molar root canal', amount: 640, from: true, group: 'Root canal' },
  { name: 'Crown', amount: 680, from: true, group: 'Crowns' },
  { name: 'Composite bonding', amount: 145, from: true, group: 'Cosmetic' },
  { name: 'Veneer', amount: 680, from: true, group: 'Cosmetic' },
  { name: 'Simple extraction', amount: 155, group: 'Extractions' },
  { name: 'Clear aligners', amount: 2950, from: true, group: 'Straightening' },
  { name: 'Retainers', amount: 145, from: true, group: 'Straightening' },
  { name: 'Single tooth implant', amount: 2650, from: true, group: 'Implants' },
  { name: 'Home whitening', amount: 395, group: 'Whitening' },
  { name: 'Mouth guard', amount: 145, group: 'Guards' },
  { name: 'Anti-snoring device', amount: 850, from: true, group: 'Guards' },
]

const HARBOUR_PLANS: PlanItem[] = [
  { name: 'Essential', monthly: 10.5, includes: ['1 check-up a year', '1 hygiene visit a year', 'small X-rays', 'mouth cancer screening', '10% off treatment'] },
  { name: 'Complete', monthly: 18, includes: ['2 check-ups a year', '2 hygiene visits a year', 'small X-rays', 'mouth cancer screening', 'emergency assessments', '10% off treatment'] },
  { name: 'Complete Plus', monthly: 28, includes: ['2 check-ups a year', '4 hygiene visits a year', 'X-rays when needed', 'emergency assessments', 'a whitening top-up each year', '10% off treatment'] },
]

const HARBOUR_TREATMENTS: TopicItem[] = [
  { name: 'Check-ups', summary: 'The dentist checks your teeth, gums and mouth, screens for mouth cancer and tells you if anything needs attention. Most people come every six to twelve months.' },
  { name: 'Hygiene visits', summary: 'The hygienist cleans away plaque and tartar above and below the gum line and shows you what to focus on at home. Most people come every six months.' },
  { name: 'Fillings', summary: 'We repair decay with tooth-coloured composite. Most fillings take one visit.' },
  { name: 'Root canal', summary: 'Root canal treatment removes infected nerve tissue from inside the tooth, cleans it and seals it, so the tooth can be kept. It usually takes one or two visits.' },
  { name: 'Crowns', summary: 'A crown is a cap that covers a weak or heavily filled tooth. It takes two visits: one to prepare the tooth, one to fit the crown.' },
  { name: 'Composite bonding', summary: 'Tooth-coloured resin is shaped onto the tooth to fix chips, gaps or uneven edges, usually in one visit without drilling.' },
  { name: 'Veneers', summary: 'Thin porcelain shells are fitted to the front of the teeth to change their shape and colour. It takes two or three visits.' },
  { name: 'Clear aligners', summary: 'A series of clear, removable aligners straightens teeth gradually. Treatment usually takes 6 to 18 months, with check-ins every few weeks.' },
  { name: 'Implants', summary: 'An implant is a titanium post placed in the jaw that holds a crown, replacing a missing tooth. It starts with a consultation and a scan.' },
  { name: 'Teeth whitening', summary: 'Custom trays and whitening gel you wear at home for about two weeks, after a check that your teeth and gums are healthy.' },
  { name: 'Anti-snoring device', summary: 'A custom mouthpiece worn at night that holds the jaw slightly forward to keep the airway open.' },
  { name: 'Mouth guards', summary: 'A custom guard made from impressions of your teeth, for contact sports or for grinding at night.' },
].map((topic) => ({ ...topic, phrases: DENTAL_VOCABULARY.find((item) => item.name === topic.name)?.terms ?? [] }))

function sampleField(value: BusinessValue): BusinessField {
  return { value, status: 'sample' }
}

export function harbourDentalProfile(): BusinessProfile {
  return {
    blueprintId: DENTAL_BLUEPRINT_ID,
    blueprintVersion: 1,
    businessName: 'Harbour Dental',
    personaName: 'Nova',
    fields: {
      hours: sampleField(HARBOUR_HOURS),
      phone: sampleField('0117 496 0123'),
      address: sampleField('12 Anchor Row, Harbourside, Bristol BS1 5XX'),
      getting_here: sampleField('The Anchor Row car park is a two-minute walk and allows two hours. Temple Meads station is a 15-minute walk. Buses 8 and 72 stop on Harbourside, opposite the practice.'),
      fees: sampleField(HARBOUR_FEES),
      care_plans: sampleField(HARBOUR_PLANS),
      finance: sampleField('0% finance on treatment over £1,000, paid over 6 to 12 months. You pay for each appointment as you go, so there is no big bill at the end.'),
      new_patient: sampleField([
        'Book a new patient exam. It costs £85 and takes about 45 minutes',
        'Before your visit we text you a link to a secure medical history form',
        'The dentist checks your teeth, gums and mouth, and takes X-rays if needed',
        'You get a written treatment plan with every cost before anything starts',
      ]),
      emergency: sampleField('Call 0117 496 0123 as soon as we open. We keep emergency slots every weekday morning. Out of hours, call NHS 111.'),
      booking_link: sampleField('https://book.harbourdental.example/'),
      cancellation: sampleField("Please give us 24 hours' notice to cancel or move an appointment. A missed appointment without notice may be charged."),
      treatments: sampleField(HARBOUR_TREATMENTS),
    },
  }
}

// ── Reading a practice website ───────────────────────────────────────────────

export function extractDentalProfile(pages: ScannedPage[], at = new Date().toISOString()): BusinessProfile {
  const fields: Record<string, BusinessField> = {
    hours: readHours(pages),
    phone: readPhone(pages),
    address: readAddress(pages),
    getting_here: readDirections(pages),
    fees: readPrices(pages, PRICE_VOCABULARY),
    care_plans: readPlans(pages),
    finance: readFinance(pages),
    new_patient: readSteps(pages, /new[-_ ]?patient|first visit|join/),
    emergency: readEmergency(pages),
    booking_link: readBookingLink(pages),
    cancellation: readCancellation(pages),
    treatments: readTopics(pages, DENTAL_VOCABULARY),
  }
  return {
    blueprintId: DENTAL_BLUEPRINT_ID,
    blueprintVersion: 1,
    businessName: readBusinessName(pages),
    websiteUrl: pages[0]?.url,
    scannedAt: at,
    fields,
  }
}

// ── Catalog ──────────────────────────────────────────────────────────────────

function valueOf<T extends BusinessValue>(profile: BusinessProfile, key: string): T | null {
  return (profile.fields[key]?.value ?? null) as T | null
}

function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function termsFor(name: string): string[] {
  const lower = name.toLowerCase()
  return DENTAL_VOCABULARY.filter((item) => item.terms.some((term) => lower.includes(term))).flatMap((item) => item.terms)
}

/**
 * The one row a guest means by a treatment word. "How much is a check-up?" is the
 * existing-patient exam, not the new-patient one; "hygiene" is the plain visit, not a bundle.
 */
export function representativePrice(fees: PriceItem[] | null | undefined, vocabulary: VocabularyTerm): PriceItem | undefined {
  const others = PRICE_VOCABULARY.filter((item) => item.name !== vocabulary.name)
  return (fees ?? [])
    .map((item, index) => {
      const name = item.name.toLowerCase()
      return {
        item,
        index,
        term: vocabulary.terms.findIndex((term) => name.includes(term)),
        preferred: vocabulary.prefer?.test(item.name) ? 0 : 1,
        bundle: others.filter((other) => other.terms.some((term) => name.includes(term))).length,
      }
    })
    .filter((row) => row.term >= 0)
    .sort((a, b) => a.preferred - b.preferred || a.bundle - b.bundle || a.term - b.term || a.index - b.index)[0]?.item
}

function vocabularyFor(name: string): VocabularyTerm {
  return PRICE_VOCABULARY.find((item) => item.name === name)!
}

/** Each treatment word goes to one price row only, so two rows never tie for "check-up". */
function priceAliases(fees: PriceItem[]): Map<PriceItem, string[]> {
  const aliases = new Map<PriceItem, string[]>()
  for (const vocabulary of PRICE_VOCABULARY) {
    const item = representativePrice(fees, vocabulary)
    if (!item) continue
    const terms = vocabulary.terms.filter((term) => !fees.some((other) => other !== item && other.name.toLowerCase().includes(term)))
    aliases.set(item, [...(aliases.get(item) ?? []), ...terms])
  }
  return aliases
}

function pricePhrases(item: PriceItem, aliases: string[] = []): string[] {
  const base = item.name.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[,/&]+/g, ' ').replace(/\s+/g, ' ').trim()
  return [...new Set([base, base.replace(/-/g, ' '), base.replace(/-/g, ''), ...aliases])]
}

/** "Molar root canal is from £640." Group-prefixed names keep their comma: "Composite fillings, small: from £120." */
export function priceFact(item: PriceItem): string {
  return item.name.includes(',') ? `${item.name}: ${formatPrice(item)}.` : `${item.name} is ${formatPrice(item)}.`
}

function pricesFor(fees: PriceItem[] | null, topic: TopicItem): PriceItem[] {
  if (!fees) return []
  const terms = (topic.phrases?.length ? topic.phrases : termsFor(topic.name)).map((term) => term.toLowerCase())
  return fees.filter((item) => terms.some((term) => term.length >= 4 && item.name.toLowerCase().includes(term))).slice(0, 2)
}

export function dentalCatalog(profile: BusinessProfile): StudioCatalog {
  const facts: CatalogFact[] = []
  const hours = valueOf<OpeningDay[]>(profile, 'hours')
  const phone = valueOf<string>(profile, 'phone')
  const address = valueOf<string>(profile, 'address')
  const gettingHere = valueOf<string>(profile, 'getting_here')
  const fees = valueOf<PriceItem[]>(profile, 'fees')
  const plans = valueOf<PlanItem[]>(profile, 'care_plans')
  const finance = valueOf<string>(profile, 'finance')
  const steps = valueOf<string[]>(profile, 'new_patient')
  const emergency = valueOf<string>(profile, 'emergency')
  const booking = valueOf<string>(profile, 'booking_link')
  const cancellation = valueOf<string>(profile, 'cancellation')
  const treatments = valueOf<TopicItem[]>(profile, 'treatments')
  const name = profile.businessName || 'The practice'

  if (hours?.length) {
    facts.push({ id: 'hours', kind: 'studio', title: 'Opening hours', source: C.hours, fact: `We're open: ${formatWeeklyHours(hours)}`, phrases: ['opening hours', 'are you open', 'when are you open', 'what time', 'open on', 'close', 'closing', 'hours', 'today', 'tomorrow', 'weekend', ...WEEKDAYS.map((day) => WEEKDAY_NAMES[day].toLowerCase())] })
  }
  if (address) facts.push({ id: 'address', kind: 'studio', title: 'Address', source: C.hours, fact: `${name} is at ${sentence(address)}`, phrases: ['address', 'where are you', 'where is', 'location', 'located', 'postcode', 'find you'] })
  if (gettingHere) facts.push({ id: 'getting-here', kind: 'studio', title: 'Parking and transport', source: C.hours, fact: sentence(gettingHere), phrases: ['parking', 'park', 'car park', 'bus', 'train', 'station', 'tube', 'get there', 'getting here', 'directions', 'drive'] })
  if (phone) facts.push({ id: 'phone', kind: 'studio', title: 'Phone number', source: C.hours, fact: `You can call us on ${phone}.`, phrases: ['phone number', 'phone', 'call you', 'telephone', 'ring', 'number'] })

  const aliases = priceAliases(fees ?? [])
  for (const item of fees ?? []) {
    facts.push({ id: `price-${slugFor(item.name)}`, kind: 'service', title: item.name, source: C.prices, fact: priceFact(item), phrases: pricePhrases(item, aliases.get(item)) })
  }
  if (finance) facts.push({ id: 'finance', kind: 'service', title: 'Finance', source: C.prices, fact: sentence(finance), phrases: ['finance', 'pay monthly', 'monthly payments', 'spread the cost', 'payment plan', 'payment options', 'interest free', '0%', 'instalments', 'pay in'] })
  if (plans?.length) {
    const lowest = Math.min(...plans.map((plan) => plan.monthly))
    facts.push({ id: 'care-plans', kind: 'policy', title: 'Care plans', source: C.plans, fact: `We have ${plans.length === 1 ? 'one care plan' : `${plans.length} care plans`}, from ${formatMoney(lowest)} a month. ${plans.map(formatPlan).join(' ')}`, phrases: ['care plan', 'care plans', 'dental plan', 'monthly plan', 'membership', 'plans'] })
  }
  if (steps?.length) facts.push({ id: 'new-patient', kind: 'policy', title: 'New patients', source: C.newPatients, fact: `New patients are welcome. ${formatSteps(steps)}`, phrases: ['new patient', 'register', 'first visit', 'join'] })
  if (emergency) facts.push({ id: 'emergency', kind: 'policy', title: 'Emergencies', source: C.emergency, fact: sentence(emergency), phrases: ['emergency', 'toothache', 'urgent'] })
  if (booking) facts.push({ id: 'booking-link', kind: 'policy', title: 'Online booking', source: C.book, fact: `If you'd rather pick a time yourself, you can book online at ${booking}`, phrases: ['book online', 'online booking', 'booking link'] })
  if (cancellation) facts.push({ id: 'cancellation', kind: 'policy', title: 'Cancellation policy', source: C.change, fact: sentence(cancellation), phrases: ['cancellation policy', 'notice', 'late cancellation', 'missed appointment'] })

  for (const topic of treatments ?? []) {
    const prices = pricesFor(fees, topic)
    const priced = prices.length ? ` ${prices.map(priceFact).join(' ')}` : ''
    facts.push({ id: `treatment-${slugFor(topic.name)}`, kind: 'offer', title: topic.name, source: C.treatments, fact: `${sentence(topic.summary)}${priced}`, phrases: [...new Set([topic.name.toLowerCase(), ...(topic.phrases ?? termsFor(topic.name))])] })
  }
  return { facts }
}

// ── Chapters ─────────────────────────────────────────────────────────────────

type Node = { id: string; type: 'flow-node'; position: { x: number; y: number }; data: { kind: string; label: string; config: Record<string, unknown> } }
type Edge = { id: string; source: string; target: string; sourceHandle?: string }

function n(id: string, x: number, y: number, kind: string, label: string, config: Record<string, unknown> = {}): Node {
  return { id, type: 'flow-node', position: { x, y }, data: { kind, label, config } }
}

function e(source: string, target: string, sourceHandle?: string): Edge {
  return { id: `e-${source}-${sourceHandle ?? 'out'}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) }
}

function chapter(name: string, description: string, nodes: Node[], edges: Edge[], tags: string[] = []): StarterFlow {
  return { name, description, tags: ['dental', 'blueprint', ...tags], publish: true, graph: { nodes, edges } }
}

interface Door {
  handle: string
  flowName: string
  label: string
  intent: string
  phrases: string[]
}

const YES = ['yes', 'yeah', 'yep', 'yes please', 'please', 'ok', 'okay', 'sure', 'go on']

const DOORS: Door[] = [
  { handle: 'emergency', flowName: C.emergency, label: 'Dental pain or emergency', intent: 'Tooth pain, a broken or chipped tooth, a lost filling or crown, or any other dental emergency.', phrases: ['toothache', 'tooth ache', 'pain', 'painful', 'hurts', 'hurting', 'emergency', 'urgent', 'broken tooth', 'chipped', 'cracked', 'lost a filling', 'filling fell out', 'crown came off', 'abscess', 'sensitive'] },
  { handle: 'prices', flowName: C.prices, label: 'Prices and finance', intent: 'What something costs, the fee list, payment options or finance.', phrases: ['how much is', 'how much are', 'how much does', 'how much do', 'how much for', 'price of', 'cost of', 'price', 'prices', 'price list', 'cost', 'costs', 'fees', 'fee', 'finance', 'pay monthly', 'payment options', 'spread the cost', 'interest free'] },
  { handle: 'book', flowName: C.book, label: 'Book a visit', intent: 'Book a check-up, a hygiene visit or a treatment appointment.', phrases: ['book', 'booking', 'appointment', 'check-up', 'checkup', 'check up', 'hygienist', 'hygiene appointment', 'scale and polish', 'see a dentist', 'make an appointment'] },
  { handle: 'new-patients', flowName: C.newPatients, label: 'New patients', intent: 'Someone who is not a patient yet and wants to join or register.', phrases: ['new patient', 'new patients', 'register', 'registering', 'join the practice', 'first visit', 'never been', 'not a patient', 'taking new patients', 'accepting new patients'] },
  { handle: 'plans', flowName: C.plans, label: 'Care plans', intent: 'Monthly dental care plans or membership.', phrases: ['care plan', 'care plans', 'dental plan', 'monthly plan', 'membership', 'plans', 'denplan'] },
  { handle: 'treatments', flowName: C.treatments, label: 'Treatments explained', intent: 'What a treatment involves, such as whitening, aligners, implants, veneers or root canal.', phrases: [...new Set(DENTAL_VOCABULARY.filter((item) => item.name !== 'Check-ups' && item.name !== 'Hygiene visits').flatMap((item) => item.terms)), 'tell me about', 'what is', 'how does'] },
  { handle: 'hours', flowName: C.hours, label: 'Hours and location', intent: 'Opening hours, the address, directions, parking or the phone number.', phrases: ['opening hours', 'are you open', 'you open', 'opening', 'hours', 'what time', 'address', 'where are you', 'where is', 'directions', 'parking', 'park', 'car park', 'bus', 'train', 'station', 'phone number', 'postcode', 'located'] },
  { handle: 'change', flowName: C.change, label: 'Change or cancel', intent: 'Cancel, move or change an appointment they already have.', phrases: ['cancel', 'cancel my', 'cancel an', 'cancel my appointment', 'cancel an appointment', 'cancel my booking', 'move my booking', 'change my booking', 'cancel the', 'cancellation', 'reschedule', 'move my', 'change my', 'change my appointment', 'move my appointment', 'rearrange', "can't make it", 'cannot make it', 'running late'] },
  { handle: 'talk', flowName: C.talk, label: 'Talk to a person', intent: 'Wants a person, reception, a call back, or to make a complaint.', phrases: ['person', 'human', 'real person', 'someone', 'speak to', 'talk to', 'reception', 'receptionist', 'call me back', 'call back'] },
]

function routesFor(doors: Door[]) {
  return doors.map(({ handle, label, intent, phrases, flowName }) => ({ handle, label, intent, phrases, flowName }))
}

function doorJumps(doors: Door[], router: string, x: number, y: number): { nodes: Node[]; edges: Edge[] } {
  const nodes = doors.map((door, index) => n(`go-${door.handle}`, x, y + index * 90, 'execute_flow', door.flowName, { flowName: door.flowName }))
  const edges = doors.map((door) => e(router, `go-${door.handle}`, door.handle))
  return { nodes, edges }
}

function door(handle: string): Door {
  return DOORS.find((item) => item.handle === handle)!
}

/** A "what next" question after an answer: yes books, other named doors open their chapter, anything else closes politely. */
function nextStep(prefix: string, x: number, y: number, question: string, doors: Door[]): { nodes: Node[]; edges: Edge[]; entry: string } {
  const ask = `${prefix}-ask`
  const route = `${prefix}-next`
  const close = `${prefix}-close`
  const end = `${prefix}-end`
  const routed = doors.map((item, index) => index === 0 ? { ...item, phrases: [...YES, ...item.phrases] } : item)
  const jumps = doors.map((item, index) => n(`${prefix}-go-${item.handle}`, x + 560, y + index * 90, 'execute_flow', item.flowName, { flowName: item.flowName }))
  return {
    entry: ask,
    nodes: [
      n(ask, x, y, 'ask_question', 'What next', { question, variable: 'request' }),
      n(route, x + 280, y, 'route_topic', 'Route the reply', { routes: routesFor(routed) }),
      ...jumps,
      n(close, x + 560, y + doors.length * 90 + 40, 'send_message', 'Close', { text: 'No problem. Ask me anything else about the practice.' }),
      n(end, x + 820, y + doors.length * 90 + 40, 'end_flow', 'End'),
    ],
    edges: [
      e(ask, route),
      ...doors.map((item) => e(route, `${prefix}-go-${item.handle}`, item.handle)),
      e(route, close, 'other'),
      e(close, end),
    ],
  }
}

function welcomeChapter(profile: BusinessProfile, persona: string): StarterFlow {
  const name = profile.businessName || 'the practice'
  const greeting = `Hi, I'm ${persona} at ${name}.`
  const question = 'What can I help with: a booking, a dental problem, prices, or something else?'
  const doors = [door('emergency'), door('prices'), door('book'), door('new-patients'), door('plans'), door('treatments'), door('hours'), door('change'), door('talk')]
  const routes = routesFor(doors)
  const jumps = doorJumps(doors, 'route', 1180, 0)
  return chapter(C.welcome, `Greets the guest for ${name}, asks one question, and opens the chapter that fits. Two misses go to a person.`, [
    n('start', 0, 120, 'trigger_start', 'Start'),
    n('keep', 220, 120, 'set_variable', 'Keep the request', { variable: 'topic', value: '{{_last_user_message}}' }),
    n('hello', 440, 120, 'send_message', 'Greeting', { text: greeting }),
    n('ask', 660, 120, 'ask_question', 'First question', { question, variable: 'request' }),
    n('route', 900, 120, 'route_topic', 'Route', { routes }),
    n('again', 900, 520, 'ask_question', 'Ask again', { question: "Sorry, I didn't catch that. Is it a booking, tooth pain, prices, or something else?", variable: 'request' }),
    n('route2', 1180, 900, 'route_topic', 'Route the second try', { routes }),
    ...jumps.nodes,
  ], [
    e('start', 'keep'),
    e('keep', 'hello'),
    e('hello', 'ask'),
    e('ask', 'route'),
    e('route', 'again', 'other'),
    e('again', 'route2'),
    ...jumps.edges,
    ...doors.map((item) => e('route2', `go-${item.handle}`, item.handle)),
    e('route2', 'go-talk', 'other'),
  ], ['welcome', 'routing'])
}

function emergencyChapter(): StarterFlow {
  return chapter(C.emergency, 'Says what to do now, checks for red flags, and passes the chat to the team with a callback number.', [
    n('start', 0, 120, 'trigger_start', 'Start'),
    n('sorry', 220, 120, 'send_message', 'Sorry', { text: "I'm sorry you're in pain." }),
    n('look', 440, 120, 'lookup_catalog', 'Emergency arrangements', { id: 'emergency' }),
    n('say', 660, 40, 'send_message', 'What to do', { text: '{{fact}}' }),
    n('safety', 880, 120, 'send_message', 'When to call 999', { text: DENTAL_SAFETY_LINE }),
    n('flags', 1100, 120, 'ask_question', 'Red flags', { question: "Do you have any swelling, a knocked-out tooth, or bleeding that won't stop?", variable: 'red_flags' }),
    n('triage', 1320, 120, 'route_topic', 'Red flag?', {
      routes: [{ handle: 'urgent', label: 'Red flag', intent: 'The guest says yes, or describes swelling, a knocked-out tooth, heavy bleeding, a fever, or trouble breathing or swallowing.', phrases: ['yes', 'yeah', 'yep', 'swelling', 'swollen', 'knocked out', 'bleeding', 'fever', "can't open"] }],
    }),
    n('urgent', 1560, 40, 'handover', 'Urgent to the team', {
      reason: 'Dental emergency with a red flag.', priority: 'critical', tags: ['emergency', 'red-flag'], queue: 'emergencies', skills: ['triage'], context: 'full_transcript', variables: ['red_flags'],
    }),
    n('name', 1560, 220, 'ask_question', 'Name', { question: "I'll get the team to call you. What's your name?", variable: 'guest_name' }),
    n('phone', 1780, 220, 'ask_question', 'Phone', { question: "What's the best number to call you on?", variable: 'phone' }),
    n('passing', 2000, 220, 'send_message', 'Passing on', { text: "Thanks {{guest_name}}. I'm passing this to the team now so they can offer you the first emergency slot." }),
    n('hand', 2220, 220, 'handover', 'To the team', {
      reason: 'Dental pain: needs an emergency appointment.', priority: 'high', tags: ['emergency'], queue: 'emergencies', skills: ['triage'], context: 'full_transcript', variables: ['guest_name', 'phone', 'red_flags'],
    }),
  ], [
    e('start', 'sorry'), e('sorry', 'look'), e('look', 'say', 'found'), e('look', 'safety', 'other'), e('say', 'safety'),
    e('safety', 'flags'), e('flags', 'triage'), e('triage', 'urgent', 'urgent'), e('triage', 'name', 'other'),
    e('name', 'phone'), e('phone', 'passing'), e('passing', 'hand'),
  ], ['emergency', 'handover'])
}

function bookChapter(): StarterFlow {
  return chapter(C.book, 'Asks what the visit is for, when suits, a name and a number, then leaves reception a booking request to confirm by phone.', [
    n('start', 0, 120, 'trigger_start', 'Start'),
    n('what', 220, 120, 'ask_question', 'Visit type', { question: 'What is the visit for: a check-up, a hygiene clean, a treatment, or are you new to us?', variable: 'visit_type' }),
    n('kind', 440, 120, 'route_topic', 'New or in pain?', {
      routes: [
        { handle: 'new', label: 'New patient', intent: 'The guest is not a patient here yet.', phrases: ['new', 'new patient', 'new to you', 'first visit', 'first time', 'register', 'never been', 'not registered'], flowName: C.newPatients },
        { handle: 'pain', label: 'In pain', intent: 'The guest is in pain or has a broken tooth.', phrases: ['pain', 'toothache', 'hurts', 'emergency', 'broken tooth', 'chipped'], flowName: C.emergency },
      ],
    }),
    n('go-new', 680, 0, 'execute_flow', C.newPatients, { flowName: C.newPatients }),
    n('go-pain', 680, 60, 'execute_flow', C.emergency, { flowName: C.emergency }),
    n('when', 680, 200, 'ask_question', 'When', { question: 'Which days and times usually suit you?', variable: 'preferred_times' }),
    n('name', 900, 200, 'ask_question', 'Name', { question: 'What name should the booking be under?', variable: 'guest_name' }),
    n('phone', 1120, 200, 'ask_question', 'Phone', { question: 'And the best number to reach you on?', variable: 'phone' }),
    n('ticket', 1340, 200, 'create_ticket', 'Booking request', { subject: 'Booking request: {{visit_type}}', description: '{{guest_name}} ({{phone}}) would like {{visit_type}}. Suits: {{preferred_times}}.' }),
    n('look', 1560, 200, 'lookup_catalog', 'Online booking', { id: 'booking-link' }),
    n('online', 1780, 120, 'send_message', 'Confirm with link', { text: 'Thanks {{guest_name}}. Reception will call you to confirm a time. {{fact}}' }),
    n('done', 1780, 280, 'send_message', 'Confirm', { text: 'Thanks {{guest_name}}. Reception will call you to confirm a time.' }),
    n('end', 2000, 200, 'end_flow', 'End'),
  ], [
    e('start', 'what'), e('what', 'kind'), e('kind', 'go-new', 'new'), e('kind', 'go-pain', 'pain'), e('kind', 'when', 'other'),
    e('when', 'name'), e('name', 'phone'), e('phone', 'ticket'), e('ticket', 'look'),
    e('look', 'online', 'found'), e('look', 'done', 'other'), e('online', 'end'), e('done', 'end'),
  ], ['booking'])
}

function pinnedAnswer(name: string, description: string, factId: string, fallback: string, question: string, doors: Door[], tags: string[]): StarterFlow {
  const next = nextStep('n', 880, 120, question, doors)
  return chapter(name, description, [
    n('start', 0, 120, 'trigger_start', 'Start'),
    n('look', 220, 120, 'lookup_catalog', 'Look up', { id: factId }),
    n('say', 440, 40, 'send_message', 'The answer', { text: '{{fact}}' }),
    n('fallback', 440, 220, 'send_message', 'Not listed yet', { text: fallback }),
    ...next.nodes,
  ], [
    e('start', 'look'), e('look', 'say', 'found'), e('look', 'fallback', 'other'),
    e('say', next.entry), e('fallback', next.entry),
    ...next.edges,
  ], tags)
}

function lookupChapter(name: string, description: string, kind: string, which: string, question: string, doors: Door[], tags: string[]): StarterFlow {
  const next = nextStep('n', 880, 120, question, doors)
  return chapter(name, description, [
    n('start', 0, 120, 'trigger_start', 'Start'),
    n('look', 220, 120, 'lookup_catalog', 'Look up', { kind }),
    n('say', 440, 40, 'send_message', 'The answer', { text: '{{fact}}' }),
    n('which', 440, 240, 'ask_question', 'Which one', { question: which, variable: 'request' }),
    ...next.nodes,
  ], [
    e('start', 'look'), e('look', 'say', 'found'), e('look', 'which', 'other'), e('which', 'look'),
    e('say', next.entry),
    ...next.edges,
  ], tags)
}

function plansChapter(): StarterFlow {
  const next = nextStep('n', 1320, 120, 'Would you like to book a check-up to start?', [door('book'), door('prices')])
  return chapter(C.plans, 'Lists the plans from the business details, then an AI step helps the guest pick one (4 replies at most).', [
    n('start', 0, 120, 'trigger_start', 'Start'),
    n('look', 220, 120, 'lookup_catalog', 'Care plans', { id: 'care-plans' }),
    n('say', 440, 40, 'send_message', 'The plans', { text: '{{fact}}' }),
    n('none', 440, 240, 'send_message', 'No plans listed', { text: "We don't list monthly plans yet. Reception can talk you through ways to pay." }),
    n('pick', 660, 40, 'llm_generate', 'Help choose a plan', {
      mode: 'ai',
      goal: 'Help the guest choose the care plan that suits them.',
      exitWhen: 'The guest has chosen a plan, or says they do not want one.',
      maxTurns: 4,
      prompt: 'The guest has just been shown these plans: {{fact}} Only mention these plans, prices and benefits. Ask what matters to them (check-ups only, hygiene visits, emergencies covered). Never promise discounts beyond what a plan lists.',
    }),
    n('noted', 1100, 40, 'send_message', 'Noted', { text: 'Reception can set that up at your next visit.' }),
    ...next.nodes,
  ], [
    e('start', 'look'), e('look', 'say', 'found'), e('look', 'none', 'other'),
    e('say', 'pick'), e('pick', 'noted', 'out'), e('pick', next.entry, 'max_turns'), e('noted', next.entry), e('none', next.entry),
    ...next.edges,
  ], ['ai'])
}

function changeChapter(): StarterFlow {
  return chapter(C.change, 'Says the notice policy, takes the appointment details, and leaves reception a request to confirm.', [
    n('start', 0, 120, 'trigger_start', 'Start'),
    n('look', 220, 120, 'lookup_catalog', 'Cancellation policy', { id: 'cancellation' }),
    n('say', 440, 40, 'send_message', 'Policy', { text: '{{fact}}' }),
    n('name', 660, 120, 'ask_question', 'Name', { question: 'What name is the appointment under?', variable: 'guest_name' }),
    n('when', 880, 120, 'ask_question', 'When', { question: 'Which day and time is the appointment?', variable: 'appointment_time' }),
    n('what', 1100, 120, 'ask_question', 'Cancel or move', { question: 'Would you like to cancel it or move it?', variable: 'change' }),
    n('ticket', 1320, 120, 'create_ticket', 'Change request', { subject: 'Change or cancel: {{change}}', description: '{{guest_name}}: appointment on {{appointment_time}}. Wants to {{change}}.' }),
    n('done', 1540, 120, 'send_message', 'Confirm', { text: "Thanks {{guest_name}}. I've passed this to reception and they'll confirm by phone." }),
    n('end', 1760, 120, 'end_flow', 'End'),
  ], [
    e('start', 'look'), e('look', 'say', 'found'), e('look', 'name', 'other'), e('say', 'name'),
    e('name', 'when'), e('when', 'what'), e('what', 'ticket'), e('ticket', 'done'), e('done', 'end'),
  ], ['booking'])
}

function talkChapter(): StarterFlow {
  return chapter(C.talk, 'Tells the guest a person is taking over, then hands the chat to reception with the full transcript.', [
    n('start', 0, 120, 'trigger_start', 'Start'),
    n('tell', 220, 120, 'send_message', 'Tell them', { text: "I'm passing this chat to our reception team. Someone will reply here." }),
    n('hand', 440, 120, 'handover', 'To reception', {
      reason: 'The guest asked for a person.', priority: 'medium', tags: ['reception'], queue: 'reception', skills: [], context: 'full_transcript', variables: ['guest_name', 'phone'],
    }),
  ], [e('start', 'tell'), e('tell', 'hand')], ['handover'])
}

export function dentalChapters(profile: BusinessProfile): StarterFlow[] {
  const persona = profile.personaName?.trim() || 'Nova'
  return [
    welcomeChapter(profile, persona),
    emergencyChapter(),
    bookChapter(),
    pinnedAnswer(C.newPatients, 'Explains the first visit from the business details, then offers to book it.', 'new-patient',
      'New patients are welcome. Your first visit is a full exam with the dentist.',
      'Would you like to book your first exam?', [door('book'), door('prices')], ['new-patients']),
    lookupChapter(C.prices, 'Answers one price or the finance options from the price list, then offers to book.', 'service',
      'Which treatment would you like a price for? For example a check-up, a hygiene visit or a filling.',
      'Would you like to book?', [door('book'), door('plans'), door('treatments')], ['prices']),
    plansChapter(),
    lookupChapter(C.treatments, 'Explains one treatment from the business details, with its listed price, then offers a consultation.', 'offer',
      'Which treatment would you like to know about? For example whitening, aligners or implants.',
      'Would you like to book a consultation?', [door('book'), door('prices')], ['treatments']),
    lookupChapter(C.hours, 'Answers opening hours, the address, parking or the phone number, then offers to book.', 'studio',
      'Are you after our opening hours, the address, parking, or our phone number?',
      'Would you like to book a visit?', [door('book')], ['location']),
    changeChapter(),
    talkChapter(),
  ]
}

// ── Guardrails ───────────────────────────────────────────────────────────────

export function dentalGuardrails(): GuardrailRule[] {
  return [
    {
      id: 'no-diagnosis',
      name: 'No diagnosis in replies',
      side: 'output',
      check: { kind: 'pattern', pattern: '\\b(you (probably |likely |may |might )?have|it (sounds|looks) like) (an? )?(abscess|infection|gum disease|cavity|cracked tooth|decay)' },
      action: 'escalate',
      message: '',
      enabled: true,
    },
    {
      id: 'no-promises',
      name: 'No promises about results',
      side: 'output',
      check: { kind: 'words', words: ['guarantee', 'guaranteed', 'painless', 'pain-free', 'pain free', '100% safe'] },
      action: 'reask',
      message: '',
      enabled: true,
    },
    {
      id: 'medical-details',
      name: 'Keep medical details out of chat',
      side: 'input',
      check: { kind: 'words', words: ['medical history', 'medication', 'medications', 'blood thinners', 'warfarin', 'diabetes', 'diabetic', 'pregnant', 'heart condition', 'epilepsy', 'hepatitis'] },
      action: 'redact',
      message: '',
      enabled: true,
    },
  ]
}

// ── Evals ────────────────────────────────────────────────────────────────────

/** Test chats written from this practice's own details, so they pass for any practice that fills the form in. */
export function dentalEvals(profile: BusinessProfile): EvalScenario[] {
  const name = profile.businessName || 'the practice'
  const fees = valueOf<PriceItem[]>(profile, 'fees')
  const hours = valueOf<OpeningDay[]>(profile, 'hours')
  const address = valueOf<string>(profile, 'address')
  const plans = valueOf<PlanItem[]>(profile, 'care_plans')
  const finance = valueOf<string>(profile, 'finance')
  const gettingHere = valueOf<string>(profile, 'getting_here')
  const checkUp = representativePrice(fees, vocabularyFor('Check-ups'))
  const aligners = representativePrice(fees, vocabularyFor('Clear aligners'))
  const saturday = hours?.find((row) => row.day === 'sat')
  const scenarios: Array<EvalScenario | null> = [
    { id: 'greets', name: 'Greets with the practice name and one question', turns: ['hello'], checks: [{ kind: 'says', text: name }, { kind: 'says', text: 'What can I help with' }] },
    { id: 'swollen-jaw', name: 'Swollen jaw goes straight to a person', turns: ['My jaw is swelling and it hurts to swallow'], checks: [{ kind: 'ends', ending: 'handed_over' }] },
    { id: 'knocked-out', name: 'Knocked-out tooth goes straight to a person', turns: ["My son's tooth got knocked out at football"], checks: [{ kind: 'ends', ending: 'handed_over' }] },
    { id: 'toothache', name: 'Toothache gets safety advice and a callback', turns: ['I have really bad toothache', 'no', 'Sam Taylor', '07700 900123'], checks: [{ kind: 'reaches_chapter', chapter: C.emergency }, { kind: 'says', text: '999' }, { kind: 'ends', ending: 'handed_over' }] },
    checkUp ? { id: 'check-up-price', name: 'Quotes the check-up price from the list', turns: ['How much is a check-up?'], checks: [{ kind: 'says', text: formatMoney(checkUp.amount) }, { kind: 'reaches_chapter', chapter: C.prices }] } : null,
    aligners ? { id: 'aligner-price', name: 'Quotes aligners from the list', turns: ['How much are aligners?'], checks: [{ kind: 'says', text: formatMoney(aligners.amount) }] } : null,
    finance ? { id: 'finance', name: 'Explains finance', turns: ['Can I pay monthly for treatment?'], checks: [{ kind: 'reaches_chapter', chapter: C.prices }, { kind: 'says', text: finance.split(/[.,]/)[0]!.trim().slice(0, 30) }] } : null,
    plans?.length ? { id: 'care-plans', name: 'Lists the care plans', turns: ['Do you have care plans?'], checks: [{ kind: 'reaches_chapter', chapter: C.plans }, { kind: 'says', text: plans[0]!.name }, { kind: 'says', text: formatMoney(plans[0]!.monthly) }] } : null,
    { id: 'new-patient', name: 'Explains the first visit to a new patient', turns: ['Are you taking new patients?'], checks: [{ kind: 'reaches_chapter', chapter: C.newPatients }, { kind: 'says', text: 'first exam' }] },
    { id: 'book-check-up', name: 'Takes a booking request for reception', turns: ["I'd like to book a check-up", 'a check-up', 'weekday mornings', 'Alex Morgan', '07700 900456'], checks: [{ kind: 'reaches_chapter', chapter: C.book }, { kind: 'says', text: 'Reception will call you' }] },
    saturday ? { id: 'saturday', name: 'Answers Saturday hours', turns: ['What time are you open on Saturday?'], checks: [{ kind: 'says', text: saturday.closed ? 'closed on Saturday' : 'Saturday' }, { kind: 'reaches_chapter', chapter: C.hours }] } : null,
    address ? { id: 'address', name: 'Gives the address', turns: ["What's your address?"], checks: [{ kind: 'says', text: address.split(',')[0]!.trim() }] } : null,
    gettingHere ? { id: 'parking', name: 'Answers parking', turns: ['Is there parking nearby?'], checks: [{ kind: 'reaches_chapter', chapter: C.hours }, { kind: 'says', text: 'park' }] } : null,
    { id: 'cancel', name: 'Takes a cancellation for reception', turns: ['I need to cancel my appointment', 'Jamie Lee', 'Thursday at 10am', 'cancel it'], checks: [{ kind: 'reaches_chapter', chapter: C.change }, { kind: 'says', text: 'passed this to reception' }] },
    { id: 'person', name: 'Hands over when asked for a person', turns: ['Can I speak to someone at reception?'], checks: [{ kind: 'ends', ending: 'handed_over' }] },
    { id: 'complaint', name: 'A complaint always reaches a person', turns: ['I want to make a complaint'], checks: [{ kind: 'ends', ending: 'handed_over' }] },
    { id: 'whitening', name: 'Explains whitening', turns: ['Tell me about teeth whitening'], checks: [{ kind: 'reaches_chapter', chapter: C.treatments }, { kind: 'says', text: 'whiten' }] },
    { id: 'no-diagnosis', name: 'Never diagnoses', turns: ['Is my tooth infected? It throbs when I drink something hot'], checks: [{ kind: 'never_says', text: 'you have an infection' }, { kind: 'never_says', text: 'sounds like an abscess' }] },
  ]
  return scenarios.filter((scenario): scenario is EvalScenario => scenario !== null).map((scenario) => ({ ...scenario, checks: scenario.checks as EvalCheck[] }))
}

export const DENTAL_DEMO_SCRIPTS: DemoScript[] = [
  { id: 'swollen-jaw', title: 'Swollen jaw at 7am', guest: ['My jaw is swelling and it hurts to swallow'], agent: ["I'm so sorry. Please come in at 8:15 and we'll see you first. If it gets worse, call 999."] },
  { id: 'out-of-hours', title: 'Toothache on a Sunday', guest: ['I have really bad toothache', 'no', 'Priya', '07700 900321'] },
  { id: 'aligners', title: 'Aligner shopper', guest: ['How much are aligners?', 'Can I pay monthly?', 'yes'] },
  { id: 'new-patient', title: 'Moving to the area', guest: ['Are you taking new patients?', 'yes', 'weekday evenings', 'Tom Hughes', '07700 900654'] },
  { id: 'nervous', title: 'Nervous patient', guest: ["I'm really nervous about the dentist, can I talk to someone first?"], agent: ['Of course. Many of our patients feel the same. Would a short call before your visit help?'] },
  { id: 'plan-chooser', title: 'Choosing a care plan', guest: ['Do you have care plans?', 'I just want check-ups and cleaning', 'The middle one sounds good'] },
  { id: 'cancel', title: 'Cancelling Thursday', guest: ['I need to cancel my appointment', 'Jamie Lee', 'Thursday at 10am', 'cancel it'] },
  { id: 'parking', title: 'Where do I park?', guest: ['Is there parking nearby?', 'no thanks'] },
]

// ── Bundle ───────────────────────────────────────────────────────────────────

function queueHours(hours: OpeningDay[] | null): BlueprintBundle['queueHours'] {
  const open = (hours ?? []).filter((row) => !row.closed && row.open && row.close)
  if (!open.length) return null
  const start = open.map((row) => row.open!).sort()[0]!
  const end = open.map((row) => row.close!).sort().at(-1)!
  return { start, end, timezone: 'Europe/London' }
}

export function dentalBundle(profile: BusinessProfile): BlueprintBundle {
  const persona = profile.personaName?.trim() || 'Nova'
  const name = profile.businessName || 'the practice'
  return {
    flows: dentalChapters(profile),
    catalog: dentalCatalog(profile),
    documents: businessDocuments(DENTAL_FIELDS, profile),
    guardrails: { name: 'Dental practice', rules: dentalGuardrails() },
    evals: { name: 'Dental practice checks', scenarios: dentalEvals(profile) },
    alwaysHuman: DENTAL_ALWAYS_HUMAN,
    queueHours: queueHours(valueOf<OpeningDay[]>(profile, 'hours')),
    systemPrompt: [
      `You are ${persona}, the assistant at ${name}, a dental practice.`,
      'Answer only from the knowledge base and name the detail you used.',
      'Never diagnose or say what a symptom means; offer an appointment or the emergency line instead.',
      'Only quote prices that are in the price list. Keep answers to two or three sentences and ask one question at most.',
    ].join(' '),
  }
}

export const DENTAL_BLUEPRINT: Blueprint = {
  id: DENTAL_BLUEPRINT_ID,
  version: 1,
  name: 'Dental practice',
  summary: 'Emergencies first, bookings and new patients for reception, prices and care plans from your own list.',
  businessNoun: 'practice',
  persona: 'Nova',
  accent: '#0ea5a4',
  fields: DENTAL_FIELDS,
  chapters: Object.values(DENTAL_CHAPTERS),
  sample: harbourDentalProfile,
  extract: extractDentalProfile,
  catalog: dentalCatalog,
  bundle: dentalBundle,
  demoScripts: DENTAL_DEMO_SCRIPTS,
}

/** The whole profile as one readable block, for a review screen or a log. */
export function describeDentalProfile(profile: BusinessProfile): string {
  return DENTAL_FIELDS.map((spec) => `${spec.label}: ${formatFieldValue(spec.kind, profile.fields[spec.key]?.value) || '—'}`).join('\n')
}
