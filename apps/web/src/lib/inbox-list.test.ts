import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_INBOX_FILTERS, inboxParams, listState, orderBySla } from './inbox-list'

test('test-run chats are hidden unless asked for, and search and sort go to the API', () => {
  assert.deepEqual(inboxParams(DEFAULT_INBOX_FILTERS), { testRuns: 'exclude' })
  assert.deepEqual(inboxParams({ ...DEFAULT_INBOX_FILTERS, search: '  refund ', sort: 'oldest', showTestRuns: true }), { q: 'refund', sort: 'oldest' })
  assert.deepEqual(inboxParams({ ...DEFAULT_INBOX_FILTERS, sort: 'sla' }), { testRuns: 'exclude' })
})

test('breached chats come first, then running reply clocks, otherwise the order is kept', () => {
  const chats = [{ id: 'a' }, { id: 'b', sla: '5m left' }, { id: 'c', sla: 'Breached' }, { id: 'd' }, { id: 'e', sla: '1h left' }]
  assert.deepEqual(orderBySla(chats).map((chat) => chat.id), ['c', 'b', 'e', 'a', 'd'])
})

test('an empty Inbox and a filter that hides everything are different states', () => {
  const base = { loading: false, error: false, total: 0, shown: 0, filters: DEFAULT_INBOX_FILTERS }
  assert.equal(listState({ ...base, loading: true }), 'loading')
  assert.equal(listState({ ...base, error: true }), 'error')
  assert.equal(listState(base), 'empty')
  assert.equal(listState({ ...base, filters: { ...DEFAULT_INBOX_FILTERS, search: 'zz' } }), 'no-match')
  assert.equal(listState({ ...base, total: 3, filters: { ...DEFAULT_INBOX_FILTERS, view: 'mine' } }), 'no-match')
  assert.equal(listState({ ...base, total: 3, shown: 3 }), 'rows')
})
