import type { FastifyInstance, FastifyRequest } from 'fastify'

type WsClient = {
  send(data: string): void
  readyState: number
  on(event: string, cb: (data: Buffer | string) => void): void
}
const WS_OPEN = 1

// Tenant → set of open sockets
const clients = new Map<string, Set<WsClient>>()

/** Broadcast a JSON-serialisable event to every WS client for a given tenant. Never throws. */
export function broadcastToTenant(tenantId: string, event: object): void {
  let payload: string
  try { payload = JSON.stringify(event) } catch { return }
  for (const ws of clients.get(tenantId) ?? []) {
    try {
      if (ws?.readyState === WS_OPEN) ws.send(payload)
    } catch { /* ignore dead socket */ }
  }
}

/** Open sockets for a tenant. */
export function tenantSocketCount(tenantId: string): number {
  return clients.get(tenantId)?.size ?? 0
}

function isSocket(value: unknown): value is WsClient {
  return Boolean(value) && typeof (value as WsClient).send === 'function' && typeof (value as WsClient).on === 'function'
}

/** @fastify/websocket 11 passes the socket itself; older versions wrapped it as { socket }. */
function socketOf(connection: unknown): WsClient | null {
  if (isSocket(connection)) return connection
  const wrapped = (connection as { socket?: unknown } | null)?.socket
  return isSocket(wrapped) ? wrapped : null
}

export async function wsRoutes(app: FastifyInstance) {
  // @ts-ignore — websocket handler type provided by @fastify/websocket
  app.get('/ws', { websocket: true }, (connection: unknown, request: FastifyRequest) => {
    const socket = socketOf(connection)
    if (!socket) {
      request.log.error('websocket handler got no socket')
      return
    }
    const token = (request.query as Record<string, string>)['token']
    let tenantId = ''

    try {
      const decoded = app.jwt.verify<{ tenantId: string }>(token ?? '')
      tenantId = decoded.tenantId
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }))
      return
    }

    if (!clients.has(tenantId)) clients.set(tenantId, new Set())
    clients.get(tenantId)!.add(socket)

    socket.send(JSON.stringify({ type: 'connected', tenantId }))

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string }
        if (msg.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }))
      } catch { /* ignore */ }
    })

    socket.on('close', () => {
      clients.get(tenantId)?.delete(socket)
    })
  })
}
