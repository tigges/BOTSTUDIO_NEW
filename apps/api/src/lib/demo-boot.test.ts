import { test } from 'node:test'
import assert from 'node:assert/strict'
import { demoSeedOnBoot } from './demo-boot.js'

test('demo data is re-applied at start unless DEMO_SEED_ON_BOOT turns it off', () => {
  assert.equal(demoSeedOnBoot({}), true, 'a host whose compose file predates the flag keeps its demo data')
  for (const value of ['true', '1', 'yes', 'TRUE']) assert.equal(demoSeedOnBoot({ DEMO_SEED_ON_BOOT: value }), true, value)
  for (const value of ['false', '0', 'no', 'off', ' False ']) assert.equal(demoSeedOnBoot({ DEMO_SEED_ON_BOOT: value }), false, value)
})
