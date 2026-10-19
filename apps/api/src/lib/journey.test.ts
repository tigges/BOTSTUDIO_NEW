import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hairStudioPack, journeyLayout, journeyTrail } from '@ybot/shared'
import { journeyTraffic, logChapterEntry, tallyJourneyChats } from './journey-traffic.js'

function input(flow: { name: string; tags?: string[]; graph: unknown }, index: number, published = true) {
  return { id: `f${index}`, name: flow.name, tags: flow.tags ?? [], published, graph: flow.graph }
}

test('salon chapters hang off the welcome, and parked charts stay loose', () => {
  const pack = hairStudioPack('Bella Hair Studio', 'Bella')
  const layout = journeyLayout(pack.flows.map((flow, index) => input(flow, index, flow.publish)))
  assert.equal(layout.roots.length, 1)
  assert.equal(layout.roots[0]?.name, 'Salon welcome')
  assert.deepEqual(layout.roots[0]?.children.map((chapter) => chapter.name), [
    'Location',
    'Salon hours',
    'Services and prices',
    'Book an appointment',
  ])
  const book = layout.roots[0]?.children.find((chapter) => chapter.name === 'Book an appointment')
  assert.deepEqual(layout.roots[0]?.children.find((chapter) => chapter.name === 'Location')?.looksUp, ['Catalog'])
  assert.deepEqual(book?.workflows, [])
  assert.equal(book?.children.some((chapter) => chapter.name === 'Consultation'), true)
  assert.equal(layout.loose.some((chapter) => chapter.name === 'Gift voucher'), true)
  assert.equal(layout.suggested.length, 0)
  const gift = layout.loose.find((chapter) => chapter.name === 'Gift voucher')
  const trail = journeyTrail(layout, gift?.id ?? '')
  assert.deepEqual(trail.path.map((chapter) => chapter.name), ['Gift voucher'])
  const bookTrail = journeyTrail(layout, book?.id ?? '')
  assert.deepEqual(bookTrail.path.map((chapter) => chapter.name), ['Salon welcome', 'Book an appointment'])
  assert.equal(bookTrail.next.includes('Consultation'), true)
})

test('an unpublished learning chapter sits beside the welcome', () => {
  const layout = journeyLayout([
    {
      id: 'welcome',
      name: 'Salon welcome',
      tags: ['welcome'],
      published: true,
      graph: { nodes: [], edges: [] },
    },
    {
      id: 'learned',
      name: 'Book a colour',
      tags: ['learning'],
      published: false,
      graph: {
        nodes: [
          { id: 'ask', data: { kind: 'ask_question', config: { question: 'What colour is your hair now?' } } },
        ],
        edges: [],
      },
    },
  ])
  assert.deepEqual(layout.suggested.map((chapter) => chapter.name), ['Book a colour'])
  assert.equal(layout.loose.length, 0)
})

test('an unpublished proposed chapter stays suggested until a chart opens it', () => {
  const layout = journeyLayout([
    {
      id: 'welcome',
      name: 'Salon welcome',
      tags: ['welcome'],
      published: true,
      graph: {
        nodes: [
          { id: 'go', data: { kind: 'execute_flow', config: { flowName: 'Hours' } }, position: { y: 0 } },
        ],
        edges: [],
      },
    },
    {
      id: 'hours',
      name: 'Hours',
      tags: ['proposed'],
      published: true,
      graph: { nodes: [], edges: [] },
    },
    {
      id: 'walk',
      name: 'Walk-ins',
      tags: ['proposed'],
      published: false,
      graph: {
        nodes: [
          { id: 'ask', data: { kind: 'ask_question', config: { question: 'Can they come in today?' } } },
        ],
        edges: [],
      },
    },
  ])
  assert.deepEqual(layout.roots[0]?.children.map((chapter) => chapter.name), ['Hours'])
  assert.deepEqual(layout.suggested.map((chapter) => chapter.name), ['Walk-ins'])
  assert.equal(layout.suggested[0]?.steps[0], 'Can they come in today?')
  assert.equal(layout.loose.length, 0)
})

test('a chat that walks two chapters counts on both', () => {
  assert.deepEqual(tallyJourneyChats([
    { flowId: 'book', conversationId: 'c1' },
    { flowId: 'book', conversationId: 'c1' },
    { flowId: 'hours', conversationId: 'c1' },
    { flowId: 'book', conversationId: 'c2' },
  ]), { book: 2, hours: 1 })
})

test('a jump back to an earlier chapter does not loop the map', () => {
  const layout = journeyLayout([
    {
      id: 'a',
      name: 'Welcome & Routing',
      tags: ['welcome'],
      published: true,
      graph: { nodes: [{ id: 'go', data: { kind: 'execute_flow', config: { flowName: 'Returns' } }, position: { y: 0 } }], edges: [] },
    },
    {
      id: 'b',
      name: 'Returns',
      tags: [],
      published: true,
      graph: { nodes: [{ id: 'back', data: { kind: 'execute_flow', config: { flowName: 'Welcome & Routing' } }, position: { y: 0 } }], edges: [] },
    },
  ])
  assert.equal(layout.roots[0]?.children[0]?.name, 'Returns')
  assert.equal(layout.roots[0]?.children[0]?.children.length, 0)
  assert.deepEqual(layout.roots[0]?.children[0]?.jumps, ['Welcome & Routing'])
})

test('a chat logged into a named chapter counts there, and a missing chapter writes nothing', async () => {
  const written: Array<{ conversationId: string; flowVersionId: string }> = []
  const db = {
    flowVersion: {
      findFirst: async (args: { where: { flow: { name: string } } }) => (args.where.flow.name === 'Salon hours' ? { id: 'v-hours' } : null),
    },
    stepLog: {
      create: async (args: { data: { conversationId: string; flowVersionId: string } }) => {
        written.push({ conversationId: args.data.conversationId, flowVersionId: args.data.flowVersionId })
        return args.data
      },
    },
  } as unknown as Parameters<typeof logChapterEntry>[0]
  const at = new Date('2026-10-19T12:00:00Z')
  assert.equal(await logChapterEntry(db, { tenantId: 't', botId: 'b', conversationId: 'c1', chapter: 'Salon hours', at }), true)
  assert.equal(await logChapterEntry(db, { tenantId: 't', botId: 'b', conversationId: 'c2', chapter: 'Gone chapter', at }), false)
  assert.deepEqual(written, [{ conversationId: 'c1', flowVersionId: 'v-hours' }])
  assert.deepEqual(tallyJourneyChats(written.map((row) => ({ flowId: 'hours', conversationId: row.conversationId }))), { hours: 1 })
})

test('each chapter reports how its chats ended, on the chosen environment only', async () => {
  const db = {
    flowVersion: { findMany: async () => [{ id: 'v-book', flowId: 'book' }, { id: 'v-person', flowId: 'person' }] },
    stepLog: {
      findMany: async () => [
        { conversationId: 'c1', flowVersionId: 'v-book' },
        { conversationId: 'c2', flowVersionId: 'v-book' },
        { conversationId: 'c3', flowVersionId: 'v-book' },
        { conversationId: 'c3', flowVersionId: 'v-person' },
        { conversationId: 'c4', flowVersionId: 'v-book' },
        { conversationId: 'sandbox', flowVersionId: 'v-book' },
      ],
    },
    conversation: {
      findMany: async () => [
        { id: 'c1', status: 'resolved', assignedTo: null, environmentId: 'prod' },
        { id: 'c2', status: 'active', assignedTo: null, environmentId: 'prod' },
        { id: 'c3', status: 'escalated', assignedTo: null, environmentId: 'prod' },
        { id: 'c4', status: 'resolved', assignedTo: 'agent-1', environmentId: 'prod' },
        { id: 'sandbox', status: 'resolved', assignedTo: null, environmentId: 'sand' },
      ],
    },
  } as unknown as Parameters<typeof journeyTraffic>[0]
  const traffic = await journeyTraffic(db, 't', 'b', new Date(0), 'prod')
  assert.deepEqual(traffic.chats, { book: 4, person: 1 })
  assert.deepEqual(traffic.outcomes['book'], { chats: 4, bot: 1, person: 2, open: 1 })
  assert.deepEqual(traffic.outcomes['person'], { chats: 1, bot: 0, person: 1, open: 0 })
  assert.deepEqual(traffic.total, { chats: 4, bot: 1, person: 2, open: 1 })
  assert.deepEqual((await journeyTraffic(db, 't', 'b', new Date(0))).total, { chats: 5, bot: 2, person: 2, open: 1 })
})
