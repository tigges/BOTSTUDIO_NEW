import type { FastifyInstance } from 'fastify'
import { prisma } from '@botstudio/db'
import { z } from 'zod'
import bcrypt from 'bcryptjs'


interface JwtPayload {
  sub: string
  tenantId: string
  role: string
}

export async function meRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/', async (request) => {
    const { sub: userId, tenantId } = request.user as JwtPayload

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: true, agentProfile: true },
    })

    if (!user) {
      return { error: { code: 'NOT_FOUND', message: 'User not found' } }
    }

    return {
      data: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        tenantId,
        role: user.memberships[0]?.role ?? 'DEVELOPER',
        status: user.agentProfile?.status ?? 'offline',
      },
    }
  })

  // PATCH /me — update current user's agent status
  app.patch('/', async (request, reply) => {
    const { sub: userId, tenantId } = request.user as JwtPayload
    const body = z.object({
      status: z.enum(['online', 'away', 'offline']).optional(),
      displayName: z.string().min(1).optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })

    const { status, displayName } = body.data

    if (status !== undefined) {
      await prisma.agentProfile.upsert({
        where: { userId },
        create: { tenantId, userId, displayName: displayName ?? 'Agent', status },
        update: { status },
      })
    }
    if (displayName !== undefined) {
      await prisma.user.update({ where: { id: userId }, data: { displayName } })
    }

    return reply.send({ data: { ok: true } })
  })

  // ── POST /me/password — change password (authenticated) ───────────────────
  app.post('/password', async (request, reply) => {
    const { sub: userId } = request.user as JwtPayload
    const body = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user?.passwordHash) return reply.status(400).send({ error: { code: 'NO_PASSWORD', message: 'Account has no password set' } })

    const valid = await bcrypt.compare(body.data.currentPassword, user.passwordHash)
    if (!valid) return reply.status(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' } })

    const passwordHash = await bcrypt.hash(body.data.newPassword, 10)
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } })

    return reply.send({ data: { message: 'Password changed successfully.' } })
  })
}
