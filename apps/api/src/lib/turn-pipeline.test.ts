import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FlowRunResult } from './flow-runner.js'
import { ANSWER_FAILED, NO_LINE, runTurnWith, type AnswerRequest, type TurnInput, type TurnPorts } from './turn-pipeline.js'

interface Fake {
  ports: TurnPorts
  log: string[]
  answers: AnswerRequest[]
}

function fake(overrides: {
  journey?: FlowRunResult | Error
  thanks?: string
  spoken?: string
  answer?: string[] | Error
  nameQuestion?: boolean
} = {}): Fake {
  const log: string[] = []
  const answers: AnswerRequest[] = []
  const ports: TurnPorts = {
    async saveInbound(input) { log.push(`in:${input.text}`) },
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
    },
    async saveOutbound(_input, text) { log.push(`out:${text}`) },
    async saveContactName() { log.push('contact') },
    warn(message) { log.push(`warn:${message}`) },
  }
  return { ports, log, answers }
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
