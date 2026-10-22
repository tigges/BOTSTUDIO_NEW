import type { FastifyReply, FastifyRequest } from 'fastify'

export const SESSION_COOKIE = 'botstudio_token'
/** Set by builds before the rename. Read for as long as such a session can live (7 days). */
export const LEGACY_SESSION_COOKIE = 'ybot_token'

const MAX_AGE_S = 60 * 60 * 24 * 7

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_S,
  })
  reply.clearCookie(LEGACY_SESSION_COOKIE, { path: '/' })
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
  reply.clearCookie(LEGACY_SESSION_COOKIE, { path: '/' })
}

/** onRequest hook, after @fastify/cookie: a session from before the rename keeps working. */
export async function adoptLegacySessionCookie(request: FastifyRequest): Promise<void> {
  const cookies = request.cookies as Record<string, string | undefined> | undefined
  if (!cookies) return
  const legacy = cookies[LEGACY_SESSION_COOKIE]
  if (legacy && !cookies[SESSION_COOKIE]) cookies[SESSION_COOKIE] = legacy
}
