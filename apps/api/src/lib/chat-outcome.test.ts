import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHAT_OUTCOMES, NO_TEAM_LINE, QUIET_CHATS_SQL, hasLiveAgentHours, keepWithBot, outcomeAfterStatus } from './chat-outcome.js'

test('only saved opening hours put live agents on the chat', () => {
  assert.equal(hasLiveAgentHours({}), false)
  assert.equal(hasLiveAgentHours(null), false)
  assert.equal(hasLiveAgentHours({ workingHours: { start: '09:00', end: '18:00', timezone: 'Europe/London' } }), true)
  assert.equal(hasLiveAgentHours({ workingHours: { start: '09:00', end: '18:00', enabled: false } }), false)
})

test('without opening hours the bot keeps the chat instead of promising a person', () => {
  assert.deepEqual(keepWithBot(['I am passing this chat to the BBC team. Someone will continue here.']), [NO_TEAM_LINE])
  assert.deepEqual(
    keepWithBot(['Colour correction needs someone at the studio to see your hair before we plan it. I am passing this chat to the studio.']),
    ['Colour correction needs someone at the studio to see your hair before we plan it.', NO_TEAM_LINE],
  )
  assert.equal((NO_TEAM_LINE.match(/\?/g) ?? []).length, 1)
})

test('the quiet-chat sweep only closes open chats nobody holds, and labels how each ended', () => {
  assert.match(QUIET_CHATS_SQL, /c\.status = 'active'/)
  assert.match(QUIET_CHATS_SQL, /c\."assignedTo" IS NULL/)
  assert.match(QUIET_CHATS_SQL, /last\."authorKind" IN \('bot', 'user'\)/)
  assert.match(QUIET_CHATS_SQL, /COALESCE\(c\.outcome/)
  for (const outcome of ['contained_resolved', 'contained_partial', 'contained_unresolved', 'abandoned']) {
    assert.ok(QUIET_CHATS_SQL.includes(`'${outcome}'`), outcome)
  }
  assert.ok(!QUIET_CHATS_SQL.includes("'escalated'"), 'the sweep never decides an escalation')
})

test('an Inbox status change records who finished the chat', () => {
  assert.equal(outcomeAfterStatus('escalated', null, null), 'escalated')
  assert.equal(outcomeAfterStatus('resolved', 'agent-1', 'contained_unresolved'), 'escalated')
  assert.equal(outcomeAfterStatus('closed', null, 'contained_partial'), 'contained_partial')
  assert.equal(outcomeAfterStatus('resolved', null, null), 'contained_resolved')
  assert.equal(outcomeAfterStatus('active', null, 'contained_resolved'), null)
  assert.equal(outcomeAfterStatus(undefined, 'agent-1', null), undefined)
})

test('outcomes are the five states the analytics roll up', () => {
  assert.deepEqual([...CHAT_OUTCOMES], ['contained_resolved', 'contained_partial', 'contained_unresolved', 'escalated', 'abandoned'])
})
