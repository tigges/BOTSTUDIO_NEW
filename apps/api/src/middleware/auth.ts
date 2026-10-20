import type { FastifyRequest, FastifyReply } from 'fastify'
import { setAuditActor } from '@ybot/db'

// ── Role hierarchy (lowest to highest privilege) ──────────────────────────────
// AGENT      — inbox only: conversations, tickets, contacts
// DEVELOPER  — build area: bots, flows, knowledge, preview
// SUPERVISOR — everything a developer can do + campaigns, analytics, webhooks
// ADMIN      — full access including team management, system status, audit log

export const ROLES = ['AGENT', 'DEVELOPER', 'SUPERVISOR', 'ADMIN'] as const
export type Role = (typeof ROLES)[number]

/** Verify a valid JWT is present.  Fastify's jwtVerify() attaches the
 *  decoded payload to request.user automatically. */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify()
    const user = request.user as { sub?: string; tenantId?: string; role?: string }
    if (user?.sub && user.tenantId) {
      setAuditActor({ tenantId: user.tenantId, userId: user.sub, role: user.role, ip: request.ip, source: 'console', requestId: request.id })
    }
  } catch {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } })
  }
}

/** Return a preHandler that rejects callers whose JWT role is not in the
 *  allowed list.  Always combine with authMiddleware (authenticate) first:
 *
 *    app.addHook('preHandler', app.authenticate)
 *    app.addHook('preHandler', requireRole('ADMIN', 'SUPERVISOR'))
 */
export function requireRole(...allowed: Role[]) {
  const allowedSet = new Set<string>(allowed)
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user as { role?: string } | undefined
    const role = user?.role ?? ''
    if (!allowedSet.has(role)) {
      reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `This action requires one of the following roles: ${allowed.join(', ')}`,
        },
      })
    }
  }
}
