import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backgroundProblems, processRole } from './background.js'
import { BackgroundJobsUnavailableError, dispatchWebhookEvent, enqueueKnowledgeSync, queueHealth, setQueuesForTest } from './queues.js'

test('the process role defaults to all, so a host without a worker container keeps its background work', () => {
  assert.equal(processRole({}), 'all')
  assert.equal(processRole({ PROCESS_ROLE: 'API' }), 'api')
  assert.equal(processRole({ PROCESS_ROLE: 'worker' }), 'worker')
  assert.equal(processRole({ PROCESS_ROLE: 'nonsense' }), 'all')
})

test('System Status names what is wrong with background work and how to fix it', () => {
  const healthy = backgroundProblems({ valkeyOk: true, role: 'api', workers: [{ id: 'w:1', role: 'worker', startedAt: '', seenAt: '' }], dropped: 0, lastDrop: null })
  assert.deepEqual(healthy, [])

  const down = backgroundProblems({ valkeyOk: false, role: 'all', workers: [], dropped: 0, lastDrop: null })
  assert.deepEqual(down.map((p) => p.key), ['valkey'])

  const noWorker = backgroundProblems({ valkeyOk: true, role: 'api', workers: [], dropped: 0, lastDrop: null })
  assert.match(noWorker[0]!.message, /up -d worker/)

  const dropped = backgroundProblems({ valkeyOk: true, role: 'all', workers: [{ id: 'a:1', role: 'all', startedAt: '', seenAt: '' }], dropped: 2, lastDrop: { queue: 'knowledge-sync', reason: 'Valkey did not answer', at: '2026-10-21T11:00:00.000Z' } })
  assert.match(dropped[0]!.message, /^2 background jobs were dropped .*knowledge-sync/)
})

test('a job that cannot be queued is counted and reported instead of vanishing', async () => {
  setQueuesForTest({ knowledge: null })
  await assert.rejects(
    enqueueKnowledgeSync({ tenantId: 't', sourceId: 's', botId: 'b' }),
    (err: unknown) => err instanceof BackgroundJobsUnavailableError && /knowledge-sync job was not queued/.test(err.message),
  )
  assert.equal(queueHealth().dropped, 1)
  assert.equal(queueHealth().lastDrop?.queue, 'knowledge-sync')

  const failing = { add: async () => { throw new Error('Connection is closed.') }, waitUntilReady: async () => {} }
  setQueuesForTest({ knowledge: failing })
  await assert.rejects(enqueueKnowledgeSync({ tenantId: 't', sourceId: 's', botId: 'b' }), BackgroundJobsUnavailableError)
  assert.equal(queueHealth().lastDrop?.reason, 'Connection is closed.')

  const added: unknown[] = []
  setQueuesForTest({ knowledge: { add: async (_n: string, data: object) => { added.push(data) }, waitUntilReady: async () => {} } })
  await enqueueKnowledgeSync({ tenantId: 't', sourceId: 's', botId: 'b' })
  assert.equal(added.length, 1)
  assert.equal(queueHealth().dropped, 0)
})

test('webhook fan-out never throws', async () => {
  setQueuesForTest({ webhook: null })
  await assert.doesNotReject(dispatchWebhookEvent('no-such-tenant', 'conversation.escalated', {}))
})
