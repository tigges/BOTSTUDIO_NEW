import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { openEventStream } from './event-stream.js'

test('a route that fails mid-stream ends the stream instead of crashing the server', async () => {
  const app = Fastify()
  const crashes: unknown[] = []
  const onUncaught = (err: unknown) => { crashes.push(err) }
  process.on('uncaughtException', onUncaught)
  try {
    app.post('/chat', async (_request, reply) => {
      const stream = openEventStream(reply, { 'Access-Control-Allow-Origin': '*' })
      try {
        stream.send({ conversationId: 'c1' })
        throw new Error('turn failed')
      } catch {
        stream.send({ chunk: 'Sorry' })
      } finally {
        stream.end()
      }
    })
    app.post('/escapes', async (_request, reply) => {
      const stream = openEventStream(reply)
      stream.send({ chunk: 'hi' })
      throw new Error('not caught by the route')
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`

    const res = await fetch(`${base}/chat`, { method: 'POST' })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'text/event-stream')
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.equal(await res.text(), 'data: {"conversationId":"c1"}\n\ndata: {"chunk":"Sorry"}\n\n')

    const escaped = await fetch(`${base}/escapes`, { method: 'POST' }).then((r) => r.status).catch(() => 'aborted')
    assert.ok(escaped === 200 || escaped === 'aborted')
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.deepEqual(crashes, [])

    const health = await fetch(`${base}/chat`, { method: 'POST' })
    assert.equal(health.status, 200)
    await health.text()
  } finally {
    process.off('uncaughtException', onUncaught)
    await app.close()
  }
})

test('named events carry an event line', async () => {
  const app = Fastify()
  app.post('/preview', async (_request, reply) => {
    const stream = openEventStream(reply)
    stream.send({ text: 'a' }, 'chunk')
    stream.end()
  })
  const res = await app.inject({ method: 'POST', url: '/preview' })
  assert.equal(res.body, 'event: chunk\ndata: {"text":"a"}\n\n')
  await app.close()
})
