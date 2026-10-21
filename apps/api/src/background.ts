import { hostname } from 'node:os'
import { startKnowledgeSyncWorker } from './workers/knowledge-sync.js'
import { startWebhookWorker } from './workers/webhook-deliver.js'
import { startConversationAnalysisWorker } from './workers/conversation-analysis.js'
import { startCampaignWorker } from './workers/campaign-send.js'
import { startQuietChatSweep } from './lib/chat-outcome.js'
import { sweepExpiredMemory } from './lib/contact-memory.js'
import { KEY_PREFIX, getValkey, isReady } from './lib/valkey.js'

/**
 * all    — one process serves HTTP and runs the background work (the default,
 *          and what a host without a worker container runs).
 * api    — HTTP only; a worker container runs the background work.
 * worker — background work only (src/worker.ts).
 */
export type ProcessRole = 'all' | 'api' | 'worker'

export function processRole(env: NodeJS.ProcessEnv = process.env): ProcessRole {
  const role = env['PROCESS_ROLE']?.trim().toLowerCase()
  return role === 'api' || role === 'worker' ? role : 'all'
}

export const WORKER_HEARTBEAT_PREFIX = `${KEY_PREFIX}worker:`
const HEARTBEAT_EVERY_MS = 20_000
const HEARTBEAT_TTL_MS = 60_000

export interface WorkerHeartbeat {
  id: string
  role: ProcessRole
  startedAt: string
  seenAt: string
}

function startHeartbeat(role: ProcessRole): () => void {
  const id = `${hostname()}:${process.pid}`
  const startedAt = new Date().toISOString()
  const beat = async () => {
    const redis = await getValkey()
    if (!isReady(redis)) return
    const body: WorkerHeartbeat = { id, role, startedAt, seenAt: new Date().toISOString() }
    await redis.set(`${WORKER_HEARTBEAT_PREFIX}${id}`, JSON.stringify(body), 'PX', HEARTBEAT_TTL_MS).catch(() => {})
  }
  void beat()
  // Not unref'd: in the worker container this timer keeps the process alive
  // even while Valkey is down and no BullMQ connection holds the event loop.
  const timer = setInterval(() => { void beat() }, HEARTBEAT_EVERY_MS)
  return () => clearInterval(timer)
}

/** Workers that wrote a heartbeat in the last minute. Empty when Valkey is unreachable. */
export async function liveWorkers(): Promise<WorkerHeartbeat[]> {
  const redis = await getValkey()
  if (!isReady(redis)) return []
  try {
    const keys: string[] = []
    let cursor = '0'
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', `${WORKER_HEARTBEAT_PREFIX}*`, 'COUNT', 100)
      cursor = next
      keys.push(...batch)
    } while (cursor !== '0' && keys.length < 1000)
    if (keys.length === 0) return []
    const values = await redis.mget(...keys)
    return values.flatMap((value) => {
      try { return value ? [JSON.parse(value) as WorkerHeartbeat] : [] } catch { return [] }
    })
  } catch {
    return []
  }
}

/** Queue consumers, sweeps and the heartbeat. Runs in exactly one place per deployment role. */
export function startBackgroundWork(role: ProcessRole): () => void {
  const log = (message: string) => console.log(message)
  startKnowledgeSyncWorker().catch(() => {})
  startWebhookWorker().catch(() => {})
  startConversationAnalysisWorker().catch(() => {})
  startCampaignWorker().catch(() => {})
  const stopQuiet = startQuietChatSweep(log)
  const sweepMemory = () => sweepExpiredMemory().catch((err) => console.warn('[contact-memory]', err instanceof Error ? err.message : err))
  void sweepMemory()
  const memoryTimer = setInterval(sweepMemory, 6 * 3_600_000)
  memoryTimer.unref()
  const stopHeartbeat = startHeartbeat(role)
  return () => {
    stopQuiet()
    clearInterval(memoryTimer)
    stopHeartbeat()
  }
}

export interface BackgroundProblem { key: string; message: string }

/** What System Status lists under "Needs attention" for background work. */
export function backgroundProblems(input: {
  valkeyOk: boolean
  role: ProcessRole
  workers: WorkerHeartbeat[]
  dropped: number
  lastDrop: { queue: string; reason: string; at: string } | null
}): BackgroundProblem[] {
  const problems: BackgroundProblem[] = []
  if (!input.valkeyOk) {
    problems.push({ key: 'valkey', message: 'Valkey is unreachable. Knowledge sync, webhook delivery, campaigns and chat analysis are not running, and new jobs are dropped. Check the valkey container and REDIS_URL.' })
  } else if (input.workers.length === 0) {
    problems.push({
      key: 'worker',
      message: input.role === 'api'
        ? 'No background worker is running. Start it on the host with `docker compose ... up -d worker`.'
        : 'The background worker has not reported in the last minute. Check the API logs for [queues] and worker errors.',
    })
  }
  if (input.dropped > 0 && input.lastDrop) {
    const jobs = input.dropped === 1 ? '1 background job was' : `${input.dropped} background jobs were`
    problems.push({ key: 'dropped', message: `${jobs} dropped since the API started. Last: ${input.lastDrop.queue} at ${input.lastDrop.at} (${input.lastDrop.reason}).` })
  }
  return problems
}
