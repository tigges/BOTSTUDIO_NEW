import { withLlmScope } from './llm-ledger.js'

/**
 * The demo program (Acme, Bella, Harbour Dental journeys) and the Bella
 * benchmark are re-applied when the API starts only where DEMO_SEED_ON_BOOT
 * allows it. app.botstudio.uk is the demo environment and keeps it on; a
 * customer install sets it to false and runs `node apps/api/dist/scripts/apply-demos.js`
 * by hand when it wants the demo companies.
 *
 * Unset means on, so a host whose compose file predates the flag behaves as before.
 */
export function demoSeedOnBoot(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['DEMO_SEED_ON_BOOT']?.trim().toLowerCase()
  return !(value === 'false' || value === '0' || value === 'no' || value === 'off')
}

/** Both jobs run independently, as they did at boot: one failing does not skip the other. */
export async function applyDemoData(log: (label: string, result: unknown, failed: boolean) => void): Promise<boolean> {
  const jobs: Array<[string, () => Promise<unknown>]> = [
    ['demo-program', async () => {
      const { applyDemoProgram } = await import('../scripts/demo-program.js')
      return withLlmScope({ source: 'authoring' }, () => applyDemoProgram())
    }],
    ['bella-benchmark', async () => {
      const { ensureBellaBenchmark } = await import('../scripts/ensure-demos.js')
      return ensureBellaBenchmark()
    }],
  ]
  const results = await Promise.allSettled(jobs.map(([, run]) => run()))
  results.forEach((result, i) => {
    const label = jobs[i]![0]
    if (result.status === 'fulfilled') log(label, result.value, false)
    else log(label, result.reason instanceof Error ? result.reason.message : result.reason, true)
  })
  return results.every((r) => r.status === 'fulfilled')
}
