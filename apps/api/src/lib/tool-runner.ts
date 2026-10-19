import { randomUUID } from 'node:crypto'
import {
  checkToolArgs, fillJsonTemplate, fillToolTemplate, httpConfig, toolChangesData,
  type ToolParameter,
} from '@ybot/shared'
import { applyAuthProfile, type AppliedAuth } from './auth-profiles.js'
import { assertPublicUrl } from './public-url.js'
import { runFunctionCode } from './function-sandbox.js'
import { mcpCallTool, type McpTransport } from './mcp-client.js'
import { scrubValues } from './secrets.js'

/** Where a run came from. Test chats and eval runs do not run tools that change data. */
export type ToolRunSource = 'bot' | 'inbox' | 'console' | 'test_chat' | 'eval'

export interface RunnableTool {
  id: string
  tenantId: string
  botId: string
  name: string
  kind: string
  effect: string
  parameters: unknown
  config: unknown
  authProfile?: { kind: string; settings: unknown; secretEnc: string | null } | null
}

export interface ToolRunContext {
  source: ToolRunSource
  conversationId?: string
  actorId?: string
}

export interface ToolResult {
  ok: boolean
  output: unknown
  error?: string
  status?: number
  durationMs: number
  attempts: number
  /** True when a test chat or eval skipped a tool that changes data. */
  skipped?: boolean
}

export interface ToolDeps {
  fetch: typeof fetch
  checkUrl: (url: string) => Promise<unknown>
  searchKnowledge: (query: string, tenantId: string, botId: string, topK: number) => Promise<string[]>
  runWorkflow: (workflowId: string, ctx: { tenantId: string; botId: string; conversationId?: string }) => Promise<unknown>
  runFunction: typeof runFunctionCode
  sleep: (ms: number) => Promise<void>
  now: () => number
}

const OUTPUT_LIMIT = 20_000

export function defaultToolDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    fetch: globalThis.fetch,
    checkUrl: (url) => assertPublicUrl(url),
    searchKnowledge: async (query, tenantId, botId, topK) => (await import('./knowledge-search.js')).searchKnowledge(query, tenantId, botId, topK),
    runWorkflow: async (workflowId, ctx) => (await import('./automation-engine.js')).runWorkflowNow(workflowId, ctx),
    runFunction: runFunctionCode,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    ...overrides,
  }
}

// ── Circuit breaker (per tool, per process) ──────────────────────────────────

interface Breaker { failures: number; openUntil: number }
const breakers = new Map<string, Breaker>()

export function resetCircuitBreakers(): void {
  breakers.clear()
}

function breakerOpen(toolId: string, now: number): boolean {
  const state = breakers.get(toolId)
  return Boolean(state && state.openUntil > now)
}

function recordOutcome(toolId: string, ok: boolean, limit: { failures: number; resetSeconds: number }, now: number): void {
  if (ok) { breakers.delete(toolId); return }
  const state = breakers.get(toolId) ?? { failures: 0, openUntil: 0 }
  state.failures += 1
  if (state.failures >= limit.failures) {
    state.openUntil = now + limit.resetSeconds * 1000
    state.failures = 0
  }
  breakers.set(toolId, state)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parametersOf(tool: RunnableTool): ToolParameter[] {
  return Array.isArray(tool.parameters) ? (tool.parameters as ToolParameter[]) : []
}

function configOf(tool: RunnableTool): Record<string, unknown> {
  return (tool.config && typeof tool.config === 'object' ? tool.config : {}) as Record<string, unknown>
}

function clip(value: unknown): unknown {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  if (text.length <= OUTPUT_LIMIT) return value
  return { truncated: true, preview: text.slice(0, OUTPUT_LIMIT) }
}

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function statusHint(status: number): string {
  if (status === 401) return 'The service refused the credentials (401). Check the secret on the Auth Profile.'
  if (status === 403) return 'The service says this account may not do that (403). Check the permissions behind the Auth Profile.'
  if (status === 404) return 'The service could not find that address (404). Check the URL and the values filled into it.'
  if (status === 400 || status === 422) return `The service rejected the request (${status}). Check the body and the parameters.`
  if (status === 429) return 'The service is rate limiting this tool (429). Try again shortly.'
  return `The service answered ${status}.`
}

// ── Kinds ────────────────────────────────────────────────────────────────────

async function runHttp(tool: RunnableTool, args: Record<string, unknown>, auth: AppliedAuth, deps: ToolDeps): Promise<Omit<ToolResult, 'durationMs'>> {
  const http = httpConfig(configOf(tool))
  const now = deps.now()
  if (breakerOpen(tool.id, now)) {
    return { ok: false, output: null, error: `Paused after ${http.circuitBreaker.failures} failures in a row. It tries again after ${http.circuitBreaker.resetSeconds} seconds.`, attempts: 0 }
  }
  const url = new URL(fillToolTemplate(http.url, args, true))
  for (const [key, value] of Object.entries(auth.query)) url.searchParams.set(key, value)
  await deps.checkUrl(url.toString())

  const headers: Record<string, string> = { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5' }
  for (const [key, value] of Object.entries(http.headers)) headers[key] = fillToolTemplate(value, args)
  Object.assign(headers, auth.headers)
  const sendsBody = http.method !== 'GET' && http.method !== 'DELETE'
  let body: string | undefined
  if (sendsBody) {
    body = JSON.stringify(http.body.trim() ? fillJsonTemplate(http.body, args) : args)
    headers['Content-Type'] = 'application/json'
  }
  if (http.idempotencyHeader && http.method !== 'GET') headers[http.idempotencyHeader] = randomUUID()

  const mayRetry = tool.effect === 'read' || Boolean(http.idempotencyHeader && http.method !== 'GET')
  const maxAttempts = mayRetry ? 1 + http.retries : 1
  let attempts = 0
  let last: Omit<ToolResult, 'durationMs'> = { ok: false, output: null, error: 'The tool did not run.', attempts: 0 }
  while (attempts < maxAttempts) {
    attempts++
    try {
      const res = await deps.fetch(url, { method: http.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(http.timeoutMs) })
      const text = await res.text()
      let output: unknown = text
      if ((res.headers.get('content-type') ?? '').includes('json') && text) {
        try { output = JSON.parse(text) } catch { output = text }
      }
      last = res.ok
        ? { ok: true, output: clip(output), status: res.status, attempts }
        : { ok: false, output: clip(output), status: res.status, error: statusHint(res.status), attempts }
      if (res.ok || !retryable(res.status)) break
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      last = { ok: false, output: null, error: timedOut ? `No answer within ${Math.round(http.timeoutMs / 1000)} seconds.` : `Could not reach the service: ${err instanceof Error ? err.message : String(err)}`, attempts }
    }
    if (attempts < maxAttempts) await deps.sleep(250 * 2 ** (attempts - 1))
  }
  recordOutcome(tool.id, last.ok || (last.status !== undefined && !retryable(last.status)), http.circuitBreaker, deps.now())
  return last
}

async function runMcp(tool: RunnableTool, args: Record<string, unknown>, auth: AppliedAuth, deps: ToolDeps): Promise<Omit<ToolResult, 'durationMs'>> {
  const config = configOf(tool)
  const serverUrl = new URL(String(config['serverUrl'] ?? ''))
  for (const [key, value] of Object.entries(auth.query)) serverUrl.searchParams.set(key, value)
  const transport: McpTransport = { fetch: deps.fetch, checkUrl: deps.checkUrl, headers: auth.headers, timeoutMs: 30_000 }
  const result = await mcpCallTool(serverUrl.toString(), String(config['toolName'] ?? ''), args, transport)
  return result.isError
    ? { ok: false, output: clip(result.output), error: 'The MCP tool reported an error.', attempts: 1 }
    : { ok: true, output: clip(result.output), attempts: 1 }
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function runTool(tool: RunnableTool, rawArgs: Record<string, unknown> | undefined, ctx: ToolRunContext, deps: ToolDeps = defaultToolDeps()): Promise<ToolResult> {
  const started = deps.now()
  const done = (result: Omit<ToolResult, 'durationMs'>): ToolResult => ({ ...result, durationMs: Math.max(0, deps.now() - started) })

  const checked = checkToolArgs(parametersOf(tool), rawArgs)
  if (!checked.ok) return done({ ok: false, output: null, error: checked.errors.join(' '), attempts: 0 })
  const args = checked.value

  if ((ctx.source === 'test_chat' || ctx.source === 'eval') && toolChangesData(tool.effect)) {
    return done({ ok: true, skipped: true, output: { skipped: true, reason: `${tool.name} changes data, so test chats do not run it.` }, attempts: 0 })
  }

  let auth: AppliedAuth = { headers: {}, query: {} }
  const finish = (result: Omit<ToolResult, 'durationMs'>): ToolResult => done(auth.secret
    ? { ...result, output: scrubJson(result.output, auth.secret), error: result.error && scrubValues(result.error, [auth.secret]) }
    : result)
  try {
    auth = applyAuthProfile(tool.authProfile)
    const config = configOf(tool)
    switch (tool.kind) {
      case 'http':
        return finish(await runHttp(tool, args, auth, deps))
      case 'mcp':
        return finish(await runMcp(tool, args, auth, deps))
      case 'knowledge': {
        const topK = Math.min(10, Math.max(1, Number(config['topK'] ?? 4) || 4))
        const chunks = await deps.searchKnowledge(String(args['query'] ?? ''), tool.tenantId, tool.botId, topK)
        return finish({ ok: true, output: { found: chunks.length > 0, chunks }, attempts: 1 })
      }
      case 'workflow': {
        const output = await deps.runWorkflow(String(config['workflowId'] ?? ''), { tenantId: tool.tenantId, botId: tool.botId, conversationId: ctx.conversationId })
        return finish({ ok: true, output, attempts: 1 })
      }
      case 'function': {
        const run = await deps.runFunction(String(config['code'] ?? ''), args, Number(config['timeoutMs'] ?? 2_000))
        return finish(run.ok ? { ok: true, output: clip(run.output), attempts: 1 } : { ok: false, output: null, error: run.error, attempts: 1 })
      }
      default:
        return finish({ ok: false, output: null, error: `Tool type "${tool.kind}" cannot run.`, attempts: 0 })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return done({ ok: false, output: null, error: scrubValues(message, [auth.secret]), attempts: 1 })
  }
}

/** Arguments as stored on a run: secrets from the profile removed. */
function scrubJson(value: unknown, secret: string): unknown {
  if (value === undefined) return value
  return JSON.parse(scrubValues(JSON.stringify(value), [secret, JSON.stringify(secret).slice(1, -1)]))
}
