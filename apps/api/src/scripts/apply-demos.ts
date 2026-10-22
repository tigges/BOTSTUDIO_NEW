/**
 * One-off: apply the demo program and the Bella benchmark, then exit.
 *   docker compose ... run --rm api node apps/api/dist/scripts/apply-demos.js
 */
import { installLlmLedger } from '../lib/llm-ledger.js'
import { installLlmPrivacy } from '../lib/privacy.js'
import { applyDemoData } from '../lib/demo-boot.js'

installLlmLedger()
installLlmPrivacy()
const ok = await applyDemoData((label, result, failed) => {
  if (failed) console.error(`[${label}] failed:`, result)
  else console.log(`[${label}]`, JSON.stringify(result))
})
process.exit(ok ? 0 : 1)
