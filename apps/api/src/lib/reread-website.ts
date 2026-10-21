import { prisma } from '@botstudio/db'
import { type ScannedPage } from '@botstudio/shared'
import { draftWebsiteChatWithModel } from './site-jobs.js'
import { upsertStudioCatalog } from './studio-catalog.js'

/** Replace the catalog and page texts from a fresh read. Charts stay as they are. */
export async function rereadWebsitePages(input: {
  tenantId: string
  botId: string
  sourceId: string
  pages: ScannedPage[]
  companyName: string
  personaName?: string | null
}) {
  const draft = await draftWebsiteChatWithModel({
    pages: input.pages,
    companyName: input.companyName,
    personaName: input.personaName,
  })
  await upsertStudioCatalog(input.tenantId, input.botId, draft.catalog)
  await prisma.document.deleteMany({ where: { knowledgeSourceId: input.sourceId, tenantId: input.tenantId } })
  if (draft.documents.length > 0) {
    await prisma.document.createMany({
      data: draft.documents.map((doc) => ({
        tenantId: input.tenantId,
        knowledgeSourceId: input.sourceId,
        title: doc.title.slice(0, 180) || doc.url,
        content: doc.content,
        status: 'indexed',
        metadata: { url: doc.url },
      })),
    })
  }
  await prisma.knowledgeSource.update({
    where: { id: input.sourceId },
    data: { lastSyncAt: new Date() },
  })
  return draft
}
