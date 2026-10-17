import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Acme owned inbox keeps Bob Smith and arrived damaged for live QA', () => {
  const source = readFileSync(new URL('./ensure-demos.ts', import.meta.url), 'utf8')
  assert.match(source, /const ACME_NAMES = \['Alice Johnson', 'Bob Smith'/)
  assert.match(source, /The kettle in my order arrived damaged/)
  assert.match(source, /enrich-acme/)
  assert.equal(/Alex \$\{i \+ 1\}/.test(source), false)
})

test('demo traffic pins owned enrich chats after each batch', () => {
  const source = readFileSync(new URL('../lib/demo-traffic.ts', import.meta.url), 'utf8')
  assert.match(source, /pinOwnedInbox/)
  assert.match(source, /enrich-acme/)
  assert.match(source, /enrich-bella/)
})
