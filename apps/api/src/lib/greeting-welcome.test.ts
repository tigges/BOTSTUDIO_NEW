import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine, type FlowGraph } from '@ybot/runtime'
import type { ExecutionServices, Session } from '@ybot/runtime'
import { assistantGreeting, greetingWelcomeGraph, inspectFlowGraph, starterFlows } from '@ybot/shared'

function session(text: string, name = 'there'): Session {
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

test('a hi after the greeting asks the first question, never the name', async () => {
  const graph = greetingWelcomeGraph({
    greeting: assistantGreeting('BotStudio'),
    followUp: 'What would you like to know?',
    routes: [
      { handle: 'plan', phrases: ['pricing', 'price'], answer: 'The free plan needs no credit card.' },
    ],
    menu: 'Ask me about the free plan.',
    choices: ['Free plan'],
  }) as unknown as FlowGraph
  const issues = inspectFlowGraph(graph, { flowNames: [] }).filter((issue) => issue.level === 'block' || issue.level === 'repair')
  assert.deepEqual(issues, [])
  assert.equal(/What's your name/.test(JSON.stringify(graph)), false)
  const machine = new SessionMachine({ llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices)

  const hello = await machine.run(session('hi'), graph, 'hi')
  assert.equal(hello.session.status, 'waiting_input')
  assert.equal(hello.newMessages.map((message) => message.content.text).join('\n'), "Hi, I'm the assistant at BotStudio.")
  const follow = await reply(machine, hello, graph, 'hi')
  assert.equal(follow.newMessages.map((message) => message.content.text).join('\n'), 'What would you like to know?')
  const plan = await reply(machine, follow, graph, 'pricing')
  assert.match(plan.newMessages.map((message) => message.content.text).join('\n'), /free plan/)

  const price = await machine.run(session('What is the pricing?'), graph, 'What is the pricing?')
  assert.match(price.newMessages.map((message) => message.content.text).join('\n'), /Hi, I'm the assistant at BotStudio/)
  assert.match(price.newMessages.map((message) => message.content.text).join('\n'), /free plan/)
  assert.equal(price.session.status, 'completed')

  const shop = starterFlows('Acme Corp').find((flow) => flow.name === 'Welcome & Routing')!
  const shopGraph = shop.graph as unknown as FlowGraph
  const shopHello = await machine.run(session('hello'), shopGraph, 'hello')
  assert.equal(shopHello.newMessages.map((message) => message.content.text).join('\n'), "Hi, I'm the assistant at Acme Corp.")
  const shopNext = await reply(machine, shopHello, shopGraph, 'hi')
  assert.equal(shopNext.newMessages.map((message) => message.content.text).join('\n'), 'What do you need help with?')
})
