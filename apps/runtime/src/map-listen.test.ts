import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hairStudioPack } from '@ybot/shared'
import type { FlowGraph } from './engine.js'
import { isSmallTalk, listenForChapter, offerOnMap, sameQuestion, shapeTurn } from './map-listen.js'

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
  assert.equal(listenForChapter({ chapters, catalog, text: 'colour', current: 'Salon welcome' }), 'Book an appointment')
  assert.equal(listenForChapter({ chapters, catalog, text: 'color', current: 'Offers' }), 'Book an appointment')
  assert.equal(listenForChapter({ chapters, catalog, text: 'how much is colour', current: 'Salon welcome' }), 'Services and prices')
  assert.equal(listenForChapter({ chapters, catalog, text: 'hi', current: 'Salon welcome' }), undefined)
})

test('a finished chapter offers the doors instead of repeating itself', () => {
  const { chapters } = salonChapters()
  const offer = offerOnMap(chapters, 'Salon hours')
  assert.match(offer, /prices/)
  assert.match(offer, /book/)
  assert.match(offer, /What would you like/)
  assert.equal(offer.includes('welcome'), false)
  assert.equal(/questions/.test(offer), false)
  assert.equal(sameQuestion("What's your name?", 'whats your name'), true)
  assert.equal(sameQuestion("What's your name?", 'What would you like done?'), false)
  assert.equal(isSmallTalk('thanks'), true)
  assert.equal(isSmallTalk('cut'), false)
})

test('a long which-one list becomes three short names, and hours asks one next thing', () => {
  const listed = shapeTurn(
    'Which cut & style? Ladies wash, cut & style, Gents wash, cut & style, Kids (12 & under), Teens (13-16) boys, Blow-dry.',
  )
  assert.match(listed, /Which cut/)
  assert.match(listed, /Ladies/)
  assert.match(listed, /Gents/)
  assert.match(listed, /Kids/)
  assert.match(listed, /or another/)
  assert.equal(/Ladies wash/.test(listed), false)
  assert.equal(/Blow-dry/.test(listed), false)
  assert.equal((listed.match(/\?/g) ?? []).length, 1)

  const hours = shapeTurn(
    'Yuzu is open Tuesday to Friday 10am to 8pm. Want where we are, a price, or to book?',
    'Salon hours',
  )
  assert.match(hours, /Shall I book a time/)
  assert.equal(/where we are/.test(hours), false)
  assert.equal((hours.match(/\?/g) ?? []).length, 1)

  const already = 'Which cut & style? Ladies, Gents, or Kids — or another.'
  assert.equal(shapeTurn(already), already)
})
