import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatPlain, draftWebsiteChat, hairStudioPack, learnedSpecFromJobs, packFromLearned, pageFromHtml } from '@ybot/shared'
import { runJourneyPreview } from './journey-preview.js'
import type { FlowGraph } from './engine.js'

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
  const open = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  assert.match(open.text, /What's your name\?/)
  assert.equal(open.chapter, 'Salon welcome')
  assert.equal(open.session?.status, 'waiting_input')
})

test('a request on the welcome continues in that chapter and keeps the name', async () => {
  const { chapters, catalog } = salonWalk()
  const hello = await runJourneyPreview({
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
  const open = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const cut = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'cut',
    environmentLabel: 'Sandbox',
    session: open.session,
  })
  assert.match(cut.text, /£35/)
  assert.equal(cut.chapter, 'Services and prices')
  assert.equal(cut.text.includes("What would you like done"), false)

  const hours = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'salon hours',
    environmentLabel: 'Sandbox',
    session: cut.session,
  })
  assert.match(hours.text, /Monday to Saturday/)
  assert.match(hours.text, /Shall I book/)
  assert.equal(/where we are/.test(hours.text), false)
  assert.equal((hours.text.match(/\?/g) ?? []).length, 1)
  assert.equal(hours.chapter, 'Salon hours')

  const services = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'services',
    environmentLabel: 'Sandbox',
    session: hours.session,
  })
  assert.match(services.text, /thinking of|£/)
  assert.equal(services.chapter, 'Services and prices')
  assert.equal(services.text.includes('I can also help with hours, prices, or a booking.'), false)
})

test('a finished chapter offers the map instead of greeting again', async () => {
  const { chapters, catalog } = salonWalk()
  const priced = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'how much is a haircut',
    environmentLabel: 'Sandbox',
  })
  const booked = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'no',
    environmentLabel: 'Sandbox',
    session: priced.session,
  })
  const again = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'catalog',
    environmentLabel: 'Sandbox',
    session: booked.session,
  })
  assert.match(again.text, /What would you like/)
  assert.equal(again.text.includes("What's your name"), false)
  assert.equal(again.text.includes("Hi, I'm Bella"), false)
})

test('a handoff to a chapter that is not on this map stops', async () => {
  const walk = salonWalk()
  const chapters = walk.chapters.filter((chapter) => chapter.name !== 'Location')
  const hello = await runJourneyPreview({
    chapters,
    catalog: walk.catalog,
    startChapter: 'Salon welcome',
    message: 'where are you',
    environmentLabel: 'Production',
  })
  const stopped = await runJourneyPreview({
    chapters,
    catalog: walk.catalog,
    startChapter: 'Salon welcome',
    message: 'Ada',
    environmentLabel: 'Production',
    session: hello.session,
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
  const open = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const colour = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'color',
    environmentLabel: 'Sandbox',
    session: open.session,
  })
  assert.equal(colour.chapter, 'Book an appointment')
  assert.match(colour.text, /colour work/i)
  assert.equal(/50%|Every Tuesday/i.test(colour.text), false)
  assert.equal(/phorest\.com/i.test(colour.text), false)
  assert.equal((colour.text.match(/\?/g) ?? []).length, 1)

  const need = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'full head',
    environmentLabel: 'Sandbox',
    session: colour.session,
  })
  assert.match(need.text, /cut with the colour/i)
  const upsell = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'yes',
    environmentLabel: 'Sandbox',
    session: need.session,
  })
  assert.match(upsell.text, /senior stylist/i)
  const stylist = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'senior',
    environmentLabel: 'Sandbox',
    session: upsell.session,
  })
  assert.match(stylist.text, /When would suit/i)
  const when = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'Tuesday afternoon',
    environmentLabel: 'Sandbox',
    session: stylist.session,
  })
  assert.match(when.text, /Tuesday with a senior stylist/)
  assert.match(when.text, /12pm, 2pm, or 3pm/)
  assert.match(when.text, /Which time/)
  assert.equal((when.text.match(/\?/g) ?? []).length, 1)
  const slot = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '2pm',
    environmentLabel: 'Sandbox',
    session: when.session,
  })
  assert.match(slot.text, /What's your name/)
  const named = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'Sophie',
    environmentLabel: 'Sandbox',
    session: slot.session,
  })
  assert.match(named.text, /mobile/i)
  const mobile = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '07700 900123',
    environmentLabel: 'Sandbox',
    session: named.session,
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
  const turn = (message: string, session?: Parameters<typeof runJourneyPreview>[0]['session']) => runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message,
    environmentLabel: 'Sandbox',
    session,
    now: saturday,
  })
  const open = await turn('')
  const colour = await turn('color', open.session)
  const need = await turn('full head', colour.session)
  const upsell = await turn('yes', need.session)
  const stylist = await turn('senior', upsell.session)
  assert.match(stylist.text, /When would suit/i)
  const when = await turn('tomoeeow', stylist.session)
  assert.match(when.text, /closed Sunday/)
  assert.match(when.text, /Tuesday with a senior stylist I have 11am, 2pm, or 5pm/)
  assert.equal(/tomoeeow/i.test(when.text), false)
  assert.equal((when.text.match(/\?/g) ?? []).length, 1)
  const slot = await turn('11am', when.session)
  assert.match(slot.text, /What's your name/)
  const named = await turn('CT', slot.session)
  assert.match(named.text, /mobile/i)
  const mobile = await turn('788888877', named.session)
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
  const open = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const where = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'where are you',
    environmentLabel: 'Sandbox',
    session: open.session,
  })
  assert.match(where.text, /Want the hours/)
  assert.equal(where.chapter, 'Location')
  const hours = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'ok',
    environmentLabel: 'Sandbox',
    session: where.session,
  })
  assert.match(hours.text, /Monday to Saturday|09:00/)
  assert.match(hours.text, /Shall I book/)
  assert.equal(hours.chapter, 'Salon hours')
  assert.equal(/been to us before/i.test(hours.text), false)

  const book = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'ok',
    environmentLabel: 'Sandbox',
    session: hours.session,
  })
  assert.equal(book.chapter, 'Book an appointment')
  assert.match(book.text, /been to us before|colour work|What would you like done/)
})

test('an older Location chart that hears ok as Book still opens hours in the test chat', async () => {
  const walk = salonWalk()
  const chapters = walk.chapters.map((chapter) => (
    chapter.name === 'Location' ? { ...chapter, graph: withOldHoursDoors(chapter.graph) } : chapter
  ))
  const where = await runJourneyPreview({
    chapters,
    catalog: walk.catalog,
    startChapter: 'Salon welcome',
    message: 'where are you',
    environmentLabel: 'Sandbox',
  })
  assert.equal(where.chapter, 'Location')
  const hours = await runJourneyPreview({
    chapters,
    catalog: walk.catalog,
    startChapter: 'Salon welcome',
    message: 'ok',
    environmentLabel: 'Sandbox',
    session: where.session,
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
  const open = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })

  const colour = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'color',
    environmentLabel: 'Sandbox',
    session: open.session,
  })
  assert.equal(colour.chapter, 'Book an appointment')
  assert.match(colour.text, /colour work/i)
  assert.equal(/50%|Every Tuesday/i.test(colour.text), false)

  const named = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'red full head',
    environmentLabel: 'Sandbox',
    session: colour.session,
  })
  assert.equal(named.chapter, 'Book an appointment')
  assert.match(named.text, /cut with the colour/i)
  assert.equal(/50%|Every Tuesday/i.test(named.text), false)

  const skipQualify = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'full head colour',
    environmentLabel: 'Sandbox',
    session: open.session,
  })
  assert.equal(skipQualify.chapter, 'Book an appointment')
  assert.match(skipQualify.text, /cut with the colour/i)
  assert.equal(/colour work/i.test(skipQualify.text), false)
  assert.equal(/50%/i.test(skipQualify.text), false)

  const priced = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'prices',
    environmentLabel: 'Sandbox',
    session: open.session,
  })
  assert.equal(priced.chapter, 'Services and prices')
  const fullHead = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'red full head',
    environmentLabel: 'Sandbox',
    session: priced.session,
  })
  assert.equal(fullHead.chapter, 'Services and prices')
  assert.match(fullHead.text, /£101|£87/)
  assert.equal(/50%|Every Tuesday/i.test(fullHead.text), false)

  const deals = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'what offers do you have',
    environmentLabel: 'Sandbox',
    session: open.session,
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
  const open = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const cut = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'cut',
    environmentLabel: 'Sandbox',
    session: open.session,
  })
  assert.match(cut.text, /which cut/i)
  assert.match(cut.text, /Ladies/)
  assert.match(cut.text, /or another/)
  assert.equal(/Ladies wash/.test(cut.text), false)
  assert.equal(cut.chapter, 'Services and prices')

  const men = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'men',
    environmentLabel: 'Sandbox',
    session: cut.session,
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
  const open = await runJourneyPreview({
    chapters,
    startChapter: 'Welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const missed = await runJourneyPreview({
    chapters,
    startChapter: 'Welcome',
    message: 'how much for unlimited data roaming',
    environmentLabel: 'Sandbox',
    session: open.session,
  })
  assert.equal(/SIM only/.test(missed.text), false)
  const classified = await runJourneyPreview({
    chapters,
    startChapter: 'Welcome',
    message: 'how much for unlimited data roaming',
    environmentLabel: 'Sandbox',
    session: open.session,
    llm: { classify: async () => ({ category: 'Plans', confidence: 0.9 }) },
  })
  assert.equal(classified.chapter, 'Plans')
  assert.match(classified.text, /SIM only/)
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
  const turn = (message: string, session?: Parameters<typeof runJourneyPreview>[0]['session']) =>
    runJourneyPreview({ chapters, startChapter: pack.welcomeName, message, environmentLabel: 'Sandbox', session })

  const phone = await turn('I want to buy a phone')
  assert.equal(phone.chapter, 'Buy a phone')
  assert.match(phone.text, /pay monthly contract phones/)
  assert.match(phone.text, /Anything else I can help with\?/)
  assert.equal((phone.text.match(/\?/g) ?? []).length, 1)
  assert.equal(phone.session?.status, 'waiting_input')

  const broadband = await turn('broadband please', phone.session)
  assert.equal(broadband.chapter, 'Get broadband')
  assert.match(broadband.text, /Pro Broadband from £39/)

  const done = await turn('no thanks', broadband.session)
  assert.match(done.text, /Thanks for chatting/)
  assert.equal(done.session?.status, 'completed')
})
