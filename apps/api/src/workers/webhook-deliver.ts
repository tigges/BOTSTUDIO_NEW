/**
 * Webhook delivery BullMQ worker.
 * Consumes jobs from the "webhook:deliver" queue and POSTs payloads to
 * subscriber URLs with HMAC-SHA256 signatures when a secret is configured.
 */

import { createHmac } from 'node:crypto'
import { QUEUE_WEBHOOK_DELIVER } from '../queues.js'
import { webhookHeaders } from '../lib/webhook-headers.js'

export async function startWebhookWorker(): Promise<void> {
  try {
    const { Worker } = await import('bullmq')
    const ioredis = await import('ioredis')
    const IORedis = ioredis.default ?? ioredis as unknown as new (url: string, opts: object) => object

    const connection = new (IORedis as unknown as new (url: string, opts: object) => object)(
      process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      { maxRetriesPerRequest: null },
    )

    const worker = new Worker(
      QUEUE_WEBHOOK_DELIVER,
      async (job) => {
        const { url, secret, event, data } = job.data as { url: string; secret?: string; event: string; data: object }
        const payload = JSON.stringify({ event, data, deliveredAt: new Date().toISOString() })

        const headers = webhookHeaders({
          event,
          deliveryId: String(job.id ?? ''),
          signature: secret ? `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}` : undefined,
        })

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: payload,
          signal: AbortSignal.timeout(15_000),
        })

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${url}`)
        }
      },
      { connection, concurrency: 5 },
    )

    worker.on('failed', (job, err) => {
      console.warn(`[webhook-worker] Job ${job?.id} failed:`, err.message)
    })

    console.log('[webhook-worker] started')
  } catch (err) {
    console.warn('[webhook-worker] not started:', err instanceof Error ? err.message : err)
  }
}
