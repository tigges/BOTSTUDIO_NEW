import assert from 'node:assert/strict'
import { test } from 'node:test'
import { knowledgeTabs, navItemActive } from './build-nav.ts'

test('Journey stays lit on the flow list and on any flow', () => {
  assert.equal(navItemActive('journey', '/build/journey', '/build/journey'), true)
  assert.equal(navItemActive('journey', '/build/journey', '/build/flows'), true)
  assert.equal(navItemActive('inbox', '/inbox', '/inbox/tasks'), true)
  assert.equal(navItemActive('inbox', '/inbox', '/inboxes'), false)
  assert.equal(navItemActive('journey', '/build/journey', '/build/flows/abc'), true)
  assert.equal(navItemActive('journey', '/build/journey', '/build/workflows'), false)
})

test('Knowledge stays lit on every knowledge tab, not only Sources', () => {
  for (const tab of ['sources', 'documents', 'search', 'faqs', 'intents']) {
    assert.equal(navItemActive('knowledge', '/build/knowledge/sources', `/build/knowledge/${tab}`), true, tab)
  }
  assert.equal(navItemActive('knowledge', '/build/knowledge/sources', '/build/business'), false)
})

test('other items match their own path and children', () => {
  assert.equal(navItemActive('bot-settings', '/build/settings', '/build/settings'), true)
  assert.equal(navItemActive('settings', '/settings', '/build/settings'), false)
  assert.equal(navItemActive('tools', '/build/tools', '/build/tools/x'), true)
})

test('Intents and Entities show only for a bot that uses them', () => {
  const labels = (counts: { intents?: number; entities?: number }, path = '/build/knowledge/sources') => knowledgeTabs(counts, path).map((tab) => tab.label)
  assert.deepEqual(labels({ intents: 0, entities: 0 }), ['Sources', 'Documents', 'Search & Test'])
  assert.deepEqual(labels({}), ['Sources', 'Documents', 'Search & Test'])
  assert.deepEqual(labels({ intents: 2, entities: 0 }), ['Sources', 'Documents', 'Search & Test', 'Intents'])
  assert.deepEqual(labels({ intents: 1, entities: 3 }), ['Sources', 'Documents', 'Search & Test', 'Intents', 'Entities'])
})

test('an open Intents or Entities page keeps its tab even when empty', () => {
  assert.deepEqual(knowledgeTabs({}, '/build/knowledge/entities').map((tab) => tab.label), ['Sources', 'Documents', 'Search & Test', 'Entities'])
})
