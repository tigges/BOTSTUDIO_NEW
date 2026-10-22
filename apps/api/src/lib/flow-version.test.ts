import assert from 'node:assert/strict'
import { test } from 'node:test'
import { versionForEnvironment, versionsForEnvironmentList } from '@botstudio/shared'

const versions = [
  { version: 14, status: 'published', environmentId: 'sandbox', graph: 'sandbox-welcome' },
  { version: 4, status: 'published', environmentId: 'production', graph: 'production-welcome' },
  { version: 2, status: 'draft', environmentId: null, graph: 'old-draft' },
  { version: 1, status: 'published', environmentId: 'production', graph: 'old-production' },
]

test('the list keeps the newest published graph for each environment', () => {
  const listed = versionsForEnvironmentList(versions)
  assert.deepEqual(listed.map((item) => item.version), [14, 4, 2])
})

test('sandbox and production open the same newest graph', () => {
  assert.equal(versionForEnvironment(versions, 'sandbox', 'sandbox')?.version, 14)
  assert.equal(versionForEnvironment(versions, 'production', 'production')?.version, 14)
})

test('a draft is the working copy on production too', () => {
  const draft = [{ version: 1, status: 'draft', environmentId: null }]
  assert.equal(versionForEnvironment(draft, 'sandbox', 'sandbox')?.version, 1)
  assert.equal(versionForEnvironment(draft, 'production', 'production')?.version, 1)
})
