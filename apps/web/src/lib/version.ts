/**
 * The deployed build comes from the API at runtime (`/system/version`), so the
 * web image does not change, and is not redeployed, when only the API changed.
 * The constants below are the fallback for the static demo build, which has no
 * API and receives its values from vite.config.ts.
 */

export interface AppBuildInfo {
  version:     string   // e.g. "1.1.26"; the patch number is the CI build number
  buildNumber: string   // CI run number, e.g. "42"; "local" in dev
  gitSha:      string   // full git SHA; "dev" in local
  buildDate:   string   // ISO-8601 date; empty when unknown
}

export const buildInfo: AppBuildInfo = {
  version:     __APP_VERSION__,
  buildNumber: __BUILD_NUMBER__,
  gitSha:      __GIT_SHA__,
  buildDate:   __BUILD_DATE__,
}

/** Short label for compact display: "v1.1.26" (patch = build number) */
export function shortVersion(info: AppBuildInfo = buildInfo): string {
  const suffix = info.buildNumber === 'local' ? '-dev' : ''
  return `v${info.version}${suffix}`
}

/** Full label for tooltip: "v1.1.26 · abc1234 · 2026-09-21" */
export function fullVersion(info: AppBuildInfo = buildInfo): string {
  const date = info.buildDate ? new Date(info.buildDate).toLocaleDateString() : ''
  const sha  = info.gitSha !== 'dev' ? ` · ${info.gitSha.slice(0, 7)}` : ''
  return `v${info.version}${sha}${date ? ' · ' + date : ''}`
}
