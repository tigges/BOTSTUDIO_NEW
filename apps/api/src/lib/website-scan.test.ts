import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine, type FlowGraph } from '@ybot/runtime'
import type { ExecutionServices, Session } from '@ybot/runtime'
import {
  chooseSitePages,
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

function topicSession(topic: string): Session {
  const next = session('Ada')
  next.variables.flow['topic'] = topic
  return next
}

function messageTexts(flow: { graph?: { nodes?: Array<{ data?: { kind?: string; config?: { text?: string } } }> } } | undefined): string[] {
  return (flow?.graph?.nodes ?? []).flatMap((node) => (
    node.data?.kind === 'send_message' ? [String(node.data.config?.text ?? '')] : []
  ))
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
  assert.equal(/£\s*\d/.test(draft.doors[2]!.answer), false)
  assert.match(draft.doors[2]!.answer, /cut/)
  assert.match(draft.doors[2]!.answer, /colour/i)
  const serviceFlow = draft.flows.find((flow) => flow.name === 'Services and prices')
  const serviceMessages = messageTexts(serviceFlow)
  assert.ok(serviceMessages.length > 1)
  assert.ok(serviceMessages.some((text) => /£58/.test(text) && !/£75/.test(text)))
  assert.ok(serviceMessages.some((text) => /£75/.test(text) && !/£58/.test(text)))
  assert.ok(serviceMessages.some((text) => /£64/.test(text)))
  assert.ok(serviceMessages.some((text) => /£33/.test(text)))
  assert.ok(serviceMessages.some((text) => /£29/.test(text) && !/£58/.test(text)))
  assert.equal(serviceMessages.some((text) => /£58/.test(text) && /£75/.test(text)), false)
  assert.ok(serviceMessages.some((text) => /48 hours/.test(text)) || draft.facts.some((fact) => /48 hours/.test(fact.text)))
  assert.match(draft.doors[3]!.answer, /\[Phorest\]\(https:\/\/www\.phorest\.com\/salon\/yuzuhairandbeauty\)/)
  assert.equal(/Book on Phorest: https:/.test(draft.doors[3]!.answer), false)
  assert.equal(draft.booking?.label, 'Phorest')
  assert.match(draft.note, /cancellation rule/)
  assert.equal(draft.facts.some((fact) => fact.label === 'Offers'), true)
  assert.equal(draft.documents[0]?.content.includes('Dickens Yard'), true)
  assert.ok(draft.catalog.facts.some((fact) => fact.id === 'location' && /Dickens Yard/.test(fact.fact)))
  assert.ok(draft.catalog.facts.some((fact) => fact.id === 'hours' && /Tuesday to Friday/.test(fact.fact)))
  assert.ok(draft.catalog.facts.some((fact) => /£58/.test(fact.fact) && !/£75/.test(fact.fact)))

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

  const servicesGraph = serviceFlow!.graph as unknown as FlowGraph
  const asked = await machine.run(topicSession('how much is a haircut'), servicesGraph, 'Ada')
  const askedText = asked.newMessages.map((message) => message.content.text).join('\n')
  assert.match(askedText, /£58/)
  assert.equal(/£75/.test(askedText), false)
  assert.match(askedText, /book/i)
  const menu = await machine.run(topicSession('prices'), servicesGraph, 'Ada')
  const menuText = menu.newMessages.map((message) => message.content.text).join('\n')
  assert.match(menuText, /thinking of/i)
  assert.equal(/£\s*\d/.test(menuText), false)

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
  assert.deepEqual(layout.roots[0]?.children.find((chapter) => chapter.name === 'Book an appointment')?.workflows, ['Phorest'])
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
  assert.equal(draft.catalog.facts.length, 0)
})

const PRICE_LIST = `<title>Price list</title>
<h2>Cut &amp; style</h2>
<table>
<tr><th>Service</th><th>Senior</th><th>Stylist</th></tr>
<tr><th>Ladies wash, cut &amp; style</th><td data-label="Senior">£87</td><td data-label="Stylist">£58</td></tr>
<tr><th>Gents wash, cut &amp; style</th><td data-label="Senior">£45</td><td data-label="Stylist">£38</td></tr>
<tr><th>Kids (12 &amp; under)</th><td data-label="Senior">£29</td><td data-label="Stylist">£23</td></tr>
<tr><th>Long hair</th><td data-label="Senior">+£41</td><td data-label="Stylist">+£41</td></tr>
<tr><th>Teens (13-16) boys</th><td data-label="Senior">£35</td><td data-label="Stylist">£29</td></tr>
<tr><th>Blow-dry</th><td data-label="Senior">£28</td><td data-label="Stylist">£22</td></tr>
</table>
<h2>Colour</h2>
<table>
<tr><th>Service</th><th>Senior</th><th>Stylist</th></tr>
<tr><th>Full head</th><td data-label="Senior">£101</td><td data-label="Stylist">£87</td></tr>
<tr><th>Roots</th><td data-label="Senior">£88</td><td data-label="Stylist">£75</td></tr>
</table>
<p>Please complete a patch test at least 48 hours before your appointment.</p>`

const QUESTIONS = `<title>Questions</title>
<summary>How much is a haircut at Yuzu in Ealing?</summary>
<p>A ladies wash, cut and style is £58 with a stylist.</p>
<summary>Where is the salon?</summary>
<p>5 Dickens Yard, Longfield Avenue, Ealing, W5 2TD.</p>`

const TEAM = `<title>Join our team</title>
<p>We are looking for senior stylists, stylists, and models at Dickens Yard.</p>
<p>Email your CV to info@yuzuhairandbeauty.co.uk.</p>`

const OFFERS = `<title>Offers</title>
<p>Every Tuesday, 50% off your most expensive colour service.</p>
<p>Every Tuesday, enjoy a kaleidoscope of shades at a discounted rate of 50%.</p>
<p>Every Wednesday, 25% off blow-dries.</p>`

test('linked pages become separate conversations instead of one price paragraph', async () => {
  const home = pageFromHtml('https://yuzu.hair/', `<title>Yuzu</title>
<p>Yuzu Hair and Beauty works at 5 Dickens Yard, Longfield Avenue, Ealing, W5 2TD.</p>
<p>Open Tuesday to Friday 10am to 8pm and Saturday 9am to 6pm. Monday and Sunday closed.</p>
<a href="https://www.phorest.com/salon/yuzuhairandbeauty">Book</a>`)
  const draft = draftWebsiteChat({
    pages: [home, pageFromHtml('https://yuzu.hair/prices/', PRICE_LIST), pageFromHtml('https://yuzu.hair/questions/', QUESTIONS), pageFromHtml('https://yuzu.hair/team/', TEAM), pageFromHtml('https://yuzu.hair/offers/', OFFERS)],
    companyName: 'Yuzu',
    personaName: 'Bella',
  })
  assert.deepEqual(draft.doors.map((door) => door.title), ['Where we are', 'Hours', 'Services', 'Questions', 'Offers', 'Join the team', 'Book'])
  const services = draft.flows.find((flow) => flow.name === 'Services and prices')
  const messages = messageTexts(services)
  assert.match(messages.find((text) => /Ladies/.test(text)) ?? '', /£87 with a senior/)
  assert.match(messages.find((text) => /Ladies/.test(text)) ?? '', /£58 with a stylist/)
  assert.equal(/£75/.test(messages.find((text) => /Ladies/.test(text)) ?? ''), false)
  assert.match(messages.find((text) => /Kids/.test(text)) ?? '', /£29/)
  assert.match(messages.find((text) => /Long hair/.test(text)) ?? '', /plus £41/)
  assert.match(messages.find((text) => /Roots/.test(text)) ?? '', /£75/)
  assert.equal(/£58/.test(messages.find((text) => /Roots/.test(text)) ?? ''), false)
  assert.equal(messages.some((text) => /£58/.test(text) && /£75/.test(text)), false)
  const colourQuestion = (services?.graph as { nodes?: Array<{ data?: { kind?: string; config?: { question?: string } } }> }).nodes
    ?.find((node) => node.data?.kind === 'ask_question' && /which colour/i.test(node.data.config?.question ?? ''))
  assert.match(colourQuestion?.data?.config?.question ?? '', /patch test/i)

  const haircut = draft.faqs.find((faq) => /haircut at Yuzu/i.test(faq.question))
  assert.match(haircut?.answer ?? '', /£58/)
  assert.equal((haircut?.answer ?? '').includes('Where is the salon'), false)
  assert.match(draft.doors.find((door) => door.flowName === 'Join the team')?.answer ?? '', /info@yuzuhairandbeauty\.co\.uk|Which role/)
  assert.equal(draft.facts.some((fact) => /info@yuzuhairandbeauty\.co\.uk/.test(fact.text)), true)
  assert.match(draft.facts.find((fact) => fact.label === 'Pages')?.text ?? '', /prices/)
  assert.match(draft.facts.find((fact) => fact.label === 'Pages')?.text ?? '', /questions/)
  assert.match(draft.facts.find((fact) => fact.label === 'Pages')?.text ?? '', /team/)
  const offerMessages = messageTexts(draft.flows.find((flow) => flow.name === 'Offers'))
  assert.equal(offerMessages.filter((text) => /Tuesday/.test(text)).length, 1)
  assert.match(offerMessages.find((text) => /Tuesday/.test(text)) ?? '', /50% off/)
  assert.equal(
    draft.catalog.facts.filter((fact) => fact.source === 'Offers').every((fact) => !fact.phrases.some((phrase) => /colou?r|cut/.test(phrase))),
    true,
  )

  const names = draft.flows.map((flow) => flow.name)
  for (const flow of draft.flows) {
    const issues = inspectFlowGraph(flow.graph as Parameters<typeof inspectFlowGraph>[0], { flowNames: names })
    assert.deepEqual(issues.filter((issue) => issue.level === 'block' || issue.level === 'repair'), [], `${flow.name}: ${JSON.stringify(issues)}`)
  }
  const layout = journeyLayout(draft.flows.map((flow, index) => ({
    id: `flow-${index}`,
    name: flow.name,
    tags: flow.tags,
    published: false,
    graph: flow.graph,
  })))
  assert.deepEqual(layout.roots[0]?.children.map((chapter) => chapter.name), [
    'Location', 'Salon hours', 'Services and prices', 'Questions', 'Offers', 'Join the team', 'Book an appointment',
  ])

  const machine = new SessionMachine({ llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices)
  const graph = services!.graph as unknown as FlowGraph
  const kids = await machine.run(topicSession('kids'), graph, 'Ada')
  const kidsText = kids.newMessages.map((message) => message.content.text).join('\n')
  assert.match(kidsText, /£29/)
  assert.equal(/£58/.test(kidsText), false)
  const named = await machine.run(topicSession('cut'), graph, 'Ada')
  const namedText = named.newMessages.map((message) => message.content.text).join('\n')
  assert.match(namedText, /which cut/i)
  assert.match(namedText, /Ladies/)
  assert.match(namedText, /Gents/)
  assert.match(namedText, /Kids/)
  assert.match(namedText, /or another/)
  assert.equal(/Ladies wash/.test(namedText), false)
  assert.equal(/Blow-dry/.test(namedText), false)
  assert.equal(/£75/.test(namedText), false)
  named.session.variables.flow['_last_user_message'] = 'men'
  const men = await machine.run(named.session, graph, 'men')
  const menText = men.newMessages.map((message) => message.content.text).join('\n')
  assert.match(menText, /£45|£38/)
  assert.equal(/£87/.test(menText), false)
  assert.equal(/where we are/.test(menText), false)
})

test('chooseSitePages keeps a price list, questions, and the team page once', () => {
  const chosen = chooseSitePages({
    homeUrl: 'https://yuzu.hair/',
    links: [
      { href: 'https://yuzu.hair/wp-content/themes/yuzu-round/static/prices.html', text: 'Full menu' },
      { href: 'https://yuzu.hair/wp-content/themes/yuzu-round/static/patch.html', text: 'Patch' },
      { href: 'https://yuzu.hair/wp-content/themes/yuzu-round/static/offers.html', text: 'Offers' },
      { href: 'https://yuzu.hair/wp-content/themes/yuzu-round/static/team.html', text: 'Find out more' },
      { href: 'https://yuzu.hair/wp-content/themes/yuzu-round/static/questions.html', text: 'Questions' },
      { href: 'https://www.phorest.com/salon/yuzuhairandbeauty', text: 'Book' },
    ],
    sitemap: [
      'https://yuzu.hair/sample-page/',
      'https://yuzu.hair/',
      'https://yuzu.hair/prices/',
      'https://yuzu.hair/offers/',
      'https://yuzu.hair/team/',
      'https://yuzu.hair/questions/',
      'https://yuzu.hair/patch/',
      'https://yuzu.hair/hello-world/',
    ],
    limit: 9,
  })
  assert.equal(chosen.filter((href) => href.includes('prices')).length, 1)
  assert.equal(chosen.some((href) => href.endsWith('/prices/')), true)
  assert.equal(chosen.some((href) => href.includes('/questions')), true)
  assert.equal(chosen.some((href) => href.includes('/team')), true)
  assert.equal(chosen.some((href) => href.includes('sample-page') || href.includes('hello-world') || href.includes('phorest')), false)
})

const HUBSPOT_PRICING = `<!doctype html>
<html><head><title>Pricing</title></head>
<body>
<p>HubSpot CRM pipeline marketing automation</p>
<h1>Sales. Marketing. Service. All together.</h1>
<section>
  <h2>Free</h2>
  <p>No credit card required</p>
  <p>£0/mo</p>
  <p>Get started free</p>
  <p>Get AI-powered help across the CRM</p>
  <p>Get a unified view of your contacts</p>
  <p>Organize and manage your companies</p>
  <p>Create automations from your records</p>
</section>
<section>
  <h2>Starter</h2>
  <p>Limited-time · 65% off</p>
  <p>£7/mo/seat</p>
  <p>Buy now</p>
  <p>Email and in-app chat support</p>
  <p>Keep your CRM up to date with AI</p>
  <p>Plan and create campaigns with Marketing Studio</p>
</section>
<section>
  <h2>Professional</h2>
  <p>For mature teams</p>
  <p>£81/mo/seat</p>
  <p>Buy now</p>
  <p>Talk to Sales</p>
  <p>Organize teams across hubs</p>
  <p>Test changes with a sandbox</p>
  <p>Control which data users can access</p>
</section>
<section>
  <h2>Enterprise</h2>
  <p>For sophisticated teams</p>
  <p>£155/mo/seat</p>
  <p>Buy now</p>
  <p>Connect multiple workspaces</p>
  <p>Set up marketing email</p>
</section>
</body></html>`

test('a CRM pricing page becomes plan doors and an email follow-up, not a salon map', async () => {
  const page = pageFromHtml('https://www.hubspot.com/pricing', HUBSPOT_PRICING)
  const draft = draftWebsiteChat({ pages: [page], companyName: 'test', personaName: '' })
  assert.match(draft.greeting, /Maya at test/)
  assert.equal(/Bella/.test(draft.greeting), false)
  assert.equal(draft.doors.some((door) => door.flowName === 'Location' || door.flowName === 'Salon hours'), false)
  const plans = draft.doors.find((door) => /plan|pricing/i.test(door.flowName) || /plan/i.test(door.title))
  assert.ok(plans)
  assert.match(plans!.blurb, /Free/)
  assert.match(plans!.blurb, /Starter/)
  assert.match(JSON.stringify(draft.flows), /£0 a month/)
  assert.match(JSON.stringify(draft.flows), /£7 a month per seat/)
  assert.match(JSON.stringify(draft.flows), /£81 a month per seat/)
  assert.match(JSON.stringify(draft.flows), /£155 a month per seat/)
  assert.equal(/HubSpot/i.test(JSON.stringify(draft.flows)), false)
  const demo = draft.flows.find((flow) => flow.name === 'Book a demo')
  assert.ok(demo)
  assert.match(JSON.stringify(demo.graph), /good email address/)
  assert.match(JSON.stringify(demo.graph), /One moment please/)
  assert.match(JSON.stringify(demo.graph), /from test sales/)
  assert.ok(draft.doors.length >= 12)
  assert.ok(draft.doors.some((door) => /marketing/i.test(door.title)))
  assert.ok(draft.doors.some((door) => /sales/i.test(door.title)))
  assert.ok(draft.doors.some((door) => /contacts/i.test(door.title)))
  const machine = new SessionMachine({ llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices)
  const demoGraph = demo.graph as unknown as FlowGraph
  const asked = await machine.run(session('talk to sales'), demoGraph, 'talk to sales')
  assert.match(asked.newMessages.map((message) => message.content.text).join('\n'), /good email address/)
  asked.session.variables.flow['_last_user_message'] = 'toto.limbo@gmail.com'
  asked.session.variables.flow['email'] = 'toto.limbo@gmail.com'
  const next = await machine.run(asked.session, demoGraph, 'toto.limbo@gmail.com')
  const nextText = next.newMessages.map((message) => message.content.text).join('\n')
  assert.match(nextText, /One moment please/)
  assert.match(nextText, /Maya from test sales/)
  const names = draft.flows.map((flow) => flow.name)
  for (const flow of draft.flows) {
    const issues = inspectFlowGraph(flow.graph as Parameters<typeof inspectFlowGraph>[0], { flowNames: names })
    assert.deepEqual(issues.filter((issue) => issue.level === 'block' || issue.level === 'repair'), [], flow.name)
  }
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
