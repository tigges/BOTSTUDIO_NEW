import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine, type FlowGraph } from '@botstudio/runtime'
import type { ExecutionServices, Session } from '@botstudio/runtime'
import {
  CORPORATE_WELCOME_DRAFT,
  CORPORATE_WELCOME_NAME,
  corporateServicesPack,
  flowCatalog,
  inspectFlowGraph,
  planCorporateImport,
  selectPackRemoval,
  starterPackScope,
} from '@botstudio/shared'

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

async function reply(machine: SessionMachine, previous: { session: Session }, graph: FlowGraph, text: string, name?: string) {
  previous.session.variables.flow['_last_user_message'] = text
  if (name) previous.session.variables.contact = { name }
  return machine.run(previous.session, graph, text)
}

test('the pack answers ordinary questions from the flow itself', async () => {
  const pack = corporateServicesPack('Acme Corp')
  const names = pack.flows.map((flow) => flow.name)
  assert.equal(new Set(names).size, names.length)
  assert.equal(pack.intents.length, pack.faqs.length)
  for (const intent of pack.intents) {
    const flow = pack.flows.find((item) => item.name === intent.name)
    assert.ok(flow, intent.name)
    assert.match(JSON.stringify(flow.graph), new RegExp(intent.responses[0]!.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    const faq = pack.faqs.find((item) => item.question === intent.description)
    assert.equal(faq?.answer, intent.responses[0]!.text)
  }
  for (const flow of pack.flows) {
    const issues = inspectFlowGraph(flow.graph as Parameters<typeof inspectFlowGraph>[0], { flowNames: names })
    const blocking = issues.filter((issue) => issue.level === 'block' || issue.level === 'repair')
    assert.deepEqual(blocking, [], flow.name)
  }

  const welcome = pack.flows.find((flow) => flow.name === CORPORATE_WELCOME_NAME)!
  const machine = new SessionMachine({ llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices)
  const graph = welcome.graph as unknown as FlowGraph

  const hours = await machine.run(session('What are your opening hours?'), graph, 'What are your opening hours?')
  assert.equal(hours.jumpToFlow, 'Opening hours')
  assert.match(hours.newMessages.map((message) => message.content.text).join('\n'), /Hi, I'm the assistant from Acme Corp/)

  const tracking = await machine.run(session('where is my order'), graph, 'where is my order')
  assert.equal(tracking.jumpToFlow, 'Order tracking')

  const cancel = await machine.run(session('Please cancel my order'), graph, 'Please cancel my order')
  assert.equal(cancel.jumpToFlow, 'Cancel order')

  const policy = await machine.run(session('What is your return policy?'), graph, 'What is your return policy?')
  assert.equal(policy.jumpToFlow, 'Returns policy')

  const startReturn = await machine.run(session('I want to return this kettle'), graph, 'I want to return this kettle')
  assert.equal(startReturn.jumpToFlow, 'Return Request')

  const hello = await machine.run(session('hello'), graph, 'hello')
  assert.equal(hello.jumpToFlow, undefined)
  assert.equal(hello.session.status, 'waiting_input')
  assert.equal(hello.newMessages.map((message) => message.content.text).join('\n'), "Hi, I'm the assistant from Acme Corp.")
  const again = await reply(machine, hello, graph, 'hi')
  assert.equal(again.newMessages.map((message) => message.content.text).join('\n'), 'What do you need help with?')
  assert.equal(/What's your name/.test(JSON.stringify(graph)), false)

  const chosen = await reply(machine, again, graph, 'Opening hours')
  assert.equal(chosen.jumpToFlow, 'Opening hours')

  const address = await machine.run(session('Please change the delivery address'), graph, 'Please change the delivery address')
  assert.equal(address.jumpToFlow, 'Change address')

  const hoursFlow = pack.flows.find((flow) => flow.name === 'Opening hours')!
  const spoken = await machine.run(session('hours'), hoursFlow.graph as unknown as FlowGraph, 'hours')
  assert.match(spoken.newMessages.map((message) => message.content.text).join('\n'), /09:00 to 18:00/)
  assert.equal(spoken.session.status, 'completed')
})

test('a new company gets a published welcome and no second draft', () => {
  const plan = planCorporateImport({
    companyName: 'Northwind',
    existingFlowNames: [],
    existingIntentNames: [],
    existingQuestions: [],
    publishedWelcome: false,
  })
  const welcome = plan.flows.find((flow) => flow.name === CORPORATE_WELCOME_NAME)
  assert.equal(welcome?.publish, true)
  assert.equal(plan.flows.some((flow) => flow.name === CORPORATE_WELCOME_DRAFT), false)
  assert.equal(plan.flows.find((flow) => flow.name === 'Opening hours')?.publish, true)
  assert.match(JSON.stringify(welcome?.graph), /Hi, I'm the assistant from Northwind/)
  assert.equal(plan.intents.length > 0, true)
})

test('an existing welcome is left in place and the benchmark greeting is a draft', () => {
  const plan = planCorporateImport({
    companyName: 'Acme Corp',
    existingFlowNames: ['Welcome & Routing', 'Cancel order', 'Order Status'],
    existingIntentNames: ['greeting'],
    existingQuestions: ['What is your return policy?'],
    publishedWelcome: true,
  })
  assert.equal(plan.flows.some((flow) => flow.name === CORPORATE_WELCOME_NAME), false)
  assert.equal(plan.flows.some((flow) => flow.name === 'Cancel order'), false)
  const draft = plan.flows.find((flow) => flow.name === CORPORATE_WELCOME_DRAFT)
  assert.equal(draft?.publish, false)
  assert.equal(plan.flows.find((flow) => flow.name === 'Opening hours')?.publish, true)
  assert.equal(plan.faqs.some((faq) => faq.question === 'What is your return policy?'), false)
  assert.equal(plan.intents.some((intent) => intent.name === 'greeting'), false)

  const again = planCorporateImport({
    companyName: 'Acme Corp',
    existingFlowNames: ['Welcome & Routing', 'Cancel order', 'Order Status', ...plan.flows.map((flow) => flow.name)],
    existingIntentNames: ['greeting', ...plan.intents.map((intent) => intent.name)],
    existingQuestions: ['What is your return policy?', ...plan.faqs.map((faq) => faq.question)],
    publishedWelcome: true,
  })
  assert.deepEqual(again.flows, [])
  assert.deepEqual(again.intents, [])
  assert.deepEqual(again.faqs, [])
})

test('removing the corporate pack leaves the salon flows that were already there', () => {
  const scope = starterPackScope('corporate-services')
  const selected = selectPackRemoval(scope, {
    flows: [
      { id: 'welcome', name: 'Welcome & Routing', tags: ['welcome', 'routing'] },
      { id: 'draft', name: 'Corporate welcome', tags: ['welcome', 'routing', 'corporate'] },
      { id: 'hours', name: 'Opening hours', tags: ['corporate', 'template', 'faq'] },
      { id: 'cancel', name: 'Cancel order', tags: ['orders', 'template'] },
    ],
    intents: [
      { id: 'keep', name: 'new_intent_1790205994182' },
      { id: 'hours', name: 'Opening hours' },
      { id: 'cancel', name: 'Cancel order' },
    ],
    faqs: [
      { id: 'hours', tags: ['corporate', 'opening-hours'] },
      { id: 'own', tags: ['salon'] },
    ],
  })
  assert.deepEqual(selected.flows.map((flow) => flow.name).sort(), ['Corporate welcome', 'Opening hours'])
  assert.deepEqual(selected.intents.map((intent) => intent.name).sort(), ['Cancel order', 'Opening hours'])
  assert.deepEqual(selected.faqs.map((faq) => faq.id), ['hours'])
})

test('the new-flow list keeps one welcome and the older templates', () => {
  const names = flowCatalog('Acme Corp').map((flow) => flow.name)
  assert.equal(names.filter((name) => name === CORPORATE_WELCOME_NAME).length, 1)
  assert.ok(names.includes('Opening hours'))
  assert.ok(names.includes('Order Status'))
  assert.equal(new Set(names).size, names.length)
})
