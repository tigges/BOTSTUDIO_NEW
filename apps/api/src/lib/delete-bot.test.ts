import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deleteBotRecords, type BotRemover } from './delete-bot.js'

function fakeDb(found: boolean): { db: BotRemover; calls: string[] } {
  const calls: string[] = []
  const note = (name: string) => {
    calls.push(name)
    return Promise.resolve({})
  }
  const db: BotRemover = {
    bot: {
      findFirst: async () => (found ? { id: 'bot-1' } : null),
      delete: () => note('bot'),
    },
    flow: {
      findMany: async () => {
        calls.push('flows')
        return found ? [{ id: 'flow-1' }] : []
      },
    },
    flowSession: { deleteMany: () => note('sessions') },
    conversation: { deleteMany: () => note('conversations') },
    channel: { deleteMany: () => note('channels') },
    flowVersion: { deleteMany: () => note('versions') },
    templateOptimization: { deleteMany: () => note('optimizations') },
    team: { updateMany: () => note('teams') },
  }
  return { db, calls }
}

test('a missing bot is left untouched', async () => {
  const { db, calls } = fakeDb(false)
  assert.equal(await deleteBotRecords(db, 'tenant-1', 'bot-1'), 'missing')
  assert.deepEqual(calls, [])
})

test('chats and channels go before the bot, and contacts are not touched', async () => {
  const { db, calls } = fakeDb(true)
  assert.equal(await deleteBotRecords(db, 'tenant-1', 'bot-1'), 'deleted')
  assert.deepEqual(calls, [
    'flows',
    'sessions',
    'conversations',
    'channels',
    'versions',
    'optimizations',
    'teams',
    'bot',
  ])
  assert.equal(calls.includes('contacts'), false)
})
