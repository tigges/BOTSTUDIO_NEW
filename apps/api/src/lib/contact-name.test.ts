import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usableContactName } from './contact-name.js'

test('a real name can be said out loud', () => {
  assert.equal(usableContactName('Sarah'), 'Sarah')
  assert.equal(usableContactName('  Mary-Jane  '), 'Mary-Jane')
  assert.equal(usableContactName("O'Brien"), "O'Brien")
})

test('greetings, placeholders, and sentences are not names', () => {
  assert.equal(usableContactName('hi'), undefined)
  assert.equal(usableContactName('Hello!'), undefined)
  assert.equal(usableContactName('good morning'), undefined)
  assert.equal(usableContactName('Visitor'), undefined)
  assert.equal(usableContactName('Guest'), undefined)
  assert.equal(usableContactName('there'), undefined)
  assert.equal(usableContactName('I want a haircut'), undefined)
  assert.equal(usableContactName('help'), undefined)
  assert.equal(usableContactName('features'), undefined)
  assert.equal(usableContactName('N'), undefined)
  assert.equal(usableContactName('hi there'), undefined)
  assert.equal(usableContactName('book a colour'), undefined)
  assert.equal(usableContactName('cut'), undefined)
  assert.equal(usableContactName('services'), undefined)
  assert.equal(usableContactName('catalog'), undefined)
  assert.equal(usableContactName(''), undefined)
  assert.equal(usableContactName(null), undefined)
})
