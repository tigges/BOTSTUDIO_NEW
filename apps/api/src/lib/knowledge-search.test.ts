import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keywordQuery, knowledgeBlock, preferBusiness, sourcesOf, type KnowledgeHit } from './knowledge-search.js'

const hit = (documentId: string, title: string, sourceKind = 'website'): KnowledgeHit => ({
  content: `${title} text`, documentId, title, source: sourceKind === 'business' ? 'Business details' : 'example.co.uk', sourceKind,
})

test('the keyword fallback ORs plain words and drops anything that could break the query', () => {
  assert.equal(keywordQuery('What does getting an implant involve?'), 'what | does | getting | implant | involve')
  assert.equal(keywordQuery("can't & won't | (drop) :* !table"), "can | won | drop | table")
  assert.equal(keywordQuery('a ? !'), '')
  assert.equal(keywordQuery('Zahnreinigung für Kinder'), 'zahnreinigung | für | kinder')
})

test('sources list each document once, in the order its passages were found', () => {
  assert.deepEqual(sourcesOf([hit('a', 'Prices'), hit('b', 'Hours'), hit('a', 'Prices')]).map((ref) => ref.title), ['Prices', 'Hours'])
})

test('Business details passages go first, at most two, and the rest keep their search order', () => {
  const candidates = [hit('w1', 'Contact page'), hit('w2', 'Home page'), hit('b1', 'Opening hours', 'business'), hit('w3', 'Fees page'), hit('b2', 'Phone', 'business'), hit('b3', 'Address', 'business')]
  assert.deepEqual(preferBusiness(candidates, 4).map((item) => item.documentId), ['b1', 'b2', 'w1', 'w2'])
  assert.deepEqual(preferBusiness([hit('w1', 'Contact page'), hit('w2', 'Home page')], 4).map((item) => item.documentId), ['w1', 'w2'])
})

test('the knowledge block marks Business details as confirmed and says they win a disagreement', () => {
  const block = knowledgeBlock([hit('b1', 'Opening hours', 'business'), hit('w1', 'Contact page')])
  assert.match(block, /\[1\] \(Business details, confirmed by the business\) Opening hours text/)
  assert.match(block, /\[2\] Contact page text/)
  assert.match(block, /use the Business details passage/)
  assert.doesNotMatch(knowledgeBlock([hit('w1', 'Contact page')]), /Business details/)
  assert.equal(knowledgeBlock([]), '')
})
