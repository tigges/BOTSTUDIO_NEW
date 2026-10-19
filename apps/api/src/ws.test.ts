import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import wsPlugin from '@fastify/websocket'
import { broadcastToTenant, tenantSocketCount, wsRoutes } from './ws.js'

type Inbox = { ws: import('ws').WebSocket; next(): Promise<Record<string, unknown>> }

/** Opens a socket that keeps every message, including ones sent before the open event resolves. */
async function connect(app: Awaited<ReturnType<typeof socketApp>>, path: string): Promise<Inbox> {
  const queue: string[] = []
  const waiting: Array<(text: string) => void> = []
  const ws = await app.injectWS(path, {}, {
    onInit: (socket) => socket.on('message', (data) => {
      const text = String(data)
      const take = waiting.shift()
      if (take) take(text)
      else queue.push(text)
    }),
  })
  const next = () => new Promise<Record<string, unknown>>((resolve) => {
    const text = queue.shift()
    if (text !== undefined) resolve(JSON.parse(text))
    else waiting.push((t) => resolve(JSON.parse(t)))
  })
  return { ws, next }
}

async function socketApp() {
  const app = Fastify()
  await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' })
  await app.register(wsPlugin)
  await app.register(wsRoutes)
  await app.ready()
  return app
}

test('an Inbox socket connects, receives tenant broadcasts and leaves cleanly', async () => {
  const app = await socketApp()
  const token = app.jwt.sign({ tenantId: 't-ws' })
  const { ws, next } = await connect(app, `/ws?token=${token}`)
  assert.deepEqual(await next(), { type: 'connected', tenantId: 't-ws' })
  assert.equal(tenantSocketCount('t-ws'), 1)

  broadcastToTenant('t-ws', { event: 'message.created', data: { id: 'm1' } })
  assert.deepEqual(await next(), { event: 'message.created', data: { id: 'm1' } })

  ws.terminate()
  await once(ws, 'close')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(tenantSocketCount('t-ws'), 0)
  await app.close()
})

test('a broadcast never throws, even with a bad token socket or an unserialisable event', async () => {
  const app = await socketApp()
  const { ws, next } = await connect(app, '/ws?token=nope')
  assert.equal((await next())['message'], 'Unauthorized')
  assert.equal(tenantSocketCount(''), 0)
  const loop: Record<string, unknown> = {}
  loop['self'] = loop
  assert.doesNotThrow(() => broadcastToTenant('t-none', { event: 'x' }))
  assert.doesNotThrow(() => broadcastToTenant('t-ws', loop))
  ws.terminate()
  await app.close()
})
