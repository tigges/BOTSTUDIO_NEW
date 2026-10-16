import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hairStudioCatalog } from '@ybot/shared'
import { matchCatalog } from './catalog-lookup.js'

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
