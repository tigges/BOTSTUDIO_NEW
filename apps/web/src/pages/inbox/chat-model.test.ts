import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatName } from './chat-model'

test('a chat is named after its contact, a contact-less Journey Test after the test, anything else Unknown', () => {
  assert.equal(chatName({ contact: { displayName: 'Amira Hassan' } as never, subject: 'Journey Test: Talk to a person' }), 'Amira Hassan')
  assert.equal(chatName({ subject: 'Journey Test: Talk to a person' }), 'Journey Test')
  assert.equal(chatName({ subject: null }), 'Unknown')
})
