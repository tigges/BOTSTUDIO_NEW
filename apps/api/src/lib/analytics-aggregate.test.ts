import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateSamples, formatMetric, measure, movement, previousRange, readAnalyticsQuery, timeBucket, type AnalyticsQuery } from '@ybot/shared'
import { chatSamples, chatWhere } from './analytics-aggregate.js'

const NOW = new Date('2026-10-21T12:00:00Z')

test('the query is typed and every mistake names the field', () => {
  const ok = readAnalyticsQuery({ metric: 'escalated_rate', dimensions: 'time,channel', days: '7', environment: 'production' }, NOW)
  assert.ok(!('error' in ok))
  assert.deepEqual(ok.dimensions, ['time', 'channel'])
  assert.equal(ok.filters.testRuns, 'exclude')
  assert.equal(ok.filters.environment, 'production')
  assert.equal(ok.range.from, '2026-10-14T12:00:00.000Z')

  const body = readAnalyticsQuery({ metric: 'conversations', dimensions: ['outcome'], filters: { testRuns: 'only' }, range: { from: '2026-10-01', to: '2026-10-08' }, granularity: 'week' }, NOW)
  assert.ok(!('error' in body))
  assert.equal(body.filters.testRuns, 'only')
  assert.equal(body.granularity, 'week')

  const err = (raw: Record<string, unknown>) => (readAnalyticsQuery(raw, NOW) as { error: string }).error
  assert.match(err({ metric: 'nope' }), /^metric must be one of/)
  assert.match(err({ metric: 'conversations', dimensions: 'colour' }), /^dimensions: "colour"/)
  assert.match(err({ metric: 'escalated_rate', dimensions: 'outcome' }), /^dimensions: outcome cannot split/)
  assert.match(err({ metric: 'conversations', range: { from: 'soon' } }), /^range\.from is not a date/)
  assert.match(err({ metric: 'conversations', range: { from: '2026-10-08', to: '2026-10-01' } }), /^range\.from must be before/)
  assert.match(err({ metric: 'conversations', testRuns: 'maybe' }), /^filters\.testRuns/)
})

test('the previous period has the same length and ends where the range starts', () => {
  assert.deepEqual(previousRange({ from: '2026-10-14T00:00:00.000Z', to: '2026-10-21T00:00:00.000Z' }), { from: '2026-10-07T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z' })
})

test('weeks start on Monday in UTC', () => {
  assert.equal(timeBucket(new Date('2026-10-21T23:30:00Z'), 'day'), '2026-10-21')
  assert.equal(timeBucket(new Date('2026-10-21T23:30:00Z'), 'week'), '2026-10-19')
  assert.equal(timeBucket(new Date('2026-10-19T00:00:00Z'), 'week'), '2026-10-19')
  assert.equal(timeBucket(new Date('2026-10-18T23:59:00Z'), 'week'), '2026-10-12')
})

test('rates come from finished chats only, and escalation is its own count, not the rest of containment', () => {
  const chats = [
    { id: 'a', createdAt: NOW, outcome: 'contained_resolved', channel: 'Web' },
    { id: 'b', createdAt: NOW, outcome: 'contained_partial', channel: 'Web' },
    { id: 'c', createdAt: NOW, outcome: 'escalated', channel: 'WhatsApp' },
    { id: 'd', createdAt: NOW, outcome: 'abandoned', channel: 'Web' },
    { id: 'e', createdAt: NOW, outcome: null, channel: 'Web' },
  ]
  assert.equal(chatSamples('conversations', chats).length, 5)
  const contained = chatSamples('contained_rate', chats)
  const escalated = chatSamples('escalated_rate', chats)
  assert.equal(contained.length, 4)
  assert.equal(contained.filter((s) => s.value === 1).length, 2)
  assert.equal(escalated.filter((s) => s.value === 1).length, 1)
  assert.equal(chatSamples('resolved_by_bot_rate', chats).filter((s) => s.value === 1).length, 1)
})

test('no data is a dash with a zero denominator, never a zero rate', () => {
  const empty = measure('rate', [])
  assert.equal(empty.value, null)
  assert.equal(empty.denominator, 0)
  assert.equal(formatMetric('escalated_rate', empty.value), '—')
  assert.equal(formatMetric('escalated_rate', 0), '0.0%')
  assert.equal(formatMetric('first_reply_ms', 1530), '1.5s')
  assert.equal(formatMetric('llm_cost', 0.004), '<$0.01')
  assert.equal(measure('count', []).value, 0)
})

test('groups by the requested dimensions and keeps each denominator', () => {
  const query = readAnalyticsQuery({ metric: 'escalated_rate', dimensions: 'channel', days: 7 }, NOW) as AnalyticsQuery
  const at = new Date('2026-10-20T10:00:00Z')
  const result = aggregateSamples(query, [
    { at, value: 1, channel: 'Web', outcome: 'escalated' },
    { at, value: 0, channel: 'Web', outcome: 'abandoned' },
    { at, value: 0, channel: 'WhatsApp', outcome: 'contained_resolved' },
  ], [])
  assert.deepEqual(result.rows.map((r) => [r.key.channel, r.value, r.denominator]), [['Web', 0.5, 2], ['WhatsApp', 0, 1]])
  assert.equal(result.total.denominator, 3)
  assert.equal(result.previous.value, null)
})

test('a change only counts as moved when it clears the margin of both periods', () => {
  const big = (hits: number, n: number) => measure('rate', [...Array(hits).fill(1), ...Array(n - hits).fill(0)])
  assert.equal(movement(big(60, 100), big(40, 100)), 'up')
  assert.equal(movement(big(6, 10), big(4, 10)), 'flat')
  assert.equal(movement(big(400, 1000), big(6, 10)), 'flat')
  assert.equal(movement(measure('rate', []), big(4, 10)), 'unknown')
  assert.equal(movement(measure('sum', [1, 2]), measure('sum', [5])), 'unknown')
  assert.equal(movement(big(2, 2), big(1, 2)), 'flat')
  assert.ok(measure('rate', [1, 1]).margin! > 0.3)
  assert.equal(movement(measure('count', Array(19).fill(1)), measure('count', [])), 'up')
  assert.equal(movement(measure('count', [1, 1]), measure('count', [])), 'flat')
})

test('test runs, environment and channel narrow the chats', () => {
  const filters = { testRuns: 'exclude' as const, environment: 'production', channelId: 'ch1' }
  assert.deepEqual(chatWhere('t1', filters), { tenantId: 't1', channelId: 'ch1', environment: { kind: 'production' }, testRunId: null })
  assert.deepEqual(chatWhere('t1', { testRuns: 'only' }).testRunId, { not: null })
  assert.equal('testRunId' in chatWhere('t1', { testRuns: 'include' }), false)
})
