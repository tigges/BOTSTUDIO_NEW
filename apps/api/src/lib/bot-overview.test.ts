import { test } from 'node:test'
import assert from 'node:assert/strict'
import { botStage, filledBusinessFields, setupChecklist, type BotFootprint } from '@ybot/shared'
import { costPerChat } from './bot-overview.js'

const blank: BotFootprint = {
  businessFields: 0,
  knowledgeItems: 0,
  flows: 0,
  tools: 0,
  productionChannels: 0,
  sandboxChats: 0,
  productionChats7d: 0,
  liveRelease: null,
}

test('a bot with nothing built is empty, anything built makes it building', () => {
  assert.equal(botStage(blank), 'empty')
  assert.equal(botStage({ ...blank, flows: 1 }), 'building')
  assert.equal(botStage({ ...blank, knowledgeItems: 3 }), 'building')
  assert.equal(botStage({ ...blank, productionChannels: 1, sandboxChats: 4 }), 'empty')
})

test('a live Production release makes it live, even with no chats yet', () => {
  assert.equal(botStage({ ...blank, liveRelease: 1 }), 'live')
  assert.equal(botStage({ ...blank, flows: 2, liveRelease: 4, productionChats7d: 0 }), 'live')
})

test('the checklist ticks off what the footprint shows, in setup order', () => {
  const items = setupChecklist({ ...blank, businessFields: 5, flows: 1, sandboxChats: 2 })
  assert.deepEqual(items.map((item) => item.id), ['business', 'knowledge', 'journey', 'sandbox', 'channel', 'publish'])
  assert.deepEqual(items.filter((item) => item.done).map((item) => item.id), ['business', 'journey', 'sandbox'])
  assert.ok(items.every((item) => item.path.startsWith('/')))
})

test('business fields count only the ones with a value', () => {
  assert.equal(filledBusinessFields({}), 0)
  assert.equal(filledBusinessFields(null), 0)
  assert.equal(filledBusinessFields({ fields: {
    phone: { value: '01234 567890' },
    email: { value: '  ' },
    hours: { value: [] },
    services: { value: [{ name: 'Check-up' }] },
    parking: { value: null },
    deposit: { value: 0 },
  } }), 3)
})

test('cost per chat is a dash with no chats or no ledger rows, never zero', () => {
  assert.equal(costPerChat(null, 10), null)
  assert.equal(costPerChat(1.2, 0), null)
  assert.equal(costPerChat(1.2, 4), 0.3)
})
