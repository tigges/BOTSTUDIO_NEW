import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PRIVACY, chatPlain, draftWebsiteChat, hairStudioPack, learnedSpecFromJobs, packFromLearned, pageFromHtml } from '@ybot/shared'
import { keepFirstQuestion, type FlowGraph } from '@ybot/runtime'
import { currentLlmScope } from './llm-ledger.js'
import { runTestTurn, withWorkingCopy, type TestChatDeps, type TestChatState } from './test-chat.js'

const noSafety: TestChatDeps['safety'] = async () => ({ rules: [], privacy: DEFAULT_PRIVACY })

const noTeam = async () => ({ liveAgents: false, alwaysHuman: [] })

/** The model never answers unless a test says so; phrase matching decides. */
function quietModel(classify?: (text: string, params: { categories: string[] }) => Promise<{ category: string; confidence: number }>) {
  return {
    classify: classify ?? (async () => ({ category: 'other', confidence: 0 })),
    embed: async () => ({ embeddings: [[]] }),
    complete: async () => ({ content: '' }),
    stream: async () => {},
  }
}

async function testTurn(input: {
  chapters: Array<{ name: string; graph: FlowGraph }>
  startChapter: string
  message: string
  environmentLabel: string
  state?: TestChatState
  catalog?: Parameters<typeof runTestTurn>[0]['catalog']
  now?: Date
  llm?: { classify: (text: string, params: { categories: string[] }) => Promise<{ category: string; confidence: number }> }
}) {
  const turn = await runTestTurn({
    tenantId: 'tenant',
    botId: 'bot',
    chapters: input.chapters,
    startChapter: input.startChapter,
    environmentLabel: input.environmentLabel,
    message: input.message,
    catalog: input.catalog ?? { facts: [] },
    state: input.state,
  }, {
    handoverRules: noTeam,
    answer: async () => {},
    llm: async () => quietModel(input.llm?.classify) as never,
    catalog: async () => undefined,
    db: {},
    now: () => input.now ?? new Date(),
    safety: noSafety,
  })
  return { text: turn.text, chapter: turn.chapter, path: turn.path, state: turn.state }
}

function salonWalk(company = 'Yuzu') {
  const pack = hairStudioPack(company, 'Bella')
  return {
    chapters: pack.flows.map((flow) => ({
      name: flow.name,
      graph: flow.graph as unknown as FlowGraph,
    })),
    catalog: pack.catalog,
  }
}

test('the test chat opens on the greeting and does not burn a fake hi', async () => {
  const { chapters, catalog } = salonWalk()
  const open = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  assert.match(open.text, /What's your name\?/)
  assert.equal(open.chapter, 'Salon welcome')
  assert.equal(open.state.session?.status, 'waiting_input')
})

test('a request on the welcome continues in that chapter and keeps the name', async () => {
  const { chapters, catalog } = salonWalk()
  const hello = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'where are you',
    environmentLabel: 'Sandbox',
  })
  assert.match(hello.text, /14 Rosewood Lane/)
  assert.equal(hello.chapter, 'Location')
  assert.equal(hello.text.includes("What's your name"), false)
})

test('cut opens the price, and services after hours does not dead-end', async () => {
  const { chapters, catalog } = salonWalk()
  const open = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const cut = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'cut',
    environmentLabel: 'Sandbox',
    state: open.state,
  })
  assert.match(cut.text, /£35/)
  assert.equal(cut.chapter, 'Services and prices')
  assert.equal(cut.text.includes("What would you like done"), false)

  const hours = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'salon hours',
    environmentLabel: 'Sandbox',
    state: cut.state,
  })
  assert.match(hours.text, /Monday to Saturday/)
  assert.match(hours.text, /Shall I book/)
  assert.equal(/where we are/.test(hours.text), false)
  assert.equal((hours.text.match(/\?/g) ?? []).length, 1)
  assert.equal(hours.chapter, 'Salon hours')

  const services = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'services',
    environmentLabel: 'Sandbox',
    state: hours.state,
  })
  assert.match(services.text, /thinking of|£/)
  assert.equal(services.chapter, 'Services and prices')
  assert.equal(services.text.includes('I can also help with hours, prices, or a booking.'), false)
})

test('a finished chapter offers the map instead of greeting again', async () => {
  const { chapters, catalog } = salonWalk()
  const priced = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'how much is a haircut',
    environmentLabel: 'Sandbox',
  })
  const booked = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'no',
    environmentLabel: 'Sandbox',
    state: priced.state,
  })
  const again = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'catalog',
    environmentLabel: 'Sandbox',
    state: booked.state,
  })
  assert.match(again.text, /What would you like/)
  assert.equal(again.text.includes("What's your name"), false)
  assert.equal(again.text.includes("Hi, I'm Bella"), false)
})

test('a handoff to a chapter that is not on this map stops', async () => {
  const walk = salonWalk()
  const chapters = walk.chapters.filter((chapter) => chapter.name !== 'Location')
  const hello = await testTurn({
    chapters,
    catalog: walk.catalog,
    startChapter: 'Salon welcome',
    message: 'where are you',
    environmentLabel: 'Production',
  })
  const stopped = await testTurn({
    chapters,
    catalog: walk.catalog,
    startChapter: 'Salon welcome',
    message: 'Ada',
    environmentLabel: 'Production',
    state: hello.state,
  })
  assert.match(stopped.text, /Location is not on this Production map\./)
  assert.equal(stopped.text.includes('Rosewood'), false)
  assert.equal(stopped.chapter, 'Salon welcome')
})

test('colour qualifies the booking instead of reading a Tuesday offer', async () => {
  const home = pageFromHtml('https://yuzu.hair/', `<title>Yuzu</title>
<p>Yuzu Hair and Beauty works at 5 Dickens Yard, Longfield Avenue, Ealing, W5 2TD.</p>
<p>Open Tuesday to Friday 10am to 8pm and Saturday 9am to 6pm. Monday and Sunday closed.</p>
<p>Every Tuesday, 50% off your most expensive colour service with a full-priced wash, cut and blow-dry.</p>
<p>Every Wednesday, 25% off blow-dries.</p>
<a href="https://www.phorest.com/salon/yuzuhairandbeauty">Book</a>`)
  const draft = draftWebsiteChat({ pages: [home], companyName: 'Yuzu', personaName: 'Bella' })
  const chapters = draft.flows.map((flow) => ({
    name: flow.name,
    graph: flow.graph as unknown as FlowGraph,
  }))
  const open = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const colour = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'color',
    environmentLabel: 'Sandbox',
    state: open.state,
  })
  assert.equal(colour.chapter, 'Book an appointment')
  assert.match(colour.text, /colour work/i)
  assert.equal(/50%|Every Tuesday/i.test(colour.text), false)
  assert.equal(/phorest\.com/i.test(colour.text), false)
  assert.equal((colour.text.match(/\?/g) ?? []).length, 1)

  const need = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'full head',
    environmentLabel: 'Sandbox',
    state: colour.state,
  })
  assert.match(need.text, /cut with the colour/i)
  const upsell = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'yes',
    environmentLabel: 'Sandbox',
    state: need.state,
  })
  assert.match(upsell.text, /senior stylist/i)
  const stylist = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'senior',
    environmentLabel: 'Sandbox',
    state: upsell.state,
  })
  assert.match(stylist.text, /When would suit/i)
  const when = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'Tuesday afternoon',
    environmentLabel: 'Sandbox',
    state: stylist.state,
  })
  assert.match(when.text, /Tuesday with a senior stylist/)
  assert.match(when.text, /12pm, 2pm, or 3pm/)
  assert.match(when.text, /Which time/)
  assert.equal((when.text.match(/\?/g) ?? []).length, 1)
  const slot = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '2pm',
    environmentLabel: 'Sandbox',
    state: when.state,
  })
  assert.match(slot.text, /What's your name/)
  const named = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'Sophie',
    environmentLabel: 'Sandbox',
    state: slot.state,
  })
  assert.match(named.text, /mobile/i)
  const mobile = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '07700 900123',
    environmentLabel: 'Sandbox',
    state: named.state,
  })
  assert.match(mobile.text, /confirm/i)
  assert.match(mobile.text, /Tuesday at 2pm/)
  assert.equal(/Tuesday afternoon/.test(mobile.text), false)
  assert.match(chatPlain(mobile.text), /Phorest/)
  assert.equal(/https?:\/\//.test(chatPlain(mobile.text)), false)
  assert.match(mobile.text, /\[Phorest\]\(/)
  assert.equal(mobile.chapter, 'Book an appointment')
})

test('a mistyped tomorrow offers senior slots and confirms a clock time', async () => {
  const saturday = new Date('2026-10-17T12:00:00')
  const home = pageFromHtml('https://yuzu.hair/', `<title>Yuzu</title>
<p>Yuzu Hair and Beauty works at 5 Dickens Yard, Longfield Avenue, Ealing, W5 2TD.</p>
<p>Open Tuesday to Friday 10am to 8pm and Saturday 9am to 6pm. Monday and Sunday closed.</p>
<a href="https://www.phorest.com/salon/yuzuhairandbeauty">Book</a>`)
  const draft = draftWebsiteChat({ pages: [home], companyName: 'Yuzu', personaName: 'Bella' })
  const chapters = draft.flows.map((flow) => ({
    name: flow.name,
    graph: flow.graph as unknown as FlowGraph,
  }))
  const turn = (message: string, state?: TestChatState) => testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message,
    environmentLabel: 'Sandbox',
    state,
    now: saturday,
  })
  const open = await turn('')
  const colour = await turn('color', open.state)
  const need = await turn('full head', colour.state)
  const upsell = await turn('yes', need.state)
  const stylist = await turn('senior', upsell.state)
  assert.match(stylist.text, /When would suit/i)
  const when = await turn('tomoeeow', stylist.state)
  assert.match(when.text, /closed Sunday/)
  assert.match(when.text, /Tuesday with a senior stylist I have 11am, 2pm, or 5pm/)
  assert.equal(/tomoeeow/i.test(when.text), false)
  assert.equal((when.text.match(/\?/g) ?? []).length, 1)
  const slot = await turn('11am', when.state)
  assert.match(slot.text, /What's your name/)
  const named = await turn('CT', slot.state)
  assert.match(named.text, /mobile/i)
  const mobile = await turn('788888877', named.state)
  assert.match(mobile.text, /confirm/i)
  assert.match(mobile.text, /Tuesday at 11am/)
  assert.equal(/tomoeeow/i.test(mobile.text), false)
  assert.match(chatPlain(mobile.text), /Phorest/)
})

function withOldHoursDoors(graph: FlowGraph): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.data.kind !== 'route_topic') return node
      const routes = (node.data.config['routes'] as Array<{ handle: string; phrases: string[] }> | undefined) ?? []
      if (!routes.some((route) => route.handle === 'hours')) return node
      return {
        ...node,
        data: {
          ...node.data,
          config: {
            ...node.data.config,
            routes: routes.map((route) => {
              if (route.handle === 'hours') return { ...route, phrases: ['hours', 'opening hours', 'when are you open'] }
              if (route.handle === 'book') return { ...route, phrases: ['book', 'booking', 'yes', 'please', 'ok', 'okay', 'yeah'] }
              return route
            }),
          },
        },
      }
    }),
  }
}

test('ok after Want the hours opens Salon hours, and ok after hours still books', async () => {
  const { chapters, catalog } = salonWalk()
  const open = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const where = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'where are you',
    environmentLabel: 'Sandbox',
    state: open.state,
  })
  assert.match(where.text, /Want the hours/)
  assert.equal(where.chapter, 'Location')
  const hours = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'ok',
    environmentLabel: 'Sandbox',
    state: where.state,
  })
  assert.match(hours.text, /Monday to Saturday|09:00/)
  assert.match(hours.text, /Shall I book/)
  assert.equal(hours.chapter, 'Salon hours')
  assert.equal(/been to us before/i.test(hours.text), false)

  const book = await testTurn({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'ok',
    environmentLabel: 'Sandbox',
    state: hours.state,
  })
  assert.equal(book.chapter, 'Book an appointment')
  assert.match(book.text, /been to us before|colour work|What would you like done/)
})

test('an older Location chart that hears ok as Book still opens hours in the test chat', async () => {
  const walk = salonWalk()
  const chapters = walk.chapters.map((chapter) => (
    chapter.name === 'Location' ? { ...chapter, graph: withOldHoursDoors(chapter.graph) } : chapter
  ))
  const where = await testTurn({
    chapters,
    catalog: walk.catalog,
    startChapter: 'Salon welcome',
    message: 'where are you',
    environmentLabel: 'Sandbox',
  })
  assert.equal(where.chapter, 'Location')
  const hours = await testTurn({
    chapters,
    catalog: walk.catalog,
    startChapter: 'Salon welcome',
    message: 'ok',
    environmentLabel: 'Sandbox',
    state: where.state,
  })
  assert.equal(hours.chapter, 'Salon hours')
  assert.match(hours.text, /Monday to Saturday|09:00/)
  assert.equal(/been to us before/i.test(hours.text), false)
})

test('a named colour stays on the walk and a deal only appears when they ask', async () => {
  const home = pageFromHtml('https://yuzu.hair/', `<title>Yuzu</title>
<p>Yuzu Hair and Beauty works at 5 Dickens Yard, Longfield Avenue, Ealing, W5 2TD.</p>
<p>Open Tuesday to Friday 10am to 8pm and Saturday 9am to 6pm. Monday and Sunday closed.</p>
<p>Every Tuesday, 50% off your most expensive colour service with a full-priced wash, cut and blow-dry.</p>
<p>Every Wednesday, 25% off blow-dries.</p>
<a href="https://www.phorest.com/salon/yuzuhairandbeauty">Book</a>`)
  const prices = pageFromHtml('https://yuzu.hair/prices/', `<title>Price list</title>
<h2>Cut &amp; style</h2>
<table>
<tr><th>Service</th><th>Senior</th><th>Stylist</th></tr>
<tr><th>Ladies wash, cut &amp; style</th><td data-label="Senior">£87</td><td data-label="Stylist">£58</td></tr>
<tr><th>Gents wash, cut &amp; style</th><td data-label="Senior">£45</td><td data-label="Stylist">£38</td></tr>
</table>
<h2>Colour</h2>
<table>
<tr><th>Service</th><th>Senior</th><th>Stylist</th></tr>
<tr><th>Full head</th><td data-label="Senior">£101</td><td data-label="Stylist">£87</td></tr>
<tr><th>Roots</th><td data-label="Senior">£88</td><td data-label="Stylist">£75</td></tr>
</table>`)
  const draft = draftWebsiteChat({ pages: [home, prices], companyName: 'Yuzu', personaName: 'Bella' })
  const chapters = draft.flows.map((flow) => ({
    name: flow.name,
    graph: flow.graph as unknown as FlowGraph,
  }))
  const open = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })

  const colour = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'color',
    environmentLabel: 'Sandbox',
    state: open.state,
  })
  assert.equal(colour.chapter, 'Book an appointment')
  assert.match(colour.text, /colour work/i)
  assert.equal(/50%|Every Tuesday/i.test(colour.text), false)

  const named = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'red full head',
    environmentLabel: 'Sandbox',
    state: colour.state,
  })
  assert.equal(named.chapter, 'Book an appointment')
  assert.match(named.text, /cut with the colour/i)
  assert.equal(/50%|Every Tuesday/i.test(named.text), false)

  const skipQualify = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'full head colour',
    environmentLabel: 'Sandbox',
    state: open.state,
  })
  assert.equal(skipQualify.chapter, 'Book an appointment')
  assert.match(skipQualify.text, /cut with the colour/i)
  assert.equal(/colour work/i.test(skipQualify.text), false)
  assert.equal(/50%/i.test(skipQualify.text), false)

  const priced = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'prices',
    environmentLabel: 'Sandbox',
    state: open.state,
  })
  assert.equal(priced.chapter, 'Services and prices')
  const fullHead = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'red full head',
    environmentLabel: 'Sandbox',
    state: priced.state,
  })
  assert.equal(fullHead.chapter, 'Services and prices')
  assert.match(fullHead.text, /£101|£87/)
  assert.equal(/50%|Every Tuesday/i.test(fullHead.text), false)

  const deals = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'what offers do you have',
    environmentLabel: 'Sandbox',
    state: open.state,
  })
  assert.equal(deals.chapter, 'Offers')
  assert.match(deals.text, /50%|offer/i)
})

test('cut then men hears Gents instead of the whole map', async () => {
  const home = pageFromHtml('https://yuzu.hair/', `<title>Yuzu</title>
<p>Yuzu Hair and Beauty works at 5 Dickens Yard, Longfield Avenue, Ealing, W5 2TD.</p>
<p>Open Tuesday to Friday 10am to 8pm and Saturday 9am to 6pm. Monday and Sunday closed.</p>
<a href="https://www.phorest.com/salon/yuzuhairandbeauty">Book</a>`)
  const prices = pageFromHtml('https://yuzu.hair/prices/', `<title>Price list</title>
<h2>Cut &amp; style</h2>
<table>
<tr><th>Service</th><th>Senior</th><th>Stylist</th></tr>
<tr><th>Ladies wash, cut &amp; style</th><td data-label="Senior">£87</td><td data-label="Stylist">£58</td></tr>
<tr><th>Gents wash, cut &amp; style</th><td data-label="Senior">£45</td><td data-label="Stylist">£38</td></tr>
<tr><th>Kids (12 &amp; under)</th><td data-label="Senior">£29</td><td data-label="Stylist">£23</td></tr>
<tr><th>Teens (13-16) boys</th><td data-label="Senior">£35</td><td data-label="Stylist">£29</td></tr>
<tr><th>Blow-dry</th><td data-label="Senior">£28</td><td data-label="Stylist">£22</td></tr>
</table>
<h2>Colour</h2>
<table>
<tr><th>Service</th><th>Senior</th><th>Stylist</th></tr>
<tr><th>Full head</th><td data-label="Senior">£101</td><td data-label="Stylist">£87</td></tr>
<tr><th>Roots</th><td data-label="Senior">£88</td><td data-label="Stylist">£75</td></tr>
</table>`)
  const draft = draftWebsiteChat({ pages: [home, prices], companyName: 'Yuzu', personaName: 'Bella' })
  const chapters = draft.flows.map((flow) => ({
    name: flow.name,
    graph: flow.graph as unknown as FlowGraph,
  }))
  const open = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const cut = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'cut',
    environmentLabel: 'Sandbox',
    state: open.state,
  })
  assert.match(cut.text, /which cut/i)
  assert.match(cut.text, /Ladies/)
  assert.match(cut.text, /or another/)
  assert.equal(/Ladies wash/.test(cut.text), false)
  assert.equal(cut.chapter, 'Services and prices')

  const men = await testTurn({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'men',
    environmentLabel: 'Sandbox',
    state: cut.state,
  })
  assert.match(men.text, /£45|£38/)
  assert.equal(men.chapter, 'Services and prices')
  assert.equal(/where we are/.test(men.text), false)
  assert.equal(/What would you like/.test(men.text), false)
})

test('a phrase miss on the test chat can open a chapter the model names', async () => {
  const speak = (name: string, text: string): { name: string; graph: FlowGraph } => ({
    name,
    graph: {
      nodes: [
        { id: `${name}-start`, data: { kind: 'trigger_start', label: 'Start', config: {} } },
        { id: `${name}-say`, data: { kind: 'send_message', label: name, config: { text } } },
      ],
      edges: [{ id: `${name}-e`, source: `${name}-start`, target: `${name}-say` }],
    },
  })
  const chapters = [
    speak('Welcome', 'How can I help?'),
    speak('Plans', 'SIM only from £26 a month.'),
    speak('Hours', 'Open 8 to 8.'),
  ]
  const open = await testTurn({
    chapters,
    startChapter: 'Welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const missed = await testTurn({
    chapters,
    startChapter: 'Welcome',
    message: 'how much for unlimited data roaming',
    environmentLabel: 'Sandbox',
    state: open.state,
  })
  assert.equal(/SIM only/.test(missed.text), false)
  const classified = await testTurn({
    chapters,
    startChapter: 'Welcome',
    message: 'how much for unlimited data roaming',
    environmentLabel: 'Sandbox',
    state: open.state,
    llm: { classify: async () => ({ category: 'Plans', confidence: 0.9 }) },
  })
  assert.equal(classified.chapter, 'Plans')
  assert.match(classified.text, /SIM only/)
})

test('a website bot greets, then asks what they need, without asking a name it never uses', async () => {
  const pages = [pageFromHtml('https://www.hubspot.com/', '<html><head><title>HubSpot</title></head><body><p>CRM software for growing teams.</p></body></html>')]
  const job = (name: string, phrases: string[], answer: string) => ({
    flowName: name, choice: name, phrases, question: `What about ${name.toLowerCase()}?`, answer, blurb: answer.slice(0, 80),
  })
  const spec = learnedSpecFromJobs({
    pages,
    companyName: 'hubspot',
    personaName: 'James',
    keepBrand: true,
    topics: [job('View pricing', ['pricing', 'price'], 'HubSpot offers free tools and premium plans from $7 a month.')],
  })
  const pack = packFromLearned(spec, 'hubspot', 'James')
  const chapters = pack.flows.map((flow) => ({ name: flow.name, graph: flow.graph as unknown as FlowGraph }))
  const turn = (message: string, state?: TestChatState) =>
    testTurn({ chapters, startChapter: pack.welcomeName, message, environmentLabel: 'Sandbox', state })

  const open = await turn('')
  assert.equal(open.text, "Hi, I'm James at hubspot.")
  const hi = await turn('hi', open.state)
  assert.equal(hi.text.includes("What's your name"), false)
  assert.match(hi.text, /^What do you need help with\?/)
  const pricing = await turn('pricing', hi.state)
  assert.equal(pricing.chapter, 'View pricing')
  assert.match(pricing.text, /\$7 a month/)
})

test('a model-drafted answer offers the other topics, follows one, and closes on no thanks', async () => {
  const pages = [pageFromHtml('https://www.vodafone.co.uk/', '<html><head><title>Vodafone</title></head><body><p>Phones, SIM only and broadband from Vodafone.</p></body></html>')]
  const job = (name: string, phrases: string[], answer: string) => ({
    flowName: name, choice: name, phrases, question: `What about ${name.toLowerCase()}?`, answer, blurb: answer.slice(0, 80),
  })
  const spec = learnedSpecFromJobs({
    pages,
    companyName: 'Vodafone',
    personaName: 'Voda',
    keepBrand: true,
    topics: [
      job('Buy a phone', ['buy a phone', 'new phone'], 'Vodafone offers pay monthly contract phones and pay as you go phones.'),
      job('Get SIM only deal', ['sim only', 'sim deal'], 'Vodafone offers SIM only plans with minutes, texts and mobile data.'),
      job('Get broadband', ['broadband', 'home internet'], 'Vodafone offers Pro Broadband from £39 a month with Vodafone TV at no extra cost.'),
    ],
  })
  assert.equal(spec.menu, 'I can help you buy a phone, get SIM only deal, get broadband, or talk to a person.')
  const pack = packFromLearned(spec, 'Vodafone', 'Voda')
  const chapters = pack.flows.map((flow) => ({ name: flow.name, graph: flow.graph as unknown as FlowGraph }))
  const turn = (message: string, state?: TestChatState) =>
    testTurn({ chapters, startChapter: pack.welcomeName, message, environmentLabel: 'Sandbox', state })

  const phone = await turn('I want to buy a phone')
  assert.equal(phone.chapter, 'Buy a phone')
  assert.match(phone.text, /pay monthly contract phones/)
  assert.match(phone.text, /Anything else I can help with\?/)
  assert.equal((phone.text.match(/\?/g) ?? []).length, 1)
  assert.equal(phone.state.session?.status, 'waiting_input')

  const broadband = await turn('broadband please', phone.state)
  assert.equal(broadband.chapter, 'Get broadband')
  assert.match(broadband.text, /Pro Broadband from £39/)

  const done = await turn('no thanks', broadband.state)
  assert.match(done.text, /Thanks for chatting/)
  assert.equal(done.state.session?.status, 'completed')
})

function speakChapter(name: string, text: string): { name: string; graph: FlowGraph } {
  return {
    name,
    graph: {
      nodes: [
        { id: `${name}-start`, data: { kind: 'trigger_start', label: 'Start', config: {} } },
        { id: `${name}-say`, data: { kind: 'send_message', label: name, config: { text } } },
      ],
      edges: [{ id: `${name}-e`, source: `${name}-start`, target: `${name}-say` }],
    },
  }
}

function pipelineTurn(message: string, state: TestChatState | undefined, options: {
  chapters?: Array<{ name: string; graph: FlowGraph }>
  liveAgents?: boolean
  alwaysHuman?: string[]
  answer?: TestChatDeps['answer']
} = {}) {
  return runTestTurn({
    tenantId: 'tenant',
    botId: 'bot',
    chapters: options.chapters ?? salonWalk().chapters,
    startChapter: options.chapters ? (options.chapters[0]?.name ?? 'Welcome') : 'Salon welcome',
    environmentLabel: 'Sandbox',
    message,
    catalog: salonWalk().catalog,
    state,
  }, {
    handoverRules: async () => ({ liveAgents: options.liveAgents ?? false, alwaysHuman: options.alwaysHuman ?? [] }),
    answer: options.answer ?? (async () => {}),
    llm: async () => quietModel() as never,
    catalog: async () => undefined,
    db: {},
    safety: noSafety,
  })
}

test('an always-human word hands the test chat to a person when the team is on, and the bot then stays quiet', async () => {
  const open = await pipelineTurn('', undefined, { liveAgents: true, alwaysHuman: ['complaint'] })
  const asked = await pipelineTurn('I want to make a complaint', open.state, { liveAgents: true, alwaysHuman: ['complaint'] })
  assert.equal(asked.path, 'handover')
  assert.equal(asked.state.status, 'escalated')
  assert.equal(asked.state.outcome, 'escalated')
  assert.equal(asked.state.handover?.source, 'always_human')
  assert.equal(asked.state.handover?.priority, 'high')
  assert.match(asked.state.handover?.summary ?? '', /complaint/)
  const after = await pipelineTurn('hello?', asked.state, { liveAgents: true, alwaysHuman: ['complaint'] })
  assert.equal(after.path, 'held')
  assert.equal(after.text, '')
})

test('without opening hours for people the test chat keeps the guest with the bot, as live chats do', async () => {
  const asked = await pipelineTurn('complaint', undefined, { liveAgents: false, alwaysHuman: ['complaint'] })
  assert.notEqual(asked.path, 'handover')
  assert.equal(asked.state.handover, null)
  assert.equal(asked.state.outcome, 'contained_unresolved')
  assert.match(asked.text, /not on chat/)
})

test('a bot with no journey answers from knowledge with the chat so far, in the test environment', async () => {
  const seen: Array<{ text: string; history: unknown[]; environment?: string }> = []
  const answer: TestChatDeps['answer'] = async (request) => {
    seen.push({ text: request.text, history: request.history, environment: currentLlmScope()?.environment })
    request.onChunk(seen.length === 1 ? 'We open at nine.' : 'Yes, on bank holidays too.')
  }
  const first = await pipelineTurn('when do you open', undefined, { chapters: [], answer })
  assert.equal(first.path, 'answer')
  assert.equal(first.text, 'We open at nine.')
  const second = await pipelineTurn('bank holidays too?', first.state, { chapters: [], answer })
  assert.equal(second.text, 'Yes, on bank holidays too.')
  assert.equal(seen[1]!.environment, 'test')
  assert.deepEqual(seen[1]!.history, [
    { role: 'user', content: 'when do you open' },
    { role: 'assistant', content: 'We open at nine.' },
  ])
})

test('a journey that reaches its end resolves the test chat by the bot', async () => {
  const chapter = speakChapter('Welcome', 'Thanks for chatting.')
  chapter.graph.nodes.push({ id: 'Welcome-end', data: { kind: 'end_flow', label: 'End', config: {} } })
  chapter.graph.edges.push({ id: 'Welcome-e2', source: 'Welcome-say', target: 'Welcome-end' })
  const done = await pipelineTurn('', undefined, { chapters: [chapter] })
  assert.equal(done.text, 'Thanks for chatting.')
  assert.equal(done.ended, true)
  assert.equal(done.state.status, 'resolved')
  assert.equal(done.state.outcome, 'contained_resolved')
})

test('a test turn never changes the state it was given', async () => {
  const open = await pipelineTurn('', undefined)
  const frozen = JSON.stringify(open.state)
  await pipelineTurn('where are you', open.state)
  assert.equal(JSON.stringify(open.state), frozen)
})

function canvasTurn(chapter: string, graph: FlowGraph, message: string, state?: TestChatState, options: {
  saved?: Array<{ name: string; graph: FlowGraph }>
  catalog?: Parameters<typeof runTestTurn>[0]['catalog']
  classify?: (text: string, params: { categories: string[] }) => Promise<{ category: string; confidence: number }>
} = {}) {
  return runTestTurn({
    tenantId: 'tenant',
    botId: 'bot',
    chapters: withWorkingCopy(options.saved ?? [], chapter, graph),
    startChapter: chapter,
    environmentLabel: 'Sandbox',
    message,
    catalog: options.catalog ?? { facts: [] },
    state,
  }, {
    handoverRules: noTeam,
    answer: async () => {},
    llm: async () => quietModel(options.classify) as never,
    catalog: async () => undefined,
    db: {},
    safety: noSafety,
  })
}

test('Test Bot on the welcome follows a handoff into the saved chapter', async () => {
  const { chapters, catalog } = salonWalk()
  const welcome = chapters.find((chapter) => chapter.name === 'Salon welcome')!
  const hello = await canvasTurn(welcome.name, welcome.graph, 'where are you', undefined, { catalog })
  assert.match(hello.text, /What's your name\?/)
  const alone = await canvasTurn(welcome.name, welcome.graph, 'Ada', hello.state, { catalog })
  assert.match(alone.text, /Location is not on this Sandbox map\./)
  assert.equal(alone.text.includes('Rosewood'), false)
  const walked = await canvasTurn(welcome.name, welcome.graph, 'where are you', undefined, { saved: chapters, catalog })
  assert.equal(walked.chapter, 'Location')
  assert.match(walked.text, /Rosewood/)
})

test('Test Bot walks the edited chart, not its saved copy', async () => {
  const { chapters, catalog } = salonWalk()
  const location = chapters.find((chapter) => chapter.name === 'Location')!
  const edited = structuredClone(location.graph)
  for (const node of edited.nodes) {
    if (node.data.kind === 'send_message' || node.data.kind === 'lookup_fact') node.data.config = { ...node.data.config, text: 'We moved to 9 Elm Street.' }
  }
  edited.nodes = edited.nodes.filter((node) => node.data.kind !== 'lookup_fact')
  const turn = await canvasTurn('Location', edited, '', undefined, { saved: chapters, catalog })
  assert.equal(turn.text.includes('Rosewood'), false)
})

test('a second question is left for the next turn', () => {
  const stacked = "Great! I'd be happy to help you book a haircut. To get you scheduled, I'll need a few details: What day works best for you? Do you have a preferred time? Do you have a specific stylist?"
  const kept = keepFirstQuestion(stacked)
  assert.equal((kept.match(/\?/g) ?? []).length, 1)
  assert.match(kept, /What day works best for you\?/)
  assert.equal(kept.includes('stylist'), false)
  assert.equal(keepFirstQuestion("Hi, I'm Bella at Bella Hair Studio."), "Hi, I'm Bella at Bella Hair Studio.")
  assert.equal(keepFirstQuestion('Have you been to us before?'), 'Have you been to us before?')
})

test('the booking chart on Test Bot asks once, including a mistyped cut', async () => {
  const pack = hairStudioPack('Bella Hair Studio')
  const graph = pack.flows.find((flow) => flow.name === 'Book an appointment')!.graph as unknown as FlowGraph
  const hello = await canvasTurn('Book an appointment', graph, '', undefined, { catalog: pack.catalog })
  assert.match(hello.text, /What would you like done\?/)
  assert.equal((hello.text.match(/\?/g) ?? []).length, 1)
  assert.equal(hello.text.includes('stylist'), false)

  for (const typed of ['wnat a cut', 'wnat a ctu']) {
    const cut = await canvasTurn('Book an appointment', graph, typed, hello.state, { catalog: pack.catalog })
    assert.equal((cut.text.match(/\?/g) ?? []).length, 1)
    assert.equal(cut.state.session?.variables && (cut.state.session.variables as { flow: Record<string, unknown> }).flow['route'], 'cut')
    assert.equal(cut.text.toLowerCase().includes('wnat'), false)
    assert.equal(cut.text.includes('preferred time'), false)
  }
})

test('a phrase miss on Test Bot can classify among this chart\'s jobs', async () => {
  const graph = {
    nodes: [
      { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
      { id: 'route', data: { kind: 'route_topic', label: 'Route', config: { routes: [{ handle: 'plans', phrases: ['plans'] }, { handle: 'hours', phrases: ['hours'] }] } } },
      { id: 'plans', data: { kind: 'send_message', label: 'Plans', config: { text: 'SIM only from £26.' } } },
      { id: 'hours', data: { kind: 'send_message', label: 'Hours', config: { text: 'Open 8 to 8.' } } },
      { id: 'other', data: { kind: 'send_message', label: 'Other', config: { text: 'What can I help with?' } } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'route' },
      { id: 'e2', source: 'route', target: 'plans', sourceHandle: 'plans' },
      { id: 'e3', source: 'route', target: 'hours', sourceHandle: 'hours' },
      { id: 'e4', source: 'route', target: 'other', sourceHandle: 'other' },
    ],
  } as FlowGraph
  const stub = await canvasTurn('Plans and hours', graph, 'how much for unlimited data roaming')
  assert.match(stub.text, /What can I help/)
  const classified = await canvasTurn('Plans and hours', graph, 'how much for unlimited data roaming', undefined, {
    classify: async () => ({ category: 'plans', confidence: 0.9 }),
  })
  assert.match(classified.text, /SIM only/)
})

test('Test Bot on the location chart looks up the address', async () => {
  const pack = hairStudioPack('Yuzu')
  const graph = pack.flows.find((flow) => flow.name === 'Location')!.graph as unknown as FlowGraph
  const turn = await canvasTurn('Location', graph, 'where are you', undefined, { catalog: pack.catalog })
  assert.match(turn.text, /Rosewood/)
  assert.match(turn.text, /hours|price|book/i)
  assert.equal(turn.state.session?.status, 'waiting_input')
})
