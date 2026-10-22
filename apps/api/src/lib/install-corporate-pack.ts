import { prisma } from '@botstudio/db'
import {
  bakedPack,
  hairStudioCatalog,
  planCorporateImport,
  planHairStudioImport,
  planSiteImport,
  selectPackRemoval,
  starterPackScope,
  type BotStart,
  type SiteTemplatePack,
  type StarterPackId,
} from '@botstudio/shared'
import { upsertStudioCatalog } from './studio-catalog.js'
import { syncFaqKnowledge } from './faq-knowledge.js'

export interface CorporateInstallResult {
  flowsAdded: string[]
  publishedNames: string[]
  draftNames: string[]
  intentsAdded: number
  faqsAdded: number
}

/**
 * Adds the corporate services pack. Names already on the bot are left as they are.
 * New answers are published on the environment you pass (Sandbox for a new bot).
 * A welcome that is already published stays the widget entry.
 */
export async function installCorporatePack(
  tenantId: string,
  botId: string,
  companyName: string,
  environmentId: string | null,
  personaName?: string | null,
): Promise<CorporateInstallResult> {
  const persona = personaName?.trim() || undefined
  return installPlannedPack(tenantId, botId, companyName, environmentId, (input) =>
    planCorporateImport({ ...input, personaName: persona }),
  )
}

/** Adds the hair studio pack. A published welcome stays the widget entry. */
export async function installHairStudioPack(
  tenantId: string,
  botId: string,
  companyName: string,
  environmentId: string | null,
  personaName?: string | null,
): Promise<CorporateInstallResult> {
  const persona = personaName?.trim() || undefined
  const result = await installPlannedPack(tenantId, botId, companyName, environmentId, (input) =>
    planHairStudioImport({ ...input, personaName: persona }),
  )
  await upsertStudioCatalog(tenantId, botId, hairStudioCatalog(companyName))
  return result
}

/** Adds a clustered site template (software, CRM, inbox, or a learned crawl). */
export async function installSitePack(
  tenantId: string,
  botId: string,
  companyName: string,
  environmentId: string | null,
  pack: SiteTemplatePack,
): Promise<CorporateInstallResult> {
  return installPlannedPack(tenantId, botId, companyName, environmentId, (input) =>
    planSiteImport({
      pack,
      existingFlowNames: input.existingFlowNames,
      existingIntentNames: input.existingIntentNames,
      existingQuestions: input.existingQuestions,
      publishedWelcome: input.publishedWelcome,
    }),
  )
}

async function installPlannedPack(
  tenantId: string,
  botId: string,
  companyName: string,
  environmentId: string | null,
  planFor: typeof planCorporateImport,
): Promise<CorporateInstallResult> {
  const [flows, intents, faqs, publishedWelcome] = await Promise.all([
    prisma.flow.findMany({ where: { tenantId, botId }, select: { name: true } }),
    prisma.intent.findMany({ where: { tenantId, botId }, select: { name: true } }),
    prisma.faq.findMany({ where: { tenantId, botId }, select: { question: true } }),
    prisma.flowVersion.findFirst({
      where: {
        status: 'published',
        flow: {
          botId,
          tenantId,
          OR: [
            { tags: { has: 'welcome' } },
            { name: 'Welcome & Routing' },
            { name: 'Product welcome' },
            { name: 'CRM welcome' },
            { name: 'Inbox welcome' },
            { name: 'Salon welcome' },
          ],
        },
      },
      select: { id: true },
    }),
  ])

  const plan = planFor({
    companyName,
    existingFlowNames: flows.map((flow) => flow.name),
    existingIntentNames: intents.map((intent) => intent.name),
    existingQuestions: faqs.map((faq) => faq.question),
    publishedWelcome: Boolean(publishedWelcome),
  })

  const flowsAdded: string[] = []
  const publishedNames: string[] = []
  const draftNames: string[] = []
  for (const starter of plan.flows) {
    const publish = starter.publish && Boolean(environmentId)
    const flow = await prisma.flow.create({
      data: {
        tenantId,
        botId,
        name: starter.name,
        description: starter.description,
        kind: 'flow',
        tags: starter.tags,
      },
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
    flowsAdded.push(starter.name)
    if (publish) publishedNames.push(starter.name)
    else draftNames.push(starter.name)
  }

  let intentsAdded = 0
  for (const intent of plan.intents) {
    await prisma.intent.create({
      data: {
        tenantId,
        botId,
        name: intent.name,
        description: intent.description,
        utterances: intent.utterances,
        responses: intent.responses,
      },
    })
    intentsAdded += 1
  }

  let faqsAdded = 0
  for (const faq of plan.faqs) {
    await prisma.faq.create({
      data: {
        tenantId,
        botId,
        question: faq.question,
        answer: faq.answer,
        tags: faq.tags,
      },
    })
    faqsAdded += 1
  }
  if (faqsAdded) await syncFaqKnowledge(tenantId, botId)

  return { flowsAdded, publishedNames, draftNames, intentsAdded, faqsAdded }
}

export interface PackRemovalResult {
  flowsRemoved: string[]
  intentsRemoved: number
  faqsRemoved: number
}

/** Deletes the flows, intents, and FAQs that belong to the pack. Other flows stay. */
export async function removeStarterPack(tenantId: string, botId: string, pack: StarterPackId): Promise<PackRemovalResult> {
  let scope = starterPackScope(pack)
  if (scope.intentNames.length === 0) {
    const built = bakedPack(pack as BotStart, 'company')
    if (built) scope = { tag: built.tag, intentNames: built.intents.map((intent) => intent.name) }
  }
  const [flows, intents, faqs] = await Promise.all([
    prisma.flow.findMany({ where: { tenantId, botId }, select: { id: true, name: true, tags: true } }),
    prisma.intent.findMany({ where: { tenantId, botId }, select: { id: true, name: true } }),
    prisma.faq.findMany({ where: { tenantId, botId }, select: { id: true, tags: true } }),
  ])
  const selected = selectPackRemoval(scope, { flows, intents, faqs })
  const flowIds = selected.flows.map((flow) => flow.id)
  if (flowIds.length > 0) {
    const versions = await prisma.flowVersion.findMany({ where: { flowId: { in: flowIds } }, select: { id: true } })
    const versionIds = versions.map((version) => version.id)
    if (versionIds.length > 0) {
      await prisma.stepLog.deleteMany({ where: { flowVersionId: { in: versionIds } } })
    }
    await prisma.flowSession.deleteMany({ where: { botId, flowId: { in: flowIds } } })
    await prisma.flow.deleteMany({ where: { tenantId, botId, id: { in: flowIds } } })
  }
  const faqIds = selected.faqs.map((faq) => faq.id)
  const intentIds = selected.intents.map((intent) => intent.id)
  const [removedFaqs, removedIntents] = await Promise.all([
    faqIds.length > 0 ? prisma.faq.deleteMany({ where: { tenantId, botId, id: { in: faqIds } } }) : Promise.resolve({ count: 0 }),
    intentIds.length > 0 ? prisma.intent.deleteMany({ where: { tenantId, botId, id: { in: intentIds } } }) : Promise.resolve({ count: 0 }),
  ])
  if (removedFaqs.count) await syncFaqKnowledge(tenantId, botId)
  return {
    flowsRemoved: selected.flows.map((flow) => flow.name),
    intentsRemoved: removedIntents.count,
    faqsRemoved: removedFaqs.count,
  }
}
