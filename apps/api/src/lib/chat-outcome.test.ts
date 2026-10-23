import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHAT_OUTCOMES, NO_TEAM_LINE, QUIET_CHATS_SQL, hasLiveAgents, keepWithBot, noTeamLine, outcomeAfterStatus } from './chat-outcome.js'

const tuesdayNoon = new Date('2026-09-22T11:00:00Z')
const tuesdayNight = new Date('2026-09-22T21:00:00Z')

test('live agents are on the chat only when live support is on and the team is in', () => {
  assert.equal(hasLiveAgents({}, tuesdayNoon), false)
  assert.equal(hasLiveAgents(null, tuesdayNoon), false)
  const hours = { start: '09:00', end: '18:00', timezone: 'Europe/London' }
  assert.equal(hasLiveAgents({ workingHours: hours }, tuesdayNoon), true)
  assert.equal(hasLiveAgents({ workingHours: hours }, tuesdayNight), false)
  assert.equal(hasLiveAgents({ workingHours: { ...hours, enabled: false } }, tuesdayNoon), false)
  assert.equal(hasLiveAgents({ workingHours: hours, liveSupport: { enabled: false } }, tuesdayNoon), false)
  assert.equal(hasLiveAgents({ workingHours: { ...hours, enabled: false }, liveSupport: { enabled: true } }, tuesdayNight), true)
})

test('outside the hours the bot says when the team is back', () => {
  assert.equal(noTeamLine({ state: 'off', hours: null }), NO_TEAM_LINE)
  const closed = noTeamLine({ state: 'closed', hours: 'Mon-Fri 09:00-18:00 (Europe/London)' })
  assert.match(closed, /^The team is on chat Mon-Fri 09:00-18:00 \(Europe\/London\)/)
  assert.equal((closed.match(/\?/g) ?? []).length, 1)
  assert.deepEqual(keepWithBot(['I am passing this chat to the team.'], closed), [closed])
})

test('without opening hours the bot keeps the chat instead of promising a person', () => {
  assert.deepEqual(keepWithBot(['I am passing this chat to the BBC team. Someone will continue here.']), [NO_TEAM_LINE])
  assert.deepEqual(
    keepWithBot(['Colour correction needs someone at the studio to see your hair before we plan it. I am passing this chat to the studio.']),
    ['Colour correction needs someone at the studio to see your hair before we plan it.', NO_TEAM_LINE],
  )
  assert.equal((NO_TEAM_LINE.match(/\?/g) ?? []).length, 1)
})

test('a promise that someone will reply is dropped too, in the wordings bots are written with', () => {
  for (const line of [
    "I'm passing this chat to our reception team. Someone will reply here.",
    'Thanks. Someone will be with you shortly.',
    'Our team will get back to you in this chat.',
    "A colleague'll reply soon.",
  ]) {
    const kept = keepWithBot([line])
    assert.equal(kept.at(-1), NO_TEAM_LINE, line)
    assert.doesNotMatch(kept.join(' '), /someone|team will|colleague/i, line)
  }
  assert.deepEqual(keepWithBot(['The team will love your smile.']), ['The team will love your smile.', NO_TEAM_LINE])
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
