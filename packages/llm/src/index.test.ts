import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AnthropicProvider,
  anthropicRequest,
  chooseLlmProvider,
  createLlmAdapter,
  createLlmAdapterForModel,
  currentModelId,
  hasCloudLlm,
  llmChain,
  resolveLlmEnv,
  LlmAdapter,
} from './index.js'

function withFetch(handler: (host: string, body: Record<string, unknown>) => Response | Promise<Response>) {
  const realFetch = globalThis.fetch
  const asked: string[] = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = new URL(String(url))
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    asked.push(`${href.host} ${String(body['model'])}`)
    return handler(href.host, body)
  }) as typeof fetch
  return { asked, restore: () => { globalThis.fetch = realFetch } }
}

const claudeReply = (text: string, model: unknown) => new Response(JSON.stringify({
  content: [{ type: 'text', text }],
  model,
  usage: { input_tokens: 1, output_tokens: 1 },
}), { status: 200 })

test('Gemini, then Claude, then OpenAI and Groq, then Ollama', () => {
  const env = { GROQ_API_KEY: 'q', ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', OLLAMA_BASE_URL: 'http://nas:11434' }
  assert.deepEqual(llmChain(env).map((link) => link.label), ['Gemini', 'Claude', 'OpenAI', 'Groq', 'Ollama'])
  assert.equal(chooseLlmProvider({ GROQ_API_KEY: 'q', ANTHROPIC_API_KEY: 'a' }), 'anthropic')
  assert.equal(chooseLlmProvider({ ANTHROPIC_API_KEY: 'a' }), 'anthropic')
  assert.equal(chooseLlmProvider({}), 'ollama')
  assert.equal(hasCloudLlm({ GEMINI_API_KEY: 'g' }), true)
  assert.equal(hasCloudLlm({ OLLAMA_BASE_URL: 'http://nas:11434' }), false)
  assert.equal(hasCloudLlm({}), false)
})

test('LLM_PROVIDER moves a configured provider to the front', () => {
  const env = { GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', OLLAMA_BASE_URL: 'http://nas:11434' }
  assert.deepEqual(llmChain({ ...env, LLM_PROVIDER: 'ollama' }).map((link) => link.label), ['Ollama', 'Gemini', 'Claude'])
  assert.deepEqual(llmChain({ ...env, LLM_PROVIDER: 'claude' }).map((link) => link.label), ['Claude', 'Gemini', 'Ollama'])
  assert.deepEqual(llmChain({ ANTHROPIC_API_KEY: 'a', LLM_PROVIDER: 'gemini' }).map((link) => link.label), ['Claude'])
})

test('retired model ids run on their current replacement', () => {
  assert.equal(currentModelId('gemini-2.0-flash'), 'gemini-flash-latest')
  assert.equal(currentModelId('gemini-1.5-pro'), 'gemini-flash-latest')
  assert.equal(currentModelId('claude-sonnet-4-5'), 'claude-sonnet-5-5')
  assert.equal(currentModelId('claude-sonnet-4-5-20250929'), 'claude-sonnet-5-5')
  assert.equal(currentModelId('claude-3-haiku'), 'claude-sonnet-5-5')
  assert.equal(currentModelId('claude-haiku-4-5'), 'claude-haiku-5-5')
  assert.equal(currentModelId('claude-sonnet-4-6'), 'claude-sonnet-4-6')
  assert.equal(currentModelId('claude-opus-4-5-20251101'), 'claude-opus-4-5-20251101')
  assert.equal(currentModelId('gemini-flash-latest'), 'gemini-flash-latest')
  assert.deepEqual(llmChain({ GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gemini-2.0-flash' }).map((link) => link.model), ['gemini-flash-latest'])
})

test('chat falls through a failing provider to the next one', async () => {
  const fetch = withFetch((host, body) => host.includes('groq')
    ? new Response('{"error":"model_not_found"}', { status: 404 })
    : claudeReply('Hello from Claude', body['model']))
  const warn = console.warn
  console.warn = () => {}
  try {
    const result = await createLlmAdapter({ GROQ_API_KEY: 'q', ANTHROPIC_API_KEY: 'a', LLM_PROVIDER: 'groq' })
      .complete({ messages: [{ role: 'user', content: 'hi' }], model: 'gemini-2.0-flash' })
    assert.equal(result.content, 'Hello from Claude')
    assert.deepEqual(fetch.asked, ['api.groq.com llama-3.3-70b-versatile', 'api.anthropic.com claude-sonnet-5-5'])
  } finally {
    console.warn = warn
    fetch.restore()
  }
})

test('a saved model goes first on its own provider, and a retired id is upgraded', async () => {
  const fetch = withFetch((_host, body) => claudeReply('ok', body['model']))
  try {
    const adapter = createLlmAdapterForModel('claude-sonnet-4-5', { GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' })
    await adapter.complete({ messages: [{ role: 'user', content: 'hi' }], model: 'claude-sonnet-4-5' })
    assert.deepEqual(fetch.asked, ['api.anthropic.com claude-sonnet-5-5'])
  } finally {
    fetch.restore()
  }
})

test('a saved model without its key uses the chain, not a foreign provider with that id', async () => {
  const fetch = withFetch((_host, body) => claudeReply('ok', body['model']))
  try {
    await createLlmAdapterForModel('gemini-2.0-flash', { ANTHROPIC_API_KEY: 'a' })
      .complete({ messages: [{ role: 'user', content: 'hi' }], model: 'gemini-2.0-flash' })
    assert.deepEqual(fetch.asked, ['api.anthropic.com claude-sonnet-5-5'])
  } finally {
    fetch.restore()
  }
})

test('a stream that already sent text does not restart on the next provider', async () => {
  const encoder = new TextEncoder()
  const fetch = withFetch(() => {
    let pulls = 0
    return new Response(new ReadableStream({
      pull(controller) {
        pulls += 1
        if (pulls === 1) controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Half an ans"}}]}\n'))
        else controller.error(new Error('socket hang up'))
      },
    }), { status: 200 })
  })
  const chunks: string[] = []
  try {
    await assert.rejects(
      createLlmAdapter({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' })
        .stream({ messages: [{ role: 'user', content: 'hi' }], onChunk: (chunk) => chunks.push(chunk) }),
      /socket hang up/,
    )
    assert.deepEqual(chunks, ['Half an ans'])
    assert.equal(fetch.asked.length, 1)
  } finally {
    fetch.restore()
  }
})

test('a leftover provider/apiKey bag still reads GEMINI_API_KEY from the process', () => {
  const previous = process.env['GEMINI_API_KEY']
  process.env['GEMINI_API_KEY'] = 'from-server'
  try {
    const resolved = resolveLlmEnv({
      provider: 'openai',
      apiKey: 'only-openai',
    })
    assert.equal(resolved['GEMINI_API_KEY'], 'from-server')
    assert.equal(chooseLlmProvider({ provider: 'gemini', apiKey: 'k' }), 'gemini')
    assert.equal(resolveLlmEnv({ provider: 'claude', apiKey: 'k' })['ANTHROPIC_API_KEY'], 'k')
  } finally {
    if (previous === undefined) delete process.env['GEMINI_API_KEY']
    else process.env['GEMINI_API_KEY'] = previous
  }
})

test('Claude models that refuse sampling settings get none, and Sonnet 5.x skip thinking', () => {
  const ask = (model: string) => anthropicRequest({ messages: [{ role: 'user', content: 'hi' }], model, temperature: 0 })
  assert.equal('temperature' in ask('claude-sonnet-5-5'), false)
  assert.deepEqual(ask('claude-sonnet-5-5')['thinking'], { type: 'between_tools' })
  assert.deepEqual(ask('claude-sonnet-5')['thinking'], { type: 'disabled' })
  assert.equal('temperature' in ask('claude-haiku-5-5'), false)
  assert.equal('thinking' in ask('claude-haiku-5-5'), false)
  assert.equal('temperature' in ask('claude-opus-4-7'), false)
  assert.equal(ask('claude-sonnet-4-6')['temperature'], 0)
  assert.equal(ask('claude-opus-4-1-20250805')['temperature'], 0)
  assert.equal(ask('claude-haiku-4-5-20251001')['temperature'], 0)
  assert.equal(ask('claude-3-5-sonnet-latest')['temperature'], 0)
  assert.equal('thinking' in ask('claude-sonnet-4-6'), false)
  assert.equal(anthropicRequest({ messages: [] })['model'], 'claude-sonnet-5-5')
})

test('a Claude reply reads only its text blocks, and an empty one counts as a failure', async () => {
  const reply = (content: unknown[]) => withFetch(() => new Response(JSON.stringify({
    content, model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200 }))
  const claude = new AnthropicProvider('a')
  let fetch = reply([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Hello' }, { type: 'text', text: ' there' }])
  try {
    assert.equal((await claude.complete({ messages: [{ role: 'user', content: 'hi' }] })).content, 'Hello there')
  } finally {
    fetch.restore()
  }
  fetch = reply([{ type: 'thinking', thinking: 'hmm' }])
  try {
    await assert.rejects(claude.complete({ messages: [{ role: 'user', content: 'hi' }] }), /returned no text/)
  } finally {
    fetch.restore()
  }
})

test('classify shows the model what each category means when the caller says', async () => {
  const prompts: string[] = []
  const adapter = new LlmAdapter({
    complete: async (params) => {
      prompts.push(params.systemPrompt ?? '')
      return { content: '{"category":"book","confidence":0.9}', model: 'fake', inputTokens: 1, outputTokens: 1 }
    },
    embed: async () => ({ embeddings: [], model: 'fake' }),
  })
  const result = await adapter.classify('can I come in Friday', {
    categories: ['book', 'hours', 'other'],
    descriptions: { book: 'The guest wants an appointment' },
  })
  assert.equal(result.category, 'book')
  assert.match(prompts[0]!, /- book: The guest wants an appointment\n- hours\n- other/)
})
