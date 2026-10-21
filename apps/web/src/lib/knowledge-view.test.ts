import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampTopK, filterDocuments, highlightParts, levelCounts } from './knowledge-view.ts'

test('matched words are marked whatever their case, the rest is kept as-is', () => {
  assert.deepEqual(highlightParts('Hygiene visits cost £45. A hygiene visit…', ['hygiene', 'visit']), [
    { text: 'Hygiene', hit: true },
    { text: ' ', hit: false },
    { text: 'visit', hit: true },
    { text: 's cost £45. A ', hit: false },
    { text: 'hygiene', hit: true },
    { text: ' ', hit: false },
    { text: 'visit', hit: true },
    { text: '…', hit: false },
  ])
  assert.deepEqual(highlightParts('No terms', []), [{ text: 'No terms', hit: false }])
  assert.deepEqual(highlightParts('It shows how', ['how']), [{ text: 'It shows ', hit: false }, { text: 'how', hit: true }])
  assert.deepEqual(highlightParts('a+b (c)', ['a+b']), [{ text: 'a+b', hit: true }, { text: ' (c)', hit: false }])
})

const docs = [
  { title: 'Opening hours', source: { id: 's1', name: 'Business details' }, quality: { level: 'good' as const } },
  { title: 'Price list PDF', source: { id: 's2', name: 'Uploads' }, quality: { level: 'poor' as const } },
  { title: 'Home page', source: { id: 's3', name: 'harbourdental.co.uk' }, quality: { level: 'fair' as const } },
]

test('documents filter by title or source name, source and quality together', () => {
  assert.equal(filterDocuments(docs, { text: '', sourceId: '', level: '' }).length, 3)
  assert.deepEqual(filterDocuments(docs, { text: 'harbour', sourceId: '', level: '' }).map((d) => d.title), ['Home page'])
  assert.deepEqual(filterDocuments(docs, { text: '', sourceId: 's2', level: 'poor' }).map((d) => d.title), ['Price list PDF'])
  assert.equal(filterDocuments(docs, { text: 'hours', sourceId: 's2', level: '' }).length, 0)
})

test('quality counts cover every level, zero included', () => {
  assert.deepEqual(levelCounts(docs), { good: 1, fair: 1, poor: 1, pending: 0 })
})

test('top K stays between 1 and 20', () => {
  assert.equal(clampTopK(0), 1)
  assert.equal(clampTopK(50), 20)
  assert.equal(clampTopK(Number.NaN), 5)
  assert.equal(clampTopK(4.6), 5)
})
