/**
 * Background worker entry point: the same image as the API, started with
 * `node apps/api/dist/worker.js`. It consumes the BullMQ queues and runs the
 * sweeps, and serves no HTTP. Run the API with PROCESS_ROLE=api next to it so
 * the work does not run twice.
 */
import { installConsoleScrubbing } from './lib/log-scrub.js'
import { assertProductionSecrets } from './lib/production-secrets.js'
import { installLlmLedger } from './lib/llm-ledger.js'
import { installLlmPrivacy } from './lib/privacy.js'
import { setTurnBroadcast } from './lib/turn-pipeline.js'
import { broadcastToTenant, startBroadcastRelay } from './ws.js'
import { initQueues } from './queues.js'
import { startBackgroundWork } from './background.js'

installConsoleScrubbing()
assertProductionSecrets()
installLlmLedger()
installLlmPrivacy()
setTurnBroadcast(broadcastToTenant)

await startBroadcastRelay({ subscribe: false }).catch((err) => console.error('[ws] broadcast relay not started:', err instanceof Error ? err.message : err))
await initQueues(process.env['REDIS_URL'] ?? 'redis://localhost:6379')
const stop = startBackgroundWork('worker')
console.log('[worker] started: knowledge-sync, webhook-deliver, conversation-analysis, campaign-send, sweeps')

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    stop()
    process.exit(0)
  })
}
