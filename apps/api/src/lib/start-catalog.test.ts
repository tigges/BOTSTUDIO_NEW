import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine, type FlowGraph } from '@ybot/runtime'
import type { ExecutionServices, Session } from '@ybot/runtime'
import {
  BAKED_TEMPLATES,
  EMAIL_QUESTION,
  START_CLUSTERS,
  START_OPTIONS,
  abstractBrand,
  bakedPack,
  draftClusteredTemplate,
  identityFor,
  inspectFlowGraph,
  pageFromHtml,
  personaAvatar,
  startPreview,
  suggestCluster,
  templatesInCluster,
} from '@ybot/shared'

function session(text: string, name = 'Ada'): Session {
  return {
    id: 's1',
    conversationId: 'c1',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId: 'start',
    variables: { flow: { _last_user_message: text }, global: {}, contact: { name } },
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

test('the wizard starts with scan, sample, and blank — templates stay parked', () => {
  assert.deepEqual(START_OPTIONS.map((item) => item.id), ['website', 'sample', 'blank'])
  assert.equal(START_OPTIONS.some((item) => item.id === 'template'), false)
  assert.equal(BAKED_TEMPLATES.some((item) => item.id === 'website' || item.id === 'blank'), false)
  assert.equal(templatesInCluster('hair').some((item) => item.id === 'hair-studio'), true)
  assert.equal(templatesInCluster('commerce').some((item) => item.id === 'corporate'), true)
  assert.equal(templatesInCluster('hair').some((item) => item.id === 'corporate'), false)
  assert.equal(BAKED_TEMPLATES.filter((item) => item.id === 'product-support')[0]?.source?.host, 'cevro.ai')
  assert.equal(BAKED_TEMPLATES.filter((item) => item.id === 'crm-platform')[0]?.source?.host, 'hubspot.com')
  assert.equal(BAKED_TEMPLATES.filter((item) => item.id === 'inbox-assistant')[0]?.source?.host, 'gmail.com')
  assert.deepEqual(START_CLUSTERS.map((item) => item.id), ['hair', 'commerce', 'software', 'crm', 'email', 'custom'])
})

test('each template has its own persona, and the company is the bot name', () => {
  assert.equal(identityFor('hair-studio').persona, 'Bella')
  assert.equal(identityFor('crm-platform').persona, 'Maya')
  assert.equal(identityFor('crm').persona, 'Maya')
  assert.notEqual(identityFor('crm-platform').accent, identityFor('hair-studio').accent)
  const crm = startPreview({ start: 'crm-platform', companyName: 'test' })
  assert.match(crm.greeting, /Maya/)
  assert.match(crm.greeting, /test/)
  assert.equal(/Bella Hair Studio|Bella/.test(crm.greeting), false)
  assert.ok(crm.doors.some((door) => door.title === 'Marketing'))
  const hair = startPreview({ start: 'hair-studio', companyName: 'Yuzu' })
  assert.match(hair.greeting, /Bella/)
  assert.match(hair.greeting, /Yuzu/)
  const avatar = personaAvatar('Maya', identityFor('crm-platform').accent)
  assert.match(avatar, /^data:image\/svg\+xml/)
  assert.match(avatar, /M/)
})

test('crawled brand names come off so the map can sit as a template', () => {
  assert.match(abstractBrand('Cevro is an AI support platform built for iGaming operators, including Winpot.'), /the platform/i)
  assert.equal(/Cevro|Winpot/i.test(abstractBrand('Cevro helps Winpot.')), false)
  assert.equal(/HubSpot/i.test(abstractBrand('HubSpot aligns marketing, sales, and service.')), false)
  assert.equal(/Gmail/i.test(abstractBrand('Gmail never uses your mail content for ads.')), false)
  assert.equal(suggestCluster('Cevro AI customer support for iGaming KYC payments'), 'software')
  assert.equal(suggestCluster('HubSpot CRM pipeline marketing automation'), 'crm')
  assert.equal(
    suggestCluster('Email and in-app chat support. Keep your CRM up to date. HubSpot pipeline marketing automation.'),
    'crm',
  )
  assert.equal(suggestCluster('Gmail inbox compose search'), 'email')
  assert.equal(suggestCluster('Ladies wash cut and style at the salon'), 'hair')
  assert.equal(suggestCluster('Welcome to the studio. We love hair.'), 'hair')
  assert.equal(
    suggestCluster(
      'Build, operate, and connect your hybrid agent workforce. Bots answer from your own content. Hair & Spa. Colour. Cut. Start with the website widget. The same chat in Inbox. https://botstudio.uk/',
    ),
    'software',
  )
})

test('the software pack from cevro.ai answers without brand names', async () => {
  const pack = bakedPack('product-support', 'Northwind')
  assert.ok(pack)
  const blob = JSON.stringify(pack.flows)
  assert.equal(/Cevro|Winpot|SweepNext/i.test(blob), false)
  assert.match(blob, /Northwind/)
  const names = pack.flows.map((flow) => flow.name)
  assert.equal(new Set(names).size, names.length)
  for (const flow of pack.flows) {
    const issues = inspectFlowGraph(flow.graph as Parameters<typeof inspectFlowGraph>[0], { flowNames: names })
    const blocking = issues.filter((issue) => issue.level === 'block' || issue.level === 'repair')
    assert.deepEqual(blocking, [], flow.name)
  }
  const welcome = pack.flows.find((flow) => flow.name === pack.welcomeName)!
  const machine = new SessionMachine({ llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices)
  const graph = welcome.graph as unknown as FlowGraph
  const product = await machine.run(session('what does the product do'), graph, 'what does the product do')
  assert.equal(product.jumpToFlow, 'Product')
  const demo = await machine.run(session('book a demo'), graph, 'book a demo')
  assert.equal(demo.jumpToFlow, 'Book a demo')
})

test('the CRM pack speaks as Maya at the bot name, not a salon', async () => {
  const pack = bakedPack('crm-platform', 'test')
  assert.ok(pack)
  const blob = JSON.stringify(pack.flows)
  assert.equal(/Bella Hair Studio|\bBella\b/.test(blob), false)
  assert.match(blob, /Maya at test/)
  const welcome = pack.flows.find((flow) => flow.name === pack.welcomeName)!
  const machine = new SessionMachine({ llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices)
  const graph = welcome.graph as unknown as FlowGraph
  const sales = await machine.run(session('sales pipeline'), graph, 'sales pipeline')
  assert.equal(sales.jumpToFlow, 'Sales')
  const hello = await machine.run(session('hi', 'there'), graph, 'hi')
  assert.match(hello.newMessages.map((message) => message.content.text).join('\n'), /Maya at test/)
  const names = pack.flows.map((flow) => flow.name)
  for (const flow of pack.flows) {
    const issues = inspectFlowGraph(flow.graph as Parameters<typeof inspectFlowGraph>[0], { flowNames: names })
    assert.deepEqual(issues.filter((issue) => issue.level === 'block' || issue.level === 'repair'), [], flow.name)
  }
  const plans = pack.flows.find((flow) => flow.name === 'Plans and pricing')!
  const plansGraph = plans.graph as unknown as FlowGraph
  const which = await machine.run(session('plans'), plansGraph, 'plans')
  const whichText = which.newMessages.map((message) => message.content.text).join('\n')
  assert.match(whichText, /Free/)
  assert.match(whichText, /Starter/)
  assert.equal(/£/.test(whichText), false)
  which.session.variables.flow['_last_user_message'] = 'starter'
  const starter = await machine.run(which.session, plansGraph, 'starter')
  assert.match(starter.newMessages.map((message) => message.content.text).join('\n'), /£7/)
  const demo = pack.flows.find((flow) => flow.name === 'Book a demo')!
  const demoGraph = demo.graph as unknown as FlowGraph
  const email = await machine.run(session('talk to sales'), demoGraph, 'talk to sales')
  assert.match(email.newMessages.map((message) => message.content.text).join('\n'), /good email address/)
  email.session.variables.flow['_last_user_message'] = 'ada@example.com'
  email.session.variables.flow['email'] = 'ada@example.com'
  const handed = await machine.run(email.session, demoGraph, 'ada@example.com')
  const handedText = handed.newMessages.map((message) => message.content.text).join('\n')
  assert.match(handedText, /One moment please/)
  assert.match(handedText, /from test sales/)
  assert.match(handedText, /paid plans/)
})

test('crm and inbox packs keep a visual map of doors', () => {
  const crm = startPreview({ start: 'crm-platform', companyName: 'Northwind' })
  assert.ok(crm.doors.some((door) => door.title === 'Marketing'))
  assert.ok(crm.doors.some((door) => door.title === 'A demo'))
  assert.ok(crm.doors.some((door) => door.title === 'Contacts'))
  assert.ok(crm.doors.some((door) => door.title === 'Tickets'))
  assert.ok(crm.doors.some((door) => door.title === 'Billing'))
  assert.ok(crm.doors.some((door) => /Free/.test(door.blurb) && /Starter/.test(door.blurb)))
  assert.ok(crm.doors.length >= 12)
  assert.match(crm.greeting, /Maya at Northwind/)
  const inbox = startPreview({ start: 'inbox-assistant', companyName: 'Northwind' })
  assert.ok(inbox.doors.some((door) => /inbox/i.test(door.title)))
  assert.ok(inbox.doors.some((door) => /security/i.test(door.title)))
  assert.ok(inbox.doors.some((door) => door.title === 'Labels'))
  assert.ok(inbox.doors.some((door) => door.title === 'Filters'))
  assert.ok(inbox.doors.length >= 12)
  assert.match(inbox.greeting, /Jules at Northwind/)
  const software = startPreview({ start: 'product-support', companyName: 'Northwind' })
  assert.ok(software.doors.some((door) => door.title === 'Accounts'))
  assert.ok(software.doors.some((door) => door.title === 'Pricing'))
  assert.ok(software.doors.length >= 12)
  const hair = startPreview({ start: 'hair-studio', companyName: 'Yuzu', personaName: 'Bella' })
  assert.match(hair.greeting, /Bella/)
  assert.ok(hair.doors.length >= 8)
})

test('a vendor homepage becomes a software template with brand names off', () => {
  const page = pageFromHtml(
    'https://www.cevro.ai/',
    `<html><head><title>Cevro AI</title></head><body>
      <h1>The AI Player Support Platform Built for iGaming</h1>
      <p>Cevro deploys AI agents that handle player queries end-to-end across bonuses, KYC, payments, RG.</p>
      <p>Integrations connect PAMs, helpdesks, CRMs and payment providers.</p>
      <p>Book a demo with our team to see how Cevro can help.</p>
    </body></html>`,
  )
  const spec = draftClusteredTemplate({ pages: [page], companyName: 'Northwind' })
  assert.equal(spec.clusterId, 'software')
  assert.equal(/Cevro/i.test(JSON.stringify(spec.topics)), false)
  assert.ok(spec.topics.some((topic) => /AI agents|player queries|platform|iGaming/i.test(topic.answer)))
  assert.ok(spec.topics.some((topic) => topic.flowName === 'Talk to a person'))
  assert.equal(spec.topics.some((topic) => topic.flowName === 'Accounts'), false)
  assert.equal(spec.topics.some((topic) => /did not state this/i.test(topic.answer)), false)
  assert.equal(spec.topics.find((topic) => topic.flowName === 'Book a demo')?.walk, 'email')
  assert.ok(spec.topics.length < 8)
  assert.equal(/accounts/i.test(spec.menu), false)
})
