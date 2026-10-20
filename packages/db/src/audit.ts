import { AsyncLocalStorage } from 'node:async_hooks'
import type { PrismaClient } from '@prisma/client'

/**
 * Every change a signed-in person makes writes one audit row with the record
 * before and after. The API opens a context per request and names the actor
 * once they are authenticated; writes outside a named actor (guests, the bot,
 * background jobs) are not audited.
 */
export interface AuditActor {
  tenantId: string
  userId: string
  role?: string
  ip?: string
  /** console: the web app; api: an API key; system: a script run on someone's behalf. */
  source: 'console' | 'api' | 'system'
  requestId?: string
}

interface AuditContext {
  actor?: AuditActor
}

const contexts = new AsyncLocalStorage<AuditContext>()

/** Opens an empty context; `setAuditActor` fills it in later in the same request. */
export function runWithAuditContext<T>(fn: () => T): T {
  return contexts.run({}, fn)
}

export function setAuditActor(actor: AuditActor): void {
  const ctx = contexts.getStore()
  if (ctx) ctx.actor = actor
}

/** Prisma queries run when awaited, so the await has to happen inside the context. */
export function withAuditActor<T>(actor: AuditActor, fn: () => T | PromiseLike<T>): Promise<T> {
  return contexts.run({ actor }, async () => await fn())
}

export function currentAuditActor(): AuditActor | undefined {
  return contexts.getStore()?.actor
}

/** High-volume or derived rows: chat traffic, ledgers, sessions and the audit log itself. */
const NOT_AUDITED = new Set([
  'Activity',
  'Message',
  'StepLog',
  'LlmCall',
  'EvalRun',
  'FlowSession',
  'ToolRun',
  'UserSession',
  'CsatResponse',
  'WebhookDelivery',
  'CampaignDelivery',
  'DocumentChunk',
  'Document',
])

const SINGLE = new Set(['create', 'update', 'upsert', 'delete'])
const MANY = new Set(['createMany', 'createManyAndReturn', 'updateMany', 'updateManyAndReturn', 'deleteMany'])

/** Fields whose values never reach the audit log, whatever the model. */
const SECRET_FIELD = /pass(word)?|secret|token|api_?key|credential|hash|sealed|private_?key/i
/** Changes to only these fields are bookkeeping, not a person's decision. */
const BOOKKEEPING = new Set(['updatedAt', 'lastSeenAt', 'lastMessageAt'])

export function hideSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value ?? null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => hideSecrets(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_FIELD.test(key) && item !== null && item !== undefined && item !== '' ? '[hidden]' : hideSecrets(item, depth + 1),
    ]))
  }
  return value
}

/** Field names whose values differ between before and after. */
export function changedFields(before: unknown, after: unknown): string[] {
  if (Array.isArray(before) || Array.isArray(after)) {
    const byId = (rows: unknown) => new Map((Array.isArray(rows) ? rows : []).map((row) => [(row as { id?: unknown })?.id, row]))
    const a = byId(before)
    const b = byId(after)
    const fields = new Set<string>()
    for (const id of new Set([...a.keys(), ...b.keys()])) changedFields(a.get(id), b.get(id)).forEach((f) => fields.add(f))
    return [...fields].sort()
  }
  const a = before && typeof before === 'object' ? before as Record<string, unknown> : {}
  const b = after && typeof after === 'object' ? after as Record<string, unknown> : {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((key) => JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)).sort()
}

function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1)
}

type Delegate = {
  findUnique(args: unknown): Promise<unknown>
  findMany(args: unknown): Promise<unknown[]>
}

function idsOf(rows: unknown): string[] {
  return Array.isArray(rows) ? rows.flatMap((row) => typeof (row as { id?: unknown })?.id === 'string' ? [(row as { id: string }).id] : []) : []
}

export function auditAction(model: string, operation: string, existed: boolean): string {
  const noun = lowerFirst(model).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
  if (operation.startsWith('create') || (operation === 'upsert' && !existed)) return `${noun}.created`
  if (operation.startsWith('delete')) return `${noun}.deleted`
  return `${noun}.updated`
}

/** Adds before/after audit rows to every write made under a named actor. */
export function withAudit(base: PrismaClient) {
  return base.$extends({
    name: 'audit',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const actor = contexts.getStore()?.actor
          if (!actor || NOT_AUDITED.has(model) || (!SINGLE.has(operation) && !MANY.has(operation))) return query(args)
          const delegate = (base as unknown as Record<string, Delegate>)[lowerFirst(model)]
          if (!delegate) return query(args)
          const where = (args as { where?: unknown }).where

          let before: unknown = null
          if (where && (operation === 'update' || operation === 'upsert' || operation === 'delete')) {
            before = await delegate.findUnique({ where }).catch(() => null)
          } else if (where && (operation === 'updateMany' || operation === 'updateManyAndReturn' || operation === 'deleteMany')) {
            before = await delegate.findMany({ where, take: 50 }).catch(() => null)
          }

          const result = await query(args)

          let after: unknown = null
          if (operation === 'create' || operation === 'update' || operation === 'upsert') {
            // A write without select/include returns the whole row. Re-reading would miss uncommitted rows inside a transaction.
            const narrowed = Boolean((args as { select?: unknown; include?: unknown }).select || (args as { include?: unknown }).include)
            const id = (result as { id?: unknown } | null)?.id ?? (before as { id?: unknown } | null)?.id
            after = narrowed && typeof id === 'string' ? (await delegate.findUnique({ where: { id } }).catch(() => null)) ?? result : result
          } else if (operation === 'updateMany' || operation === 'updateManyAndReturn') {
            const ids = idsOf(before)
            after = ids.length ? await delegate.findMany({ where: { id: { in: ids } } }).catch(() => null) : null
          } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
            after = Array.isArray(result) ? result : (args as { data?: unknown }).data ?? null
          }

          const changes = changedFields(before, after)
          if (operation.startsWith('update') && changes.length > 0 && changes.every((field) => BOOKKEEPING.has(field))) return result
          if ((operation === 'updateMany' || operation === 'deleteMany') && idsOf(before).length === 0) return result

          const target = (after ?? before) as { id?: unknown; tenantId?: unknown } | null
          const targetId = !Array.isArray(target) && typeof target?.id === 'string' ? target.id : null
          await base.activity.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: auditAction(model, operation, before !== null),
              resource: lowerFirst(model),
              resourceId: targetId,
              metadata: {
                before: hideSecrets(before),
                after: hideSecrets(after),
                changes: operation.startsWith('update') || operation === 'upsert' ? changes.filter((f) => !BOOKKEEPING.has(f)) : [],
                source: actor.source,
                ip: actor.ip ?? null,
                requestId: actor.requestId ?? null,
              } as object,
            },
          }).catch(() => {})
          return result
        },
      },
    },
  })
}
