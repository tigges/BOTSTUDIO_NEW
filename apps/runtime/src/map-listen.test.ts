import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hairStudioPack } from '@ybot/shared'
import type { FlowGraph } from './engine.js'
import { isSmallTalk, listenForChapter, offerOnMap, sameQuestion } from './map-listen.js'

function salonChapters() {
  const pack = hairStudioPack('Yuzu', 'Bella')
  return {
    chapters: pack.flows.map((flow) => ({ name: flow.name, graph: flow.graph as unknown as FlowGraph })),
    catalog: pack.catalog,
  }
}

test('a service word opens prices, not the welcome', () => {
  const { chapters, catalog } = salonChapters()
  assert.equal(listenForChapter({ chapters, catalog, text: 'cut', current: 'Salon welcome' }), 'Services and prices')
  assert.equal(listenForChapter({ chapters, catalog, text: 'services', current: 'Salon hours' }), 'Services and prices')
  assert.equal(listenForChapter({ chapters, catalog, text: 'book a haircut', current: 'Salon welcome' }), 'Book an appointment')
  assert.equal(listenForChapter({ chapters, catalog, text: 'hi', current: 'Salon welcome' }), undefined)
})

test('a finished chapter offers the doors instead of repeating itself', () => {
  const { chapters } = salonChapters()
  assert.match(offerOnMap(chapters, 'Salon hours'), /prices/)
  assert.match(offerOnMap(chapters, 'Salon hours'), /What would you like/)
  assert.equal(offerOnMap(chapters, 'Salon hours').includes('welcome'), false)
  assert.equal(sameQuestion("What's your name?", 'whats your name'), true)
  assert.equal(sameQuestion("What's your name?", 'What would you like done?'), false)
  assert.equal(isSmallTalk('thanks'), true)
  assert.equal(isSmallTalk('cut'), false)
})
