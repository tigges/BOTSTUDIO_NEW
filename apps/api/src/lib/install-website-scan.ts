import { prisma } from '@ybot/db'
import type { WebsiteChatDraft } from '@ybot/shared'

/** Saves the scanned welcome as drafts, plus the pages under Knowledge. Visitors hear it after a Sandbox publish. */
export async function installWebsiteScan(tenantId: string, botId: string, draft: WebsiteChatDraft) {
  for (const starter of draft.flows) {
    const found = await prisma.flow.findFirst({ where: { tenantId, botId, name: starter.name } })
    if (found) continue
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
