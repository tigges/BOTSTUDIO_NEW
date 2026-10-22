import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { productionSecretProblems } from './production-secrets.js'

const strong = 'a'.repeat(64)

test('a missing or published JWT_SECRET is fatal', () => {
  for (const jwt of [undefined, '', 'change-me-in-production', 'dev-secret-change-me', 'dev-only-jwt-secret']) {
    const problems = productionSecretProblems({ JWT_SECRET: jwt })
    assert.equal(problems.find((p) => p.key === 'JWT_SECRET')?.fatal, true, String(jwt))
  }
  assert.deepEqual(productionSecretProblems({ JWT_SECRET: strong }), [])
})

test('a short JWT_SECRET is reported but does not stop the API', () => {
  const [problem] = productionSecretProblems({ JWT_SECRET: 'short-but-private' })
  assert.equal(problem?.key, 'JWT_SECRET')
  assert.equal(problem?.fatal, false)
})

test('published database and Valkey passwords are reported, never fatal, and never echoed', () => {
  const problems = productionSecretProblems({
    JWT_SECRET: strong,
    DATABASE_URL: 'postgresql://ybot:ybotSecret123@postgres:5432/ybot',
    REDIS_URL: 'redis://:valkey123@valkey:6379',
  })
  assert.deepEqual(problems.map((p) => [p.key, p.fatal]), [['POSTGRES_PASSWORD', false], ['REDIS_PASSWORD', false]])
  for (const p of problems) assert.doesNotMatch(p.message, /ybotSecret123|valkey123/)
  assert.deepEqual(productionSecretProblems({
    JWT_SECRET: strong,
    DATABASE_URL: 'postgresql://ybot:s3cret-from-env@postgres:5432/ybot',
    REDIS_URL: 'redis://valkey:6379',
  }), [])
})

test('the API exits at start in production without a JWT_SECRET', () => {
  const entry = fileURLToPath(new URL('../index.ts', import.meta.url))
  const env = { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'change-me-in-production', PORT: '0', DATABASE_URL: 'postgresql://x:y@127.0.0.1:1/z' }
  const run = spawnSync(process.execPath, ['--import', 'tsx', entry], { env, encoding: 'utf8', timeout: 60_000 })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /JWT_SECRET is a published default/)
})
