import type { Redis, RedisOptions } from 'ioredis'

/**
 * Shared state that every API replica must agree on lives in Valkey: Inbox
 * broadcasts, the inbound replay window and rate-limit counters. Commands fail
 * fast while Valkey is down (no offline queue), so callers fall back to their
 * in-process behaviour instead of hanging a request.
 *
 * Shared state is used only when REDIS_URL is set. Tests and a plain
 * `pnpm dev` without Valkey keep the in-process behaviour.
 */

export const KEY_PREFIX = 'botstudio:'

let client: Redis | null | undefined

export function valkeyUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return env['REDIS_URL']?.trim() || null
}

async function connect(url: string, options: RedisOptions = {}): Promise<Redis> {
  const ioredis = await import('ioredis')
  const IORedis = (ioredis.default ?? ioredis) as unknown as new (url: string, opts: RedisOptions) => Redis
  const redis = new IORedis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    retryStrategy: (times) => Math.min(times * 500, 5000),
    ...options,
  })
  redis.on('error', (err) => logOnce(`[valkey] ${err.message}`))
  return redis
}

let lastLogged = ''
function logOnce(message: string) {
  if (message === lastLogged) return
  lastLogged = message
  console.error(message)
}

/** The shared command connection, or null when REDIS_URL is not set. */
export async function getValkey(): Promise<Redis | null> {
  if (client !== undefined) return client
  const url = valkeyUrl()
  client = url ? await connect(url) : null
  return client
}

/** A dedicated connection for SUBSCRIBE, which cannot share the command connection. */
export async function createSubscriber(): Promise<Redis | null> {
  const url = valkeyUrl()
  return url ? connect(url, { enableOfflineQueue: true, maxRetriesPerRequest: null }) : null
}

export function isReady(redis: Redis | null): redis is Redis {
  return Boolean(redis) && redis!.status === 'ready'
}
