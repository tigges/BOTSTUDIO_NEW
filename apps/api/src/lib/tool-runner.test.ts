import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PRIVACY, checkToolArgs, fillJsonTemplate, toolIssues, toolParametersSchema, type ToolDraft } from '@ybot/shared'
import { defaultToolDeps, resetCircuitBreakers, runTool, type RunnableTool, type ToolDeps } from './tool-runner.js'
import { sealSecret, openSecret, secretHint } from './secrets.js'
import { applyAuthProfile } from './auth-profiles.js'
import { assertPublicUrl, isPrivateAddress } from './public-url.js'
import { mcpCallTool, mcpListTools } from './mcp-client.js'

interface Call { url: string; init: RequestInit }

function fakeFetch(responses: Array<() => Response | Promise<Response>>, calls: Call[]): typeof fetch {
  let i = 0
  return (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = responses[Math.min(i++, responses.length - 1)]!
    return next()
  }) as typeof fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function deps(overrides: Partial<ToolDeps>): ToolDeps {
  return defaultToolDeps({ checkUrl: async () => undefined, sleep: async () => {}, privacy: async () => DEFAULT_PRIVACY, ...overrides })
}

function httpTool(overrides: Partial<RunnableTool> = {}, config: Record<string, unknown> = {}): RunnableTool {
  return {
    id: 'tool-1',
    tenantId: 't1',
    botId: 'b1',
    name: 'lookup_order',
    kind: 'http',
    effect: 'read',
    parameters: [
      { name: 'order', type: 'string', description: 'Order number', required: true },
      { name: 'verbose', type: 'boolean', description: 'More detail', required: false },
    ],
    config: { method: 'GET', url: 'https://api.example.com/orders/{{order}}?v={{verbose}}', headers: {}, body: '', timeoutMs: 5000, retries: 2, circuitBreaker: { failures: 3, resetSeconds: 60 }, idempotencyHeader: 'Idempotency-Key', ...config },
    authProfile: null,
    ...overrides,
  }
}

beforeEach(() => resetCircuitBreakers())

test('HTTP tool fills the URL, encodes values and returns parsed JSON', async () => {
  const calls: Call[] = []
  const result = await runTool(httpTool(), { order: 'A 1/2', verbose: 'true' }, { source: 'bot' }, deps({ fetch: fakeFetch([() => json({ status: 'shipped' })], calls) }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.output, { status: 'shipped' })
  assert.equal(calls[0]!.url, 'https://api.example.com/orders/A%201%2F2?v=true')
  assert.equal(calls[0]!.init.method, 'GET')
  assert.equal((calls[0]!.init.headers as Record<string, string>)['Idempotency-Key'], undefined)
})

test('arguments are checked against the declared parameters before anything runs', async () => {
  const calls: Call[] = []
  const result = await runTool(httpTool(), { verbose: 'maybe', extra: 1 }, { source: 'bot' }, deps({ fetch: fakeFetch([() => json({})], calls) }))
  assert.equal(result.ok, false)
  assert.match(result.error!, /order is required/)
  assert.match(result.error!, /verbose must be a boolean/)
  assert.match(result.error!, /extra is not a parameter/)
  assert.equal(calls.length, 0)
})

test('read tools retry on 5xx; write tools without an idempotency header do not', async () => {
  const calls: Call[] = []
  const read = await runTool(httpTool(), { order: '1' }, { source: 'bot' }, deps({ fetch: fakeFetch([() => json({}, 503), () => json({}, 502), () => json({ ok: 1 })], calls) }))
  assert.equal(read.ok, true)
  assert.equal(read.attempts, 3)

  const writeCalls: Call[] = []
  const write = await runTool(
    httpTool({ effect: 'write' }, { method: 'POST', url: 'https://api.example.com/orders', idempotencyHeader: '' }),
    { order: '1' }, { source: 'bot' },
    deps({ fetch: fakeFetch([() => json({}, 503), () => json({ ok: 1 })], writeCalls) }),
  )
  assert.equal(write.ok, false)
  assert.equal(write.attempts, 1)
  assert.equal(writeCalls.length, 1)
})

test('the idempotency key stays the same across retries of one call', async () => {
  const calls: Call[] = []
  const result = await runTool(
    httpTool({ effect: 'write' }, { method: 'POST', url: 'https://api.example.com/orders', body: '{"order":"{{order}}","n":{{verbose}}}' }),
    { order: 'A1', verbose: true }, { source: 'bot' },
    deps({ fetch: fakeFetch([() => json({}, 500), () => json({ id: 9 }, 201)], calls) }),
  )
  assert.equal(result.ok, true)
  const keys = calls.map((call) => (call.init.headers as Record<string, string>)['Idempotency-Key'])
  assert.equal(keys.length, 2)
  assert.ok(keys[0])
  assert.equal(keys[0], keys[1])
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { order: 'A1', n: true })
})

test('the circuit breaker pauses a tool after repeated failures', async () => {
  let now = 1_000_000
  const calls: Call[] = []
  const d = deps({ fetch: fakeFetch([() => json({}, 500)], calls), now: () => now })
  const tool = httpTool({}, { retries: 0, circuitBreaker: { failures: 2, resetSeconds: 30 } })
  await runTool(tool, { order: '1' }, { source: 'bot' }, d)
  await runTool(tool, { order: '1' }, { source: 'bot' }, d)
  const paused = await runTool(tool, { order: '1' }, { source: 'bot' }, d)
  assert.equal(paused.ok, false)
  assert.match(paused.error!, /Paused after 2 failures/)
  assert.equal(calls.length, 2)
  now += 31_000
  await runTool(tool, { order: '1' }, { source: 'bot' }, d)
  assert.equal(calls.length, 3)
})

test('status codes name what to fix', async () => {
  const result = await runTool(httpTool(), { order: '1' }, { source: 'bot' }, deps({ fetch: fakeFetch([() => json({ error: 'no' }, 401)], []) }))
  assert.equal(result.ok, false)
  assert.equal(result.status, 401)
  assert.match(result.error!, /Auth Profile/)
})

test('Auth Profile credentials are added at call time and scrubbed from what comes back', async () => {
  const calls: Call[] = []
  const secret = 'sk_live_very_secret_value_1234'
  const tool = httpTool({ authProfile: { kind: 'bearer', settings: {}, secretEnc: sealSecret(secret) } })
  const result = await runTool(tool, { order: '1' }, { source: 'bot' }, deps({ fetch: fakeFetch([() => json({ echoed: `Bearer ${secret}` })], calls) }))
  assert.equal((calls[0]!.init.headers as Record<string, string>)['Authorization'], `Bearer ${secret}`)
  assert.deepEqual(result.output, { echoed: 'Bearer [secret]' })
  assert.ok(!JSON.stringify(result).includes(secret))
})

test('api_key profiles can go in a query parameter, and errors never show it', async () => {
  const calls: Call[] = []
  const secret = 'query-secret-abcdef'
  const tool = httpTool({ authProfile: { kind: 'api_key', settings: { queryParam: 'key' }, secretEnc: sealSecret(secret) } })
  const result = await runTool(tool, { order: '1' }, { source: 'bot' }, deps({
    fetch: (async (url: string | URL) => { calls.push({ url: String(url), init: {} }); throw new Error(`connect failed for ${String(url)}`) }) as typeof fetch,
  }))
  assert.match(calls[0]!.url, /key=query-secret-abcdef/)
  assert.equal(result.ok, false)
  assert.ok(!result.error!.includes(secret))
  assert.match(result.error!, /\[secret\]/)
})

test('tools that change data are skipped in test chats and evals, and run elsewhere', async () => {
  const calls: Call[] = []
  const tool = httpTool({ effect: 'side_effect' }, { method: 'POST', url: 'https://api.example.com/sms' })
  const skipped = await runTool(tool, { order: '1' }, { source: 'test_chat' }, deps({ fetch: fakeFetch([() => json({})], calls) }))
  assert.equal(skipped.ok, true)
  assert.equal(skipped.skipped, true)
  assert.equal(calls.length, 0)
  const ran = await runTool(tool, { order: '1' }, { source: 'inbox' }, deps({ fetch: fakeFetch([() => json({ sent: true })], calls) }))
  assert.equal(ran.skipped, undefined)
  assert.equal(calls.length, 1)
})

test('private addresses are refused before any request is made', async () => {
  assert.equal(isPrivateAddress('10.1.2.3'), true)
  assert.equal(isPrivateAddress('169.254.169.254'), true)
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true)
  assert.equal(isPrivateAddress('fd00::1'), true)
  assert.equal(isPrivateAddress('8.8.8.8'), false)
  await assert.rejects(assertPublicUrl('http://db.internal/', async () => ['172.19.0.4']), /private network/)
  await assert.rejects(assertPublicUrl('http://127.0.0.1:5432/'), /private network/)
  await assert.rejects(assertPublicUrl('file:///etc/passwd'), /only http and https/)
  const ok = await assertPublicUrl('https://api.example.com/x', async () => ['93.184.216.34'])
  assert.equal(ok.hostname, 'api.example.com')

  const calls: Call[] = []
  const blocked = await runTool(httpTool(), { order: '1' }, { source: 'bot' }, defaultToolDeps({
    privacy: async () => DEFAULT_PRIVACY,
    fetch: fakeFetch([() => json({})], calls),
    checkUrl: (url) => assertPublicUrl(url, async () => ['10.0.0.5']),
  }))
  assert.equal(blocked.ok, false)
  assert.match(blocked.error!, /private network/)
  assert.equal(calls.length, 0)
})

test('knowledge, workflow and function tools run through the same entry point', async () => {
  const base = { id: 'x', tenantId: 't1', botId: 'b1', effect: 'read', authProfile: null }
  const knowledge = await runTool(
    { ...base, name: 'search_help', kind: 'knowledge', parameters: [{ name: 'query', type: 'string', description: 'Question', required: true }], config: { topK: 2 } },
    { query: 'opening hours' }, { source: 'bot' },
    deps({ searchKnowledge: async (query, tenantId, botId, topK) => [{ content: `${query}|${tenantId}|${botId}|${topK}`, documentId: 'd1', title: 'Opening hours', source: 'Business details', sourceKind: 'business' }] }),
  )
  assert.deepEqual(knowledge.output, { found: true, chunks: [{ text: 'opening hours|t1|b1|2', title: 'Opening hours', source: 'Business details', confirmed: true }] })

  let ran = ''
  const workflow = await runTool(
    { ...base, name: 'notify_team', kind: 'workflow', effect: 'side_effect', parameters: [], config: { workflowId: 'wf-1' } },
    {}, { source: 'inbox', conversationId: 'c1' },
    deps({ runWorkflow: async (id, ctx) => { ran = `${id}:${ctx.conversationId}`; return { ran: true } } }),
  )
  assert.equal(workflow.ok, true)
  assert.equal(ran, 'wf-1:c1')

  const fn = await runTool(
    { ...base, name: 'add_vat', kind: 'function', parameters: [{ name: 'net', type: 'number', description: 'Net price', required: true }], config: { code: 'async function main(args) { return { gross: Math.round(args.net * 1.2 * 100) / 100 } }', timeoutMs: 2000 } },
    { net: '10.5' }, { source: 'bot' }, deps({}),
  )
  assert.equal(fn.ok, true, fn.error)
  assert.deepEqual(fn.output, { gross: 12.6 })
})

test('functions cannot reach the network, files or the environment', async () => {
  const base = { id: 'f', tenantId: 't1', botId: 'b1', name: 'probe', kind: 'function', effect: 'read', parameters: [], authProfile: null }
  const escape = 'const p = this.constructor.constructor("return process")(); const g = this.constructor.constructor("return globalThis")();'
  const probe = await runTool({ ...base, config: { code: `async function main() { ${escape} return [typeof g.fetch, typeof g.require, typeof p.getBuiltinModule, Object.keys(p.env).length].join() }`, timeoutMs: 2000 } }, {}, { source: 'bot' }, deps({}))
  assert.equal(probe.output, 'undefined,undefined,undefined,0')
  const loop = await runTool({ ...base, config: { code: 'async function main() { while (true) {} }', timeoutMs: 300 } }, {}, { source: 'bot' }, deps({}))
  assert.equal(loop.ok, false)
  assert.match(loop.error!, /longer than 300 ms/)
})

test('MCP tools: list over JSON, call over SSE, session id carried', async () => {
  const seen: Array<{ method: string; session: string | null }> = []
  const server = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: Record<string, unknown> }
    seen.push({ method: body.method, session: new Headers(init?.headers).get('mcp-session-id') })
    if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' } })
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (body.method === 'tools/list') return json({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'get_weather', description: 'Weather for a city', inputSchema: { type: 'object', properties: { city: { type: 'string', description: 'City' } }, required: ['city'] } }] } })
    const payload = { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ city: (body.params!['arguments'] as { city: string }).city, temp: 18 }) }] } }
    return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
  const transport = { fetch: server, checkUrl: async () => undefined, headers: { Authorization: 'Bearer t' }, timeoutMs: 5000 }
  const tools = await mcpListTools('https://mcp.example.com/mcp', transport)
  assert.equal(tools[0]!.name, 'get_weather')
  const call = await mcpCallTool('https://mcp.example.com/mcp', 'get_weather', { city: 'Leeds' }, transport)
  assert.deepEqual(call.output, { city: 'Leeds', temp: 18 })
  assert.equal(call.isError, false)
  assert.deepEqual(seen.slice(0, 3).map((s) => s.method), ['initialize', 'notifications/initialized', 'tools/list'])
  assert.equal(seen[2]!.session, 'sess-1')
})

test('secrets are sealed with AES-GCM and only a hint is shown', () => {
  const sealed = sealSecret('my-long-api-key-0001')
  assert.match(sealed, /^v1:/)
  assert.ok(!sealed.includes('my-long-api-key'))
  assert.equal(openSecret(sealed), 'my-long-api-key-0001')
  assert.equal(secretHint('my-long-api-key-0001'), '••••0001')
  assert.equal(secretHint('short'), '••••')
  const tampered = sealed.slice(0, -4) + (sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA')
  assert.throws(() => openSecret(tampered), /Enter it again/)
  const basic = applyAuthProfile({ kind: 'basic', settings: { username: 'ann' }, secretEnc: sealSecret('pw') })
  assert.equal(basic.headers['Authorization'], `Basic ${Buffer.from('ann:pw').toString('base64')}`)
})

test('saving a tool names the field to fix, and refuses credentials on the tool', () => {
  const draft: ToolDraft = {
    name: 'Lookup Order',
    kind: 'http',
    description: 'short',
    parameters: [{ name: 'order', type: 'string', description: '', required: true }],
    returns: { type: 'object', description: '' },
    effect: 'read',
    config: { method: 'GET', url: 'https://api.example.com/o/{{order}}?api_key=abc', headers: { Authorization: 'Bearer x' }, body: '{"a": {{missing}}}' },
  }
  const fields = toolIssues(draft).map((issue) => issue.field)
  assert.ok(fields.includes('name'))
  assert.ok(fields.includes('description'))
  assert.ok(fields.includes('parameters.0.description'))
  assert.ok(fields.includes('config.url'))
  assert.ok(fields.includes('config.headers.Authorization'))
  assert.ok(toolIssues(draft).some((issue) => issue.message.includes('{{missing}} is not a parameter')))

  const schema = toolParametersSchema([{ name: 'size', type: 'string', description: 'Size', required: true, enum: ['S', 'M'] }])
  assert.deepEqual(schema, { type: 'object', properties: { size: { type: 'string', description: 'Size', enum: ['S', 'M'] } }, required: ['size'], additionalProperties: false })
  assert.deepEqual(checkToolArgs([{ name: 'n', type: 'integer', description: 'n', required: true }], { n: '4' }).value, { n: 4 })
  assert.deepEqual(fillJsonTemplate('{"note":"Hi {{name}}","n":{{n}},"tags":{{tags}}}', { name: 'Ann "A"', n: 3, tags: ['x'] }), { note: 'Hi Ann "A"', n: 3, tags: ['x'] })
})
