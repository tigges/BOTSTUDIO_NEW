/**
 * Integration connections keep their credential in an Auth Profile, sealed.
 * HubSpot and Zendesk also install ordinary HTTP tools that use that profile.
 */
import { prisma } from '@botstudio/db'
import {
  CONNECTORS, connectorIssues, connectorProfileSettings, connectorSettings, connectorTools, isConnector, toolIssues,
  type AuthProfileKind,
} from '@botstudio/shared'
import { sealSecret, secretHint } from './secrets.js'

type Db = typeof prisma

export class IntegrationError extends Error {
  constructor(public status: number, message: string, public code: string, public issues?: Array<{ field: string; message: string }>) {
    super(message)
  }
}

export interface CatalogItem {
  id: string
  name: string
}

function profileKindFor(provider: string): AuthProfileKind {
  return isConnector(provider) ? CONNECTORS[provider].profileKind : 'bearer'
}

/** "HubSpot", or "HubSpot 2" when someone already has a profile with that name. */
async function freeProfileName(db: Db, tenantId: string, base: string): Promise<string> {
  const taken = new Set((await db.authProfile.findMany({ where: { tenantId, name: { startsWith: base } }, select: { name: true } })).map((row) => row.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

/** What still has to be filled in before tools can use the connection. */
export function connectionGaps(provider: string, settings: unknown, hasSecret: boolean): Array<{ field: string; message: string }> {
  if (!isConnector(provider)) return hasSecret ? [] : [{ field: 'secret', message: 'Key: paste it again.' }]
  const clean = connectorSettings(provider, (settings ?? {}) as Record<string, unknown>)
  return connectorIssues(provider, clean, undefined, hasSecret)
}

export async function connectIntegration(opts: {
  tenantId: string
  userId: string
  item: CatalogItem
  secret?: string
  settings?: Record<string, unknown>
}, db: Db = prisma) {
  const { tenantId, userId, item } = opts
  const provider = item.id
  const existing = await db.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
    include: { authProfile: true },
  })
  const secret = opts.secret?.trim() || undefined
  const settings = isConnector(provider) ? connectorSettings(provider, opts.settings ?? {}) : {}
  const issues = isConnector(provider)
    ? connectorIssues(provider, settings, secret, Boolean(existing?.authProfile?.secretEnc))
    : (!secret && !existing?.authProfile?.secretEnc ? [{ field: 'secret', message: 'Key: paste the API key or token.' }] : [])
  if (issues.length) throw new IntegrationError(422, issues[0]!.message, 'CONNECTION_INVALID', issues)

  const kind = profileKindFor(provider)
  const profileSettings = isConnector(provider) ? connectorProfileSettings(provider, settings) : {}
  const sealed = secret ? { secretEnc: sealSecret(secret), secretHint: secretHint(secret) } : {}
  const profile = existing?.authProfile
    ? await db.authProfile.update({ where: { id: existing.authProfile.id }, data: { kind, settings: profileSettings, ...sealed } })
    : await db.authProfile.create({
        data: { tenantId, name: await freeProfileName(db, tenantId, item.name), kind, settings: profileSettings, ...sealed, createdBy: userId },
      })
  const row = await db.integrationConnection.upsert({
    where: { tenantId_provider: { tenantId, provider } },
    create: { tenantId, provider, authProfileId: profile.id, settings, apiKey: null },
    update: { authProfileId: profile.id, settings, apiKey: null, connectedAt: new Date() },
  })
  return { connection: row, profile }
}

/** Removes the connection. Its Auth Profile goes too, or loses its secret when tools still point at it. */
export async function disconnectIntegration(tenantId: string, provider: string, db: Db = prisma): Promise<{ toolsLeft: number }> {
  const row = await db.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
    include: { authProfile: { include: { _count: { select: { tools: true } } } } },
  })
  if (!row) return { toolsLeft: 0 }
  await db.integrationConnection.delete({ where: { id: row.id } })
  const profile = row.authProfile
  if (!profile) return { toolsLeft: 0 }
  if (profile._count.tools === 0) {
    await db.authProfile.delete({ where: { id: profile.id } })
    return { toolsLeft: 0 }
  }
  await db.authProfile.update({ where: { id: profile.id }, data: { secretEnc: null, secretHint: null } })
  return { toolsLeft: profile._count.tools }
}

/** Adds the connector's tools to one bot, attached to the connection's Auth Profile. */
export async function installConnectorTools(tenantId: string, botId: string, provider: string, db: Db = prisma) {
  if (!isConnector(provider)) throw new IntegrationError(409, 'This connection has no tools to add yet.', 'NO_TOOLS')
  const bot = await db.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
  if (!bot) throw new IntegrationError(404, 'Bot not found.', 'NOT_FOUND')
  const row = await db.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
    include: { authProfile: true },
  })
  if (!row?.authProfile) throw new IntegrationError(409, `Connect ${CONNECTORS[provider].name} first.`, 'NOT_CONNECTED')
  const gaps = connectionGaps(provider, row.settings, Boolean(row.authProfile.secretEnc))
  if (gaps.length) throw new IntegrationError(409, `${CONNECTORS[provider].name}: ${gaps[0]!.message}`, 'CONNECTION_INCOMPLETE', gaps)

  const settings = connectorSettings(provider, row.settings as Record<string, unknown>)
  const created: Array<{ id: string; name: string }> = []
  const skipped: string[] = []
  for (const draft of connectorTools(provider, settings)) {
    const issues = toolIssues({ ...draft, authProfileId: row.authProfile.id })
    if (issues.length) { skipped.push(`${draft.name}: ${issues[0]!.message}`); continue }
    if (await db.tool.findFirst({ where: { botId, name: draft.name }, select: { id: true } })) {
      skipped.push(`${draft.name}: this bot has it already.`)
      continue
    }
    const tool = await db.tool.create({
      data: {
        tenantId, botId, name: draft.name, kind: draft.kind, description: draft.description,
        parameters: draft.parameters as object[], returns: draft.returns as object, effect: draft.effect,
        config: draft.config as object, authProfileId: row.authProfile.id,
      },
      select: { id: true, name: true },
    })
    created.push(tool)
  }
  return { created, skipped }
}

/**
 * Connections saved before Auth Profiles kept the key in plain text. Each one
 * becomes a sealed Auth Profile and the plain value is cleared. Safe to run on
 * every boot: it only touches rows that still hold a key.
 */
export async function moveLegacyIntegrationKeys(catalog: readonly CatalogItem[], db: Db = prisma): Promise<{ moved: number }> {
  const rows = await db.integrationConnection.findMany({ where: { apiKey: { not: null } } })
  let moved = 0
  for (const row of rows) {
    const key = row.apiKey?.trim()
    if (!key) {
      await db.integrationConnection.update({ where: { id: row.id }, data: { apiKey: null } })
      continue
    }
    const name = catalog.find((item) => item.id === row.provider)?.name ?? row.provider
    const sealed = { secretEnc: sealSecret(key), secretHint: secretHint(key) }
    const kind = profileKindFor(row.provider)
    const settings = isConnector(row.provider)
      ? connectorProfileSettings(row.provider, connectorSettings(row.provider, (row.settings ?? {}) as Record<string, unknown>))
      : {}
    const profileId = row.authProfileId
      ? (await db.authProfile.update({ where: { id: row.authProfileId }, data: sealed })).id
      : (await db.authProfile.create({ data: { tenantId: row.tenantId, name: await freeProfileName(db, row.tenantId, name), kind, settings, ...sealed } })).id
    await db.integrationConnection.update({ where: { id: row.id }, data: { authProfileId: profileId, apiKey: null } })
    moved++
  }
  return { moved }
}
