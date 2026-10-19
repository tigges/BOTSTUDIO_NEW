import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { streamDoneEvent } from './widget-rating.js'

test('a waiting welcome turn does not ask for a rating', () => {
  assert.deepEqual(streamDoneEvent(false), { done: true })
  assert.deepEqual(streamDoneEvent(undefined), { done: true })
})

test('a finished flow asks for a rating', () => {
  assert.deepEqual(streamDoneEvent(true), { done: true, ended: true })
})

test('the widget script rates only a finished flow and does not ask for a name', () => {
  const source = readFileSync(new URL('../routes/widget.ts', import.meta.url), 'utf8')
  assert.match(source, /function updMsg\(i,text,streaming,ended\)/)
  assert.match(source, /if\(d\.done\)\{live=!!d\.live;updMsg\(bi,botText,false,!!d\.ended\);\}/)
  assert.match(source, /if\(!botText&&live\)\{messages\.splice\(bi,1\);render\(\);\}/)
  assert.match(source, /'\/replies\?session='/)
  assert.doesNotMatch(source, /What's your name/)
})
