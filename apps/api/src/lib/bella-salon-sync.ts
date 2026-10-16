import { graphKeepsLearning } from '@ybot/shared'
import { graphAction } from './copy-graphs.js'

/** The retail starter welcome. Bella's public page should not speak it. */
export function isShopWelcomeGraph(name: string, graph: unknown): boolean {
  if (name !== 'Welcome & Routing') return false
  const text = JSON.stringify(graph).toLowerCase()
  return text.includes('billing') && (text.includes('return') || text.includes('order'))
}

/**
 * Pack refresh skips an environment whose published chart already carries
 * a learning route. Other environments still receive the pack when their
 * published copy is missing or older.
 */
export function environmentsToRefresh(
  graph: unknown,
  published: Array<{ environmentId: string; graph: unknown }>,
  environmentIds: string[],
): string[] {
  const open = environmentIds.filter((environmentId) => {
    const current = published.find((item) => item.environmentId === environmentId)
    return !current || !graphKeepsLearning(current.graph)
  })
  return environmentsNeedingGraph(graph, published, open)
}

export function environmentsNeedingGraph(
  graph: unknown,
  published: Array<{ environmentId: string; graph: unknown }>,
  environmentIds: string[],
): string[] {
  return environmentIds.filter((environmentId) => {
    const current = published.find((item) => item.environmentId === environmentId)
    return graphAction(current?.graph ?? null, graph) !== 'keep'
  })
}

/** Prisma unique constraint, including (flowId, version). */
export function isUniqueConstraint(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: unknown }).code === 'P2002')
}

/** Runs work again when two seeds pick the same flow version number. */
export async function retryOnUnique<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await run()
    } catch (err) {
      last = err
      if (!isUniqueConstraint(err) || attempt === attempts - 1) throw err
    }
  }
  throw last
}
