// BullMQ queues. The API and the worker both enqueue; only the worker process
// (or the API itself with PROCESS_ROLE=all) consumes. A job that cannot be
// enqueued is never dropped silently: it is logged, counted for System Status,
// and the caller gets BackgroundJobsUnavailableError.

import { prisma } from '@ybot/db'

export const QUEUE_KNOWLEDGE_SYNC    = 'knowledge-sync'
export const QUEUE_CAMPAIGN_SEND     = 'campaign-send'
export const QUEUE_WEBHOOK_DELIVER   = 'webhook-deliver'
export const QUEUE_CONVO_ANALYSIS    = 'conversation-analysis'

const ENQUEUE_TIMEOUT_MS = 5000

type AnyQueue = {
  add(name: string, data: object, opts?: object): Promise<unknown>
  waitUntilReady(): Promise<unknown>
}

let knowledgeSyncQueue: AnyQueue | null = null
let webhookQueue: AnyQueue | null = null
let campaignQueue: AnyQueue | null = null
let convoAnalysisQueue: AnyQueue | null = null

export class BackgroundJobsUnavailableError extends Error {
  readonly code = 'BACKGROUND_JOBS_UNAVAILABLE'
  constructor(queue: string, reason: string) {
    super(`Background jobs are not running (${reason}), so the ${queue} job was not queued. Check Admin > System Status.`)
    this.name = 'BackgroundJobsUnavailableError'
  }
}

export interface QueueHealth {
  initialised: boolean
  dropped: number
  lastDrop: { queue: string; reason: string; at: string } | null
}

const health: QueueHealth = { initialised: false, dropped: 0, lastDrop: null }

export function queueHealth(): QueueHealth {
  return { ...health, lastDrop: health.lastDrop ? { ...health.lastDrop } : null }
}

function drop(queue: string, reason: string): BackgroundJobsUnavailableError {
  health.dropped += 1
  health.lastDrop = { queue, reason, at: new Date().toISOString() }
  console.error(`[queues] ${queue} job dropped: ${reason}`)
  return new BackgroundJobsUnavailableError(queue, reason)
}

async function addJob(queue: AnyQueue | null, queueName: string, name: string, data: object, opts: object): Promise<void> {
  if (!queue) throw drop(queueName, health.initialised ? 'the queue is not available' : 'queues were not started')
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      queue.add(name, data, opts),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Valkey did not answer')), ENQUEUE_TIMEOUT_MS) }),
    ])
  } catch (err) {
    throw drop(queueName, err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timer)
  }
}

export async function initQueues(redisUrl: string) {
  try {
    const { Queue } = await import('bullmq')
    const connection = { url: redisUrl }
    knowledgeSyncQueue = new Queue(QUEUE_KNOWLEDGE_SYNC,  { connection })
    webhookQueue       = new Queue(QUEUE_WEBHOOK_DELIVER,  { connection })
    campaignQueue      = new Queue(QUEUE_CAMPAIGN_SEND,    { connection })
    convoAnalysisQueue = new Queue(QUEUE_CONVO_ANALYSIS,   { connection })
    health.initialised = true
  } catch (err) {
    console.error('[queues] BullMQ could not start; background jobs will be dropped:', err instanceof Error ? err.message : err)
    return
  }
  // The queues reconnect on their own; this only reports the state at start.
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      knowledgeSyncQueue.waitUntilReady(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ENQUEUE_TIMEOUT_MS) }),
    ])
    console.log('✅ BullMQ queues initialised')
  } catch (err) {
    console.error(`[queues] Valkey is unreachable (${err instanceof Error ? err.message : err}); background jobs are dropped until it answers.`)
  } finally {
    clearTimeout(timer)
  }
}

/** Test hook: install fake queues. */
export function setQueuesForTest(queues: Partial<Record<'knowledge' | 'webhook' | 'campaign' | 'analysis', AnyQueue | null>>) {
  if ('knowledge' in queues) knowledgeSyncQueue = queues.knowledge ?? null
  if ('webhook' in queues) webhookQueue = queues.webhook ?? null
  if ('campaign' in queues) campaignQueue = queues.campaign ?? null
  if ('analysis' in queues) convoAnalysisQueue = queues.analysis ?? null
  health.initialised = true
  health.dropped = 0
  health.lastDrop = null
}

export async function enqueueKnowledgeSync(payload: { tenantId: string; sourceId: string; botId: string; kind?: string; config?: Record<string, unknown> }) {
  await addJob(knowledgeSyncQueue, QUEUE_KNOWLEDGE_SYNC, 'sync', payload, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
}

export async function enqueueWebhookDelivery(payload: { url: string; secret?: string; event: string; data: object }) {
  await addJob(webhookQueue, QUEUE_WEBHOOK_DELIVER, 'deliver', payload, { attempts: 5, backoff: { type: 'exponential', delay: 2000 } })
}

export async function enqueueCampaignSend(payload: { tenantId: string; botId: string; campaignId: string }) {
  await addJob(campaignQueue, QUEUE_CAMPAIGN_SEND, 'send', payload, { attempts: 2, backoff: { type: 'exponential', delay: 10000 } })
}

export async function enqueueConversationAnalysis(payload: { conversationId: string; tenantId: string; botId: string }) {
  // Delay 30 s to allow any last CSAT rating to arrive before analysis
  await addJob(convoAnalysisQueue, QUEUE_CONVO_ANALYSIS, 'analyse', payload, {
    attempts: 2,
    backoff: { type: 'fixed', delay: 30_000 },
    delay: 30_000,
  })
}

/** Fan out a platform event to all matching webhooks for a tenant. Never throws; drops are counted. */
export async function dispatchWebhookEvent(tenantId: string, event: string, data: object): Promise<void> {
  try {
    const hooks = await prisma.webhook.findMany({ where: { tenantId, isActive: true, events: { has: event } } })
    await Promise.all(hooks.map((wh: { url: string; secret: string | null }) =>
      enqueueWebhookDelivery({ url: wh.url, secret: wh.secret ?? undefined, event, data }).catch(() => {})))
  } catch { /* non-critical */ }
}
