/**
 * Minimal MCP client over Streamable HTTP: initialize, list tools, call one.
 * Tool definitions are fetched when a person configures the tool and refreshed
 * by hand; nothing syncs them in the background.
 */

const PROTOCOL_VERSION = '2025-06-18'

export interface McpToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpTransport {
  fetch: typeof fetch
  /** Throws when the address may not be called. */
  checkUrl: (url: string) => Promise<unknown>
  headers: Record<string, string>
  timeoutMs: number
}

interface RpcResponse {
  id?: number | string
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

function parseBody(text: string, contentType: string, id: number): RpcResponse | undefined {
  if (contentType.includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!data) continue
      try {
        const message = JSON.parse(data) as RpcResponse
        if (message.id === id) return message
      } catch { /* keep reading */ }
    }
    return undefined
  }
  if (!text.trim()) return undefined
  const parsed = JSON.parse(text) as RpcResponse | RpcResponse[]
  return Array.isArray(parsed) ? parsed.find((message) => message.id === id) : parsed
}

class McpSession {
  private nextId = 1
  private sessionId: string | undefined

  constructor(private url: string, private transport: McpTransport) {}

  private async post(body: Record<string, unknown>): Promise<Response> {
    await this.transport.checkUrl(this.url)
    return this.transport.fetch(this.url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(this.transport.timeoutMs),
      headers: {
        ...this.transport.headers,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': PROTOCOL_VERSION,
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++
    const res = await this.post({ jsonrpc: '2.0', id, method, params })
    const session = res.headers.get('mcp-session-id')
    if (session) this.sessionId = session
    const text = await res.text()
    if (res.status === 401 || res.status === 403) throw new Error(`The MCP server refused the credentials (${res.status}). Check the Auth Profile on this tool.`)
    if (!res.ok) throw new Error(`The MCP server answered ${res.status} to ${method}.`)
    const message = parseBody(text, res.headers.get('content-type') ?? '', id)
    if (!message) throw new Error(`The MCP server sent no answer to ${method}.`)
    if (message.error) throw new Error(`The MCP server rejected ${method}: ${message.error.message}`)
    return message.result ?? {}
  }

  async notify(method: string): Promise<void> {
    const res = await this.post({ jsonrpc: '2.0', method })
    await res.text().catch(() => '')
  }

  async open(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'BotStudio', version: '1.0.0' },
    })
    await this.notify('notifications/initialized')
  }
}

export async function mcpListTools(serverUrl: string, transport: McpTransport): Promise<McpToolInfo[]> {
  const session = new McpSession(serverUrl, transport)
  await session.open()
  const tools: McpToolInfo[] = []
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const result = await session.request('tools/list', cursor ? { cursor } : {})
    for (const tool of (result['tools'] as Array<Record<string, unknown>> | undefined) ?? []) {
      tools.push({
        name: String(tool['name'] ?? ''),
        description: String(tool['description'] ?? ''),
        inputSchema: (tool['inputSchema'] as Record<string, unknown>) ?? { type: 'object', properties: {} },
      })
    }
    cursor = typeof result['nextCursor'] === 'string' ? result['nextCursor'] : undefined
    if (!cursor) break
  }
  return tools.filter((tool) => tool.name)
}

export interface McpCallResult {
  isError: boolean
  output: unknown
}

export async function mcpCallTool(serverUrl: string, toolName: string, args: Record<string, unknown>, transport: McpTransport): Promise<McpCallResult> {
  const session = new McpSession(serverUrl, transport)
  await session.open()
  const result = await session.request('tools/call', { name: toolName, arguments: args })
  const structured = result['structuredContent']
  const content = (result['content'] as Array<Record<string, unknown>> | undefined) ?? []
  const text = content.filter((part) => part['type'] === 'text').map((part) => String(part['text'] ?? '')).join('\n')
  let output: unknown = structured ?? text
  if (structured === undefined && text) {
    try { output = JSON.parse(text) } catch { output = text }
  }
  return { isError: result['isError'] === true, output }
}
