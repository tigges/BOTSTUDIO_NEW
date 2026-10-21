/**
 * Releases: what guests on Production hear.
 *
 * A release is a frozen copy of every chapter plus the welcome it opens on.
 * Publishing to Production makes a new release and points the environment at
 * it; rollback points it back at an older one. A bot that has never released
 * keeps playing its working copy (newest saved graph per chapter), so live
 * bots are not silenced by the upgrade. Sandbox and test chats always play
 * the working copy.
 */

import { prisma } from '@botstudio/db'
import { parseReleaseChapters, releaseDiff, withChapter, type ReleaseChapter, type ReleaseDiff } from '@botstudio/shared'
import { isEntryFlow, newestByFlow, pickEntry } from './entry-flow.js'
import type { VersionRow } from './flow-runner.js'
import { destinationPhrases, withDestination } from './welcome-routes.js'

export interface JourneySnapshot {
  chapters: ReleaseChapter[]
  entry?: string
}

export interface LiveRelease extends JourneySnapshot {
  id: string
  number: number
}

export class ReleaseError extends Error {
  constructor(public status: number, message: string, public code = 'RELEASE') {
    super(message)
  }
}

type VersionWithFlow = {
  id: string
  flowId: string
  version: number
  graph: unknown
  publishedAt: Date | null
  flow: { name: string; tags: string[] }
}

function toChapter(row: VersionWithFlow): ReleaseChapter {
  return { flowId: row.flowId, flowVersionId: row.id, version: row.version, name: row.flow.name, tags: row.flow.tags, graph: row.graph }
}

/** The welcome a snapshot opens on: a chapter tagged or named as the welcome, else the first. */
export function snapshotEntry(chapters: ReleaseChapter[]): string | undefined {
  return (chapters.find((chapter) => isEntryFlow({ name: chapter.name, tags: chapter.tags })) ?? chapters[0])?.name
}

/** Release chapters in the shape the journey runner reads. */
export function chapterRow(chapter: ReleaseChapter): VersionRow {
  return { id: chapter.flowVersionId, flowId: chapter.flowId, graph: chapter.graph, flow: { name: chapter.name, tags: chapter.tags } }
}

/** A chapter with no steps cannot play; a release leaves it out. */
export function hasSteps(graph: unknown): boolean {
  const nodes = graph && typeof graph === 'object' ? (graph as { nodes?: unknown }).nodes : undefined
  return Array.isArray(nodes) && nodes.length > 0
}

export async function workingCopy(botId: string): Promise<JourneySnapshot> {
  const versions = await prisma.flowVersion.findMany({ where: { flow: { botId } }, include: { flow: true } })
  const newest = newestByFlow(versions)
  return { chapters: newest.map(toChapter), entry: pickEntry(newest)?.flow.name }
}

const CACHE_MS = 5_000
const liveCache = new Map<string, { at: number; release: LiveRelease | null }>()

export function forgetLiveRelease(environmentId: string): void {
  liveCache.delete(environmentId)
}

/** The release an environment plays, or null when it plays the working copy. */
export async function liveRelease(environmentId: string): Promise<LiveRelease | null> {
  const cached = liveCache.get(environmentId)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.release
  const environment = await prisma.environment.findUnique({ where: { id: environmentId }, select: { liveReleaseId: true } })
  const row = environment?.liveReleaseId
    ? await prisma.botRelease.findUnique({ where: { id: environment.liveReleaseId } })
    : null
  const release = row
    ? { id: row.id, number: row.number, chapters: parseReleaseChapters(row.chapters), entry: row.entry ?? undefined }
    : null
  liveCache.set(environmentId, { at: Date.now(), release })
  return release
}

/** The release a Production chat plays, or null when it plays the working copy. */
export async function releaseForChat(conversationId: string): Promise<LiveRelease | null> {
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { environmentId: true, environment: { select: { kind: true } } },
  })
  if (!convo?.environmentId || convo.environment?.kind !== 'production') return null
  return liveRelease(convo.environmentId)
}

export async function productionEnvironment(botId: string, tenantId: string) {
  const environment = await prisma.environment.findFirst({ where: { botId, tenantId, kind: 'production' } })
  if (!environment) throw new ReleaseError(404, 'This bot has no Production environment.', 'NO_PRODUCTION')
  return environment
}

export interface Candidate {
  snapshot: JourneySnapshot
  /** What guests hear now: the live release, or the working copy when nothing is released yet. */
  live: JourneySnapshot
  liveReleaseId: string | null
  diff: ReleaseDiff
  /** The welcome learns a handoff to the published chapter; saved as a new version when the release lands. */
  welcomePatch?: { flowId: string; graph: unknown }
}

/**
 * The release that publishing would create. Without a chapter: the whole
 * working copy. With one: what guests hear now with that chapter swapped in.
 */
export async function releaseCandidate(botId: string, environmentId: string, chapterVersionId?: string): Promise<Candidate> {
  const release = await liveRelease(environmentId)
  const working = await workingCopy(botId)
  const live = release ?? { ...working, chapters: working.chapters.filter((chapter) => hasSteps(chapter.graph)) }
  let chapters = working.chapters
  let welcomePatch: Candidate['welcomePatch']
  if (chapterVersionId) {
    const row = await prisma.flowVersion.findUnique({ where: { id: chapterVersionId }, include: { flow: true } })
    if (!row || row.flow.botId !== botId) throw new ReleaseError(404, 'That chapter version no longer exists.', 'NO_VERSION')
    chapters = withChapter(live.chapters, toChapter(row))
    const phrases = destinationPhrases(row.flow.name)
    const welcomeName = snapshotEntry(chapters)
    const welcome = chapters.find((chapter) => chapter.name === welcomeName)
    if (phrases && welcome && welcome.flowId !== row.flowId) {
      const graph = withDestination(welcome.graph as Parameters<typeof withDestination>[0], row.flow.name, phrases)
      if (graph && JSON.stringify(graph) !== JSON.stringify(welcome.graph)) {
        welcomePatch = { flowId: welcome.flowId, graph }
        chapters = chapters.map((chapter) => (chapter.flowId === welcome.flowId ? { ...chapter, graph } : chapter))
      }
    }
  }
  chapters = chapters.filter((chapter) => hasSteps(chapter.graph) || chapter.flowVersionId === chapterVersionId)
  const snapshot = { chapters, entry: snapshotEntry(chapters) ?? working.entry }
  return { snapshot, live, liveReleaseId: release?.id ?? null, diff: releaseDiff(live.chapters, chapters), welcomePatch }
}

/** Saves the candidate as the next release and points the environment at it. */
export async function createRelease(opts: {
  tenantId: string
  botId: string
  environmentId: string
  candidate: Candidate
  note?: string
  evalRunIds: string[]
  createdBy?: string
}) {
  const { tenantId, botId, environmentId, candidate } = opts
  if (candidate.snapshot.chapters.length === 0) throw new ReleaseError(422, 'There is nothing to publish yet. Add a chapter on the Journey page first.', 'EMPTY')
  const published = await prisma.$transaction(async (tx) => {
    let chapters = candidate.snapshot.chapters
    const now = new Date()
    if (candidate.welcomePatch) {
      const latest = await tx.flowVersion.findFirst({ where: { flowId: candidate.welcomePatch.flowId }, orderBy: { version: 'desc' } })
      const created = await tx.flowVersion.create({
        data: {
          tenantId,
          flowId: candidate.welcomePatch.flowId,
          version: (latest?.version ?? 0) + 1,
          status: 'published',
          environmentId,
          graph: candidate.welcomePatch.graph as object,
          publishedAt: now,
        },
      })
      chapters = chapters.map((chapter) => (chapter.flowId === created.flowId ? { ...chapter, flowVersionId: created.id, version: created.version } : chapter))
    }
    const last = await tx.botRelease.findFirst({ where: { botId, environmentId }, orderBy: { number: 'desc' }, select: { number: true } })
    const release = await tx.botRelease.create({
      data: {
        tenantId,
        botId,
        environmentId,
        number: (last?.number ?? 0) + 1,
        chapters: chapters as unknown as object,
        entry: candidate.snapshot.entry ?? null,
        note: opts.note?.trim() || null,
        evalRunIds: opts.evalRunIds,
        createdBy: opts.createdBy ?? null,
      },
    })
    await tx.environment.update({ where: { id: environmentId }, data: { liveReleaseId: release.id } })
    const drafts = chapters.map((chapter) => chapter.flowVersionId)
    await tx.flowVersion.updateMany({
      where: { id: { in: drafts }, status: { not: 'published' } },
      data: { status: 'published', environmentId, publishedAt: now },
    })
    return release
  })
  forgetLiveRelease(environmentId)
  return published
}

/** Points the environment back at an older release. Nothing is copied or edited. */
export async function rollback(opts: { botId: string; tenantId: string; releaseId: string }) {
  const release = await prisma.botRelease.findFirst({ where: { id: opts.releaseId, botId: opts.botId, tenantId: opts.tenantId } })
  if (!release) throw new ReleaseError(404, 'That release no longer exists.', 'NO_RELEASE')
  await prisma.environment.update({ where: { id: release.environmentId }, data: { liveReleaseId: release.id } })
  forgetLiveRelease(release.environmentId)
  return release
}

export interface ReleaseListItem {
  id: string
  number: number
  note: string | null
  createdAt: Date
  createdBy: string | null
  live: boolean
  chapters: Array<{ name: string; version: number }>
  evalRunIds: string[]
  /** Compared with the release before it. */
  diff: ReleaseDiff
}

export async function listReleases(botId: string, environmentId: string, liveReleaseId: string | null): Promise<ReleaseListItem[]> {
  const rows = await prisma.botRelease.findMany({ where: { botId, environmentId }, orderBy: { number: 'desc' }, take: 50 })
  const parsed = rows.map((row) => ({ row, chapters: parseReleaseChapters(row.chapters) }))
  return parsed.map(({ row, chapters }, index) => ({
    id: row.id,
    number: row.number,
    note: row.note,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    live: row.id === liveReleaseId,
    chapters: chapters.map((chapter) => ({ name: chapter.name, version: chapter.version })),
    evalRunIds: row.evalRunIds,
    diff: releaseDiff(parsed[index + 1]?.chapters ?? [], chapters),
  }))
}
