import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import { SESSION_COOKIE, adoptLegacySessionCookie, clearSessionCookies, setSessionCookie } from './session-cookie.js'

async function app() {
  const server = Fastify()
  await server.register(cookie)
  server.addHook('onRequest', adoptLegacySessionCookie)
  await server.register(jwt, { secret: 'cookie-test-secret-cookie-test-secret', cookie: { cookieName: SESSION_COOKIE, signed: false } })
  server.get('/me', async (request) => { await request.jwtVerify(); return request.user })
  server.post('/login', async (_request, reply) => { setSessionCookie(reply, server.jwt.sign({ sub: 'u1' })); return { ok: true } })
  server.post('/logout', async (_request, reply) => { clearSessionCookies(reply); return { ok: true } })
  await server.ready()
  return server
}

test('a session cookie from before the rename still signs the user in', async () => {
  const server = await app()
  const token = server.jwt.sign({ sub: 'u1' })
  for (const name of ['botstudio_token', 'ybot_token']) {
    const res = await server.inject({ url: '/me', cookies: { [name]: token } })
    assert.equal(res.statusCode, 200, name)
    assert.equal(res.json().sub, 'u1')
  }
  assert.equal((await server.inject({ url: '/me' })).statusCode, 401, 'no cookie, no session')
  await server.close()
})

test('login sets the BotStudio cookie and clears the old one; logout clears both', async () => {
  const server = await app()
  const login = await server.inject({ method: 'POST', url: '/login' })
  const set = login.cookies.map((c) => [c.name, c.value ? 'set' : 'cleared'])
  assert.deepEqual(set, [['botstudio_token', 'set'], ['ybot_token', 'cleared']])
  const logout = await server.inject({ method: 'POST', url: '/logout' })
  assert.deepEqual(logout.cookies.map((c) => [c.name, c.value]), [['botstudio_token', ''], ['ybot_token', '']])
  await server.close()
})
