import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FlowGraph } from '@botstudio/runtime'
import {
  DEFAULT_PRIVACY,
  evalIssues,
  judgeScenario,
  parseEvalScenarios,
  parseReleaseChapters,
  releaseDiff,
  withChapter,
  type EvalScenario,
  type ReleaseChapter,
} from '@botstudio/shared'
import { runTestTurn, type TestChatDeps } from './test-chat.js'
import { playScenario, runGate, runSuite, type EvalDeps } from './evals.js'
import { chapterRow, hasSteps, snapshotEntry, type JourneySnapshot } from './releases.js'
import { BundleError, parseBundle, planImport, serialiseBundle, type Bundle } from './bundle.js'

const quietModel = {
  classify: async () => ({ category: 'other', confidence: 0 }),
  embed: async () => ({ embeddings: [[]] }),
  complete: async () => ({ content: '' }),
  stream: async () => {},
}

const node = (id: string, kind: string, config: Record<string, unknown> = {}) => ({ id, data: { kind, label: id, config } })
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })

const bookingChart = {
  nodes: [
    node('start', 'start'),
    node('ask', 'ask_question', { question: 'Which service would you like?', variable: 'service' }),
    node('done', 'send_message', { text: 'Lovely, a {{service}} it is.' }),
    node('end', 'end_flow'),
  ],
  edges: [edge('start', 'ask'), edge('ask', 'done'), edge('done', 'end')],
} as unknown as FlowGraph

const chatDeps: Partial<TestChatDeps> = {
  handoverRules: async () => ({ liveAgents: false, alwaysHuman: [] }),
  answer: async () => {},
  llm: async () => quietModel as never,
  catalog: async () => ({ facts: [] }),
  safety: async () => ({ rules: [], privacy: DEFAULT_PRIVACY }),
  db: {},
  now: () => new Date('2026-10-19T12:00:00Z'),
}

const snapshot: JourneySnapshot = {
  chapters: [{ flowId: 'f1', flowVersionId: 'v1', version: 1, name: 'Bookings', tags: ['welcome'], graph: bookingChart }],
  entry: 'Bookings',
}

function evalDeps(saved: unknown[]): Partial<EvalDeps> {
  return {
    turn: (input) => runTestTurn(input, chatDeps),
    cost: async () => 0.0042,
    save: async (row) => {
      saved.push(row)
      return { id: `run-${saved.length}`, createdAt: new Date('2026-10-19T12:00:00Z') }
    },
  }
}

const books: EvalScenario = {
  id: 's1',
  name: 'Books a cut',
  turns: ['haircut'],
  checks: [
    { kind: 'says', text: 'which service' },
    { kind: 'says', text: 'a haircut it is' },
    { kind: 'reaches_chapter', chapter: 'bookings' },
    { kind: 'not_blocked' },
  ],
}

const refunds: EvalScenario = {
  id: 's2',
  name: 'Never promises a refund',
  turns: ['haircut'],
  checks: [{ kind: 'never_says', text: 'haircut' }],
}

test('a scenario plays the greeting and each guest message through the test chat, then is judged', async () => {
  const result = await playScenario(books, { tenantId: 't', botId: 'b', snapshot, environmentLabel: 'Sandbox' }, (input) => runTestTurn(input, chatDeps))
  assert.equal(result.error, undefined)
  assert.deepEqual(result.transcript.map((line) => line.role), ['bot', 'guest', 'bot'])
  assert.match(result.transcript[2]!.text, /a haircut it is/)
  assert.ok(result.checks.every((check) => check.passed), JSON.stringify(result.checks))
  assert.equal(result.passed, true)
})

test('a suite run counts passes and failures, sums its cost and is saved as failed', async () => {
  const saved: Array<Record<string, unknown>> = []
  const run = await runSuite({
    tenantId: 't',
    botId: 'b',
    suite: { id: 'suite', name: 'Salon basics', scenarios: [books, refunds] },
    snapshot,
    target: { kind: 'working_copy', chapters: [{ name: 'Bookings', version: 1 }] },
    trigger: 'manual',
  }, evalDeps(saved))
  assert.equal(run.status, 'failed')
  assert.equal(run.passed, 1)
  assert.equal(run.failed, 1)
  assert.equal(run.costUsd, 0.0042)
  assert.equal(saved.length, 1)
  assert.equal(saved[0]!['trigger'], 'manual')
  const failed = run.results.find((result) => !result.passed)!
  assert.match(failed.checks[0]!.detail, /Bot reply 2 contains these words/)
})

test('a scenario whose chat throws is an error, and an error fails the gate', async () => {
  const broken = await playScenario(books, { tenantId: 't', botId: 'b', snapshot, environmentLabel: 'Production' }, async () => {
    throw new Error('model unreachable')
  })
  assert.equal(broken.passed, false)
  assert.match(broken.error ?? '', /model unreachable/)

  const gate = await runGate({ tenantId: 't', botId: 'b', snapshot }, {
    ...evalDeps([]),
    turn: async () => { throw new Error('model unreachable') },
    suites: [{ id: 'g', name: 'Gate', scenarios: [books] }],
  })
  assert.equal(gate.passed, false)
  assert.equal(gate.runs[0]!.status, 'error')
  assert.equal(gate.runs[0]!.trigger, 'publish')
})

test('the gate is open with no gate suites, and suites without scenarios are not run', async () => {
  const none = await runGate({ tenantId: 't', botId: 'b', snapshot }, { ...evalDeps([]), suites: [] })
  assert.deepEqual(none, { passed: true, runs: [] })
  const empty = await runGate({ tenantId: 't', botId: 'b', snapshot }, { ...evalDeps([]), suites: [{ id: 'g', name: 'Empty', scenarios: [] }] })
  assert.deepEqual(empty, { passed: true, runs: [] })
  const passing = await runGate({ tenantId: 't', botId: 'b', snapshot }, { ...evalDeps([]), suites: [{ id: 'g', name: 'Gate', scenarios: [books] }] })
  assert.equal(passing.passed, true)
  assert.deepEqual(passing.runs.map((run) => run.status), ['passed'])
})

test('checks are judged from the transcript and the end state', () => {
  const observed = {
    transcript: [
      { role: 'bot' as const, text: 'Hi! What can I do?', path: 'journey', chapter: 'Welcome' },
      { role: 'guest' as const, text: 'refund please' },
      { role: 'bot' as const, text: 'I can’t share that.', path: 'guardrail', chapter: 'Welcome' },
    ],
    status: 'escalated' as const,
  }
  const results = judgeScenario({
    id: 'x',
    name: 'x',
    turns: ['refund please'],
    checks: [
      { kind: 'says', text: "I CAN'T   share" },
      { kind: 'ends', ending: 'handed_over' },
      { kind: 'ends', ending: 'resolved' },
      { kind: 'reaches_chapter', chapter: 'Refunds' },
      { kind: 'not_blocked' },
    ],
  }, observed)
  assert.deepEqual(results.map((result) => result.passed), [true, true, false, false, false])
  assert.match(results[3]!.detail, /Chapters reached: Welcome/)
  assert.match(results[4]!.detail, /Bot reply 2 was stopped/)
})

test('a suite cannot be saved with an unnamed scenario, no guest messages or an empty check', () => {
  const scenarios = parseEvalScenarios([{ id: 'a', name: '', turns: [' '], checks: [{ kind: 'says', text: '' }, { kind: 'bogus' }] }])
  assert.equal(scenarios[0]!.checks.length, 1)
  const messages = evalIssues(scenarios).map((issue) => issue.message)
  assert.ok(messages.some((message) => /Give the scenario a name/.test(message)))
  assert.ok(messages.some((message) => /no guest messages/.test(message)))
  assert.ok(messages.some((message) => /needs the words to look for/.test(message)))
})

const chapter = (flowId: string, name: string, graph: unknown, version = 1): ReleaseChapter => ({ flowId, flowVersionId: `${flowId}-v${version}`, version, name, tags: [], graph })

test('a release diff names added, removed, changed and unchanged chapters', () => {
  const live = [chapter('a', 'Welcome', { n: 1 }), chapter('b', 'Bookings', { n: 1 }), chapter('c', 'Prices', { n: 1 })]
  const next = [chapter('a', 'Welcome', { n: 1 }), chapter('b', 'Bookings', { n: 2 }, 2), chapter('d', 'Gift cards', { n: 1 })]
  assert.deepEqual(releaseDiff(live, next), { added: ['Gift cards'], removed: ['Prices'], changed: ['Bookings'], unchanged: ['Welcome'] })
})

test('publishing one chapter swaps it into what is live and leaves the others alone', () => {
  const live = [chapter('a', 'Welcome', { n: 1 }), chapter('b', 'Bookings', { n: 1 })]
  const next = withChapter(live, chapter('b', 'Bookings', { n: 3 }, 3))
  assert.deepEqual(next.map((item) => item.flowVersionId), ['a-v1', 'b-v3'])
  assert.deepEqual(withChapter(live, chapter('z', 'New', {})).map((item) => item.name), ['Welcome', 'Bookings', 'New'])
})

test('release chapters read back safely and play as version rows', () => {
  const parsed = parseReleaseChapters([{ flowId: 'a', flowVersionId: 'v', name: 'Welcome', tags: ['welcome', 3], graph: { nodes: [1] } }, { name: 'broken' }, null])
  assert.equal(parsed.length, 1)
  assert.deepEqual(parsed[0]!.tags, ['welcome'])
  assert.deepEqual(chapterRow(parsed[0]!), { id: 'v', flowId: 'a', graph: { nodes: [1] }, flow: { name: 'Welcome', tags: ['welcome'] } })
  assert.equal(snapshotEntry([chapter('b', 'Bookings', {}), { ...chapter('a', 'Hello', {}), tags: ['welcome'] }]), 'Hello')
  assert.equal(snapshotEntry([chapter('b', 'Bookings', {})]), 'Bookings')
  assert.equal(hasSteps({ nodes: [] }), false)
  assert.equal(hasSteps({ nodes: [{ id: 'x' }] }), true)
})

function bundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    format: 'botstudio.bundle',
    version: 1,
    exportedAt: '2026-10-19T12:00:00.000Z',
    bot: { name: 'Yuzu' },
    chapters: [],
    tools: [],
    guardrailPolicies: [],
    privacy: null,
    evalSuites: [],
    ...overrides,
  }
}

const graph = (text: string) => ({ nodes: [{ id: 'start', data: { kind: 'start', label: 'start', config: {} } }, { id: 'm', data: { kind: 'send_message', label: 'm', config: { text } } }], edges: [] })
const lookupTool = {
  name: 'lookup_booking',
  kind: 'http',
  description: 'Looks up a booking by its reference number.',
  effect: 'read',
  parameters: [{ name: 'ref', type: 'string', description: 'Booking reference', required: true }],
  returns: {},
  config: { method: 'GET', url: 'https://salon.example.com/bookings/{{ref}}' },
  authProfile: 'Salon API',
}

test('a bundle survives a YAML round trip and a JSON round trip', () => {
  const original = bundle({
    chapters: [{ name: 'Bookings', tags: ['booking'], graph: graph('Hi: "quoted" and a colon') }],
    tools: [lookupTool],
    evalSuites: [{ name: 'Basics', gate: true, scenarios: [books] }],
  })
  for (const format of ['yaml', 'json'] as const) {
    const back = parseBundle(serialiseBundle(original, format))
    assert.deepEqual(back.chapters, original.chapters)
    assert.deepEqual(back.tools, original.tools)
    assert.deepEqual(back.evalSuites, original.evalSuites)
  }
})

test('a file that is not a bundle is refused with the field that is wrong', () => {
  assert.throws(() => parseBundle('{"format":"other"}'), (err: unknown) => err instanceof BundleError && /format/.test(err.message))
  assert.throws(() => parseBundle('nodes: [unclosed'), (err: unknown) => err instanceof BundleError && /not valid JSON or YAML/.test(err.message))
})

test('import modes: skip keeps what exists, merge updates it, replace also removes what the file lacks', () => {
  const current = bundle({
    chapters: [
      { name: 'Bookings', tags: [], graph: graph('old') },
      { name: 'Prices', tags: [], graph: graph('prices') },
      { name: 'Old draft', tags: [], graph: graph('draft') },
    ],
  })
  const incoming = bundle({ chapters: [{ name: 'Bookings', tags: [], graph: graph('new') }, { name: 'Gift cards', tags: [], graph: graph('gifts') }] })
  const actions = (mode: 'skip' | 'merge' | 'replace') => planImport(current, incoming, mode, [], ['Prices']).items.map((item) => `${item.name}:${item.action}`)
  assert.deepEqual(actions('skip'), ['Bookings:keep', 'Gift cards:create'])
  assert.deepEqual(actions('merge'), ['Bookings:update', 'Gift cards:create'])
  assert.deepEqual(actions('replace'), ['Bookings:update', 'Gift cards:create', 'Prices:keep', 'Old draft:delete'])
  const same = planImport(current, bundle({ chapters: [current.chapters[0]!] }), 'merge')
  assert.deepEqual(same.items.map((item) => item.action), ['unchanged'])
})

test('import flags a tool with a credential header, a missing Auth Profile and a step pointing at an unknown tool', () => {
  const plan = planImport(bundle(), bundle({
    tools: [lookupTool, { ...lookupTool, name: 'leaky_tool', config: { method: 'GET', url: 'https://x.example.com', headers: { Authorization: 'Bearer abc' } } }],
    chapters: [{ name: 'Orders', tags: [], graph: { nodes: [{ id: 't', data: { kind: 'run_tool', label: 't', config: { toolId: '@tool:missing_tool' } } }], edges: [] } }],
    privacy: { ...DEFAULT_PRIVACY, revealToAgents: true },
  }), 'merge', [])
  const leaky = plan.items.find((item) => item.name === 'leaky_tool')!
  assert.equal(leaky.action, 'invalid')
  assert.match(leaky.note ?? '', /Auth Profile/)
  assert.ok(plan.warnings.some((warning) => /"Salon API", which this workspace does not have/.test(warning)))
  assert.ok(plan.warnings.some((warning) => /runs the tool "missing_tool"/.test(warning)))
  assert.ok(plan.warnings.some((warning) => /Import keeps this off/.test(warning)))
})
