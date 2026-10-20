/**
 * Plays one test run against a live server and prints the scorecard.
 *
 *   LIVE_URL=https://app.botstudio.uk TARGET=harbour-dental KIND=traffic \
 *   QA_EMAIL=qa@acme.com QA_PASSWORD=... pnpm --filter @ybot/api exec tsx src/scripts/test-run.ts
 *
 * Bella signs in with BELLA_EMAIL / BELLA_PASSWORD. Writes the JSON report to
 * REPORT_FILE when set and the Markdown scorecard to $GITHUB_STEP_SUMMARY.
 * Exits 1 when any check fails.
 */

import { appendFileSync, writeFileSync } from 'node:fs'
import { scorecard } from '../test-runs/report.js'
import { runTestRun, type Kind, type Target } from '../test-runs/runner.js'

const TARGETS: Target[] = ['harbour-dental', 'bella', 'acme']
const KINDS: Kind[] = ['traffic', 'release']

function credentials(target: Target): { email: string; password: string } {
  if (process.env.EMAIL && process.env.PASSWORD) return { email: process.env.EMAIL, password: process.env.PASSWORD }
  if (target === 'bella') return { email: process.env.BELLA_EMAIL || 'demo@bella.com', password: process.env.BELLA_PASSWORD || 'Demo1234!' }
  return { email: process.env.QA_EMAIL || 'qa@acme.com', password: process.env.QA_PASSWORD || 'QaDemo1234!' }
}

async function main() {
  const baseUrl = (process.env.LIVE_URL || process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
  const target = (process.env.TARGET || 'harbour-dental') as Target
  const kind = (process.env.KIND || 'traffic') as Kind
  if (!TARGETS.includes(target)) throw new Error(`TARGET must be one of ${TARGETS.join(', ')}; got "${target}".`)
  if (!KINDS.includes(kind)) throw new Error(`KIND must be one of ${KINDS.join(', ')}; got "${kind}".`)
  const generated = process.env.GENERATED ? Number(process.env.GENERATED) : undefined
  if (generated !== undefined && !(Number.isInteger(generated) && generated >= 0)) throw new Error(`GENERATED must be a whole number; got "${process.env.GENERATED}".`)

  const report = await runTestRun({
    baseUrl,
    target,
    kind,
    ...credentials(target),
    ...(process.env.SEED ? { seed: process.env.SEED } : {}),
    ...(generated !== undefined ? { generated } : {}),
    ...(process.env.ONLY ? { only: process.env.ONLY.split(',').map((id) => id.trim()).filter(Boolean) } : {}),
    ...(process.env.PUBLIC_GAP_MS ? { publicGapMs: Number(process.env.PUBLIC_GAP_MS) } : {}),
    log: (line) => console.log(line),
  })

  const markdown = scorecard(report)
  console.log(`\n${markdown}`)
  if (process.env.REPORT_FILE) writeFileSync(process.env.REPORT_FILE, JSON.stringify(report, null, 2))
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
  if (report.status !== 'passed') process.exit(1)
}

main().then(() => process.exit(0)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
