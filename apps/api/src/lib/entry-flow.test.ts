import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickEntry, pickWorkingCopy } from './entry-flow.js'
import { recipesToPropose } from './draft-flows.js'
import { DRAFT_RECIPES } from './draft-flows.js'
import { extendWelcomeGraph, withDestination } from './welcome-routes.js'

test('pickEntry keeps the newest welcome flow in front of a later publish', () => {
  const chosen = pickEntry([
    { publishedAt: new Date('2026-09-01'), flow: { name: 'Order Status', tags: [] } },
    { publishedAt: new Date('2026-09-03'), flow: { name: 'Welcome & Routing', tags: ['welcome'] } },
    { publishedAt: new Date('2026-09-04'), flow: { name: 'Billing', tags: [] } },
  ])
  assert.equal(chosen?.flow.name, 'Welcome & Routing')
})

test('a draft salon welcome is the working copy when nothing is published', () => {
  const chosen = pickWorkingCopy([
    { flowId: 'loc', version: 1, publishedAt: null, flow: { name: 'Location', tags: [] } },
    { flowId: 'welcome', version: 1, publishedAt: null, flow: { name: 'Salon welcome', tags: ['welcome'] } },
  ])
  assert.equal(chosen?.flow.name, 'Salon welcome')
})

test('a newer draft welcome beats an older published one', () => {
  const chosen = pickWorkingCopy([
    { flowId: 'welcome', version: 1, publishedAt: new Date('2026-09-01'), flow: { name: 'Salon welcome', tags: ['welcome'] } },
    { flowId: 'welcome', version: 2, publishedAt: null, flow: { name: 'Salon welcome', tags: ['welcome'] } },
    { flowId: 'prices', version: 3, publishedAt: new Date('2026-09-04'), flow: { name: 'Services and prices', tags: [] } },
  ])
  assert.equal(chosen?.flow.name, 'Salon welcome')
  assert.equal(chosen?.version, 2)
})

test('three password chats propose a draft and a second pass does not', () => {
  const messages = [
    'I forgot my password',
    'Can you reset my password?',
    'I cannot sign in',
  ]
  const recipe = DRAFT_RECIPES.filter((item) => item.name === 'Password Reset')
  assert.deepEqual(recipesToPropose(messages, recipe, []), ['Password Reset'])
  assert.deepEqual(recipesToPropose(messages, recipe, ['Password Reset']), [])
})

test('publishing a destination adds one handoff to the welcome router', () => {
  const graph = {
    nodes: [
      { id: 'route', data: { kind: 'route_topic', label: 'Route', config: { routes: [{ handle: 'orders', phrases: ['order'] }] } } },
    ],
    edges: [] as Array<{ id: string; source: string; target: string; sourceHandle?: string }>,
  }
  const phrases = DRAFT_RECIPES.find((item) => item.name === 'Password Reset')!.phrases
  const next = withDestination(graph, 'Password Reset', phrases)
  assert.ok(next)
  const routes = next!.nodes.find((node) => node.id === 'route')!.data.config['routes'] as Array<{ flowName?: string }>
  assert.equal(routes.filter((route) => route.flowName === 'Password Reset').length, 1)
  const again = withDestination(next!, 'Password Reset', phrases)
  const routesAgain = again!.nodes.find((node) => node.id === 'route')!.data.config['routes'] as Array<{ flowName?: string }>
  assert.equal(routesAgain.filter((route) => route.flowName === 'Password Reset').length, 1)
})

test('sandbox use cases extend the welcome menu once', () => {
  const graph = {
    nodes: [
      { id: 'route', data: { kind: 'route_topic', label: 'Route', config: { routes: [{ handle: 'orders', phrases: ['order', 'delivery'] }] } } },
      { id: 'ask', data: { kind: 'ask_question', label: 'Ask', config: { question: 'What do you need?', choices: ['Order status'] } } },
      { id: 'other', data: { kind: 'send_message', label: 'Menu', config: { text: 'I can help with orders, returns, and billing. Tell me which one you need.' } } },
    ],
    edges: [] as Array<{ id: string; source: string; target: string; sourceHandle?: string }>,
  }
  const destinations = [
    { flowName: 'Cancel order', phrases: ['cancel my order'], choice: 'Cancel an order' },
    { flowName: 'Change address', phrases: ['delivery address'], choice: 'Change address' },
  ]
  const next = extendWelcomeGraph(graph, destinations)
  assert.ok(next)
  const routes = next!.nodes.find((node) => node.id === 'route')!.data.config['routes'] as Array<{ handle: string }>
  assert.equal(routes.some((route) => route.handle === 'cancel-order'), true)
  assert.equal(routes.some((route) => route.handle === 'change-address'), true)
  const choices = next!.nodes.find((node) => node.id === 'ask')!.data.config['choices'] as string[]
  assert.deepEqual(choices, ['Order status', 'Cancel an order', 'Change address'])
  const menu = next!.nodes.find((node) => node.id === 'other')!.data.config['text'] as string
  assert.match(menu, /cancellation/)
  const again = extendWelcomeGraph(next!, destinations)
  assert.equal(JSON.stringify(again), JSON.stringify(next))
})
