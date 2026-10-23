import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PLATFORM_ADMIN_EMAILS, isPlatformAdmin, platformAdminEmails } from './platform-admin.js'

test('a workspace ADMIN is not a platform admin unless their login is on the operator list', () => {
  const env = { PLATFORM_ADMIN_EMAILS: 'ops@botstudio.uk, Charles@Acme.com' }
  assert.equal(isPlatformAdmin({ role: 'ADMIN', email: 'demo@bella.com' }, env), false, 'a customer admin')
  assert.equal(isPlatformAdmin({ role: 'ADMIN', email: 'someone@new-signup.com' }, env), false, 'anyone who registers a workspace')
  assert.equal(isPlatformAdmin({ role: 'ADMIN', email: 'charles@acme.com' }, env), true, 'case-insensitive match')
  assert.equal(isPlatformAdmin({ role: 'ADMIN', email: ' OPS@botstudio.uk ' }, env), true)
  assert.equal(isPlatformAdmin({ role: 'SUPERVISOR', email: 'ops@botstudio.uk' }, env), false, 'operators still need ADMIN')
  assert.equal(isPlatformAdmin({ role: 'ADMIN', email: null }, env), false)
})

test('with no list configured the operator account is the default, so the live host keeps access', () => {
  assert.deepEqual([...platformAdminEmails({})], DEFAULT_PLATFORM_ADMIN_EMAILS)
  assert.deepEqual([...platformAdminEmails({ PLATFORM_ADMIN_EMAILS: '  ' })], DEFAULT_PLATFORM_ADMIN_EMAILS)
  assert.equal(isPlatformAdmin({ role: 'ADMIN', email: 'charles@acme.com' }, {}), true)
  assert.equal(isPlatformAdmin({ role: 'ADMIN', email: 'demo@acme.com' }, {}), false, 'the shared Acme demo login is not an operator')
  assert.equal(isPlatformAdmin({ role: 'ADMIN', email: 'qa@acme.com' }, {}), false)
})
