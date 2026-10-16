import { prisma } from '@ybot/db'

export function webChannelName(kind: string): string {
  return kind === 'sandbox' ? 'Website Chat (Test)' : 'Website Chat'
}

export function environmentsMissingWeb(
  environments: Array<{ id: string; kind: string }>,
  channels: Array<{ environmentId: string; kind: string }>,
): Array<{ id: string; kind: string }> {
  return environments.filter((env) => !channels.some((channel) => channel.kind === 'web' && channel.environmentId === env.id))
}

export function canRemoveWebChannel(
  channels: Array<{ id: string; kind: string; environmentId: string }>,
  id: string,
): boolean {
  const target = channels.find((channel) => channel.id === id)
  if (!target || target.kind !== 'web') return true
  return channels.some((channel) => (
    channel.kind === 'web'
    && channel.environmentId === target.environmentId
    && channel.id !== id
  ))
}

/** One active website chat per environment. Test and live both walk the journey map. */
export async function ensureWebChannels(tenantId: string, botId: string): Promise<void> {
  const [environments, channels] = await Promise.all([
    prisma.environment.findMany({ where: { botId, tenantId }, orderBy: { createdAt: 'asc' } }),
    prisma.channel.findMany({ where: { botId, tenantId, kind: 'web' } }),
  ])
  const missing = environmentsMissingWeb(environments, channels)
  for (const env of missing) {
    await prisma.channel.create({
      data: {
        tenantId,
        botId,
        environmentId: env.id,
        name: webChannelName(env.kind),
        kind: 'web',
        isActive: true,
        config: {},
      },
    })
  }
  const inactiveIds = channels.filter((channel) => !channel.isActive).map((channel) => channel.id)
  if (inactiveIds.length > 0) {
    await prisma.channel.updateMany({
      where: { id: { in: inactiveIds } },
      data: { isActive: true },
    })
  }
}

/** Website chat stays on even if someone paused it. Other channels still need to be active. */
export async function loadPublicChannel(channelId: string) {
  const channel = await prisma.channel.findFirst({ where: { id: channelId }, include: { bot: true } })
  if (!channel?.bot) return null
  if (channel.kind !== 'web') return channel.isActive ? channel : null
  if (channel.isActive) return channel
  await prisma.channel.update({ where: { id: channel.id }, data: { isActive: true } }).catch(() => {})
  return { ...channel, isActive: true }
}
