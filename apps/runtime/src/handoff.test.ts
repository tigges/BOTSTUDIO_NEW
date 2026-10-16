import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copyJumpVariables, missingChapterLine } from './handoff.js'

test('a jump keeps the request and the name', () => {
  const next = copyJumpVariables(
    { flow: { topic: 'how much is a haircut', guest_name: 'Ada' }, global: { site: 'yuzu' }, contact: { name: 'Ada' } },
    'Ada',
    'Ada',
  )
  assert.equal(next.flow['topic'], 'how much is a haircut')
  assert.equal(next.flow['guest_name'], 'Ada')
  assert.equal(next.flow['_last_user_message'], 'Ada')
  assert.equal(next.global['site'], 'yuzu')
  assert.equal(next.contact['name'], 'Ada')
})

test('a missing chapter names the map it is not on', () => {
  assert.equal(missingChapterLine('Location', 'Production'), 'Location is not on this Production map.')
  assert.equal(missingChapterLine('  ', 'Sandbox'), 'The welcome is not on this Sandbox map.')
})
