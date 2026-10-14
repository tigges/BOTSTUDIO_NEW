import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine, type FlowGraph } from '@ybot/runtime'
import type { ExecutionServices, Session } from '@ybot/runtime'
import {
  draftWebsiteChat,
  inspectFlowGraph,
  journeyLayout,
  pageFromHtml,
  welcomeDoors,
  welcomeGreeting,
} from '@ybot/shared'
import { isBlockedIp, normalizeScanUrl, PublicSiteError } from './public-site.js'

const YUZU = `<!doctype html>
<html><head><title>Yuzu Hair &amp; Beauty | Japanese hair salon, Ealing Broadway</title></head>
<body>
<a href="https://yuzu.hair/">Yuzu</a>
<a href="https://www.phorest.com/salon/yuzuhairandbeauty">Book your appointment</a>
<a href="https://maps.app.goo.gl/bhFS5wwkW3xxAdKd8">Get directions</a>
<p>Ladies wash, cut and style from £58 with a stylist, £87 with a senior. Kids from £29.</p>
<p>Colour Roots, full head and Illumina colouring. Colour guests need a patch test at least 48 hours before. From £75</p>
<p>Classic highlights, balayage and foiliage. T-section from £64, half head from £75, full head from £98. From £64</p>
<p>Nashi fillers from £33 and K2.0 moisture. Aura smoothing from £117. From £33</p>
<p>Every Tuesday, 50% off your most expensive colour service with a full-priced wash, cut and blow-dry.</p>
<p>Yuzu Hair &amp; Beauty works at 5 Dickens Yard, Longfield Avenue, Ealing, W5 2TD. Open Tuesday to Friday 10am to 8pm and Saturday 9am to 6pm. Monday and Sunday closed.</p>
<p>Contact 5 Dickens Yard Longfield Avenue Ealing, W5 2TD 020 8840 2244 info@yuzuhairandbeauty.co.uk</p>
<p>Opening hours Tuesday – Friday 10am to 8pm Saturday 9am to 6pm Monday &amp; Sunday CLOSED</p>
<p>Please complete a patch test at least 48 hours before your appointment.</p>
</body></html>`

function session(text: string): Session {
  return {
    id: 's1',
    conversationId: 'c1',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId: 'start',
    variables: { flow: { _last_user_message: text }, global: {}, contact: { name: 'Ada' } },
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

test('yuzu.hair becomes Bella at Yuzu with four doors and no invented cancellation rule', async () => {
  const page = pageFromHtml('https://yuzu.hair/', YUZU)
  const draft = draftWebsiteChat({ pages: [page], companyName: 'Yuzu', personaName: 'Bella' })
  assert.equal(draft.greeting, "Hi, I'm Bella at Yuzu. What's your name?")
  assert.deepEqual(draft.doors.map((door) => door.title), ['Where we are', 'Hours', 'Services', 'Book'])
  assert.equal(draft.doors.every((door) => door.found), true)
  assert.match(draft.doors[0]!.answer, /5 Dickens Yard, Longfield Avenue, Ealing, W5 2TD/)
  assert.match(draft.doors[0]!.answer, /020 8840 2244/)
  assert.match(draft.doors[1]!.answer, /Tuesday to Friday 10am to 8pm/)
  assert.match(draft.doors[1]!.answer, /Saturday 9am to 6pm/)
  assert.match(draft.doors[1]!.answer, /Monday and Sunday closed/)
  assert.match(draft.doors[2]!.answer, /£58/)
  assert.match(draft.doors[2]!.answer, /£75/)
  assert.match(draft.doors[2]!.answer, /£64/)
  assert.match(draft.doors[2]!.answer, /£33/)
  assert.match(draft.doors[2]!.answer, /48 hours/)
  assert.equal(draft.doors[2]!.answer.includes('£29'), false)
  assert.match(draft.doors[3]!.answer, /phorest\.com\/salon\/yuzuhairandbeauty/)
  assert.match(draft.note, /cancellation rule/)
  assert.equal(draft.facts.some((fact) => fact.label === 'Offers'), true)
  assert.equal(draft.documents[0]?.content.includes('Dickens Yard'), true)

  const names = draft.flows.map((flow) => flow.name)
  assert.equal(welcomeGreeting(draft.flows[0]?.graph), draft.greeting)
  assert.deepEqual(welcomeDoors(draft.flows[0]?.graph).map((door) => door.flowName), [
    'Location', 'Salon hours', 'Services and prices', 'Book an appointment',
  ])
  for (const flow of draft.flows) {
    const issues = inspectFlowGraph(flow.graph as Parameters<typeof inspectFlowGraph>[0], { flowNames: names })
    assert.deepEqual(issues.filter((issue) => issue.level === 'block' || issue.level === 'repair'), [], flow.name)
  }

  const machine = new SessionMachine({ llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices)
  const graph = draft.flows[0]!.graph as unknown as FlowGraph
  const opened = await machine.run(session('where are you'), graph, 'where are you')
  assert.equal(opened.session.status, 'waiting_input')
  opened.session.variables.flow['_last_user_message'] = 'Ada'
  opened.session.variables.contact = { name: 'Ada' }
  const named = await machine.run(opened.session, graph, 'Ada')
  assert.equal(named.jumpToFlow, 'Location')

  const layout = journeyLayout(draft.flows.map((flow, index) => ({
    id: `flow-${index}`,
    name: flow.name,
    tags: flow.tags,
    published: false,
    graph: flow.graph,
  })))
  assert.deepEqual(layout.roots.map((chapter) => chapter.name), ['Salon welcome'])
  assert.deepEqual(layout.roots[0]?.children.map((chapter) => chapter.name), [
    'Location', 'Salon hours', 'Services and prices', 'Book an appointment',
  ])
  assert.deepEqual(layout.suggested, [])
  assert.deepEqual(layout.loose, [])
})

test('a page with no facts still has four doors and does not invent an address', () => {
  const page = pageFromHtml('https://example.com/', '<title>Example</title><p>Welcome to the studio. We love hair.</p>')
  const draft = draftWebsiteChat({ pages: [page], companyName: 'Example', personaName: '' })
  assert.equal(draft.greeting, "Hi, I'm Bella at Example. What's your name?")
  assert.equal(draft.doors.every((door) => door.found), false)
  assert.match(draft.doors[0]!.answer, /did not state an address/)
  assert.equal(draft.doors[0]!.answer.includes('Rosewood'), false)
  assert.equal(draft.doors[2]!.answer.includes('£'), false)
})

test('private and local addresses are refused before a request', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.4', '172.16.0.1', '169.254.169.254', '::1', 'fd00::1']) {
    assert.equal(isBlockedIp(ip), true, ip)
  }
  assert.equal(isBlockedIp('8.8.8.8'), false)
  for (const input of ['http://127.0.0.1/admin', 'http://localhost', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'http://user:pass@yuzu.hair']) {
    assert.throws(() => normalizeScanUrl(input), (err: unknown) => err instanceof PublicSiteError, input)
  }
  assert.equal(normalizeScanUrl('yuzu.hair').href, 'https://yuzu.hair/')
})
