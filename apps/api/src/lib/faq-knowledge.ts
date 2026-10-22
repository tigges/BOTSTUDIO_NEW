import { prisma } from '@botstudio/db'
import { enqueueKnowledgeSync } from '../queues.js'

export const FAQ_SOURCE_KIND = 'faq'
export const FAQ_SOURCE_NAME = 'FAQs'

export function faqDocument(faq: { id: string; question: string; answer: string }) {
  return {
    title: faq.question.slice(0, 180),
    content: `Q: ${faq.question}\nA: ${faq.answer}`,
    metadata: { faqId: faq.id },
  }
}

/**
 * Rewrites the "FAQs" Knowledge source from the bot's FAQ list: one document per
 * question, so answers and Search & Test find them like any other document.
 * The source goes away with the last question.
 */
export async function syncFaqKnowledge(tenantId: string, botId: string): Promise<number> {
  const faqs = await prisma.faq.findMany({ where: { tenantId, botId }, select: { id: true, question: true, answer: true }, orderBy: { createdAt: 'asc' } })
  let source = await prisma.knowledgeSource.findFirst({ where: { tenantId, botId, kind: FAQ_SOURCE_KIND } })
  if (faqs.length === 0) {
    if (source) await prisma.knowledgeSource.delete({ where: { id: source.id } })
    return 0
  }
  const config = { questions: faqs.length }
  if (source) {
    await prisma.document.deleteMany({ where: { tenantId, knowledgeSourceId: source.id } })
    source = await prisma.knowledgeSource.update({ where: { id: source.id }, data: { config, lastSyncAt: new Date() } })
  } else {
    source = await prisma.knowledgeSource.create({ data: { tenantId, botId, name: FAQ_SOURCE_NAME, kind: FAQ_SOURCE_KIND, config, lastSyncAt: new Date() } })
  }
  await prisma.document.createMany({
    data: faqs.map((faq) => ({ tenantId, knowledgeSourceId: source.id, status: 'indexed', ...faqDocument(faq) })),
  })
  await enqueueKnowledgeSync({ tenantId, sourceId: source.id, botId, kind: FAQ_SOURCE_KIND }).catch(() => {})
  return faqs.length
}
