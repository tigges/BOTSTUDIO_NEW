/**
 * Values that shipped as defaults in the compose files and env templates. A
 * production server that still uses one is reachable with a password anyone
 * can read in this repository.
 */
const KNOWN_DEFAULTS = new Set([
  'change-me-in-production',
  'change-me-in-production-min-32-chars-long',
  'change-me-to-a-random-64-char-secret',
  '<replace-with-64-char-random-hex>',
  '<replace-with-strong-password>',
  'dev-secret-change-me',
  'ybotSecret123',
  'valkey123',
  'dev-only-postgres-password',
  'dev-only-valkey-password',
  'dev-only-jwt-secret',
])

export interface SecretProblem {
  key: string
  /** Fatal problems stop the API in production. */
  fatal: boolean
  message: string
}

function urlPassword(url: string | undefined): string | null {
  if (!url) return null
  try {
    const password = decodeURIComponent(new URL(url).password)
    return password || null
  } catch {
    return null
  }
}

export function isKnownDefault(value: string | undefined | null): boolean {
  return Boolean(value) && KNOWN_DEFAULTS.has(value!.trim())
}

/**
 * JWT_SECRET signs every session and, without SECRETS_KEY, seals Auth Profile
 * secrets, so a missing or default value is fatal. The database and Valkey
 * passwords are reported but do not stop the API: they are set on the data
 * stores themselves, and the compose file already refuses to start without them.
 */
export function productionSecretProblems(env: NodeJS.ProcessEnv): SecretProblem[] {
  const problems: SecretProblem[] = []
  const jwt = env['JWT_SECRET']?.trim()
  if (!jwt) {
    problems.push({ key: 'JWT_SECRET', fatal: true, message: 'JWT_SECRET is not set. Generate one with `openssl rand -hex 32` and add it to .env.production.' })
  } else if (isKnownDefault(jwt)) {
    problems.push({ key: 'JWT_SECRET', fatal: true, message: 'JWT_SECRET is a published default. Generate one with `openssl rand -hex 32`. Changing it signs everyone out, and without SECRETS_KEY every Auth Profile secret must be entered again.' })
  } else if (jwt.length < 32) {
    problems.push({ key: 'JWT_SECRET', fatal: false, message: 'JWT_SECRET is shorter than 32 characters. Use `openssl rand -hex 32`.' })
  }
  if (isKnownDefault(urlPassword(env['DATABASE_URL']))) {
    problems.push({ key: 'POSTGRES_PASSWORD', fatal: false, message: 'The database password is a published default. Change it in Postgres (ALTER USER) and in .env.production.' })
  }
  if (isKnownDefault(urlPassword(env['REDIS_URL']))) {
    problems.push({ key: 'REDIS_PASSWORD', fatal: false, message: 'The Valkey password is a published default. Set REDIS_PASSWORD in .env.production and recreate the valkey and api containers.' })
  }
  return problems
}

/** Stops the process in production when a fatal secret problem is found. */
export function assertProductionSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (env['NODE_ENV'] !== 'production') return
  const problems = productionSecretProblems(env)
  for (const problem of problems) console.error(`[secrets] ${problem.message}`)
  if (problems.some((p) => p.fatal)) {
    console.error('[secrets] The API will not start in production until JWT_SECRET is fixed.')
    process.exit(1)
  }
}
