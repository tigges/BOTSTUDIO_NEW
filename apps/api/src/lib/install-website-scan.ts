import { prisma } from '@ybot/db'
import { emptyCatalog, type WebsiteChatDraft } from '@ybot/shared'
import { upsertStudioCatalog } from './studio-catalog.js'

/** Saves the scanned welcome as the working copy, plus the pages under Knowledge. The widget speaks that copy. */
export async function installWebsiteScan(tenantId: string, botId: string, draft: WebsiteChatDraft) {
  await upsertStudioCatalog(tenantId, botId, draft.catalog ?? emptyCatalog())

  for (const starter of draft.flows) {
    const found = await prisma.flow.findFirst({ where: { tenantId, botId, name: starter.name } })
    if (found) {
      const draftVersion = await prisma.flowVersion.findFirst({
        where: { flowId: found.id, status: { not: 'published' } },
        orderBy: { version: 'desc' },
      })
      if (draftVersion) {
        await prisma.flowVersion.update({ where: { id: draftVersion.id }, data: { graph: starter.graph } })
      }
      continue
    }
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
        status: 'draft',
        environmentId: null,
        graph: starter.graph,
        publishedAt: null,
      },
    })
  }

  for (const intent of draft.intents) {
    const found = await prisma.intent.findFirst({ where: { tenantId, botId, name: intent.name } })
    if (found) continue
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
  }

  for (const faq of draft.faqs) {
    const found = await prisma.faq.findFirst({ where: { tenantId, botId, question: faq.question } })
    if (found) continue
    await prisma.faq.create({
      data: { tenantId, botId, question: faq.question, answer: faq.answer, tags: faq.tags },
    })
  }

  let host = draft.url
  try { host = new URL(draft.url).hostname.replace(/^www\./, '') } catch { host = draft.url }
  const source = await prisma.knowledgeSource.findFirst({ where: { tenantId, botId, kind: 'website' } })
  if (source) {
    await prisma.document.deleteMany({ where: { knowledgeSourceId: source.id, tenantId } })
    await prisma.knowledgeSource.update({
      where: { id: source.id },
      data: {
        name: host || source.name,
        config: { url: draft.url, depth: 1 },
        lastSyncAt: new Date(),
      },
    })
    if (draft.documents.length > 0) {
      await prisma.document.createMany({
        data: draft.documents.map((doc) => ({
          tenantId,
          knowledgeSourceId: source.id,
          title: doc.title.slice(0, 180) || doc.url,
          content: doc.content,
          status: 'indexed',
          metadata: { url: doc.url },
        })),
      })
    }
    return
  }
  await prisma.knowledgeSource.create({
    data: {
      tenantId,
      botId,
      name: host || 'Website',
      kind: 'website',
      config: { url: draft.url, depth: 1 },
      lastSyncAt: new Date(),
      documents: {
        create: draft.documents.map((doc) => ({
          tenantId,
          title: doc.title.slice(0, 180) || doc.url,
          content: doc.content,
          status: 'indexed',
          metadata: { url: doc.url },
        })),
      },
    },
  })
}
