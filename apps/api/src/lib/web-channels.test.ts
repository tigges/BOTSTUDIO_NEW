import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canRemoveWebChannel, environmentsMissingWeb, webChannelName } from './web-channels.js'

test('website chat has one name — sandbox and production are the top-bar layer', () => {
  assert.equal(webChannelName('sandbox'), 'Website chat')
  assert.equal(webChannelName('production'), 'Website chat')
})

test('each environment gets its own website chat', () => {
  const missing = environmentsMissingWeb(
    [
      { id: 'sandbox', kind: 'sandbox' },
      { id: 'prod', kind: 'production' },
    ],
    [{ environmentId: 'prod', kind: 'web' }],
  )
  assert.deepEqual(missing, [{ id: 'sandbox', kind: 'sandbox' }])
  assert.deepEqual(
    environmentsMissingWeb(
      [
        { id: 'sandbox', kind: 'sandbox' },
        { id: 'prod', kind: 'production' },
      ],
      [
        { environmentId: 'sandbox', kind: 'web' },
        { environmentId: 'prod', kind: 'web' },
      ],
    ),
    [],
  )
})

test('the last website chat on an environment stays', () => {
  const channels = [
    { id: 'live', kind: 'web', environmentId: 'prod' },
    { id: 'test', kind: 'web', environmentId: 'sandbox' },
    { id: 'wa', kind: 'whatsapp', environmentId: 'prod' },
  ]
  assert.equal(canRemoveWebChannel(channels, 'live'), false)
  assert.equal(canRemoveWebChannel(channels, 'test'), false)
  assert.equal(canRemoveWebChannel(channels, 'wa'), true)
  assert.equal(
    canRemoveWebChannel(
      [...channels, { id: 'live-2', kind: 'web', environmentId: 'prod' }],
      'live',
    ),
    true,
  )
})
