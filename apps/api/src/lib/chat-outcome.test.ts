import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NO_TEAM_LINE, QUIET_CHATS_SQL, hasLiveAgentHours, keepWithBot } from './chat-outcome.js'

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

test('the quiet-chat sweep only closes open chats nobody holds where the bot spoke last', () => {
  assert.match(QUIET_CHATS_SQL, /c\.status = 'active'/)
  assert.match(QUIET_CHATS_SQL, /c\."assignedTo" IS NULL/)
  assert.match(QUIET_CHATS_SQL, /last\."authorKind" = 'bot'/)
  assert.match(QUIET_CHATS_SQL, /SET status = 'resolved'/)
})
