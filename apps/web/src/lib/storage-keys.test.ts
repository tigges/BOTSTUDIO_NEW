import { test } from 'node:test'
import assert from 'node:assert/strict'
import { APP_STORAGE_KEY, THEME_STORAGE_KEY, migrateLegacyStorage, storedToken } from './storage-keys'

function memoryStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v) },
    removeItem: (k: string) => { data.delete(k) },
  }
}

test('a session and theme saved by the old build survive the rename', () => {
  const storage = memoryStorage({ 'ybot-app': JSON.stringify({ state: { token: 'tok-1' } }), 'ybot-theme': 'dark' })
  migrateLegacyStorage(storage)
  assert.equal(storedToken(storage), 'tok-1')
  assert.equal(storage.getItem(THEME_STORAGE_KEY), 'dark')
  assert.deepEqual([...storage.data.keys()].sort(), [APP_STORAGE_KEY, THEME_STORAGE_KEY].sort(), 'the old keys are gone')
})

test('a value already saved under the new name wins over a stale old one', () => {
  const storage = memoryStorage({ 'ybot-app': JSON.stringify({ state: { token: 'old' } }), [APP_STORAGE_KEY]: JSON.stringify({ state: { token: 'new' } }) })
  migrateLegacyStorage(storage)
  assert.equal(storedToken(storage), 'new')
  assert.equal(storage.getItem('ybot-app'), null)
  assert.doesNotThrow(() => migrateLegacyStorage(undefined))
  assert.equal(storedToken(memoryStorage({ [APP_STORAGE_KEY]: 'not json' })), null)
})
