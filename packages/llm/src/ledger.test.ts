import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { costFor, priceFor, RecordingProvider, setLlmRecorder, type LlmCallRecord } from './ledger.js'
import type { LlmProvider } from './types.js'

const calls: LlmCallRecord[] = []

afterEach(() => {
  calls.length = 0
  setLlmRecorder(null)
  delete process.env['LLM_PRICING_JSON']
})

function recordInto() {
  setLlmRecorder((record) => calls.push(record))
}

const inner: LlmProvider = {
  async complete() {
    return { content: 'hi', model: 'claude-haiku-4-5', inputTokens: 1000, cachedTokens: 400, outputTokens: 200, reasoningTokens: 50, durationMs: 5 }
  },
  async stream(params) {
    await new Promise((resolve) => setTimeout(resolve, 15))
    params.onChunk('he')
    params.onChunk('llo')
    return { content: 'hello', model: 'gemini-2.5-flash', inputTokens: 100, outputTokens: 20, durationMs: 20 }
  },
  async embed() {
    return { embeddings: [[0.1]], model: 'text-embedding-3-small', inputTokens: 1_000_000 }
  },
}

test('a completion is one record with tokens by class and cost', async () => {
  recordInto()
  const result = await new RecordingProvider('anthropic', inner).complete({ messages: [{ role: 'user', content: 'x' }] })
  assert.equal(result.content, 'hi')
  assert.equal(calls.length, 1)
  const [call] = calls
  assert.equal(call!.provider, 'anthropic')
  assert.equal(call!.model, 'claude-haiku-4-5')
  assert.equal(call!.operation, 'complete')
  assert.equal(call!.inputTokens, 1000)
  assert.equal(call!.cachedTokens, 400)
  assert.equal(call!.outputTokens, 200)
  assert.equal(call!.reasoningTokens, 50)
  assert.equal(call!.completionTokens, 150)
  assert.equal(call!.ttftMs, null)
  assert.equal(call!.ok, true)
  // 600 fresh at $1/M + 400 cached at $0.10/M + 200 out at $5/M
  assert.equal(call!.costUsd, 0.00164)
})

test('a stream records time to first token and passes every chunk through', async () => {
  recordInto()
  const seen: string[] = []
  await new RecordingProvider('gemini', inner).stream({ messages: [], onChunk: (chunk) => seen.push(chunk) })
  assert.deepEqual(seen, ['he', 'llo'])
  const [call] = calls
  assert.equal(call!.operation, 'stream')
  assert.ok(call!.ttftMs !== null && call!.ttftMs >= 10, `ttft ${call!.ttftMs}`)
  assert.ok(call!.latencyMs >= call!.ttftMs!)
})

test('a provider without streaming still streams once and records it', async () => {
  recordInto()
  const seen: string[] = []
  const plain: LlmProvider = { complete: inner.complete, embed: inner.embed }
  const result = await new RecordingProvider('groq', plain).stream({ messages: [], onChunk: (chunk) => seen.push(chunk) })
  assert.equal(result.content, 'hi')
  assert.deepEqual(seen, ['hi'])
  assert.equal(calls[0]!.operation, 'stream')
  assert.notEqual(calls[0]!.ttftMs, null)
})

test('embeddings record their input tokens', async () => {
  recordInto()
  await new RecordingProvider('openai', inner).embed({ texts: ['a'] })
  assert.equal(calls[0]!.operation, 'embed')
  assert.equal(calls[0]!.inputTokens, 1_000_000)
  assert.equal(calls[0]!.costUsd, 0.02)
})

test('a failed call is recorded and the error still reaches the caller', async () => {
  recordInto()
  const broken: LlmProvider = {
    async complete() { throw new Error('HTTP 429 rate limited') },
    async embed() { throw new Error('down') },
  }
  await assert.rejects(new RecordingProvider('groq', broken).complete({ messages: [], model: 'llama-3.3-70b-versatile' }), /429/)
  assert.equal(calls[0]!.ok, false)
  assert.equal(calls[0]!.model, 'llama-3.3-70b-versatile')
  assert.match(calls[0]!.error!, /429/)
  assert.equal(calls[0]!.costUsd, null)
})

test('a recorder that throws never breaks the reply', async () => {
  setLlmRecorder(() => { throw new Error('db down') })
  const result = await new RecordingProvider('anthropic', inner).complete({ messages: [] })
  assert.equal(result.content, 'hi')
})

test('prices: unknown models have no price, ollama is free, overrides win', () => {
  assert.equal(priceFor('openai', 'some-new-model'), null)
  assert.equal(costFor('openai', 'some-new-model', { input: 10, cached: 0, output: 10 }), null)
  assert.equal(costFor('ollama', 'llama3', { input: 1000, cached: 0, output: 1000 }), 0)
  assert.equal(priceFor('gemini', 'models/gemini-2.5-flash-lite')?.input, 0.1)
  process.env['LLM_PRICING_JSON'] = JSON.stringify({ 'some-new-model': { input: 2, output: 4 } })
  assert.equal(costFor('openai', 'some-new-model', { input: 1_000_000, cached: 0, output: 500_000 }), 4)
})

test('the outbound watch sees the system prompt and every message, and a throwing watch never breaks the call', async () => {
  const { setLlmOutboundWatch } = await import('./ledger.js')
  const seen: string[] = []
  setLlmOutboundWatch((text) => seen.push(text))
  const inner = { name: 'x', complete: async () => ({ content: 'ok', model: 'm' }) } as unknown as ConstructorParameters<typeof RecordingProvider>[1]
  await new RecordingProvider('anthropic', inner).complete({ systemPrompt: 'Be kind.', messages: [{ role: 'user', content: 'Call me on [PHONE_1A2B3C4D]' }] })
  assert.equal(seen[0], 'Be kind.\nCall me on [PHONE_1A2B3C4D]')
  setLlmOutboundWatch(() => { throw new Error('boom') })
  const result = await new RecordingProvider('anthropic', inner).complete({ messages: [] })
  assert.equal(result.content, 'ok')
  setLlmOutboundWatch(null)
})
