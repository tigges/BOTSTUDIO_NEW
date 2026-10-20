import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keywordQuery, sourcesOf } from './knowledge-search.js'

test('the keyword fallback ORs plain words and drops anything that could break the query', () => {
  assert.equal(keywordQuery('What does getting an implant involve?'), 'what | does | getting | implant | involve')
  assert.equal(keywordQuery("can't & won't | (drop) :* !table"), "can | won | drop | table")
  assert.equal(keywordQuery('a ? !'), '')
  assert.equal(keywordQuery('Zahnreinigung für Kinder'), 'zahnreinigung | für | kinder')
})

test('sources list each document once, in the order its passages were found', () => {
  const hit = (documentId: string, title: string) => ({ content: 'x', documentId, title, source: 'Business details' })
  assert.deepEqual(sourcesOf([hit('a', 'Prices'), hit('b', 'Hours'), hit('a', 'Prices')]).map((ref) => ref.title), ['Prices', 'Hours'])
})
