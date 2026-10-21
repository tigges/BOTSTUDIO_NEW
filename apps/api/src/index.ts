import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import wsPlugin from '@fastify/websocket'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import { authRoutes } from './routes/auth.js'
import { meRoutes } from './routes/me.js'
import { botsRoutes } from './routes/bots.js'
import { tenantsRoutes } from './routes/tenants.js'
import { flowsRoutes } from './routes/flows.js'
import { knowledgeRoutes } from './routes/knowledge.js'
import { botSettingsRoutes } from './routes/bot-settings.js'
import { conversationsRoutes, ticketsRoutes, contactsRoutes } from './routes/inbox.js'
import { campaignsRoutes, templatesRoutes } from './routes/engage.js'
import { channelsRoutes, webhooksRoutes, teamRoutes, analyticsRoutes, auditRoutes } from './routes/config.js'
import { draftPreviewRoutes, previewRoutes } from './routes/preview.js'
import { widgetRoutes } from './routes/widget.js'
import { testRunRoutes } from './routes/test-runs.js'
import { channelWebhookRoutes } from './routes/channel-webhooks.js'
import { optimizationRoutes } from './routes/optimizations.js'
import { workflowsRoutes } from './routes/workflows.js'
import { dashboardsRoutes } from './routes/dashboards.js'
import { installLlmLedger, withLlmScope } from './lib/llm-ledger.js'
import { setTurnBroadcast } from './lib/turn-pipeline.js'
import { systemRoutes } from './routes/system.js'
import { cannedRoutes, reportsRoutes, databaseRoutes, integrationsRoutes, INTEGRATION_CATALOG } from './routes/studio.js'
import { toolsRoutes, authProfilesRoutes } from './routes/tools.js'
import { authMiddleware } from './middleware/auth.js'
import { wsRoutes, broadcastToTenant, startBroadcastRelay } from './ws.js'
import { processRole, startBackgroundWork } from './background.js'
import { initQueues } from './queues.js'
import { runWithAuditContext } from '@ybot/db'
import { installConsoleScrubbing, scrubbingLoggerOptions } from './lib/log-scrub.js'
import { installLlmPrivacy } from './lib/privacy.js'
import { safetyRoutes } from './routes/safety.js'
import { evalsRoutes } from './routes/evals.js'
import { releasesRoutes } from './routes/releases.js'
import { bundleRoutes } from './routes/bundle.js'
import { botMemoryRoutes, contactMemoryRoutes } from './routes/memory.js'
import { businessRoutes } from './routes/business.js'
import { assertProductionSecrets } from './lib/production-secrets.js'
import { KEY_PREFIX, getValkey } from './lib/valkey.js'
import { SESSION_COOKIE, adoptLegacySessionCookie } from './lib/session-cookie.js'

installConsoleScrubbing()
assertProductionSecrets()

const PORT = parseInt(process.env['PORT'] ?? '3001', 10)
const HOST = process.env['HOST'] ?? '0.0.0.0'
const JWT_SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-me'

const isDev = process.env['NODE_ENV'] !== 'production'

const app = Fastify({
  // Trust X-Forwarded-Proto from reverse proxies (Cloudflare Tunnel, nginx, etc.)
  // so that request.protocol returns "https" when the user reaches us via HTTPS.
  trustProxy: true,
  logger: isDev
    ? { ...scrubbingLoggerOptions(), transport: { target: 'pino-pretty', options: { colorize: true } } }
    : scrubbingLoggerOptions(),
})

// Each request gets its own context, so the audit actor and LLM scope set later never leak into another request.
app.addHook('onRequest', (_request, _reply, done) => { runWithAuditContext(done) })

// Reflect the caller's origin. The website widget is embedded on the marketing
// site and on customer sites, so a single FRONTEND_URL blocks those chats in the
// browser. The channel allowlist still decides who may use a widget.
await app.register(cors, {
  origin: true,
  credentials: true,
})

// ── Rate limiting ──────────────────────────────────────────────────────────
// The console opens many screens in a minute. Login and the public chat keep
// their own tighter limits. A full limit answers 429, so a burst is not a crash.
// Counters live in Valkey so every replica counts the same caller together;
// while Valkey is unreachable requests are let through rather than refused.
const rateLimitStore = await getValkey()
await app.register(rateLimit, {
  global: true,
  ...(rateLimitStore ? { redis: rateLimitStore, nameSpace: `${KEY_PREFIX}rate-limit:`, skipOnError: true } : {}),
  max: 1200,
  timeWindow: '1 minute',
  keyGenerator: (req) =>
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip,
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: {
      code: 'RATE_LIMITED',
      message: `Too many requests — try again in ${Math.ceil((context.ttl ?? 60000) / 1000)}s`,
    },
  }),
})

await app.register(cookie, {
  secret: JWT_SECRET,
})
app.addHook('onRequest', adoptLegacySessionCookie)

await app.register(multipart, {
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
})

await app.register(jwt, {
  secret: JWT_SECRET,
  cookie: { cookieName: SESSION_COOKIE, signed: false },
})

app.decorate('authenticate', authMiddleware)
// Expose broadcastToTenant so runtime-bridge can call it without importing ws.ts directly
app.decorate('broadcastToTenant', broadcastToTenant)

app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

// WebSocket must be registered before route plugins that use it
await app.register(wsPlugin)
await app.register(wsRoutes)

await app.register(authRoutes, { prefix: '/api/v1/auth' })
await app.register(meRoutes, { prefix: '/api/v1/me' })
await app.register(botsRoutes, { prefix: '/api/v1/bots' })
await app.register(flowsRoutes, { prefix: '/api/v1/bots' })
await app.register(knowledgeRoutes, { prefix: '/api/v1/bots' })
await app.register(botSettingsRoutes, { prefix: '/api/v1/bots' })
await app.register(campaignsRoutes, { prefix: '/api/v1/bots' })
await app.register(templatesRoutes, { prefix: '/api/v1/bots' })
await app.register(channelsRoutes, { prefix: '/api/v1/bots' })
await app.register(tenantsRoutes, { prefix: '/api/v1/tenants' })
await app.register(conversationsRoutes, { prefix: '/api/v1/conversations' })
await app.register(ticketsRoutes, { prefix: '/api/v1/tickets' })
await app.register(contactsRoutes, { prefix: '/api/v1/contacts' })
await app.register(webhooksRoutes, { prefix: '/api/v1/webhooks' })
await app.register(teamRoutes, { prefix: '/api/v1/team' })
await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' })
await app.register(auditRoutes, { prefix: '/api/v1/audit' })
await app.register(previewRoutes, { prefix: '/api/v1/bots' })
await app.register(draftPreviewRoutes, { prefix: '/api/v1' })
await app.register(widgetRoutes, { prefix: '/api/v1' })
await app.register(testRunRoutes, { prefix: '/api/v1' })
await app.register(channelWebhookRoutes, { prefix: '/api/v1' })
await app.register(optimizationRoutes, { prefix: '/api/v1/bots' })
await app.register(workflowsRoutes, { prefix: '/api/v1/bots' })
await app.register(toolsRoutes, { prefix: '/api/v1/bots' })
await app.register(authProfilesRoutes, { prefix: '/api/v1/auth-profiles' })
await app.register(dashboardsRoutes, { prefix: '/api/v1/bots' })
await app.register(safetyRoutes, { prefix: '/api/v1/bots' })
await app.register(evalsRoutes, { prefix: '/api/v1/bots' })
await app.register(releasesRoutes, { prefix: '/api/v1/bots' })
await app.register(bundleRoutes, { prefix: '/api/v1/bots' })
await app.register(botMemoryRoutes, { prefix: '/api/v1/bots' })
await app.register(businessRoutes, { prefix: '/api/v1/bots' })
await app.register(contactMemoryRoutes, { prefix: '/api/v1' })
await app.register(reportsRoutes, { prefix: '/api/v1/bots' })
await app.register(cannedRoutes, { prefix: '/api/v1/canned-replies' })
await app.register(databaseRoutes, { prefix: '/api/v1/database' })
await app.register(integrationsRoutes, { prefix: '/api/v1/integrations' })
await app.register(systemRoutes, { prefix: '/api/v1/system' })

installLlmLedger()
installLlmPrivacy()
setTurnBroadcast(broadcastToTenant)

try {
  await app.listen({ port: PORT, host: HOST })
  console.log(`API running on http://${HOST}:${PORT}`)
  import('./scripts/demo-program.js')
    .then((mod) => withLlmScope({ source: 'authoring' }, () => mod.applyDemoProgram()))
    .then((result) => console.log('[demo-program]', JSON.stringify(result)))
    .catch((err) => console.warn('[demo-program]', err instanceof Error ? err.message : err))
  import('./scripts/ensure-demos.js')
    .then((mod) => mod.ensureBellaBenchmark())
    .then((result) => console.log('[bella-benchmark]', JSON.stringify(result)))
    .catch((err) => console.warn('[bella-benchmark]', err instanceof Error ? err.message : err))
  import('./lib/integrations.js')
    .then((mod) => mod.moveLegacyIntegrationKeys(INTEGRATION_CATALOG))
    .then((result) => { if (result.moved) console.log('[integrations] moved plain-text keys into Auth Profiles', JSON.stringify(result)) })
    .catch((err) => console.warn('[integrations]', err instanceof Error ? err.message : err))
  await startBroadcastRelay({ subscribe: true }).catch((err) => console.error('[ws] broadcast relay not started:', err instanceof Error ? err.message : err))
  void initQueues(process.env['REDIS_URL'] ?? 'redis://localhost:6379')
  const role = processRole()
  const stopBackground = role === 'all' ? startBackgroundWork(role) : () => {}
  if (role === 'api') console.log('[startup] PROCESS_ROLE=api: queue workers and sweeps run in the worker container')
  notifyDeployWebhook().catch(() => {})
  // Watchtower stops the old container with SIGTERM during a deploy. Stop
  // accepting connections and let requests in flight finish, so Caddy retries
  // new requests against the replacement instead of the caller seeing a 502.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      setTimeout(() => process.exit(0), 15_000).unref()
      stopBackground()
      app.close().finally(() => process.exit(0))
    })
  }
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

/**
 * If DEPLOY_WEBHOOK_URL is set, POST a "BotStudio is live" notification once the
 * server has started.  Compatible with Slack incoming webhooks and any generic
 * JSON POST endpoint.  Failures are silently swallowed so they never affect
 * the running server.
 */
async function notifyDeployWebhook(): Promise<void> {
  const url = process.env['DEPLOY_WEBHOOK_URL']
  if (!url) return

  const version     = process.env['APP_VERSION']     ?? 'dev'
  const buildNumber = process.env['APP_BUILD_NUMBER'] ?? 'local'
  const gitSha      = process.env['APP_GIT_SHA']      ?? 'dev'
  const buildDate   = process.env['APP_BUILD_DATE']   ?? new Date().toISOString()

  const text = `✅ *BotStudio API is live* — v${version} · build #${buildNumber} · \`${gitSha.slice(0, 7)}\` — ${new Date(buildDate).toUTCString()}`

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}
