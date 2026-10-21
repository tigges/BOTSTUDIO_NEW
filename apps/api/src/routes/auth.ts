import type { FastifyInstance } from 'fastify'
import { clearSessionCookies, setSessionCookie } from '../lib/session-cookie.js'
import { prisma } from '@ybot/db'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { sendEmail, passwordResetEmail, inviteEmail } from '../lib/email.js'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2),
  tenantName: z.string().min(2),
  tenantSlug: z.string().min(2).regex(/^[a-z0-9-]+$/),
})

export async function authRoutes(app: FastifyInstance) {
  // ── POST /login ───────────────────────────────────────────────────────────
  app.post('/login', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Invalid input', details: body.error.flatten().fieldErrors } })
    }

    // Include memberships so we can pick the correct tenant-scoped role.
    const user = await prisma.user.findFirst({
      where: { email: body.data.email },
      include: { memberships: true },
    })

    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } })
    }

    const valid = await bcrypt.compare(body.data.password, user.passwordHash)
    if (!valid) {
      return reply.status(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } })
    }

    // Scope the membership lookup to the user's own tenant so the JWT role is
    // always correct even if the user somehow belongs to multiple tenants.
    const membership = user.memberships.find((m) => m.tenantId === user.tenantId)
    const role = membership?.role ?? 'DEVELOPER'

    const token = app.jwt.sign(
      { sub: user.id, tenantId: user.tenantId, role },
      { expiresIn: '7d' },
    )

    setSessionCookie(reply, token)

    return {
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          tenantId: user.tenantId,
          role,
        },
      },
    }
  })

  // ── POST /register ────────────────────────────────────────────────────────
  app.post('/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const body = registerSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Invalid input', details: body.error.flatten().fieldErrors } })
    }

    // Email must be globally unique — each signup creates a new workspace.
    const existing = await prisma.user.findFirst({ where: { email: body.data.email } })
    if (existing) {
      return reply.status(409).send({ error: { code: 'EMAIL_TAKEN', message: 'Email already in use' } })
    }

    const slugExists = await prisma.tenant.findUnique({ where: { slug: body.data.tenantSlug } })
    if (slugExists) {
      return reply.status(409).send({ error: { code: 'SLUG_TAKEN', message: 'Workspace slug already in use' } })
    }

    const passwordHash = await bcrypt.hash(body.data.password, 10)

    // Membership cannot be nested with an empty tenant id: that value is a
    // foreign key and the database rejects it. Create the rows in order.
    let tenant: { id: string }
    let user: { id: string; email: string; displayName: string; avatarUrl: string | null }
    try {
      const created = await prisma.$transaction(async (tx) => {
        const nextTenant = await tx.tenant.create({
          data: {
            name: body.data.tenantName,
            slug: body.data.tenantSlug,
          },
        })
        const nextUser = await tx.user.create({
          data: {
            tenantId: nextTenant.id,
            email: body.data.email,
            displayName: body.data.displayName,
            passwordHash,
          },
        })
        await tx.membership.create({
          data: { tenantId: nextTenant.id, userId: nextUser.id, role: 'ADMIN' },
        })
        await tx.bot.create({
          data: {
            tenantId: nextTenant.id,
            name: `${body.data.tenantName} Bot`,
            environments: {
              create: [
                { tenantId: nextTenant.id, kind: 'sandbox', name: 'Sandbox' },
                { tenantId: nextTenant.id, kind: 'production', name: 'Production' },
              ],
            },
            config: {
              create: { tenantId: nextTenant.id },
            },
          },
        })
        return { tenant: nextTenant, user: nextUser }
      })
      tenant = created.tenant
      user = created.user
    } catch (err) {
      request.log.error({ err }, 'register failed')
      return reply.status(500).send({ error: { code: 'REGISTER_FAILED', message: 'Could not create this workspace. Please try again.' } })
    }

    const token = app.jwt.sign({ sub: user.id, tenantId: tenant.id, role: 'ADMIN' }, { expiresIn: '7d' })

    setSessionCookie(reply, token)

    return reply.status(201).send({
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          tenantId: tenant.id,
          role: 'ADMIN',
        },
      },
    })
  })

  // ── POST /logout ──────────────────────────────────────────────────────────
  app.post('/logout', async (_request, reply) => {
    clearSessionCookies(reply)
    return { data: { ok: true } }
  })

  // ── POST /forgot-password ──────────────────────────────────────────────────
  app.post('/forgot-password', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = z.object({ email: z.string().email() }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION' } })

    // Always return 200 to prevent email enumeration
    const user = await prisma.user.findFirst({ where: { email: body.data.email } })
    if (user) {
      const token = app.jwt.sign(
        { sub: user.id, type: 'password_reset', phash: user.passwordHash?.slice(-8) ?? '' },
        { expiresIn: '1h' },
      )
      const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost'
      const resetUrl = `${frontendUrl}/reset-password?token=${token}`
      await sendEmail(passwordResetEmail({ to: user.email, resetUrl, displayName: user.displayName })).catch((e) => {
        console.error('[email] forgot-password send failed:', e)
      })
    }

    return reply.send({ data: { message: 'If that email is registered you will receive a reset link shortly.' } })
  })

  // ── POST /reset-password ───────────────────────────────────────────────────
  app.post('/reset-password', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = z.object({ token: z.string(), password: z.string().min(8) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })

    let payload: { sub: string; type: string; phash: string }
    try {
      payload = app.jwt.verify(body.data.token) as typeof payload
    } catch {
      return reply.status(400).send({ error: { code: 'INVALID_TOKEN', message: 'Reset link is invalid or has expired' } })
    }

    if (payload.type !== 'password_reset') {
      return reply.status(400).send({ error: { code: 'INVALID_TOKEN' } })
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })

    // Invalidate: if the stored hash tail changed (password already reset), reject
    if ((user.passwordHash?.slice(-8) ?? '') !== payload.phash) {
      return reply.status(400).send({ error: { code: 'TOKEN_ALREADY_USED', message: 'This reset link has already been used' } })
    }

    const passwordHash = await bcrypt.hash(body.data.password, 10)
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })

    return reply.send({ data: { message: 'Password updated — you can now sign in.' } })
  })

  // ── POST /accept-invite ────────────────────────────────────────────────────
  app.post('/accept-invite', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = z.object({ token: z.string(), password: z.string().min(8), displayName: z.string().min(2).optional() }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })

    let payload: { sub: string; type: string }
    try {
      payload = app.jwt.verify(body.data.token) as typeof payload
    } catch {
      return reply.status(400).send({ error: { code: 'INVALID_TOKEN', message: 'Invite link is invalid or has expired' } })
    }

    if (payload.type !== 'invite') {
      return reply.status(400).send({ error: { code: 'INVALID_TOKEN' } })
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { memberships: true } })
    if (!user) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    if (user.passwordHash) return reply.status(409).send({ error: { code: 'ALREADY_ACCEPTED', message: 'Invite already accepted' } })

    const passwordHash = await bcrypt.hash(body.data.password, 10)
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        displayName: body.data.displayName ?? user.displayName,
      },
    })

    const membership = user.memberships.find((m) => m.tenantId === user.tenantId)
    const role = membership?.role ?? 'AGENT'
    const token = app.jwt.sign({ sub: updatedUser.id, tenantId: updatedUser.tenantId, role }, { expiresIn: '7d' })

    setSessionCookie(reply, token)

    return reply.status(200).send({
      data: {
        token,
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          displayName: updatedUser.displayName,
          tenantId: updatedUser.tenantId,
          role,
        },
      },
    })
  })
}
