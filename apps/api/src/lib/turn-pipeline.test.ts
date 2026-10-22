import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PRIVACY, handoverFromConfig, newGuardrailRule, type GuardrailRule, type HandoverRequest, type PrivacySettings } from '@botstudio/shared'
import { NO_TEAM_LINE } from './chat-outcome.js'
import type { FlowRunResult } from './flow-runner.js'
import { HANDOVER_LINE } from './handover.js'
import { ANSWER_FAILED, NO_LINE, runTurnWith, withPerson, type AnswerRequest, type TurnInput, type TurnPorts } from './turn-pipeline.js'

interface Fake {
  ports: TurnPorts
  log: string[]
  answers: AnswerRequest[]
  handovers: Array<{ request: HandoverRequest; source: string }>
}

function fake(overrides: {
  journey?: FlowRunResult | Error
  thanks?: string
  spoken?: string
  answer?: string[] | Error
  nameQuestion?: boolean
  held?: boolean
  liveAgents?: boolean
  noTeamLine?: string
  alwaysHuman?: string[]
  rules?: GuardrailRule[]
  privacy?: PrivacySettings
  sources?: Array<{ documentId: string; title: string; source: string }>
} = {}): Fake {
  const log: string[] = []
  const answers: AnswerRequest[] = []
  const handovers: Fake['handovers'] = []
  const ports: TurnPorts = {
    async safety() { return { rules: overrides.rules ?? [], privacy: overrides.privacy ?? DEFAULT_PRIVACY } },
    async saveInbound(input) { log.push(`in:${input.text}${input.guardrails?.length ? ` [${input.guardrails.map((hit) => hit.action).join(',')}]` : ''}`) },
    async held() { return overrides.held ?? false },
    async handoverRules() { return { liveAgents: overrides.liveAgents ?? true, alwaysHuman: overrides.alwaysHuman ?? [], noTeamLine: overrides.noTeamLine } },
    async handOver(_input, request, source) {
      log.push(`handover:${source}`)
      handovers.push({ request, source })
    },
    async noTeam() { log.push('no-team') },
    async runJourney() {
      log.push('journey')
      if (overrides.journey instanceof Error) throw overrides.journey
      return overrides.journey ?? { handled: false, messages: [] }
    },
    async nameTurn() {
      log.push('name')
      return { spoken: overrides.spoken ?? 'there', thanks: overrides.thanks, contact: { id: 'k1', metadata: {} } }
    },
    async history() { return [{ role: 'assistant', content: 'Earlier line' }] },
    async answer(request) {
      log.push('answer')
      answers.push(request)
      if (overrides.answer instanceof Error) throw overrides.answer
      for (const chunk of overrides.answer ?? []) request.onChunk(chunk)
      return overrides.sources ? { sources: overrides.sources } : undefined
    },
    async saveOutbound(_input, text, extra) {
      log.push(`out:${text}${extra?.guardrails?.length ? ` [${extra.guardrails.map((hit) => hit.action).join(',')}]` : ''}${extra?.sources?.length ? ` <${extra.sources.map((ref) => ref.title).join(',')}>` : ''}`)
    },
    async saveContactName() { log.push('contact') },
    warn(message) { log.push(`warn:${message}`) },
  }
  return { ports, log, answers, handovers }
}

const input = (extra: Partial<TurnInput> = {}): TurnInput & { chunks: string[] } => {
  const chunks: string[] = []
  return { conversationId: 'c1', tenantId: 't1', botId: 'b1', text: 'Do you do balayage?', onChunk: (chunk) => chunks.push(chunk), chunks, ...extra }
}

test('a journey line is saved once and streamed whole; the knowledge answer never runs', async () => {
  const f = fake({ journey: { handled: true, messages: ['Yes, we do balayage.', '', 'Shall I book you in?'], ended: false } })
  const turn = input()
  const result = await runTurnWith(f.ports, turn)
  assert.deepEqual(f.log, ['in:Do you do balayage?', 'journey', 'out:Yes, we do balayage.\n\nShall I book you in?'])
  assert.deepEqual(turn.chunks, ['Yes, we do balayage.\n\nShall I book you in?'])
  assert.deepEqual(result, { text: 'Yes, we do balayage.\n\nShall I book you in?', ended: false, path: 'journey' })
})

test('the end of a journey is reported so the widget can ask for a rating', async () => {
  const f = fake({ journey: { handled: true, messages: ['Thanks for chatting.'], ended: true } })
  assert.equal((await runTurnWith(f.ports, input())).ended, true)
})

test('an opening turn saves no guest line', async () => {
  const f = fake({ journey: { handled: true, messages: ['Hi, I am Yuzu. What can I help with?'] } })
  await runTurnWith(f.ports, input({ text: '', opening: true }))
  assert.equal(f.log[0], 'journey')
})

test('a line the Inbox already saved is not saved twice', async () => {
  const f = fake({ journey: { handled: true, messages: ['Sure.'] } })
  await runTurnWith(f.ports, input({ inboundSaved: true }))
  assert.ok(!f.log.some((entry) => entry.startsWith('in:')))
})

test('no journey: the bot answers from knowledge with the chat history, and the streamed text is what is saved', async () => {
  const f = fake({ answer: ['We open ', 'at 9.'] })
  const turn = input()
  const result = await runTurnWith(f.ports, turn)
  assert.deepEqual(turn.chunks, ['We open ', 'at 9.'])
  assert.equal(result.text, 'We open at 9.')
  assert.equal(result.path, 'answer')
  assert.deepEqual(f.answers[0]!.history, [{ role: 'assistant', content: 'Earlier line' }])
  assert.equal(f.log.at(-1), 'out:We open at 9.')
})

test('a journey that fails falls back to the knowledge answer', async () => {
  const f = fake({ journey: new Error('graph broken'), answer: ['Here is what I found.'] })
  const result = await runTurnWith(f.ports, input())
  assert.equal(result.path, 'answer')
  assert.ok(f.log.includes('warn:journey failed, answering from knowledge'))
})

test('a failed or empty answer says so instead of going silent', async () => {
  for (const answer of [new Error('all providers down'), [] as string[]]) {
    const f = fake({ answer })
    const turn = input()
    const result = await runTurnWith(f.ports, turn)
    assert.equal(result.text, ANSWER_FAILED)
    assert.deepEqual(turn.chunks, [ANSWER_FAILED])
    assert.equal(f.log.at(-1), `out:${ANSWER_FAILED}`)
  }
})

test('an opening with no journey gets a fixed line, not a model call', async () => {
  const f = fake()
  const result = await runTurnWith(f.ports, input({ text: '', opening: true }))
  assert.equal(result.text, NO_LINE)
  assert.ok(!f.log.includes('answer'))
})

test('a name the guest just gave is thanked without a model call', async () => {
  const f = fake({ thanks: 'Thanks, Ana.' })
  const result = await runTurnWith(f.ports, input({ text: 'Ana' }))
  assert.deepEqual(result, { text: 'Thanks, Ana.', ended: false, path: 'name' })
  assert.ok(!f.log.includes('answer'))
})

test('name tokens in a streamed answer are filled before the guest sees them', async () => {
  const f = fake({ answer: ['Hi {{contact.name}}, ', 'we open at 9.'], spoken: 'Ana' })
  const turn = input()
  const result = await runTurnWith(f.ports, turn)
  assert.equal(turn.chunks.join(''), 'Hi Ana, we open at 9.')
  assert.equal(result.text, turn.chunks.join(''))
})

test('while a person holds the chat the guest line is saved and the bot says nothing', async () => {
  const f = fake({ held: true, journey: { handled: true, messages: ['What day suits you?'] } })
  const turn = input({ text: 'Are you still there?' })
  const result = await runTurnWith(f.ports, turn)
  assert.deepEqual(f.log, ['in:Are you still there?'])
  assert.deepEqual(turn.chunks, [])
  assert.deepEqual(result, { text: '', ended: false, path: 'held' })
  assert.equal(withPerson(result), true)
})

test('a word on the always-human list hands over before the journey runs', async () => {
  const f = fake({ alwaysHuman: ['complaint', 'speak to a manager'], journey: { handled: true, messages: ['Which service?'] } })
  const turn = input({ text: 'I want to make a Complaint about my colour' })
  const result = await runTurnWith(f.ports, turn)
  assert.ok(!f.log.includes('journey'))
  assert.equal(f.handovers[0]!.source, 'always_human')
  assert.equal(f.handovers[0]!.request.priority, 'high')
  assert.deepEqual(f.handovers[0]!.request.tags, ['always-human'])
  assert.match(f.handovers[0]!.request.reason, /complaint/)
  assert.deepEqual(result, { text: HANDOVER_LINE, ended: false, path: 'handover' })
  assert.deepEqual(turn.chunks, [HANDOVER_LINE])
})

test('the always-human list matches whole words only', async () => {
  const f = fake({ alwaysHuman: ['manager'], journey: { handled: true, messages: ['Sure.'] } })
  await runTurnWith(f.ports, input({ text: 'Is the management team in today?' }))
  assert.equal(f.handovers.length, 0)
  assert.ok(f.log.includes('journey'))
})

test('a journey handover passes the step contract on and keeps the journey line', async () => {
  const request = handoverFromConfig({ reason: 'Colour correction', priority: 'critical', tags: 'colour, vip', queue: 'stylists', skills: 'colour' })
  const f = fake({ journey: { handled: true, messages: ['I am passing this chat to the studio.'], handover: request } })
  const result = await runTurnWith(f.ports, input())
  assert.deepEqual(f.handovers, [{ request, source: 'journey' }])
  assert.equal(result.text, 'I am passing this chat to the studio.')
  assert.equal(result.path, 'handover')
})

test('with live support off the bot keeps the chat and says so', async () => {
  const request = handoverFromConfig({ team: 'support' })
  for (const f of [
    fake({ liveAgents: false, journey: { handled: true, messages: ['I am passing this chat to the team. Someone will continue here.'], handover: request } }),
    fake({ liveAgents: false, alwaysHuman: ['refund'] }),
  ]) {
    const result = await runTurnWith(f.ports, input({ text: 'I want a refund' }))
    assert.equal(f.handovers.length, 0)
    assert.ok(f.log.includes('no-team'))
    assert.equal(result.text, NO_TEAM_LINE)
    assert.equal(withPerson(result), false)
  }
})

test('outside opening hours the bot says when the team is on chat', async () => {
  const closed = 'The team is on chat Mon-Fri 09:00-18:00 (Europe/London), so I will keep helping here for now. What do you need help with?'
  const f = fake({ liveAgents: false, noTeamLine: closed, alwaysHuman: ['refund'] })
  const result = await runTurnWith(f.ports, input({ text: 'I want a refund' }))
  assert.equal(f.handovers.length, 0)
  assert.equal(result.text, closed)
})

const rule = (partial: Partial<GuardrailRule>): GuardrailRule => newGuardrailRule({ id: partial.name ?? 'r', name: 'Rule', ...partial })

test('a blocked guest message is saved, flagged and answered with the rule line; nothing else runs', async () => {
  const f = fake({ rules: [rule({ name: 'Competitors', check: { kind: 'words', words: ['Acme Salon'] }, action: 'block', message: 'I can only talk about our own salon.' })] })
  const turn = input({ text: 'Is Acme Salon cheaper?' })
  const result = await runTurnWith(f.ports, turn)
  assert.deepEqual(f.log, ['in:Is Acme Salon cheaper? [block]', 'out:I can only talk about our own salon.'])
  assert.equal(result.path, 'guardrail')
  assert.deepEqual(turn.chunks, ['I can only talk about our own salon.'])
})

test('new rules warn: the guest line goes through and is flagged', async () => {
  const f = fake({ rules: [rule({ name: 'Refund', check: { kind: 'words', words: ['refund'] } })], journey: { handled: true, messages: ['Sure.'] } })
  await runTurnWith(f.ports, input({ text: 'I want a refund' }))
  assert.deepEqual(f.log, ['in:I want a refund [warn]', 'journey', 'out:Sure.'])
})

test('redact on guest messages changes what is saved and what the journey sees', async () => {
  const seen: string[] = []
  const f = fake({ rules: [rule({ name: 'Swearing', check: { kind: 'words', words: ['damn'] }, action: 'redact' })], journey: { handled: true, messages: ['OK.'] } })
  const runJourney = f.ports.runJourney
  f.ports.runJourney = async (turn) => { seen.push(turn.text); return runJourney(turn) }
  await runTurnWith(f.ports, input({ text: 'damn this booking' }))
  assert.equal(seen[0], '[redacted] this booking')
  assert.equal(f.log[0], 'in:[redacted] this booking [redact]')
})

test('escalate on a guest message hands over with the guardrail as the reason', async () => {
  const f = fake({ rules: [rule({ name: 'Legal threat', check: { kind: 'words', words: ['lawyer'] }, action: 'escalate' })] })
  const result = await runTurnWith(f.ports, input({ text: 'My lawyer will call you' }))
  assert.equal(result.path, 'handover')
  assert.equal(f.handovers[0]?.source, 'guardrail')
  assert.match(f.handovers[0]!.request.reason, /Legal threat/)
  assert.ok(!f.log.includes('journey'))
})

test('reask on a guest message asks them to rephrase', async () => {
  const f = fake({ rules: [rule({ name: 'Shouting', check: { kind: 'pattern', pattern: '^[A-Z !]{8,}$' }, action: 'reask' })] })
  const result = await runTurnWith(f.ports, input({ text: 'WHERE IS MY ORDER' }))
  assert.equal(result.text, 'Could you put that another way?')
  assert.equal(result.path, 'guardrail')
})

test('a reply rule that can change replies holds the answer back until it is checked', async () => {
  const f = fake({
    rules: [rule({ name: 'No prices', side: 'output', check: { kind: 'pattern', pattern: '£\\d+' }, action: 'block', message: 'Prices are on our website.' })],
    answer: ['It costs ', '£40.'],
  })
  const turn = input()
  const result = await runTurnWith(f.ports, turn)
  assert.deepEqual(turn.chunks, ['Prices are on our website.'])
  assert.equal(result.text, 'Prices are on our website.')
  assert.equal(f.log.at(-1), 'out:Prices are on our website. [block]')
})

test('reask on a reply writes it again once with an instruction, then blocks', async () => {
  const f = fake({ rules: [rule({ name: 'No prices', side: 'output', check: { kind: 'pattern', pattern: '£\\d+' }, action: 'reask' })], answer: ['£40.'] })
  const result = await runTurnWith(f.ports, input())
  assert.equal(f.answers.length, 2)
  assert.match(f.answers[1]!.instruction ?? '', /No prices/)
  assert.equal(result.text, 'I can’t share that. Is there something else I can help with?')
})

test('warn-only reply rules keep streaming and flag the saved reply', async () => {
  const f = fake({ rules: [rule({ name: 'Mentions price', side: 'output', check: { kind: 'pattern', pattern: '£\\d+' } })], answer: ['It is ', '£40.'] })
  const turn = input()
  await runTurnWith(f.ports, turn)
  assert.deepEqual(turn.chunks, ['It is ', '£40.'])
  assert.equal(f.log.at(-1), 'out:It is £40. [warn]')
})

test('a journey line that breaks a block rule is replaced', async () => {
  const f = fake({
    rules: [rule({ name: 'No internal', side: 'output', check: { kind: 'words', words: ['internal'] }, action: 'block' })],
    journey: { handled: true, messages: ['See the internal wiki.'] },
  })
  const result = await runTurnWith(f.ports, input())
  assert.equal(result.text, 'I can’t share that. Is there something else I can help with?')
})

test('the guest sees personal data in their reader mode; masking holds the stream', async () => {
  const f = fake({ privacy: { ...DEFAULT_PRIVACY, render: { ...DEFAULT_PRIVACY.render, end_user: 'mask' } }, answer: ['We will email ', 'jane@example.com.'] })
  const turn = input()
  const result = await runTurnWith(f.ports, turn)
  assert.equal(result.text, 'We will email j•••@e•••.com.')
  assert.deepEqual(turn.chunks, ['We will email j•••@e•••.com.'])
})

const PRICE_LIST = { documentId: 'd1', title: 'Harbour Dental: Price list', source: 'Business details' }

test('a knowledge answer is saved with the documents it was written from', async () => {
  const f = fake({ answer: ['An implant is ', '£2,650.'], sources: [PRICE_LIST] })
  await runTurnWith(f.ports, input({ text: 'How much is an implant?' }))
  assert.equal(f.log.at(-1), 'out:An implant is £2,650. <Harbour Dental: Price list>')
})

test('a failed answer and a blocked answer carry no sources', async () => {
  const failed = fake({ answer: new Error('model down'), sources: [PRICE_LIST] })
  await runTurnWith(failed.ports, input())
  assert.equal(failed.log.at(-1), `out:${ANSWER_FAILED}`)

  const blocked = fake({ rules: [rule({ name: 'No prices', side: 'output', check: { kind: 'pattern', pattern: '£\\d+' }, action: 'block' })], answer: ['£40.'], sources: [PRICE_LIST] })
  await runTurnWith(blocked.ports, input())
  assert.ok(!blocked.log.at(-1)!.includes('<'), blocked.log.at(-1))
})
