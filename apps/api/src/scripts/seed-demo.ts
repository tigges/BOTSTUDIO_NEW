/**
 * Backwards-compatible entry point.
 * The old Hair Studio script appended 240 chats on every run and used
 * acme@ybot.ai. Both demo companies are now created by ensure-demos,
 * and a second run does not add more chats.
 */
export { ensureDemos as seedDemo } from './ensure-demos.js'
import { ensureDemos } from './ensure-demos.js'
import { prisma } from '@botstudio/db'

const isDirectRun = process.argv[1]?.endsWith('seed-demo.ts') || process.argv[1]?.endsWith('seed-demo.js')
if (isDirectRun) {
  ensureDemos()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
      return prisma.$disconnect()
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
