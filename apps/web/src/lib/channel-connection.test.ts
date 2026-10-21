import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apiErrorField, credentialForm, credentialPatch, missingCredential } from './channel-connection'

const saved = { phoneNumberId: '123', verifyToken: 'verify-me' }

test('the form fills plain fields and leaves secrets blank', () => {
  assert.deepEqual(credentialForm('whatsapp', saved), { phoneNumberId: '123', accessToken: '', verifyToken: 'verify-me' })
  assert.deepEqual(credentialForm('web', {}), {})
})

test('a saved secret counts as filled; an unsaved one does not', () => {
  const form = credentialForm('whatsapp', saved)
  assert.equal(missingCredential('whatsapp', form, ['accessToken']), null)
  assert.equal(missingCredential('whatsapp', form, []), 'accessToken')
  assert.equal(missingCredential('whatsapp', { ...form, phoneNumberId: ' ' }, ['accessToken']), 'phoneNumberId')
})

test('only changed fields are sent, so a blank secret keeps the saved one', () => {
  const form = credentialForm('whatsapp', saved)
  assert.equal(credentialPatch('whatsapp', form, saved), null)
  assert.deepEqual(credentialPatch('whatsapp', { ...form, accessToken: 'EAAnew' }, saved), { accessToken: 'EAAnew' })
  assert.deepEqual(credentialPatch('whatsapp', { ...form, phoneNumberId: '456' }, saved), { phoneNumberId: '456' })
})

test('the field an API refusal names is read from the error body', () => {
  assert.equal(apiErrorField({ code: 'CHANNEL_VERIFY', field: 'accessToken' }), 'accessToken')
  assert.equal(apiErrorField({ code: 'VALIDATION' }), null)
  assert.equal(apiErrorField(undefined), null)
})
