import { addDemoTraffic } from '../lib/demo-traffic.js'

const isDirectRun = process.argv[1]?.endsWith('demo-traffic.ts') || process.argv[1]?.endsWith('demo-traffic.js')

if (isDirectRun) {
  addDemoTraffic()
    .then((result) => {
      console.log(JSON.stringify(result))
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
