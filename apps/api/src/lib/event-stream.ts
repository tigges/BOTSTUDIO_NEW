import type { FastifyReply } from 'fastify'

export interface EventStream {
  /** Writes one `data:` event (and an `event:` line when named). Ignored once the guest has gone. */
  send(data: object, event?: string): void
  end(): void
}

/**
 * Server-Sent Events on a hijacked reply. Fastify no longer owns the response,
 * so an error after the first byte cannot make it write a second set of
 * headers (ERR_HTTP_HEADERS_SENT), which crashes the process. The route must
 * catch its own errors and end the stream.
 */
export function openEventStream(reply: FastifyReply, headers: Record<string, string> = {}): EventStream {
  reply.hijack()
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...headers,
  })
  reply.raw.flushHeaders?.()
  let open = true
  reply.raw.on('close', () => { open = false })
  reply.raw.on('error', () => { open = false })
  return {
    send(data, event) {
      if (!open || reply.raw.writableEnded) return
      reply.raw.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`)
    },
    end() {
      if (!reply.raw.writableEnded) reply.raw.end()
    },
  }
}
