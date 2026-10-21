import type { FastifyInstance, FastifyRequest } from 'fastify'
import { KEY_PREFIX, createSubscriber, getValkey, isReady } from './lib/valkey.js'

type WsClient = {
  send(data: string): void
  readyState: number
  on(event: string, cb: (data: Buffer | string) => void): void
}
const WS_OPEN = 1

// Tenant → set of open sockets on this process
const clients = new Map<string, Set<WsClient>>()

function deliverLocal(tenantId: string, payload: string): void {
  for (const ws of clients.get(tenantId) ?? []) {
    try {
      if (ws?.readyState === WS_OPEN) ws.send(payload)
    } catch { /* ignore dead socket */ }
  }
}

/**
 * Carries broadcasts between processes. With several API replicas a socket is
 * open on only one of them, so every event goes through Valkey pub/sub and each
 * replica delivers it to its own sockets. Without a ready transport, events go
 * straight to this process's sockets.
 */
export interface BroadcastTransport {
  ready(): boolean
  publish(message: string): Promise<unknown>
  onMessage(handler: (message: string) => void): void
}

let transport: BroadcastTransport | null = null

export function useBroadcastTransport(next: BroadcastTransport | null): void {
  transport = next
  next?.onMessage((message) => {
    try {
      const { tenantId, payload } = JSON.parse(message) as { tenantId: string; payload: string }
      if (typeof tenantId === 'string' && typeof payload === 'string') deliverLocal(tenantId, payload)
    } catch { /* not ours */ }
  })
}

export const BROADCAST_CHANNEL = `${KEY_PREFIX}inbox-events`

/**
 * API processes subscribe and deliver; a worker only publishes. Returns false
 * when REDIS_URL is not set, in which case broadcasts stay in this process.
 */
export async function startBroadcastRelay(options: { subscribe: boolean }): Promise<boolean> {
  const publisher = await getValkey()
  if (!publisher) return false
  const subscriber = options.subscribe ? await createSubscriber() : null
  const handlers: Array<(message: string) => void> = []
  if (subscriber) {
    subscriber.on('message', (_channel: string, message: string) => { for (const h of handlers) h(message) })
    void subscriber.subscribe(BROADCAST_CHANNEL).catch((err: Error) => console.error('[ws] subscribe failed:', err.message))
  }
  useBroadcastTransport({
    ready: () => isReady(publisher) && (!subscriber || isReady(subscriber)),
    publish: (message) => publisher.publish(BROADCAST_CHANNEL, message),
    onMessage: (handler) => { handlers.push(handler) },
  })
  return true
}

/** Broadcast a JSON-serialisable event to every WS client for a given tenant. Never throws. */
export function broadcastToTenant(tenantId: string, event: object): void {
  let payload: string
  try { payload = JSON.stringify(event) } catch { return }
  if (transport?.ready()) {
    transport.publish(JSON.stringify({ tenantId, payload })).catch(() => deliverLocal(tenantId, payload))
    return
  }
  deliverLocal(tenantId, payload)
}

/** Open sockets for a tenant on this process. */
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
