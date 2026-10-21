import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateFilters, aggregateParams, readAnalyticsSearch } from './analytics-filters'

test('only known values survive a hand-edited URL', () => {
  assert.deepEqual(readAnalyticsSearch({ days: '30', env: 'production', channel: 'ch1', tests: 'include' }), { days: 30, env: 'production', channel: 'ch1', tests: 'include' })
  assert.deepEqual(readAnalyticsSearch({ days: '12', env: 'staging', channel: '', tests: 'yes' }), {})
})

test('test runs stay out unless the URL asks for them, and the top bar picks the environment', () => {
  assert.deepEqual(aggregateFilters({}, 'production', 'b1'), { botId: 'b1', environment: 'production', testRuns: 'exclude' })
  assert.deepEqual(aggregateFilters({ env: 'all', tests: 'include' }, 'sandbox', null), { testRuns: 'include' })
  assert.deepEqual(aggregateFilters({ env: 'sandbox', channel: 'ch1' }, 'production', 'b1'), { botId: 'b1', environment: 'sandbox', channelId: 'ch1', testRuns: 'exclude' })
})

test('long ranges are grouped by week', () => {
  const filters = { testRuns: 'exclude' as const, environment: 'production' }
  assert.equal(aggregateParams({ metric: 'conversations', dimensions: ['time'] }, filters, 7).granularity, 'day')
  assert.deepEqual(aggregateParams({ metric: 'conversations', dimensions: ['time', 'outcome'] }, filters, 90), {
    metric: 'conversations', dimensions: 'time,outcome', granularity: 'week', days: '90', testRuns: 'exclude', environment: 'production',
  })
})
