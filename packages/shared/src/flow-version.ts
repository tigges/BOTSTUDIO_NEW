export interface ListedVersion {
  version: number
  status: string
  environmentId?: string | null
}

/** Newest published version for one environment, plus the newest draft. */
export function versionsForEnvironmentList<T extends ListedVersion>(versions: T[]): T[] {
  const sorted = [...versions].sort((a, b) => b.version - a.version)
  const picked: T[] = []
  const seen = new Set<string>()
  let draft: T | undefined
  for (const version of sorted) {
    if (version.status === 'published' && version.environmentId) {
      if (seen.has(version.environmentId)) continue
      seen.add(version.environmentId)
      picked.push(version)
      continue
    }
    if (!draft && version.status !== 'published') draft = version
  }
  if (draft) picked.push(draft)
  return picked.sort((a, b) => b.version - a.version)
}

/**
 * The canvas, map, and Test Bot open this version.
 * Sandbox and Production share the newest saved graph until a client
 * needs a separate live copy.
 */
export function versionForEnvironment<T extends ListedVersion>(
  versions: T[] | undefined,
  _environmentId?: string | null,
  _kind?: string,
): T | undefined {
  const list = [...(versions ?? [])].sort((a, b) => b.version - a.version)
  return list[0]
}
