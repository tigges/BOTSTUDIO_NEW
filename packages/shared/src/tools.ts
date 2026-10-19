/**
 * One Tools registry: HTTP, Functions, MCP, Knowledge and Workflow tools share
 * the same scaffold (name, model-facing description, typed parameters, return
 * type, declared effect). Credentials never live on a tool; a tool references
 * an Auth Profile by id.
 */

export const TOOL_KINDS = ['http', 'function', 'mcp', 'knowledge', 'workflow'] as const
export type ToolKind = (typeof TOOL_KINDS)[number]

export const TOOL_EFFECTS = ['read', 'write', 'side_effect'] as const
export type ToolEffect = (typeof TOOL_EFFECTS)[number]

export const TOOL_PARAM_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'] as const
export type ToolParamType = (typeof TOOL_PARAM_TYPES)[number]

export const AUTH_PROFILE_KINDS = ['api_key', 'bearer', 'basic', 'custom_header'] as const
export type AuthProfileKind = (typeof AUTH_PROFILE_KINDS)[number]

export const TOOL_KIND_LABELS: Record<ToolKind, string> = {
  http: 'HTTP',
  function: 'Function',
  mcp: 'MCP',
  knowledge: 'Knowledge',
  workflow: 'Workflow',
}

export const TOOL_EFFECT_LABELS: Record<ToolEffect, string> = {
  read: 'Reads data',
  write: 'Changes data',
  side_effect: 'Side effect',
}

export const AUTH_PROFILE_KIND_LABELS: Record<AuthProfileKind, string> = {
  api_key: 'API key',
  bearer: 'Bearer token',
  basic: 'Username and password',
  custom_header: 'Custom header',
}

export interface ToolParameter {
  name: string
  type: ToolParamType
  description: string
  required: boolean
  enum?: string[]
}

export interface ToolReturns {
  type: ToolParamType
  description: string
}

export interface HttpToolConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** `{{param}}` placeholders are filled and URL-encoded. */
  url: string
  headers: Record<string, string>
  /** JSON body template; `{{param}}` placeholders are filled. Empty sends the arguments as JSON. */
  body: string
  timeoutMs: number
  retries: number
  circuitBreaker: { failures: number; resetSeconds: number }
  /** Header that carries one key per call, kept the same across retries. Empty turns it off. */
  idempotencyHeader: string
}

export interface FunctionToolConfig {
  /** JavaScript defining `async function main(args)`. Runs without network or file access. */
  code: string
  timeoutMs: number
}

export interface McpToolConfig {
  serverUrl: string
  toolName: string
  /** The server's own input schema, as fetched. */
  inputSchema?: Record<string, unknown>
  fetchedAt?: string
}

export interface KnowledgeToolConfig {
  topK: number
}

export interface WorkflowToolConfig {
  workflowId: string
}

export type ToolConfig = HttpToolConfig | FunctionToolConfig | McpToolConfig | KnowledgeToolConfig | WorkflowToolConfig

export interface ToolDraft {
  name: string
  kind: ToolKind
  description: string
  parameters: ToolParameter[]
  returns: ToolReturns
  effect: ToolEffect
  config: Record<string, unknown>
  authProfileId?: string | null
}

export const HTTP_TOOL_DEFAULTS: HttpToolConfig = {
  method: 'GET',
  url: '',
  headers: {},
  body: '',
  timeoutMs: 30_000,
  retries: 2,
  circuitBreaker: { failures: 5, resetSeconds: 60 },
  idempotencyHeader: 'Idempotency-Key',
}

export const HTTP_TIMEOUT_MAX_MS = 120_000
export const FUNCTION_TIMEOUT_MAX_MS = 5_000

export function defaultToolConfig(kind: ToolKind): Record<string, unknown> {
  switch (kind) {
    case 'http': return { ...HTTP_TOOL_DEFAULTS, headers: {}, circuitBreaker: { ...HTTP_TOOL_DEFAULTS.circuitBreaker } }
    case 'function': return { code: 'async function main(args) {\n  return { ok: true, args }\n}\n', timeoutMs: 2_000 }
    case 'mcp': return { serverUrl: '', toolName: '' }
    case 'knowledge': return { topK: 4 }
    case 'workflow': return { workflowId: '' }
  }
}

export function httpConfig(config: Record<string, unknown> | null | undefined): HttpToolConfig {
  const raw = (config ?? {}) as Partial<HttpToolConfig>
  const breaker = (raw.circuitBreaker ?? {}) as Partial<HttpToolConfig['circuitBreaker']>
  return {
    method: (raw.method ?? HTTP_TOOL_DEFAULTS.method).toUpperCase() as HttpToolConfig['method'],
    url: String(raw.url ?? ''),
    headers: { ...(raw.headers ?? {}) },
    body: String(raw.body ?? ''),
    timeoutMs: clampNumber(raw.timeoutMs, 1_000, HTTP_TIMEOUT_MAX_MS, HTTP_TOOL_DEFAULTS.timeoutMs),
    retries: clampNumber(raw.retries, 0, 5, HTTP_TOOL_DEFAULTS.retries),
    circuitBreaker: {
      failures: clampNumber(breaker.failures, 1, 50, HTTP_TOOL_DEFAULTS.circuitBreaker.failures),
      resetSeconds: clampNumber(breaker.resetSeconds, 5, 3_600, HTTP_TOOL_DEFAULTS.circuitBreaker.resetSeconds),
    },
    idempotencyHeader: raw.idempotencyHeader === undefined ? HTTP_TOOL_DEFAULTS.idempotencyHeader : String(raw.idempotencyHeader),
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** The parameters as the JSON Schema the model sees. */
export function toolParametersSchema(parameters: ToolParameter[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const param of parameters) {
    properties[param.name] = {
      type: param.type,
      ...(param.description ? { description: param.description } : {}),
      ...(param.enum && param.enum.length > 0 ? { enum: param.enum } : {}),
    }
  }
  return {
    type: 'object',
    properties,
    required: parameters.filter((param) => param.required).map((param) => param.name),
    additionalProperties: false,
  }
}

/** Reads an MCP server's input schema back into typed parameters. */
export function parametersFromJsonSchema(schema: Record<string, unknown> | undefined): ToolParameter[] {
  const properties = (schema?.['properties'] ?? {}) as Record<string, Record<string, unknown>>
  const required = new Set(Array.isArray(schema?.['required']) ? (schema!['required'] as string[]) : [])
  return Object.entries(properties).map(([name, prop]) => {
    const rawType = Array.isArray(prop['type']) ? (prop['type'] as string[])[0] : prop['type']
    const type = (TOOL_PARAM_TYPES as readonly string[]).includes(String(rawType)) ? (rawType as ToolParamType) : 'string'
    const values = Array.isArray(prop['enum']) ? (prop['enum'] as unknown[]).map(String) : undefined
    return {
      name,
      type,
      description: String(prop['description'] ?? ''),
      required: required.has(name),
      ...(values ? { enum: values } : {}),
    }
  })
}

export interface ToolIssue {
  field: string
  message: string
}

const TOOL_NAME = /^[a-z][a-z0-9_]{1,63}$/
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
/** Header names that carry credentials. Those belong in an Auth Profile. */
const CREDENTIAL_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token)$|(token|secret|password|api[-_]?key)/i
const CREDENTIAL_QUERY = /[?&](api[-_]?key|access[-_]?token|token|secret|password|key)=(?!\{\{)/i

/** Everything that blocks saving a tool, naming the field to fix. */
export function toolIssues(tool: ToolDraft): ToolIssue[] {
  const issues: ToolIssue[] = []
  if (!TOOL_NAME.test(tool.name)) {
    issues.push({ field: 'name', message: 'Name: use 2–64 lowercase letters, digits or underscores, starting with a letter (for example lookup_order).' })
  }
  if (tool.description.trim().length < 20) {
    issues.push({ field: 'description', message: 'Description: write at least 20 characters. The bot reads it to decide when to use this tool.' })
  }
  if (!(TOOL_KINDS as readonly string[]).includes(tool.kind)) issues.push({ field: 'kind', message: 'Type: choose HTTP, Function, MCP, Knowledge or Workflow.' })
  if (!(TOOL_EFFECTS as readonly string[]).includes(tool.effect)) issues.push({ field: 'effect', message: 'Effect: choose Reads data, Changes data or Side effect.' })

  const seen = new Set<string>()
  tool.parameters.forEach((param, index) => {
    const where = `Parameter ${index + 1}`
    if (!PARAM_NAME.test(param.name)) issues.push({ field: `parameters.${index}.name`, message: `${where}: give it a name made of letters, digits or underscores.` })
    else if (seen.has(param.name)) issues.push({ field: `parameters.${index}.name`, message: `${where}: "${param.name}" is used twice.` })
    seen.add(param.name)
    if (!(TOOL_PARAM_TYPES as readonly string[]).includes(param.type)) issues.push({ field: `parameters.${index}.type`, message: `${where}: choose a type.` })
    if (!param.description.trim()) issues.push({ field: `parameters.${index}.description`, message: `${where}: describe "${param.name || 'this parameter'}" so the bot knows what to pass.` })
  })

  if (tool.kind === 'http') {
    const http = httpConfig(tool.config)
    if (!/^https?:\/\/\S+$/i.test(http.url.trim())) issues.push({ field: 'config.url', message: 'URL: enter the full address, starting with https://.' })
    if (CREDENTIAL_QUERY.test(http.url)) issues.push({ field: 'config.url', message: 'URL: remove the key from the address and choose an Auth Profile instead.' })
    for (const name of Object.keys(http.headers)) {
      if (CREDENTIAL_HEADER.test(name)) issues.push({ field: `config.headers.${name}`, message: `Header "${name}": credentials go in an Auth Profile, not on the tool.` })
    }
    if (http.body.trim()) {
      try { fillJsonTemplate(http.body, {}) } catch { issues.push({ field: 'config.body', message: 'Body: this is not valid JSON once the {{placeholders}} are filled.' }) }
    }
    for (const name of templateNames(`${http.url} ${http.body} ${Object.values(http.headers).join(' ')}`)) {
      if (!seen.has(name)) issues.push({ field: 'config', message: `{{${name}}} is not a parameter. Add a parameter called ${name} or remove the placeholder.` })
    }
  }
  if (tool.kind === 'function') {
    const code = String(tool.config['code'] ?? '')
    if (!/\bfunction\s+main\s*\(|\bmain\s*=\s*(async\s*)?\(/.test(code)) issues.push({ field: 'config.code', message: 'Code: define async function main(args) and return the result.' })
  }
  if (tool.kind === 'mcp') {
    if (!/^https?:\/\/\S+$/i.test(String(tool.config['serverUrl'] ?? ''))) issues.push({ field: 'config.serverUrl', message: 'MCP server: enter the server URL, starting with https://.' })
    if (!String(tool.config['toolName'] ?? '').trim()) issues.push({ field: 'config.toolName', message: 'MCP tool: fetch the server’s tools and pick one.' })
  }
  if (tool.kind === 'workflow' && !String(tool.config['workflowId'] ?? '').trim()) {
    issues.push({ field: 'config.workflowId', message: 'Workflow: choose the workflow this tool runs.' })
  }
  if (tool.kind === 'knowledge' && !tool.parameters.some((param) => param.name === 'query')) {
    issues.push({ field: 'parameters', message: 'Knowledge tools need a "query" parameter: the question to search for.' })
  }
  return issues
}

export function templateNames(text: string): string[] {
  const names = new Set<string>()
  for (const match of text.matchAll(/\{\{\s*([\w]+)(?:\.[\w.]+)?\s*\}\}/g)) names.add(match[1]!)
  return [...names]
}

export interface ArgsCheck {
  ok: boolean
  value: Record<string, unknown>
  errors: string[]
}

/** Checks and coerces call arguments against the declared parameters. */
export function checkToolArgs(parameters: ToolParameter[], args: Record<string, unknown> | null | undefined): ArgsCheck {
  const input = args ?? {}
  const value: Record<string, unknown> = {}
  const errors: string[] = []
  for (const param of parameters) {
    const raw = input[param.name]
    if (raw === undefined || raw === null || raw === '') {
      if (param.required) errors.push(`${param.name} is required.`)
      continue
    }
    const coerced = coerce(param.type, raw)
    if (coerced === undefined) {
      errors.push(`${param.name} must be ${param.type === 'integer' ? 'a whole number' : `a ${param.type}`}.`)
      continue
    }
    if (param.enum && param.enum.length > 0 && !param.enum.includes(String(coerced))) {
      errors.push(`${param.name} must be one of: ${param.enum.join(', ')}.`)
      continue
    }
    value[param.name] = coerced
  }
  const known = new Set(parameters.map((param) => param.name))
  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors.push(`${key} is not a parameter of this tool.`)
  }
  return { ok: errors.length === 0, value, errors }
}

function coerce(type: ToolParamType, raw: unknown): unknown {
  switch (type) {
    case 'string': return typeof raw === 'string' ? raw : typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : undefined
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
      return Number.isFinite(n) ? n : undefined
    }
    case 'integer': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
      return Number.isInteger(n) ? n : undefined
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw
      if (raw === 'true') return true
      if (raw === 'false') return false
      return undefined
    case 'object':
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
      if (typeof raw === 'string') { try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined } catch { return undefined } }
      return undefined
    case 'array':
      if (Array.isArray(raw)) return raw
      if (typeof raw === 'string') { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : undefined } catch { return undefined } }
      return undefined
  }
}

/** Fills `{{param}}` placeholders. `encode` URL-encodes each value (for URLs). */
export function fillToolTemplate(template: string, args: Record<string, unknown>, encode = false): string {
  return template.replace(/\{\{\s*([\w]+)((?:\.[\w]+)*)\s*\}\}/g, (_whole, name: string, path: string) => {
    let value: unknown = args[name]
    for (const key of path.split('.').filter(Boolean)) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
    if (value === undefined || value === null) return ''
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return encode ? encodeURIComponent(text) : text
  })
}

/** Fills a JSON body template so every value lands as valid JSON. */
export function fillJsonTemplate(template: string, args: Record<string, unknown>): unknown {
  const MARK = '\uE000'
  let out = ''
  let inString = false
  for (let i = 0; i < template.length; i++) {
    const ch = template[i]!
    if (inString && ch === '\\') { out += ch + (template[i + 1] ?? ''); i++; continue }
    if (ch === '"') { inString = !inString; out += ch; continue }
    const match = /^\{\{\s*([\w]+)\s*\}\}/.exec(template.slice(i))
    if (match) {
      out += inString ? `${MARK}${match[1]}${MARK}` : `"${MARK}${match[1]}${MARK}"`
      i += match[0].length - 1
      continue
    }
    out += ch
  }
  const whole = new RegExp(`^${MARK}(\\w+)${MARK}$`)
  const inside = new RegExp(`${MARK}(\\w+)${MARK}`, 'g')
  const fill = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const exact = whole.exec(node)
      if (exact) return args[exact[1]!] ?? null
      return node.replace(inside, (_m, name: string) => {
        const value = args[name]
        return value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
      })
    }
    if (Array.isArray(node)) return node.map(fill)
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v)]))
    return node
  }
  return fill(JSON.parse(out))
}

/** Tools that change data do not run in test chats or eval runs. */
export function toolChangesData(effect: string): boolean {
  return effect === 'write' || effect === 'side_effect'
}
