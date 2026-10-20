import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_PRIVACY,
  DENTAL_BLUEPRINT,
  DENTAL_CHAPTERS,
  acceptChanges,
  applyProfileEdit,
  businessDocuments,
  diffProfiles,
  evalIssues,
  formatWeeklyHours,
  guardrailIssues,
  hoursFromLine,
  inspectFlowGraph,
  pageFromHtml,
  parseBusinessProfile,
  profileIssues,
  stepMode,
  aiStepContract,
  type BusinessProfile,
  type PriceItem,
} from '@ybot/shared'
import type { FlowGraph } from '@ybot/runtime'
import { playScenario } from './evals.js'
import { runTestTurn, type TestChatDeps } from './test-chat.js'

const bp = DENTAL_BLUEPRINT
const sample = bp.sample()
const bundle = bp.bundle(sample)

test('every dental chapter passes the publish check', () => {
  const flowNames = bundle.flows.map((flow) => flow.name)
  assert.deepEqual(flowNames, Object.values(DENTAL_CHAPTERS))
  for (const flow of bundle.flows) {
    const blocking = inspectFlowGraph(flow.graph as never, { flowNames }).filter((issue) => issue.level !== 'note')
    assert.deepEqual(blocking, [], `${flow.name}: ${blocking.map((issue) => issue.message).join(' ')}`)
  }
})

test('the welcome greets, then asks one different question, and its router has a fallback', () => {
  const welcome = bundle.flows.find((flow) => flow.name === DENTAL_CHAPTERS.welcome)!
  const nodes = welcome.graph.nodes as Array<{ id: string; data: { kind: string; config: Record<string, unknown> } }>
  const greeting = String(nodes.find((node) => node.id === 'hello')!.data.config['text'])
  const question = String(nodes.find((node) => node.id === 'ask')!.data.config['question'])
  assert.equal(greeting, "Hi, I'm Nova at Harbour Dental.")
  assert.notEqual(greeting.toLowerCase(), question.toLowerCase())
  assert.equal((question.match(/\?/g) ?? []).length, 1)
  const edges = welcome.graph.edges as Array<{ source: string; sourceHandle?: string }>
  for (const router of nodes.filter((node) => node.data.kind === 'route_topic')) {
    assert.ok(edges.some((edge) => edge.source === router.id && edge.sourceHandle === 'other'), `${router.id} has no fallback`)
  }
})

test('the care plan step is an AI step with a goal, an exit condition and a turn limit', () => {
  const plans = bundle.flows.find((flow) => flow.name === DENTAL_CHAPTERS.plans)!
  const ai = (plans.graph.nodes as Array<{ data: { kind: string; config: Record<string, unknown> } }>)
    .filter((node) => stepMode(node.data.kind, node.data.config) === 'ai')
  assert.equal(ai.length, 1)
  assert.deepEqual(aiStepContract(ai[0]!.data.config).missing, [])
  assert.equal(ai[0]!.data.config['maxTurns'], 4)
})

test('chapters hold no prices: every number a guest hears comes from the catalog', () => {
  for (const flow of bundle.flows) {
    assert.doesNotMatch(JSON.stringify(flow.graph), /£\d/, `${flow.name} has a price in its lines`)
  }
  const pinned = bundle.flows.flatMap((flow) => (flow.graph.nodes as Array<{ data: { kind: string; config: Record<string, unknown> } }>)
    .filter((node) => node.data.kind === 'lookup_catalog' && node.data.config['id'])
    .map((node) => String(node.data.config['id'])))
  for (const id of pinned) assert.ok(bundle.catalog.facts.some((fact) => fact.id === id), `no catalog fact for ${id}`)
})

test('handovers carry a priority, a queue and the full transcript', () => {
  for (const flow of bundle.flows) {
    for (const node of flow.graph.nodes as Array<{ data: { kind: string; config: Record<string, unknown> } }>) {
      if (node.data.kind !== 'handover') continue
      assert.ok(['low', 'medium', 'high', 'critical'].includes(String(node.data.config['priority'])))
      assert.ok(String(node.data.config['queue']))
      assert.equal(node.data.config['context'], 'full_transcript')
    }
  }
})

test('the sample compiles to catalog facts, Knowledge documents, guardrails and evals that pass their own checks', () => {
  const ids = bundle.catalog.facts.map((fact) => fact.id)
  for (const id of ['hours', 'address', 'getting-here', 'phone', 'finance', 'care-plans', 'new-patient', 'emergency', 'booking-link', 'cancellation']) {
    assert.ok(ids.includes(id), `missing ${id}`)
  }
  assert.ok(bundle.catalog.facts.find((fact) => fact.id === 'price-check-up')!.fact.includes('£45'))
  const whitening = bundle.catalog.facts.find((fact) => fact.id === 'treatment-teeth-whitening')!
  assert.match(whitening.fact, /Home whitening is £395/)
  assert.equal(bundle.documents.length, bp.fields.length)
  assert.ok(bundle.documents.every((doc) => doc.title.startsWith('Harbour Dental: ')))
  assert.deepEqual(guardrailIssues(bundle.guardrails.rules), [])
  assert.deepEqual(evalIssues(bundle.evals.scenarios), [])
  assert.equal(bundle.evals.scenarios.length, 18)
  assert.deepEqual(bundle.queueHours, { start: '08:00', end: '18:00', timezone: 'Europe/London' })
  assert.deepEqual(profileIssues(bp.fields, sample), [])
})

// ── Reading a practice website ───────────────────────────────────────────────

const FOOTER = (monday: string) => `
<footer><h4>Quick Contact</h4><p>+44 (0117) 4960123</p><p>hello@harbourdental.example</p>
<p>12 Anchor Row Harbourside BRISTOL BS1 5XX</p>
<h4>Working Hours</h4><p>Monday : 8 am - ${monday} pm</p><p>Tuesday - Thursday : 8 am - 5 pm</p><p>Friday : 8 am - 4 pm</p><p>Saturday : 8 am - 1 pm</p><p>Sunday : Closed</p></footer>`

const NAV = `<nav aria-label="Menu"><ul><li><a href="/treatments/">Treatments</a><ul><li><a href="/treatments/#whitening">Whitening</a><li><a href="/treatments/#implants">Implants</a></ul><li><a href="/fees/">Fees</a></ul></nav>`

const SITE: Record<string, string> = {
  'https://harbourdental.example/': `<html><head><title>Harbour Dental — Bristol</title></head><body>${NAV}
<header><p>0117 496 0123</p><p>12 Anchor Row, Harbourside, Bristol BS1 5XX</p></header>
<main><h1>Your smile, our harbour</h1><p>A friendly independent practice for the whole family, from routine check-ups to implants.</p></main>${FOOTER('6')}</body></html>`,
  'https://harbourdental.example/fees/': `<html><head><title>Fees — Harbour Dental</title></head><body>${NAV}<main>
<h2>Exams</h2><table><tr><td>New patient exam</td><td>£85</td></tr><tr><td>Check-up</td><td>£45</td></tr></table>
<h2>Fillings</h2><table><tr><td>Small</td><td>From £115</td></tr><tr><td>Large</td><td>From £240</td></tr></table>
<h2>Straightening</h2><table><tr><td>Clear aligners</td><td>From £2,950</td></tr></table>
<h2>Whitening</h2><table><tr><td>Home whitening</td><td>£395</td></tr></table>
<h2>Payment Plans &amp; Financing</h2><p>0% finance on treatment over £1,000</p>
<h2>Care plans</h2><p>Essential Plan</p><p>£10.50</p><p>per month</p><p>Check-up x1</p><p>Hygiene x1</p>
<p>Complete Plan</p><p>£18.00</p><p>per month</p><p>Check-up x2</p><p>Hygiene x2</p><p>Emergency assessments included</p>
<h3>Contact Us</h3></main>${FOOTER('6')}</body></html>`,
  'https://harbourdental.example/contact/': `<html><head><title>Contact — Harbour Dental</title></head><body>${NAV}<main>
<h2>Parking</h2><p>The Anchor Row car park is a two-minute walk and allows two hours.</p>
<h2>By train</h2><p>Temple Meads station is a 15-minute walk from the practice.</p>
<h2>Emergencies</h2><p>If you have a dental emergency during opening hours, call us on 0117 496 0123 and we will see you the same day.</p>
</main>${FOOTER('5')}</body></html>`,
  'https://harbourdental.example/new-patients/': `<html><head><title>New patients — Harbour Dental</title></head><body>${NAV}<main>
<p>1. Book : Choose a new patient exam online or by phone.</p><p>2. Exam : The dentist checks your teeth, gums and mouth.</p><p>3. Plan : You get a written plan with every cost.</p>
<p>Before your visit we text you a link to a secure medical history form so the day runs smoothly.</p></main>${FOOTER('6')}</body></html>`,
  'https://harbourdental.example/book/': `<html><head><title>Book — Harbour Dental</title></head><body><a href="https://facebook.com/harbourdental">Facebook</a><a href="https://harbour-dental.portal.dental/login">Book online</a></body></html>`,
  'https://harbourdental.example/treatments/': `<html><head><title>Treatments — Harbour Dental</title></head><body>${NAV}<main>
<h2>Teeth whitening</h2><p>Dreaming of a brighter smile? Teeth whitening uses custom trays and a gentle gel you wear at home for about two weeks.</p>
<h2>Dental implants</h2><p>An implant is a titanium post that replaces the root of a missing tooth and holds a natural-looking crown.</p>
</main>${FOOTER('6')}</body></html>`,
}

const pages = Object.entries(SITE).map(([url, html]) => pageFromHtml(url, html))

test('day lines read as opening hours, ranges and closed days included', () => {
  assert.deepEqual(hoursFromLine('Tuesday - Thursday : 8 am - 5 pm'), [
    { day: 'tue', open: '08:00', close: '17:00' }, { day: 'wed', open: '08:00', close: '17:00' }, { day: 'thu', open: '08:00', close: '17:00' },
  ])
  assert.deepEqual(hoursFromLine('Sat 8.00am to 1:00pm'), [{ day: 'sat', open: '08:00', close: '13:00' }])
  assert.deepEqual(hoursFromLine('Sun Closed'), [{ day: 'sun', closed: true }])
  assert.deepEqual(hoursFromLine('Saturday appointments are popular'), [])
})

test('a practice website reads into typed business details with their source pages', () => {
  const profile = bp.extract(pages, '2026-10-20T09:00:00.000Z')
  const field = (key: string) => profile.fields[key]!
  assert.equal(profile.businessName, 'Harbour Dental')
  assert.equal(field('phone').value, '0117 496 0123')
  assert.equal(field('address').value, '12 Anchor Row, Harbourside, Bristol BS1 5XX')

  assert.equal(field('hours').status, 'conflict')
  assert.equal(formatWeeklyHours(field('hours').value as never), 'Monday 8am to 6pm; Tuesday to Thursday 8am to 5pm; Friday 8am to 4pm; Saturday 8am to 1pm; closed on Sunday.')
  assert.match(field('hours').note ?? '', /Monday/)

  const fees = field('fees').value as PriceItem[]
  assert.deepEqual(fees.map((item) => item.name), ['New patient exam', 'Check-up', 'Fillings, small', 'Fillings, large', 'Clear aligners', 'Home whitening'])
  assert.deepEqual(fees.find((item) => item.name === 'Clear aligners'), { name: 'Clear aligners', amount: 2950, from: true, group: 'Straightening' })
  assert.equal(field('fees').source?.url, 'https://harbourdental.example/fees/')

  assert.deepEqual((field('care_plans').value as Array<{ name: string; monthly: number }>).map(({ name, monthly }) => [name, monthly]), [['Essential Plan', 10.5], ['Complete Plan', 18]])
  assert.match(String(field('finance').value), /^0% finance on treatment over £1,000\.$/)
  assert.deepEqual(field('new_patient').value, [
    'Book: Choose a new patient exam online or by phone.',
    'Exam: The dentist checks your teeth, gums and mouth.',
    'Plan: You get a written plan with every cost.',
    'Before your visit we text you a link to a secure medical history form so the day runs smoothly.',
  ])
  assert.match(String(field('emergency').value), /same day/)
  assert.equal(field('booking_link').value, 'https://harbour-dental.portal.dental/')
  assert.match(String(field('getting_here').value), /car park/)
  const treatments = field('treatments').value as Array<{ name: string; summary: string }>
  assert.deepEqual(treatments.map((item) => item.name), ['Implants', 'Teeth whitening'])
  assert.match(treatments[1]!.summary, /^Teeth whitening uses custom trays/)
  assert.equal(field('cancellation').status, 'missing')
})

// ── Editing ──────────────────────────────────────────────────────────────────

test('an edit marks changed fields as edited, keeps the rest, and stamps who did it', () => {
  const scanned = bp.extract(pages, '2026-10-20T09:00:00.000Z')
  const next = structuredClone(scanned)
  ;(next.fields['fees']!.value as PriceItem[])[1]!.amount = 49
  next.fields['hours']!.status = 'confirmed'
  const saved = applyProfileEdit(bp.fields, scanned, next, { userId: 'u1', at: '2026-10-21T10:00:00.000Z' })
  assert.equal(saved.fields['fees']!.status, 'edited')
  assert.equal(saved.fields['fees']!.updatedBy, 'u1')
  assert.equal(saved.fields['hours']!.status, 'confirmed')
  assert.equal(saved.fields['hours']!.note, undefined)
  assert.equal(saved.fields['phone']!.status, 'found')
  assert.equal(saved.fields['phone']!.updatedBy, undefined)
  assert.match(bp.catalog(saved).facts.find((fact) => fact.id === 'price-check-up')!.fact, /£49/)
})

test('a fresh read lists only the fields that changed, and accepting one keeps the others', () => {
  const current: BusinessProfile = bp.extract(pages, '2026-10-20T09:00:00.000Z')
  const changedSite = { ...SITE, 'https://harbourdental.example/fees/': SITE['https://harbourdental.example/fees/']!.replace('£45', '£48') }
  const fresh = bp.extract(Object.entries(changedSite).map(([url, html]) => pageFromHtml(url, html)), '2026-11-01T09:00:00.000Z')
  const changes = diffProfiles(bp.fields, current, fresh)
  assert.deepEqual(changes.map((change) => change.key), ['fees'])
  assert.match(changes[0]!.before, /Check-up: £45/)
  assert.match(changes[0]!.after, /Check-up: £48/)
  const accepted = acceptChanges(current, fresh, ['fees'], { userId: 'u2', at: '2026-11-01T10:00:00.000Z' })
  assert.equal(accepted.fields['fees']!.status, 'confirmed')
  assert.equal(accepted.fields['phone'], current.fields['phone'])
})

test('posted business details are coerced to the field types and unknown fields are dropped', () => {
  const parsed = parseBusinessProfile(bp.fields, {
    blueprintId: 'dental-practice',
    businessName: '  Harbour Dental ',
    fields: {
      phone: { value: '0117 496 0123', status: 'edited' },
      fees: { value: [{ name: 'Check-up', amount: '£45' }, { name: '', amount: 3 }, { name: 'Free?', amount: 'n/a' }] },
      hours: { value: [{ day: 'mon', open: '8:00', close: '18:00' }, { day: 'funday', open: '1:00', close: '2:00' }, { day: 'sun', closed: true }] },
      booking_link: { value: 'javascript:alert(1)' },
      secret: { value: 'x' },
    },
  })!
  assert.equal(parsed.businessName, 'Harbour Dental')
  assert.deepEqual(parsed.fields['fees']!.value, [{ name: 'Check-up', amount: 45 }])
  assert.deepEqual(parsed.fields['hours']!.value, [{ day: 'mon', open: '08:00', close: '18:00' }, { day: 'sun', closed: true }])
  assert.equal(parsed.fields['booking_link']!.value, null)
  assert.equal(parsed.fields['booking_link']!.status, 'missing')
  assert.equal('secret' in parsed.fields, false)
  const issues = profileIssues(bp.fields, parsed)
  assert.ok(issues.some((issue) => issue.field === 'treatments' && issue.level === 'block'))
})

test('Knowledge documents point back at the page each detail came from', () => {
  const docs = businessDocuments(bp.fields, bp.extract(pages))
  assert.equal(docs.find((doc) => doc.key === 'fees')!.url, 'https://harbourdental.example/fees/')
  assert.match(docs.find((doc) => doc.key === 'fees')!.content, /Clear aligners: from £2,950/)
})

// ── The blueprint's own checks, played through the test chat ────────────────

function quietModel() {
  return {
    classify: async () => ({ category: 'other', confidence: 0 }),
    embed: async () => ({ embeddings: [[]] }),
    complete: async () => ({ content: '' }),
    stream: async () => {},
  }
}

async function failedScenarios(profile: BusinessProfile) {
  const compiled = bp.bundle(profile)
  const deps: Partial<TestChatDeps> = {
    handoverRules: async () => ({ liveAgents: true, alwaysHuman: compiled.alwaysHuman }),
    answer: async () => {},
    llm: async () => quietModel() as never,
    catalog: async () => compiled.catalog,
    db: {},
    now: () => new Date('2026-10-20T10:00:00.000Z'),
    safety: async () => ({ rules: compiled.guardrails.rules, privacy: DEFAULT_PRIVACY }),
  }
  const snapshot = {
    entry: DENTAL_CHAPTERS.welcome,
    chapters: compiled.flows.map((flow, index) => ({ name: flow.name, version: index + 1, flowId: `f${index}`, graph: flow.graph as unknown as FlowGraph })),
  }
  const results = []
  for (const scenario of compiled.evals.scenarios) {
    results.push(await playScenario(scenario, { tenantId: 't', botId: 'b', snapshot: snapshot as never, environmentLabel: 'Sandbox' }, (input) => runTestTurn({ ...input, catalog: compiled.catalog }, deps)))
  }
  return results
    .filter((result) => !result.passed)
    .map((result) => `${result.name}: ${result.error ?? result.checks.filter((check) => !check.passed).map((check) => check.detail).join(' ')} | ${result.transcript.map((line) => `${line.role}: ${line.text}`).join(' / ')}`)
}

test('the Harbour Dental eval suite passes on the blueprint chapters without a model', async () => {
  assert.deepEqual(await failedScenarios(sample), [])
})

test('a price list that never says "check-up" still answers it, and bundles never win a single treatment', async () => {
  const fees: PriceItem[] = [
    { name: 'New patient exam', amount: 85 },
    { name: 'Existing patient exam', amount: 45 },
    { name: 'Bundle exam & regular hygiene', amount: 120 },
    { name: 'Regular hygiene', amount: 85 },
    { name: 'Clear braces/Invisalign', amount: 3000, from: true },
    { name: 'Six month smiles', amount: 2200 },
  ]
  const profile: BusinessProfile = { ...sample, fields: { ...sample.fields, fees: { value: fees, status: 'confirmed' } } }
  const catalog = bp.catalog(profile)
  const phrasesOf = (title: string) => catalog.facts.find((fact) => fact.title === title)!.phrases
  assert.ok(phrasesOf('Existing patient exam').includes('check-up'))
  assert.ok(!phrasesOf('New patient exam').includes('check-up'))
  assert.ok(phrasesOf('Regular hygiene').includes('hygienist'))
  assert.ok(!phrasesOf('Bundle exam & regular hygiene').includes('hygienist'))
  assert.ok(!phrasesOf('Clear braces/Invisalign').includes('six month smiles'))
  assert.deepEqual(await failedScenarios(profile), [])
})
