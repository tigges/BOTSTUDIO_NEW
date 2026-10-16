import assert from 'node:assert/strict'
import { test } from 'node:test'
import { visitorTurn } from './widget-open.js'

test('opening an empty chat greets without burning a fake hi', () => {
  assert.deepEqual(visitorTurn({ opening: true }), { text: '', showVisitor: false })
  assert.deepEqual(visitorTurn({ message: '   ', opening: true }), { text: '', showVisitor: false })
})

test('a typed message stays in the transcript', () => {
  assert.deepEqual(visitorTurn({ message: 'what are your hours?', opening: true }), {
    text: 'what are your hours?',
    showVisitor: true,
  })
  assert.equal(visitorTurn({ message: '  ' }), null)
})
