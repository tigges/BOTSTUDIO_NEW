import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchesTask, taskPriority } from './tasks'

test('old priority names map onto the handoff scale', () => {
  assert.equal(taskPriority('urgent'), 'critical')
  assert.equal(taskPriority('normal'), 'medium')
  assert.equal(taskPriority('high'), 'high')
  assert.equal(taskPriority('whatever'), 'medium')
})

test('tasks match on subject or contact, and on priority', () => {
  const task = { subject: 'Call back about the refund', contact: 'Ana Lima', priority: 'high' as const }
  assert.equal(matchesTask(task, { search: 'REFUND', priority: 'all' }), true)
  assert.equal(matchesTask(task, { search: 'ana', priority: 'high' }), true)
  assert.equal(matchesTask(task, { search: '', priority: 'low' }), false)
  assert.equal(matchesTask(task, { search: 'invoice', priority: 'all' }), false)
})
