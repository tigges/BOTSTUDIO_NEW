import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fillNameTokens, isNameVariable, nameForSpeech } from '@ybot/shared'
import { fillNameTokens as localFill, isNameVariable as localIsName, nameForSpeech as localName } from './contact-speech.js'

test('runtime name speech matches the shared rules', () => {
  const samples = ['Sarah', 'Sarah Jones', 'hi', 'Visitor', '{{contact.name}}', '', 'Maya Chen', 'there']
  for (const sample of samples) {
    assert.equal(localName(sample), nameForSpeech(sample))
    assert.equal(localFill('Hi {{ contact.name }} and {{customer.name}}', sample), fillNameTokens('Hi {{ contact.name }} and {{customer.name}}', sample))
  }
  assert.equal(localIsName('user.name'), isNameVariable('user.name'))
  assert.equal(localIsName('order.number'), isNameVariable('order.number'))
  assert.equal(localName(undefined), nameForSpeech(undefined))
})

test('the flow runner does not import a workspace package', () => {
  const source = readFileSync(fileURLToPath(new URL('./utils.ts', import.meta.url)), 'utf8')
  assert.doesNotMatch(source, /@ybot\//)
})
