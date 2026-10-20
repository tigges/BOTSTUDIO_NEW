import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  connectorIssues, connectorProfileSettings, connectorSettings, connectorTools, factsToRemember, fillJsonTemplate,
  fillToolTemplate, httpConfig, journeyVariables, memoryIssues, parseMemorySettings, recallFacts, toolIssues,
} from '@ybot/shared'
import type { FlowGraph } from '@ybot/runtime'
import { openSecret } from './secrets.js'
import { applyAuthProfile } from './auth-profiles.js'
import { memoryWrites } from './contact-memory.js'
import { connectIntegration, connectionGaps, disconnectIntegration, installConnectorTools, moveLegacyIntegrationKeys } from './integrations.js'
import { runJourney } from './flow-runner.js'
import { newTestState, testJourneyStore, type TestChatDeps } from './test-chat.js'

// ── Contact memory: settings and facts ───────────────────────────────────────

test('memory settings default to off and keep a year', () => {
  assert.deepEqual(parseMemorySettings(undefined), { enabled: false, keys: [], days: 365 })
  assert.deepEqual(parseMemorySettings({ enabled: true, keys: [' email ', 'email', 'stylist'], days: 99_999 }), { enabled: true, keys: ['email', 'stylist'], days: 3_650 })
})

test('memory settings name the field to fix', () => {
  assert.match(memoryIssues({ enabled: true, keys: [], days: 30 })[0]!.message, /add at least one variable/)
  assert.match(memoryIssues({ enabled: true, keys: ['name'], days: 30 })[0]!.message, /name is kept already/)
  assert.match(memoryIssues({ enabled: true, keys: ['_last_user_message'], days: 30 })[0]!.message, /internal/)
  assert.match(memoryIssues({ enabled: true, keys: ['first name'], days: 30 })[0]!.message, /not a variable name/)
  assert.match(memoryIssues({ enabled: false, keys: [], days: 0 })[0]!.message, /Forget after/)
  assert.deepEqual(memoryIssues({ enabled: true, keys: ['email'], days: 30 }), [])
})

test('only listed, filled answers are remembered', () => {
  const settings = parseMemorySettings({ enabled: true, keys: ['email', 'stylist', 'visits', 'vip', 'notes'], days: 30 })
  const facts = factsToRemember(settings, { email: ' ana@example.com ', stylist: '', visits: 3, vip: true, notes: 'x'.repeat(600), other: 'kept out' })
  assert.deepEqual(facts, [{ key: 'email', value: 'ana@example.com' }, { key: 'visits', value: '3' }, { key: 'vip', value: 'yes' }])
  assert.deepEqual(factsToRemember({ ...settings, enabled: false }, { email: 'a@b.co' }), [])
})

test('recall skips expired facts and keys the bot does not list', () => {
  const settings = parseMemorySettings({ enabled: true, keys: ['email', 'stylist'], days: 30 })
  const now = new Date('2026-10-19T12:00:00Z')
  const rows = [
    { key: 'email', value: 'ana@example.com', expiresAt: new Date('2027-01-01T00:00:00Z') },
    { key: 'stylist', value: 'Mia', expiresAt: new Date('2026-10-01T00:00:00Z') },
    { key: 'shoe_size', value: '38', expiresAt: null },
  ]
  assert.deepEqual(recallFacts(settings, rows, now), { email: 'ana@example.com' })
})

test('an unchanged answer refreshes its expiry at most once a day', () => {
  const settings = parseMemorySettings({ enabled: true, keys: ['email', 'stylist'], days: 30 })
  const now = new Date('2026-10-19T12:00:00Z')
  const writes = memoryWrites(settings, { email: 'ana@example.com', stylist: 'Mia' }, [
    { key: 'email', value: 'ana@example.com', updatedAt: new Date('2026-10-19T08:00:00Z') },
    { key: 'stylist', value: 'Leo', updatedAt: new Date('2026-10-19T08:00:00Z') },
  ], now)
  assert.deepEqual(writes.map((w) => [w.key, w.op]), [['stylist', 'update']])
  assert.equal(writes[0]!.expiresAt.toISOString(), '2026-11-18T12:00:00.000Z')
  const later = memoryWrites(settings, { email: 'ana@example.com' }, [{ key: 'email', value: 'ana@example.com', updatedAt: new Date('2026-10-17T08:00:00Z') }], now)
  assert.deepEqual(later.map((w) => [w.key, w.op]), [['email', 'update']])
})

test('the journey offers the variables it asks for or sets', () => {
  const graphs = [{ nodes: [
    { data: { kind: 'ask_question', config: { variable: 'email' } } },
    { data: { kind: 'set_variable', config: { variable: 'tier' } } },
    { data: { kind: 'set_variable', config: { variable: '_internal' } } },
    { data: { kind: 'send_message', config: { variable: 'nope' } } },
  ] }]
  assert.deepEqual(journeyVariables(graphs), ['email', 'tier'])
})

// ── Connectors ───────────────────────────────────────────────────────────────

test('connector tools are valid registry tools with no credentials on them', () => {
  for (const provider of ['hubspot', 'zendesk'] as const) {
    const tools = connectorTools(provider, { subdomain: 'acme', email: 'agent@acme.com' })
    assert.equal(tools.length, 2)
    for (const tool of tools) {
      assert.deepEqual(toolIssues({ ...tool, authProfileId: 'p1' }), [], tool.name)
      assert.deepEqual(httpConfig(tool.config).headers, {})
      assert.ok(tool.effect === 'read' || httpConfig(tool.config).retries === 0, `${tool.name} does not retry a write`)
    }
    assert.deepEqual(tools.map((tool) => tool.effect), ['read', 'write'])
  }
})

test('HubSpot search and Zendesk calls fill to the shapes the services expect', () => {
  const [find, create] = connectorTools('hubspot', {})
  const search = fillJsonTemplate(httpConfig(find!.config).body, { email: 'ana@example.com' }) as { filterGroups: Array<{ filters: Array<{ value: string }> }> }
  assert.equal(search.filterGroups[0]!.filters[0]!.value, 'ana@example.com')
  const contact = fillJsonTemplate(httpConfig(create!.config).body, { email: 'ana@example.com', firstname: 'Ana' }) as { properties: Record<string, unknown> }
  assert.equal(contact.properties['firstname'], 'Ana')

  const [tickets, ticket] = connectorTools('zendesk', { subdomain: 'acme' })
  const url = fillToolTemplate(httpConfig(tickets!.config).url, { email: 'ana+1@example.com' }, true)
  assert.equal(url, 'https://acme.zendesk.com/api/v2/search.json?query=type%3Aticket%20requester%3Aana%2B1%40example.com&sort_by=updated_at&sort_order=desc')
  const body = fillJsonTemplate(httpConfig(ticket!.config).body, { subject: 'Refund', description: 'Card charged "twice"', email: 'ana@example.com', name: 'Ana' }) as { ticket: { comment: { body: string } } }
  assert.equal(body.ticket.comment.body, 'Card charged "twice"')
})

test('Zendesk settings accept a pasted address and name the field to fix', () => {
  assert.deepEqual(connectorSettings('zendesk', { subdomain: 'https://Acme.zendesk.com/agent', email: ' a@acme.com ' }), { subdomain: 'acme', email: 'a@acme.com' })
  const issues = connectorIssues('zendesk', { subdomain: '', email: 'nope' }, '', false)
  assert.deepEqual(issues.map((issue) => issue.field), ['secret', 'subdomain', 'email'])
  assert.deepEqual(connectorProfileSettings('zendesk', { subdomain: 'acme', email: 'a@acme.com' }), { username: 'a@acme.com/token' })
})

// ── Integrations against an in-memory database ──────────────────────────────

type Row = Record<string, unknown> & { id: string }

function fakeDb() {
  let n = 0
  const id = (prefix: string) => `${prefix}${++n}`
  const connections: Row[] = []
  const profiles: Row[] = []
  const tools: Row[] = []
  const bots: Row[] = [{ id: 'bot1', tenantId: 't1' }]
  const profileView = (profileId: unknown, include: Record<string, unknown> | undefined) => {
    const profile = profiles.find((p) => p.id === profileId)
    if (!profile) return null
    const nested = include && typeof include === 'object' && 'include' in include
    return nested ? { ...profile, _count: { tools: tools.filter((t) => t.authProfileId === profile.id).length } } : { ...profile }
  }
  const byKey = (where: { tenantId_provider: { tenantId: string; provider: string } }) =>
    connections.find((c) => c.tenantId === where.tenantId_provider.tenantId && c.provider === where.tenantId_provider.provider)
  const db = {
    integrationConnection: {
      async findUnique({ where, include }: { where: { tenantId_provider: { tenantId: string; provider: string } }; include?: { authProfile?: Record<string, unknown> | true } }) {
        const row = byKey(where)
        if (!row) return null
        return include?.authProfile ? { ...row, authProfile: profileView(row.authProfileId, include.authProfile === true ? undefined : include.authProfile) } : { ...row }
      },
      async upsert({ where, create, update }: { where: { tenantId_provider: { tenantId: string; provider: string } }; create: Row; update: Row }) {
        const row = byKey(where)
        if (row) { Object.assign(row, update); return { ...row } }
        const fresh = { id: id('c'), connectedAt: new Date(), settings: {}, ...create }
        connections.push(fresh)
        return { ...fresh }
      },
      async delete({ where }: { where: { id: string } }) {
        connections.splice(connections.findIndex((c) => c.id === where.id), 1)
      },
      async findMany({ where }: { where: { apiKey: { not: null } } }) {
        void where
        return connections.filter((c) => c.apiKey !== null && c.apiKey !== undefined).map((c) => ({ ...c }))
      },
      async update({ where, data }: { where: { id: string }; data: Row }) {
        const row = connections.find((c) => c.id === where.id)!
        Object.assign(row, data)
        return { ...row }
      },
    },
    authProfile: {
      async findMany({ where }: { where: { tenantId: string; name: { startsWith: string } } }) {
        return profiles.filter((p) => p.tenantId === where.tenantId && String(p.name).startsWith(where.name.startsWith))
      },
      async create({ data }: { data: Row }) {
        const row = { ...data, id: id('p') }
        profiles.push(row)
        return { ...row }
      },
      async update({ where, data }: { where: { id: string }; data: Row }) {
        const row = profiles.find((p) => p.id === where.id)!
        Object.assign(row, data)
        return { ...row }
      },
      async delete({ where }: { where: { id: string } }) {
        profiles.splice(profiles.findIndex((p) => p.id === where.id), 1)
      },
    },
    tool: {
      async findFirst({ where }: { where: { botId: string; name: string } }) {
        return tools.find((t) => t.botId === where.botId && t.name === where.name) ?? null
      },
      async create({ data }: { data: Row }) {
        const row = { ...data, id: id('tool') }
        tools.push(row)
        return { id: row.id, name: row['name'] }
      },
    },
    bot: {
      async findFirst({ where }: { where: { id: string; tenantId: string } }) {
        return bots.find((b) => b.id === where.id && b.tenantId === where.tenantId) ?? null
      },
    },
  }
  return { db: db as never, connections, profiles, tools }
}

const HUBSPOT = { id: 'hubspot', name: 'HubSpot' }
const ZENDESK = { id: 'zendesk', name: 'Zendesk' }

test('connecting seals the key in an Auth Profile and never stores it on the connection', async () => {
  const { db, connections, profiles } = fakeDb()
  profiles.push({ id: 'taken', tenantId: 't1', name: 'HubSpot', kind: 'api_key', settings: {} })
  const { profile } = await connectIntegration({ tenantId: 't1', userId: 'u1', item: HUBSPOT, secret: 'pat-na1-1234567890abcd' }, db)
  assert.equal(profile.name, 'HubSpot 2')
  assert.equal(profile.kind, 'bearer')
  assert.equal(profile.secretHint, '••••abcd')
  assert.equal(openSecret(String(profile.secretEnc)), 'pat-na1-1234567890abcd')
  assert.equal(connections[0]!.apiKey, null)
  assert.equal(connections[0]!.authProfileId, profile.id)
  assert.ok(!JSON.stringify(connections).includes('pat-na1'))
  assert.deepEqual(applyAuthProfile(profile as never).headers, { Authorization: 'Bearer pat-na1-1234567890abcd' })

  const again = await connectIntegration({ tenantId: 't1', userId: 'u1', item: HUBSPOT }, db)
  assert.equal(again.profile.id, profile.id, 'reconnecting reuses the profile')
  assert.equal(openSecret(String(again.profile.secretEnc)), 'pat-na1-1234567890abcd', 'leaving the key empty keeps it')
})

test('Zendesk connects with basic auth as agent/token and installs tools on its subdomain', async () => {
  const { db, tools } = fakeDb()
  await assert.rejects(
    connectIntegration({ tenantId: 't1', userId: 'u1', item: ZENDESK, secret: 'tok', settings: { subdomain: 'acme' } }, db),
    /Agent email/,
  )
  const { profile } = await connectIntegration({ tenantId: 't1', userId: 'u1', item: ZENDESK, secret: 'zd-token-123456', settings: { subdomain: 'acme', email: 'agent@acme.com' } }, db)
  const auth = applyAuthProfile(profile as never)
  assert.equal(auth.headers['Authorization'], `Basic ${Buffer.from('agent@acme.com/token:zd-token-123456').toString('base64')}`)

  const first = await installConnectorTools('t1', 'bot1', 'zendesk', db)
  assert.deepEqual(first.created.map((tool) => tool.name), ['zendesk_find_tickets', 'zendesk_create_ticket'])
  assert.ok(tools.every((tool) => tool.authProfileId === profile.id))
  assert.match(String((tools[0]!.config as { url: string }).url), /^https:\/\/acme\.zendesk\.com\/api\/v2\//)
  const second = await installConnectorTools('t1', 'bot1', 'zendesk', db)
  assert.equal(second.created.length, 0)
  assert.equal(second.skipped.length, 2)
  await assert.rejects(installConnectorTools('t1', 'bot1', 'hubspot', db), /Connect HubSpot first/)
  await assert.rejects(installConnectorTools('t1', 'other-bot', 'zendesk', db), /Bot not found/)
})

test('plain-text keys move into sealed Auth Profiles once', async () => {
  const { db, connections, profiles } = fakeDb()
  connections.push(
    { id: 'c-a', tenantId: 't1', provider: 'hubspot', apiKey: 'legacy-hubspot-key-9876', authProfileId: null, settings: {} },
    { id: 'c-b', tenantId: 't1', provider: 'zendesk', apiKey: 'legacy-zendesk-token', authProfileId: null, settings: {} },
    { id: 'c-c', tenantId: 't1', provider: 'slack', apiKey: null, authProfileId: null, settings: {} },
  )
  const catalog = [HUBSPOT, ZENDESK, { id: 'slack', name: 'Slack' }]
  assert.deepEqual(await moveLegacyIntegrationKeys(catalog, db), { moved: 2 })
  assert.ok(connections.every((c) => c.apiKey === null))
  assert.equal(profiles.length, 2)
  assert.equal(openSecret(String(profiles[0]!.secretEnc)), 'legacy-hubspot-key-9876')
  assert.equal(connections[0]!.authProfileId, profiles[0]!.id)
  assert.ok(!JSON.stringify(profiles).includes('legacy-'))
  assert.deepEqual(await moveLegacyIntegrationKeys(catalog, db), { moved: 0 }, 'a second boot changes nothing')
  // A Zendesk key on its own cannot call Zendesk: the connection asks for the subdomain and agent email.
  assert.deepEqual(connectionGaps('zendesk', connections[1]!.settings, true).map((gap) => gap.field), ['subdomain', 'email'])
})

test('disconnecting removes the profile, or only its secret while tools still use it', async () => {
  const { db, profiles } = fakeDb()
  await connectIntegration({ tenantId: 't1', userId: 'u1', item: HUBSPOT, secret: 'pat-na1-aaaaaaaaaaaa' }, db)
  assert.deepEqual(await disconnectIntegration('t1', 'hubspot', db), { toolsLeft: 0 })
  assert.equal(profiles.length, 0)

  await connectIntegration({ tenantId: 't1', userId: 'u1', item: HUBSPOT, secret: 'pat-na1-bbbbbbbbbbbb' }, db)
  await installConnectorTools('t1', 'bot1', 'hubspot', db)
  assert.deepEqual(await disconnectIntegration('t1', 'hubspot', db), { toolsLeft: 2 })
  assert.equal(profiles.length, 1)
  assert.equal(profiles[0]!.secretEnc, null)
  assert.throws(() => applyAuthProfile(profiles[0] as never), /has no secret yet/)
})

// ── The journey recalls and remembers ────────────────────────────────────────

const quietModel = {
  classify: async () => ({ category: 'other', confidence: 0 }),
  embed: async () => ({ embeddings: [[]] }),
  complete: async () => ({ content: '' }),
  stream: async () => {},
}

const deps: TestChatDeps = {
  handoverRules: async () => ({ liveAgents: false, alwaysHuman: [] }) as never,
  answer: async () => {},
  llm: async () => quietModel as never,
  catalog: async () => undefined,
  db: {},
  now: () => new Date('2026-10-19T12:00:00Z'),
  safety: async () => ({ rules: [], privacy: {} }) as never,
}

const emailGraph: FlowGraph = {
  nodes: [
    { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
    { id: 'hello', data: { kind: 'send_message', label: 'Hello', config: { text: 'Email on file: {{contact.email}}.' } } },
    { id: 'ask', data: { kind: 'ask_question', label: 'Email', config: { question: 'Which email should we use?', variable: 'email' } } },
    { id: 'done', data: { kind: 'send_message', label: 'Done', config: { text: 'Thanks, noted.' } } },
  ],
  edges: [
    { id: 'a', source: 'start', target: 'hello' },
    { id: 'b', source: 'hello', target: 'ask' },
    { id: 'c', source: 'ask', target: 'done', sourceHandle: 'out' },
  ],
} as never

async function chat(memory: Map<string, string>, lines: string[]) {
  const state = newTestState()
  const input = { tenantId: 't1', botId: 'bot1', chapters: [{ name: 'Welcome', graph: emailGraph }], startChapter: 'Welcome', environmentLabel: 'Sandbox', message: '', catalog: { facts: [] } }
  const settings = parseMemorySettings({ enabled: true, keys: ['email'], days: 30 })
  const store = {
    ...testJourneyStore(input as never, state, deps),
    recall: async () => Object.fromEntries(memory),
    async remember(flow: Record<string, unknown>) {
      for (const fact of factsToRemember(settings, flow)) memory.set(fact.key, fact.value)
    },
  }
  const replies: string[] = []
  for (const line of lines) {
    const turn = await runJourney(store, { conversationId: 'chat', botId: 'bot1', tenantId: 't1', userText: line })
    replies.push(turn.messages.join('\n'))
  }
  return replies
}

test('an answer from one chat is recalled as contact.* in the next', async () => {
  const memory = new Map<string, string>()
  const first = await chat(memory, ['hi', 'ana@example.com'])
  assert.doesNotMatch(first[0]!, /@/)
  assert.equal(memory.get('email'), 'ana@example.com')

  const second = await chat(memory, ['hi'])
  assert.match(second[0]!, /Email on file: ana@example\.com\./)
})
