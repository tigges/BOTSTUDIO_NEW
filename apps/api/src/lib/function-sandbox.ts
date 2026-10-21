import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FUNCTION_TIMEOUT_MAX_MS } from '@botstudio/shared'

const PERMISSION_FLAG = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission'
const OUTPUT_LIMIT = 256 * 1024

/**
 * Runs inside the child. The node permission model denies file, child-process
 * and worker access; network globals and module loaders are removed before the
 * code runs, and the vm context has no require, import or process, so the code
 * is a pure transform of its arguments.
 */
const BOOT = `
import vm from 'node:vm'
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'navigator']) {
  try { delete globalThis[name] } catch {}
}
for (const name of ['getBuiltinModule', 'binding', '_linkedBinding', 'dlopen']) {
  try { Object.defineProperty(process, name, { value: undefined, configurable: false, writable: false }) } catch {}
}
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => { input += d })
process.stdin.on('end', async () => {
  const done = (value) => process.stdout.write(JSON.stringify(value), () => process.exit(0))
  try {
    const { code, argsJson, timeoutMs } = JSON.parse(input)
    const context = vm.createContext({ argsJson }, { codeGeneration: { strings: false, wasm: false } })
    const main = vm.runInContext(code + '\\n;typeof main === "function" ? main : undefined', context, { timeout: timeoutMs })
    if (typeof main !== 'function') return done({ ok: false, error: 'Code: define async function main(args) and return the result.' })
    const args = vm.runInContext('JSON.parse(argsJson)', context)
    const result = await main(args)
    const json = vm.runInContext('(v) => JSON.stringify(v === undefined ? null : v)', context)(result)
    done({ ok: true, json })
  } catch (err) {
    done({ ok: false, error: String((err && err.message) || err) })
  }
})
`

let bootPath: string | undefined
function bootFile(): string {
  if (bootPath && existsSync(bootPath)) return bootPath
  const dir = mkdtempSync(join(tmpdir(), 'ybot-fn-'))
  bootPath = join(dir, 'boot.mjs')
  writeFileSync(bootPath, BOOT, { mode: 0o444 })
  return bootPath
}

export interface FunctionRun {
  ok: boolean
  output?: unknown
  error?: string
}

export function runFunctionCode(code: string, args: Record<string, unknown>, timeoutMs: number): Promise<FunctionRun> {
  const limit = Math.min(Math.max(timeoutMs, 100), FUNCTION_TIMEOUT_MAX_MS)
  return new Promise((resolve) => {
    const boot = bootFile()
    const child = spawn(process.execPath, [PERMISSION_FLAG, `--allow-fs-read=${boot}`, '--max-old-space-size=128', '--disable-proto=delete', boot], {
      env: {},
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    let out = ''
    let settled = false
    const finish = (run: FunctionRun) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGKILL')
      resolve(run)
    }
    const timer = setTimeout(() => finish({ ok: false, error: `The function took longer than ${limit} ms and was stopped.` }), limit + 500)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      out += chunk
      if (out.length > OUTPUT_LIMIT) finish({ ok: false, error: 'The function returned more than 256 KB.' })
    })
    child.on('error', (err) => finish({ ok: false, error: `The function could not start: ${err.message}` }))
    child.on('close', () => {
      if (settled) return
      try {
        const parsed = JSON.parse(out) as { ok: boolean; json?: string; error?: string }
        if (!parsed.ok) return finish({ ok: false, error: parsed.error ?? 'The function failed.' })
        finish({ ok: true, output: JSON.parse(parsed.json ?? 'null') })
      } catch {
        finish({ ok: false, error: 'The function ended without a result. Make sure main returns a value, and that it does not run out of memory.' })
      }
    })
    child.stdin.end(JSON.stringify({ code, argsJson: JSON.stringify(args), timeoutMs: limit }))
  })
}
