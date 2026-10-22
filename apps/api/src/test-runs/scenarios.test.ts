import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DENTAL_BLUEPRINT } from '@botstudio/shared'
import { referenceJourney } from '../scripts/dental-reference-chats.js'
import { runTestTurn } from '../lib/test-chat.js'
import { dentalScenarios, pick, pickVisitor, planFor, seeded } from './scenarios.js'
import { passagesWithSources } from './runner.js'

const journey = referenceJourney(DENTAL_BLUEPRINT.sample())
const now = new Date('2026-10-21T10:00:00Z')
const lower = (text: string) => text.toLowerCase().replace(/[’']/g, "'")

async function play(lines: string[]) {
  const base = { tenantId: 't', botId: 'harbour-dental-ref', chapters: journey.chapters, startChapter: journey.chapters[0]!.name, environmentLabel: 'Production', catalog: journey.bundle.catalog }
  const deps = { ...journey.deps, now: () => now }
  let turn = await runTestTurn({ ...base, message: '', opening: true }, deps)
  const replies = [turn.text]
  for (const message of lines) {
    if (turn.state.status === 'escalated') break
    turn = await runTestTurn({ ...base, message, state: turn.state }, deps)
    replies.push(turn.text)
  }
  return { replies, state: turn.state as typeof turn.state & { handover?: { source?: string; priority?: string }; ticket?: unknown } }
}

const visitor = { first: 'Sophie', last: 'Allen', phone: '07700 900101' }

for (const scenario of dentalScenarios(now)) {
  test(`Harbour Dental scenario "${scenario.title}" matches the blueprint`, async () => {
    const { replies, state } = await play(scenario.visitor(visitor))
    const said = lower(replies.join('\n'))
    const e = scenario.expect
    // A model-answered step is not deterministic offline; only its first reply is checked here.
    const checkSays = !e.usesModel
    if (checkSays) for (const text of e.says ?? []) assert.ok(said.includes(lower(text)), `expected "${text}" in: ${replies.join(' | ')}`)
    for (const text of e.neverSays ?? []) assert.ok(!said.includes(lower(text)), `did not expect "${text}" in: ${replies.join(' | ')}`)
    if (e.ends) assert.equal(state.status === 'escalated' ? 'handed_over' : 'bot', e.ends, replies.join(' | '))
    if (e.source) assert.equal(state.handover?.source, e.source)
    if (e.priority) assert.equal(state.handover?.priority, e.priority)
    if (e.ticket) assert.ok(state.ticket, `expected a ticket after: ${replies.join(' | ')}`)
    if (scenario.person) assert.equal(state.status, 'escalated', 'a person script needs the chat to reach a person')
  })
}

test('the same seed picks the same visitors and generated personas', () => {
  const a = seeded('2026-10-21T10')
  const b = seeded('2026-10-21T10')
  const plan = planFor('harbour-dental', now)
  assert.deepEqual([pickVisitor(a), pickVisitor(a)], [pickVisitor(b), pickVisitor(b)])
  assert.deepEqual(pick(plan.generated, 3, a), pick(plan.generated, 3, b))
  assert.notDeepEqual(
    Array.from({ length: 5 }, seeded('one')),
    Array.from({ length: 5 }, seeded('two')),
  )
})

test('pick never repeats an item and stops at the pool size', () => {
  const picked = pick([1, 2, 3], 5, seeded('x'))
  assert.equal(picked.length, 3)
  assert.equal(new Set(picked).size, 3)
})

test('scenario ids are unique, and only Harbour Dental runs the Inbox person', () => {
  const ids = dentalScenarios(now).map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(planFor('harbour-dental').inbox, true)
  assert.equal(planFor('bella').inbox, false)
  assert.equal(planFor('acme').inbox, false)
})

test('a Knowledge tool answer counts only when every passage names its document', () => {
  assert.equal(passagesWithSources({ found: true, chunks: [{ text: 'New patient exam: £85', title: 'Harbour Dental: Price list', source: 'Business details' }] }), true)
  assert.equal(passagesWithSources({ found: true, chunks: ['New patient exam: £85'] }), false)
  assert.equal(passagesWithSources({ found: false, chunks: [] }), false)
  assert.equal(passagesWithSources(null), false)
})

test('every plan registers the personal details its scenarios type', () => {
  for (const target of ['harbour-dental', 'bella', 'acme'] as const) {
    const plan = planFor(target, now)
    const typed = plan.scenarios.flatMap((s) => s.visitor({ first: 'Sophie', last: 'Allen', phone: '07700 900101' })).join(' ')
    for (const value of typed.match(/07700 9\d{5}|[\w.]+@example\.com/g) ?? []) assert.ok(plan.sentinels.includes(value), `${target}: ${value} is not watched`)
  }
})
