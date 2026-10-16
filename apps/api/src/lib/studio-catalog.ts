import { prisma } from '@ybot/db'
import { CATALOG_ENTITY, valuesFromCatalog, type StudioCatalog } from '@ybot/shared'

export async function upsertStudioCatalog(tenantId: string, botId: string, catalog: StudioCatalog) {
  const values = valuesFromCatalog(catalog)
  const found = await prisma.entity.findFirst({ where: { tenantId, botId, name: CATALOG_ENTITY } })
  if (found) {
    await prisma.entity.update({ where: { id: found.id }, data: { values } })
    return
  }
  await prisma.entity.create({
    data: {
      tenantId,
      botId,
      name: CATALOG_ENTITY,
      kind: 'list',
      values,
    },
  })
}
