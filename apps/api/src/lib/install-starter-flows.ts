import { prisma } from '@ybot/db'
import { draftWelcome, starterFlows } from '@ybot/shared'

/** Draft copies of the standard flows. The welcome flow is published on the environment you pass. */
export async function installStarterFlows(tenantId: string, botId: string, companyName: string, environmentId: string | null) {
  let added = 0
  for (const starter of starterFlows(companyName)) {
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
        status: starter.publish ? 'published' : 'draft',
        environmentId: starter.publish ? environmentId : null,
        graph: starter.graph,
        publishedAt: starter.publish ? new Date() : null,
      },
    })
    added += 1
  }
  return added
}

/** A draft welcome only. Visitors hear it after it is published to Sandbox. */
export async function installDraftWelcome(tenantId: string, botId: string, sample: string) {
  const found = await prisma.flow.findFirst({ where: { tenantId, botId, name: 'Welcome' } })
  if (found) return
  const starter = draftWelcome(sample)
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
