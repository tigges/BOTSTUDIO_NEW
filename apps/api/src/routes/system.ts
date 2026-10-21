import type { FastifyInstance } from 'fastify'
import { prisma } from '@ybot/db'
import { requireRole } from '../middleware/auth.js'
import * as os from 'node:os'
import { DEFAULT_MODELS, currentModelId, llmChain } from '@ybot/llm'
import { isKnownDefault, productionSecretProblems } from '../lib/production-secrets.js'
import { backgroundProblems, liveWorkers, processRole } from '../background.js'
import { queueHealth } from '../queues.js'
import { dockerRequest } from '../lib/docker.js'

function llmOrder(): string {
  const links = llmChain()
  if (links.length === 0) return 'nothing set (Ollama on localhost)'
  return links.map((link) => `${link.label} (${link.model})`).join(' → ')
}


async function pingDb() {
  const t0 = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return { ok: true, latencyMs: Date.now() - t0 }
  } catch {
    return { ok: false, latencyMs: -1 }
  }
}

async function pingRedis() {
  const t0 = Date.now()
  try {
    const ioredis = await import('ioredis')
    const IORedis = ioredis.default ?? (ioredis as unknown as new (url: string, opts: object) => import('ioredis').Redis)
    const r = new (IORedis as unknown as new (url: string, opts: object) => import('ioredis').Redis)(
      process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      { connectTimeout: 2000, lazyConnect: true },
    )
    await (r as import('ioredis').Redis & { connect(): Promise<void> }).connect()
    await r.ping()
    r.disconnect()
    return { ok: true, latencyMs: Date.now() - t0 }
  } catch {
    return { ok: false, latencyMs: -1 }
  }
}

async function seedAuthorized(app: FastifyInstance, authorization: string | undefined): Promise<boolean> {
  const secret = process.env['SEED_DEMO_SECRET']
  if (secret && authorization === `Bearer ${secret}`) return true
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  if (token && token !== secret) {
    try {
      const payload = await app.jwt.verify<{ role?: string }>(token)
      if (payload.role === 'ADMIN') return true
    } catch {
      // Not a valid admin session. Fall through.
    }
  }
  return process.env['NODE_ENV'] !== 'production' && !secret
}

export async function systemRoutes(app: FastifyInstance) {
  // Public. A hook on this plugin used to force a token on every route,
  // including this one.
  app.get('/version', async () => {
    const e = process.env
    return {
      data: {
        version:     e['APP_VERSION']      ?? '1.1.0',
        buildNumber: e['APP_BUILD_NUMBER'] ?? 'local',
        gitSha:      e['APP_GIT_SHA']      ?? 'dev',
        buildDate:   e['APP_BUILD_DATE']   ?? new Date().toISOString(),
        environment: e['NODE_ENV']         ?? 'development',
      },
    }
  })

  async function runEnsure(authorization: string | undefined, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
    if (!(await seedAuthorized(app, authorization))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Admin login or SEED_DEMO_SECRET is required' } })
    }
    const { ensureDemos } = await import('../scripts/ensure-demos.js')
    return { data: await ensureDemos() }
  }

  // Fills missing Acme and Bella demo data. Safe to call more than once.
  app.post('/ensure-demos', async (request, reply) => {
    try {
      return await runEnsure(request.headers.authorization, reply)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      request.log.error({ err }, 'ensure-demos failed')
      return reply.status(500).send({ error: { code: 'SEED_FAILED', message: msg } })
    }
  })

  // Old path. Same idempotent fill, so it no longer appends 240 chats.
  app.post('/seed-demo', async (request, reply) => {
    try {
      return await runEnsure(request.headers.authorization, reply)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      request.log.error({ err }, 'seed-demo failed')
      return reply.status(500).send({ error: { code: 'SEED_FAILED', message: msg } })
    }
  })

  // Inbox traffic only. Does not create or edit journeys, flows, or workflows.
  app.post('/demo-traffic', async (request, reply) => {
    if (!(await seedAuthorized(app, request.headers.authorization))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Admin login or SEED_DEMO_SECRET is required' } })
    }
    try {
      const { addDemoTraffic } = await import('../lib/demo-traffic.js')
      return { data: await addDemoTraffic() }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      request.log.error({ err }, 'demo-traffic failed')
      return reply.status(500).send({ error: { code: 'TRAFFIC_FAILED', message: msg } })
    }
  })

  await app.register(async function adminSystemRoutes(scope) {
    scope.addHook('preHandler', app.authenticate)
    scope.addHook('preHandler', requireRole('ADMIN'))
    scope.get('/status', statusHandler)
    scope.get('/config', configHandler)
  })
}

async function statusHandler() {
    const [db, redis, rawContainers, workers] = await Promise.all([
      pingDb(),
      pingRedis(),
      dockerRequest('/containers/json?all=1'),
      liveWorkers(),
    ])
    const role = processRole()
    const queues = queueHealth()

    const containers = Array.isArray(rawContainers)
      ? (rawContainers as Array<Record<string, unknown>>).map((c) => ({
          id: String(c['Id'] ?? '').slice(0, 12),
          name: (Array.isArray(c['Names']) && typeof c['Names'][0] === 'string')
            ? (c['Names'][0] as string).replace('/', '')
            : 'unknown',
          image: String(c['Image'] ?? ''),
          state: String(c['State'] ?? 'unknown'),
          status: String(c['Status'] ?? ''),
          created: c['Created'] as number | undefined,
        }))
      : []

    const [sources, totalChunks] = await Promise.all([
      prisma.knowledgeSource.findMany({
        select: { id: true, name: true, lastSyncAt: true, _count: { select: { documents: true } } },
      }).catch(() => []),
      prisma.documentChunk.count().catch(() => 0),
    ])

    return {
      data: {
        services: { database: db, redis },
        secretProblems: process.env['NODE_ENV'] === 'production'
          ? productionSecretProblems(process.env).map(({ key, message }) => ({ key, message }))
          : [],
        background: {
          role,
          workers,
          dropped: queues.dropped,
          problems: backgroundProblems({ valkeyOk: redis.ok, role, workers, dropped: queues.dropped, lastDrop: queues.lastDrop }),
        },
        containers,
        rag: {
          sources: sources.length,
          documents: (sources as Array<{ _count: { documents: number } }>)
            .reduce((s, x) => s + x._count.documents, 0),
          chunks: totalChunks,
          sourceList: sources,
        },
        system: {
          platform: os.platform(),
          uptime: Math.round(os.uptime()),
          nodeVersion: process.version,
          cpuCount: os.cpus().length,
          totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
          freeMemMb: Math.round(os.freemem() / 1024 / 1024),
          usedMemPct: Math.round((1 - os.freemem() / os.totalmem()) * 100),
        },
        ts: new Date().toISOString(),
        version: {
          version:     process.env['APP_VERSION']      ?? '1.1.0',
          buildNumber: process.env['APP_BUILD_NUMBER'] ?? 'local',
          gitSha:      process.env['APP_GIT_SHA']      ?? 'dev',
          buildDate:   process.env['APP_BUILD_DATE']   ?? new Date().toISOString(),
        },
      },
    }
}

async function configHandler() {
    const e = process.env
    function isSet(key: string) { return !!e[key] && !isKnownDefault(e[key]) }
    function maskUrl(url: string | undefined) {
      if (!url) return null
      try {
        const u = new URL(url)
        return `${u.protocol}//${u.hostname}:${u.port || (u.protocol === 'https:' ? 443 : 5432)}`
      } catch { return '(configured)' }
    }
    return {
      data: {
        auth: {
          JWT_SECRET: { set: isSet('JWT_SECRET'), label: 'JWT Secret' },
        },
        database: {
          DATABASE_URL: { set: isSet('DATABASE_URL'), label: 'PostgreSQL', endpoint: maskUrl(e['DATABASE_URL']) },
        },
        cache: {
          REDIS_URL: { set: isSet('REDIS_URL'), label: 'Redis / Valkey', endpoint: maskUrl(e['REDIS_URL']) },
        },
        // Web builds before MinIO was dropped iterate over this group.
        storage: {},
        llm: {
          LLM_PROVIDER:      { set: true, label: `Tried in order: ${llmOrder()}`, value: e['LLM_PROVIDER'] || null },
          GEMINI_API_KEY:    { set: isSet('GEMINI_API_KEY'),    label: 'Gemini API Key', value: isSet('GEMINI_API_KEY') ? currentModelId(e['GEMINI_MODEL'] || DEFAULT_MODELS.gemini) : null },
          ANTHROPIC_API_KEY: { set: isSet('ANTHROPIC_API_KEY'), label: 'Claude (Anthropic) API Key', value: isSet('ANTHROPIC_API_KEY') ? currentModelId(e['ANTHROPIC_MODEL'] || DEFAULT_MODELS.anthropic) : null },
          OLLAMA_BASE_URL:   { set: isSet('OLLAMA_BASE_URL'),   label: 'Ollama Base URL', endpoint: e['OLLAMA_BASE_URL'] ?? null },
          OPENAI_API_KEY:    { set: isSet('OPENAI_API_KEY'),    label: 'OpenAI API Key' },
          GROQ_API_KEY:      { set: isSet('GROQ_API_KEY'),      label: 'Groq API Key' },
        },
        app: {
          NODE_ENV:     { set: true, label: 'Environment', value: e['NODE_ENV'] ?? 'development' },
          FRONTEND_URL: { set: isSet('FRONTEND_URL'), label: 'Frontend URL', value: e['FRONTEND_URL'] ?? null },
        },
      },
    }
}
