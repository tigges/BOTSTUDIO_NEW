import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  environmentsNeedingGraph,
  environmentsToRefresh,
  isShopWelcomeGraph,
  isUniqueConstraint,
  retryOnUnique,
} from './bella-salon-sync.js'

test('the shop welcome is the retail menu, not the salon greeting', () => {
  assert.equal(isShopWelcomeGraph('Welcome & Routing', { text: 'I can help with an order, a return, billing' }), true)
  assert.equal(isShopWelcomeGraph('Welcome & Routing', { text: 'Hi, I am Bella at Bella Hair Studio.' }), false)
  assert.equal(isShopWelcomeGraph('Salon welcome', { text: 'billing return order' }), false)
})

test('a salon graph is published only where the saved copy differs', () => {
  const graph = { nodes: [{ id: 'start' }] }
  const same = { nodes: [{ id: 'start' }] }
  const other = { nodes: [{ id: 'other' }] }
  assert.deepEqual(
    environmentsNeedingGraph(graph, [
      { environmentId: 'sandbox', graph: same },
      { environmentId: 'production', graph: other },
    ], ['sandbox', 'production']),
    ['production'],
  )
  assert.deepEqual(environmentsNeedingGraph(graph, [], ['sandbox', 'production']), ['sandbox', 'production'])
})

test('a published learning route is left in place on that environment', () => {
  const pack = { nodes: [{ id: 'start' }] }
  const learned = {
    nodes: [{
      id: 'route',
      data: { kind: 'route_topic', config: { routes: [{ handle: 'learned', phrases: ['book a colour'], learning: true }] } },
    }],
  }
  assert.deepEqual(
    environmentsToRefresh(pack, [
      { environmentId: 'sandbox', graph: learned },
      { environmentId: 'production', graph: { nodes: [{ id: 'old' }] } },
    ], ['sandbox', 'production']),
    ['production'],
  )
})

test('a unique version clash is retried and then kept', async () => {
  assert.equal(isUniqueConstraint({ code: 'P2002' }), true)
  assert.equal(isUniqueConstraint({ code: 'P2003' }), false)
  assert.equal(isUniqueConstraint('boom'), false)

  let n = 0
  const value = await retryOnUnique(async () => {
    n += 1
    if (n === 1) throw Object.assign(new Error('clash'), { code: 'P2002' })
    return 'ok'
  })
  assert.equal(value, 'ok')
  assert.equal(n, 2)

  await assert.rejects(
    () => retryOnUnique(async () => {
      throw Object.assign(new Error('foreign'), { code: 'P2003' })
    }),
    /foreign/,
  )
})
