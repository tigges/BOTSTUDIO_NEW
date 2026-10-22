import { prisma } from '@botstudio/db'
import {
  businessDocuments,
  type Blueprint,
  type BusinessProfile,
} from '@botstudio/shared'
import { upsertStudioCatalog } from './studio-catalog.js'
import { forgetGuardrails } from './guardrails.js'
import { enqueueKnowledgeSync } from '../queues.js'

export const BUSINESS_SOURCE_KIND = 'business'
export const BUSINESS_SOURCE_NAME = 'Business details'

export interface BlueprintInstallResult {
  chapters: string[]
  facts: number
  documents: number
  websiteSource: WebsiteSourceRef | null
  guardrailPolicy: string
  evalSuite: string
}

/**
 * Rewrites the "Business details" Knowledge source: one document per filled field,
 * each pointing at the page it came from. Chunks are embedded by the knowledge worker.
 */
export async function syncBusinessKnowledge(tenantId: string, botId: string, blueprint: Blueprint, profile: BusinessProfile): Promise<number> {
  const documents = businessDocuments(blueprint.fields, profile)
  const config = { blueprintId: blueprint.id, websiteUrl: profile.websiteUrl ?? null, fields: documents.length }
  let source = await prisma.knowledgeSource.findFirst({ where: { tenantId, botId, kind: BUSINESS_SOURCE_KIND } })
  if (source) {
    await prisma.document.deleteMany({ where: { tenantId, knowledgeSourceId: source.id } })
    source = await prisma.knowledgeSource.update({ where: { id: source.id }, data: { config, lastSyncAt: new Date() } })
  } else {
    source = await prisma.knowledgeSource.create({
      data: { tenantId, botId, name: BUSINESS_SOURCE_NAME, kind: BUSINESS_SOURCE_KIND, config, lastSyncAt: new Date() },
    })
  }
  if (documents.length) {
    await prisma.document.createMany({
      data: documents.map((doc) => ({
        tenantId,
        knowledgeSourceId: source.id,
        title: doc.title.slice(0, 180),
        content: doc.content,
        status: 'indexed',
        metadata: { field: doc.key, ...(doc.url ? { url: doc.url } : {}) },
      })),
    })
  }
  await enqueueKnowledgeSync({ tenantId, sourceId: source.id, botId, kind: BUSINESS_SOURCE_KIND }).catch(() => {})
  return documents.length
}

/** "https://www.Harbour.example/fees" and "harbour.example" are the same site. */
export function siteHost(url: string): string | null {
  const raw = url.trim()
  if (!raw) return null
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '') || null
  } catch {
    return null
  }
}

export interface WebsiteSourceRef {
  id: string
  name: string
  created: boolean
}

/**
 * The website Business details were read from also feeds Knowledge: its pages
 * answer the questions no field covers. The Knowledge crawler reads the site on
 * its own schedule; this only makes sure the source exists, once per site.
 */
export async function ensureWebsiteSource(tenantId: string, botId: string, url: string | undefined): Promise<WebsiteSourceRef | null> {
  const host = url ? siteHost(url) : null
  if (!url || !host) return null
  const sources = await prisma.knowledgeSource.findMany({ where: { tenantId, botId, kind: 'website' }, select: { id: true, name: true, config: true } })
  const existing = sources.find((source) => siteHost(String((source.config as { url?: unknown } | null)?.url ?? '')) === host)
  if (existing) return { id: existing.id, name: existing.name, created: false }
  const config = { url, depth: 2, addedFrom: 'business_details' }
  const source = await prisma.knowledgeSource.create({ data: { tenantId, botId, name: host, kind: 'website', config } })
  await enqueueKnowledgeSync({ tenantId, sourceId: source.id, botId, kind: 'website', config }).catch(() => {})
  return { id: source.id, name: host, created: true }
}

/**
 * Saves the business details and recompiles what reads them: the catalog the
 * chapters look up every turn, the Knowledge documents, and the eval suite whose
 * expected answers come from the same values. Chapters are not touched, so a live
 * flow keeps its published version.
 */
export async function saveBusinessProfile(tenantId: string, botId: string, blueprint: Blueprint, profile: BusinessProfile) {
  await prisma.botConfig.upsert({
    where: { botId },
    create: { tenantId, botId, business: profile as object },
    update: { business: profile as object },
  })
  const bundle = blueprint.bundle(profile)
  await upsertStudioCatalog(tenantId, botId, bundle.catalog)
  const documents = await syncBusinessKnowledge(tenantId, botId, blueprint, profile)
  await prisma.evalSuite.updateMany({
    where: { tenantId, botId, name: bundle.evals.name },
    data: { scenarios: bundle.evals.scenarios as unknown as object },
  })
  return { facts: bundle.catalog.facts.length, documents }
}

/** Everything a blueprint brings to a new bot. Chapters are published on Sandbox so the test chat works at once. */
export async function installBlueprint(
  tenantId: string,
  botId: string,
  environmentId: string | null,
  blueprint: Blueprint,
  profile: BusinessProfile,
): Promise<BlueprintInstallResult> {
  const bundle = blueprint.bundle(profile)
  const existing = new Set((await prisma.flow.findMany({ where: { tenantId, botId }, select: { name: true } })).map((flow) => flow.name))
  const chapters: string[] = []
  for (const starter of bundle.flows) {
    if (existing.has(starter.name)) continue
    const publish = starter.publish && Boolean(environmentId)
    const flow = await prisma.flow.create({
      data: { tenantId, botId, name: starter.name, description: starter.description, kind: 'flow', tags: starter.tags },
    })
    await prisma.flowVersion.create({
      data: {
        tenantId,
        flowId: flow.id,
        version: 1,
        status: publish ? 'published' : 'draft',
        environmentId: publish ? environmentId : null,
        graph: starter.graph,
        publishedAt: publish ? new Date() : null,
      },
    })
    chapters.push(starter.name)
  }

  const hasActive = await prisma.guardrailPolicy.count({ where: { botId, active: true } })
  await prisma.guardrailPolicy.create({
    data: { tenantId, botId, name: bundle.guardrails.name, active: hasActive === 0, rules: bundle.guardrails.rules as object[] },
  })
  forgetGuardrails(botId)
  await prisma.evalSuite.create({
    data: { tenantId, botId, name: bundle.evals.name, gate: true, scenarios: bundle.evals.scenarios as unknown as object },
  })

  const config = await prisma.botConfig.findUnique({ where: { botId }, select: { inboxConfig: true } })
  const inbox = config?.inboxConfig && typeof config.inboxConfig === 'object' ? config.inboxConfig as Record<string, unknown> : {}
  const inboxConfig = {
    ...inbox,
    ...(bundle.queueHours ? { workingHours: { ...bundle.queueHours, enabled: true } } : {}),
    alwaysHuman: bundle.alwaysHuman,
  }
  await prisma.botConfig.upsert({
    where: { botId },
    create: { tenantId, botId, systemPrompt: bundle.systemPrompt, inboxConfig },
    update: { systemPrompt: bundle.systemPrompt, inboxConfig },
  })
  const saved = await saveBusinessProfile(tenantId, botId, blueprint, profile)
  const websiteSource = await ensureWebsiteSource(tenantId, botId, profile.websiteUrl)

  return {
    chapters,
    facts: saved.facts,
    documents: saved.documents,
    websiteSource,
    guardrailPolicy: bundle.guardrails.name,
    evalSuite: bundle.evals.name,
  }
}
