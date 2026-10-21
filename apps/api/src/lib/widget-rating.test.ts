import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { streamDoneEvent, webChoices } from './widget-rating.js'

test('a waiting welcome turn does not ask for a rating', () => {
  assert.deepEqual(streamDoneEvent(false), { done: true })
  assert.deepEqual(streamDoneEvent(undefined), { done: true })
})

test('a finished flow asks for a rating', () => {
  assert.deepEqual(streamDoneEvent(true), { done: true, ended: true })
})

test('an open question sends its choices as chips, but not once a person has the chat', () => {
  const two = webChoices(['Check-up', 'Hygiene'])
  assert.deepEqual(two, { replies: ['Check-up', 'Hygiene'], extra: '' })
  assert.deepEqual(streamDoneEvent(false, false, two.replies), { done: true, replies: ['Check-up', 'Hygiene'] })
  assert.deepEqual(streamDoneEvent(false, true, two.replies), { done: true, live: true })
})

test('more choices than the widget shows are listed by number, never dropped', () => {
  const many = webChoices(Array.from({ length: 12 }, (_, i) => `Option ${i + 1}`))
  assert.deepEqual(many.replies, [])
  assert.match(many.extra, /^\n\n1\. Option 1\n2\. Option 2/)
  assert.match(many.extra, /12\. Option 12\n\nReply with a number or the words\.$/)
})

test('the widget script rates only a finished flow and does not ask for a name', () => {
  const source = readFileSync(new URL('../routes/widget.ts', import.meta.url), 'utf8')
  assert.match(source, /function updMsg\(i,text,streaming,ended\)/)
  assert.match(source, /if\(d\.done\)\{live=!!d\.live;if\(messages\[bi\]\)messages\[bi\]\.replies=d\.replies\|\|null;updMsg\(bi,botText,false,!!d\.ended\);\}/)
  assert.match(source, /if\(!botText&&live\)\{messages\.splice\(bi,1\);render\(\);\}/)
  assert.match(source, /'\/replies\?session='/)
  assert.doesNotMatch(source, /What's your name/)
})
