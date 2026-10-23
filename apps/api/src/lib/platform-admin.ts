import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@botstudio/db'

/**
 * The people who run this BotStudio installation. A workspace ADMIN is a
 * customer's admin: anyone can register a workspace and become one, so host
 * health, environment config and demo re-seeding need this second check.
 */
export const DEFAULT_PLATFORM_ADMIN_EMAILS = ['charles@acme.com']

export function platformAdminEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env['PLATFORM_ADMIN_EMAILS']
  const list = raw === undefined || raw.trim() === '' ? DEFAULT_PLATFORM_ADMIN_EMAILS : raw.split(',')
  return new Set(list.map((email) => email.trim().toLowerCase()).filter(Boolean))
}

export function isPlatformAdmin(user: { role?: string | null; email?: string | null }, env: NodeJS.ProcessEnv = process.env): boolean {
  if (user.role !== 'ADMIN' || !user.email) return false
  return platformAdminEmails(env).has(user.email.trim().toLowerCase())
}

/** Resolves a verified JWT payload to a platform-admin decision. */
export async function platformAdminFromToken(payload: { sub?: string; role?: string } | undefined): Promise<boolean> {
  if (!payload?.sub || payload.role !== 'ADMIN') return false
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { email: true } }).catch(() => null)
  return isPlatformAdmin({ role: payload.role, email: user?.email })
}

/**
 * ADMIN of a workspace a platform admin belongs to (the Acme demo company on
 * app.botstudio.uk). Enough for demo re-seeding, which only touches demo
 * workspaces; not enough for host health or server config.
 */
export async function operatorWorkspaceAdminFromToken(payload: { sub?: string; tenantId?: string; role?: string } | undefined): Promise<boolean> {
  if (!payload?.tenantId || payload.role !== 'ADMIN') return false
  const emails = [...platformAdminEmails()]
  if (emails.length === 0) return false
  const operator = await prisma.user.findFirst({
    where: { tenantId: payload.tenantId, email: { in: emails, mode: 'insensitive' } },
    select: { id: true },
  }).catch(() => null)
  return operator !== null
}

export async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (await platformAdminFromToken(request.user as { sub?: string; role?: string } | undefined)) return
  reply.status(403).send({
    error: {
      code: 'FORBIDDEN',
      message: 'System Status and server settings are only for the people who run this BotStudio installation.',
    },
  })
}
