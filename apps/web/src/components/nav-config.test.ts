import assert from 'node:assert/strict'
import { test } from 'node:test'
import { visibleNavGroups } from './nav-config.ts'

const ids = (platformAdmin: boolean) => visibleNavGroups(platformAdmin).flatMap((group) => group.items.map((item) => item.id))

test('System Status is only in the rail for the people who run the installation', () => {
  assert.equal(ids(false).includes('system-status'), false)
  assert.equal(ids(true).includes('system-status'), true)
  assert.ok(ids(false).includes('settings'), 'a customer admin keeps their own Settings')
  assert.ok(ids(false).includes('team'))
})

test('a group with nothing left to show is dropped', () => {
  const groups = visibleNavGroups(false, [
    { label: 'Ops', items: [{ id: 'x', label: 'X', icon: (() => null) as never, path: '/x', platformOnly: true }] },
    { label: 'Build', items: [{ id: 'y', label: 'Y', icon: (() => null) as never, path: '/y' }] },
  ])
  assert.deepEqual(groups.map((group) => group.label), ['Build'])
})
