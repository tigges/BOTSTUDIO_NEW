import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inboxWhere, likePattern, readInboxQuery } from './inbox-list.js'

test('the Inbox list reads search, test-run and sort options and ignores anything else', () => {
  assert.deepEqual(readInboxQuery({ q: '  Alice  ', testRuns: 'exclude', sort: 'oldest', botId: 'b1' }), { botId: 'b1', search: 'Alice', testRuns: 'exclude', sort: 'oldest' })
  assert.deepEqual(readInboxQuery({ testRuns: 'everything', sort: 'sideways' }), { testRuns: 'include', sort: 'newest' })
  assert.equal(readInboxQuery({ q: 'x'.repeat(300) }).search?.length, 100)
})

test('hiding test runs keeps chats without a test run; showing only them does the opposite', () => {
  assert.equal(inboxWhere('t1', readInboxQuery({ testRuns: 'exclude' })).testRunId, null)
  assert.deepEqual(inboxWhere('t1', readInboxQuery({ testRuns: 'only' })).testRunId, { not: null })
  assert.equal('testRunId' in inboxWhere('t1', readInboxQuery({})), false)
})

test('search matches the contact or any chat whose messages contain the words', () => {
  const where = inboxWhere('t1', readInboxQuery({ q: 'refund' }), ['c1', 'c2'])
  assert.equal(where.OR?.length, 4)
  assert.deepEqual(where.OR?.[3], { id: { in: ['c1', 'c2'] } })
  assert.equal(inboxWhere('t1', readInboxQuery({ q: 'refund' })).OR?.length, 3)
  assert.equal('OR' in inboxWhere('t1', readInboxQuery({})), false)
})

test('wildcards typed into search are matched literally', () => {
  assert.equal(likePattern('50% off_now'), '%50\\% off\\_now%')
})
