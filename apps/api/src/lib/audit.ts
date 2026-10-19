import { prisma } from '@ybot/db'

export interface AuditEntry {
  tenantId: string
  actorId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  before?: unknown
  after?: unknown
}

/** One audit row per mutation, with the record before and after the change. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  await prisma.activity.create({
    data: {
      tenantId: entry.tenantId,
      userId: entry.actorId ?? null,
      action: entry.action,
      resource: entry.targetType,
      resourceId: entry.targetId ?? null,
      metadata: { before: (entry.before ?? null) as object, after: (entry.after ?? null) as object },
    },
  }).catch(() => {})
}
