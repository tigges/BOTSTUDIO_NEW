import { test } from 'node:test'
import assert from 'node:assert/strict'
import { documentQuality, textStats } from '@botstudio/shared'
import { explain, fuseRankings, matchedTerms, type EngineHit } from './knowledge-search-test.js'

function hit(id: string, raw: number, extra: Partial<EngineHit> = {}): EngineHit {
  return { chunkId: id, content: `passage ${id}`, documentId: `doc-${id}`, title: `Doc ${id}`, source: 'Website', sourceKind: 'website', raw, ...extra }
}

test('hybrid fusion rewards passages both engines found', () => {
  const semantic = [hit('a', 0.1), hit('b', 0.2), hit('c', 0.3)]
  const keyword = [hit('c', 0.9), hit('d', 0.5)]
  const fused = fuseRankings(semantic, keyword).map((row) => row.hit.chunkId)
  assert.equal(fused[0], 'c')
  assert.deepEqual(new Set(fused), new Set(['a', 'b', 'c', 'd']))
})

test('a document without passages is keyed by its id, so both engines can agree on it', () => {
  const whole = { chunkId: null, documentId: 'faq-1' }
  const fused = fuseRankings([hit('x', 0.1, whole)], [hit('y', 0.4, whole)])
  assert.equal(fused.length, 1)
})

test('each result says which engines found it, at what rank, and which words matched', () => {
  const semantic = [hit('a', 0.25, { content: 'We are open Monday to Friday, 8am to 6pm.' }), hit('b', 0.4)]
  const keyword = [hit('a', 0.6, { content: 'We are open Monday to Friday, 8am to 6pm.' })]
  const [first, second] = explain('When are you open on Monday?', 'hybrid', semantic, keyword, 5)
  assert.equal(first?.chunkId, 'a')
  assert.deepEqual(first?.why.semantic, { rank: 1, similarity: 0.75 })
  assert.deepEqual(first?.why.keyword, { rank: 1, score: 0.6 })
  assert.deepEqual(first?.why.matchedTerms, ['open', 'monday'])
  assert.ok(first?.why.fused != null)
  assert.equal(second?.why.keyword, null)
})

test('semantic and keyword modes keep their own engine order and no fused score', () => {
  const semantic = [hit('a', 0.1), hit('b', 0.2)]
  const keyword = [hit('b', 0.9)]
  assert.deepEqual(explain('q', 'semantic', semantic, keyword, 5).map((r) => r.chunkId), ['a', 'b'])
  const kw = explain('q', 'keyword', semantic, keyword, 5)
  assert.deepEqual(kw.map((r) => r.chunkId), ['b'])
  assert.equal(kw[0]?.why.fused, null)
})

test('Business details move ahead of other sources, and the result says so', () => {
  const semantic = [hit('web', 0.1), hit('biz', 0.3, { sourceKind: 'business', source: 'Business details' })]
  const results = explain('opening hours', 'semantic', semantic, [], 5)
  assert.equal(results[0]?.chunkId, 'biz')
  assert.equal(results[0]?.why.businessFirst, true)
  assert.equal(results[1]?.why.businessFirst, false)
})

test('top K caps the results', () => {
  const semantic = Array.from({ length: 10 }, (_, i) => hit(`s${i}`, i / 10))
  assert.equal(explain('q', 'semantic', semantic, [], 3).length, 3)
})

test('matched terms use the same words the keyword engine searches for', () => {
  assert.deepEqual(matchedTerms('Do you do X-rays?', 'Small X-rays are £12.'), ['rays'])
  assert.deepEqual(matchedTerms('a b', 'anything'), [])
  assert.deepEqual(matchedTerms('How do hygiene visits work?', 'The hygienist shows you how. Hygiene visits take 30 minutes.'), ['hygiene', 'visits'])
  assert.deepEqual(matchedTerms('show prices', 'She showed us the price list'), ['show'])
})

test('a clean, split and embedded document scores good', () => {
  const quality = documentQuality({ status: 'indexed', sourceKind: 'website', chars: 4000, letterShare: 0.85, repeatedLineShare: 0.05, chunks: 6, embeddedChunks: 6 })
  assert.deepEqual(quality, { score: 100, level: 'good', issues: [] })
})

test('thin, unembedded or failed documents say what is wrong and how to fix it', () => {
  const thin = documentQuality({ status: 'indexed', sourceKind: 'file', chars: 80, letterShare: 0.9, repeatedLineShare: 0, chunks: 1, embeddedChunks: 0 })
  assert.equal(thin.level, 'poor')
  assert.match(thin.issues[0] ?? '', /80 characters/)
  assert.match(thin.issues[1] ?? '', /1 of 1 passages have no embedding/)
  const failed = documentQuality({ status: 'failed', sourceKind: 'file', chars: 0, letterShare: 0, repeatedLineShare: 0, chunks: 0, embeddedChunks: 0 })
  assert.equal(failed.level, 'poor')
  assert.equal(failed.score, 0)
  const pending = documentQuality({ status: 'processing', sourceKind: 'url', chars: 0, letterShare: 0, repeatedLineShare: 0, chunks: 0, embeddedChunks: 0 })
  assert.equal(pending.level, 'pending')
  assert.equal(pending.score, null)
})

test('typed-in Business details are not judged on length, and the fix points to Business details', () => {
  const field = documentQuality({ status: 'indexed', sourceKind: 'business', chars: 40, letterShare: 0.5, repeatedLineShare: 0.5, chunks: 0, embeddedChunks: 0 })
  assert.equal(field.score, 80)
  assert.equal(field.level, 'good')
  assert.deepEqual(field.issues, ['Not split into passages, so only keyword search finds it. Save Business details again to index them.'])
})

test('text stats spot symbol-heavy text and repeated boilerplate lines', () => {
  const table = textStats('| 12 | 34 | 56 |\n| 78 | 90 | 12 |')
  assert.ok(table.letterShare < 0.2)
  const boiler = textStats('Home\nAbout us\nContact\nOur prices\nHome\nAbout us\nContact')
  assert.ok(boiler.repeatedLineShare > 0.3)
  assert.equal(textStats('').letterShare, 0)
})
