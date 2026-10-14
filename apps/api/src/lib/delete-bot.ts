/**
 * Remove one bot and the records that belong to it.
 *
 * Conversations, channels, and flow versions point at environments, and step
 * logs point at flow versions. Those foreign keys do not cascade, so they are
 * removed before the bot. Contacts stay: they belong to the tenant and another
 * bot may still use them.
 */

export interface BotRemover {
  bot: {
    findFirst(args: { where: { id: string; tenantId: string }; select: { id: true } }): Promise<{ id: string } | null>
    delete(args: { where: { id: string } }): Promise<unknown>
  }
  flow: {
    findMany(args: { where: { botId: string; tenantId: string }; select: { id: true } }): Promise<Array<{ id: string }>>
  }
  flowSession: {
    deleteMany(args: { where: { botId: string; tenantId: string } }): Promise<unknown>
  }
  conversation: {
    deleteMany(args: { where: { botId: string; tenantId: string } }): Promise<unknown>
  }
  channel: {
    deleteMany(args: { where: { botId: string; tenantId: string } }): Promise<unknown>
  }
  flowVersion: {
    deleteMany(args: { where: { tenantId: string; flowId: { in: string[] } } }): Promise<unknown>
  }
  templateOptimization: {
    deleteMany(args: { where: { botId: string; tenantId: string } }): Promise<unknown>
  }
  team: {
    updateMany(args: { where: { botId: string; tenantId: string }; data: { botId: null } }): Promise<unknown>
  }
}

export async function deleteBotRecords(
  db: BotRemover,
  tenantId: string,
  botId: string,
): Promise<'deleted' | 'missing'> {
  const bot = await db.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
  if (!bot) return 'missing'

  const flows = await db.flow.findMany({ where: { botId, tenantId }, select: { id: true } })
  await db.flowSession.deleteMany({ where: { botId, tenantId } })
  await db.conversation.deleteMany({ where: { botId, tenantId } })
  await db.channel.deleteMany({ where: { botId, tenantId } })
  const flowIds = flows.map((flow) => flow.id)
  if (flowIds.length > 0) {
    await db.flowVersion.deleteMany({ where: { tenantId, flowId: { in: flowIds } } })
  }
  await db.templateOptimization.deleteMany({ where: { botId, tenantId } })
  await db.team.updateMany({ where: { botId, tenantId }, data: { botId: null } })
  await db.bot.delete({ where: { id: botId } })
  return 'deleted'
}
