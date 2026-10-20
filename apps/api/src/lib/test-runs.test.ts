import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handoverProblems, signRunToken, verifyRunToken } from './test-runs.js'

test('a run token verifies only with the secret that signed it, and only unchanged', () => {
  const token = signRunToken('run_123', 'secret-a')
  assert.equal(verifyRunToken(token, 'secret-a'), 'run_123')
  assert.equal(verifyRunToken(token, 'secret-b'), undefined)
  assert.equal(verifyRunToken(token.replace('run_123', 'run_124'), 'secret-a'), undefined)
  assert.equal(verifyRunToken(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, 'secret-a'), undefined)
  assert.equal(verifyRunToken('run_123', 'secret-a'), undefined)
  assert.equal(verifyRunToken('run_123.', 'secret-a'), undefined)
  assert.equal(verifyRunToken(undefined, 'secret-a'), undefined)
  assert.equal(verifyRunToken(['x'], 'secret-a'), undefined)
})

const complete = {
  reason: 'Dental emergency with a red flag.',
  priority: 'critical',
  tags: ['emergency'],
  summary: 'Knocked-out tooth.',
  variables: { red_flags: 'tooth out' },
  routing: { queue: 'emergencies', skills: ['triage'], priority: 90 },
  context: 'full_transcript',
}

test('a complete handover payload has no problems', () => {
  assert.deepEqual(handoverProblems(complete), [])
  assert.deepEqual(handoverProblems({ ...complete, context: 'summary_only', returned: { outcome: 'resolved' } }), [])
})

test('each missing part of the handover payload is named', () => {
  assert.ok(handoverProblems(null).length > 0)
  const { reason: _reason, summary: _summary, ...rest } = complete
  const problems = handoverProblems({ ...rest, priority: 'urgent', tags: 'emergency', routing: { queue: 'emergencies', skills: [], priority: 'high' }, context: 'none', returned: { outcome: 'done' } })
  assert.ok(problems.length >= 6, problems.join('; '))
  assert.ok(problems.includes('no summary'))
  assert.ok(problems.includes('no transcript setting'))
})
