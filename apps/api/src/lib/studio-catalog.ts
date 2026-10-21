import { prisma } from '@botstudio/db'
import { CATALOG_ENTITY, valuesFromCatalog, type StudioCatalog } from '@botstudio/shared'

export async function upsertStudioCatalog(tenantId: string, botId: string, catalog: StudioCatalog) {
  const values = valuesFromCatalog(catalog) as object[]
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
