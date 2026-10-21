import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hairStudioCatalog } from '@botstudio/shared'
import { matchCatalog, pickCatalog } from './catalog-lookup.js'

test('a haircut matches one price, not the whole list', () => {
  const catalog = hairStudioCatalog('Bella Hair Studio')
  const hit = matchCatalog(catalog, 'how much is a haircut', 'service')
  assert.equal(hit?.id, 'cut')
  assert.match(hit?.fact ?? '', /£35/)
  assert.equal(matchCatalog(catalog, 'prices', 'service'), undefined)
})

test('hours and the address stay on their own facts', () => {
  const catalog = hairStudioCatalog('Bella Hair Studio')
  assert.match(matchCatalog(catalog, 'where are you')?.fact ?? '', /Rosewood/)
  assert.match(matchCatalog(catalog, 'opening hours')?.fact ?? '', /Monday to Saturday/)
  assert.equal(matchCatalog(catalog, 'where are you', 'service'), undefined)
})

test('a phrase miss can still pick a fact the guest named, and prices stay generic', async () => {
  const catalog = {
    facts: [
      { id: 'sim', kind: 'plan', title: 'SIM only plans', phrases: ['pay monthly'], fact: 'Unlimited data is £26 a month on a SIM only plan.' },
      { id: 'cut', kind: 'service', title: 'A cut', phrases: ['haircut'], fact: 'Cuts start from £35.' },
    ],
  }
  const thinking = {
    classify: async () => ({ category: 'cut', confidence: 0.9 }),
  }
  const named = await pickCatalog(catalog, 'is there a sim only deal for my phone', 'plan')
  assert.equal(named?.id, 'sim')
  assert.match(named?.fact ?? '', /£26/)
  const prices = await pickCatalog(hairStudioCatalog('Bella Hair Studio'), 'prices', 'service', thinking)
  assert.equal(prices, undefined)
  const classified = await pickCatalog(catalog, 'is sim only still sold', 'plan', {
    classify: async () => ({ category: 'sim', confidence: 0.9 }),
  })
  assert.equal(classified?.id, 'sim')
})
