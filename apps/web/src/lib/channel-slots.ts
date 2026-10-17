/** One card per channel kind. Two website-chat rows (test and live) still count as one card. */

export const CHANNEL_KINDS = ['web', 'whatsapp', 'sms', 'telegram', 'phone', 'email'] as const

export type ChannelKind = (typeof CHANNEL_KINDS)[number]
export type ChannelStatus = 'active' | 'inactive' | 'idle'

export interface ChannelRef {
  id: string
  kind: string
  environmentId?: string
  isActive: boolean
}

export function pickChannel<T extends ChannelRef>(
  channels: T[],
  kind: string,
  environmentId?: string,
): T | undefined {
  if (environmentId) {
    const exact = channels.find((channel) => channel.kind === kind && channel.environmentId === environmentId)
    if (exact) return exact
  }
  return channels.find((channel) => channel.kind === kind)
}

export function channelStatus(kind: string, channel?: { isActive: boolean } | null): ChannelStatus {
  if (kind === 'web') return 'active'
  if (!channel) return 'idle'
  return channel.isActive ? 'active' : 'inactive'
}

export function slotsForEnvironment<T extends ChannelRef>(channels: T[], environmentId?: string) {
  return CHANNEL_KINDS.map((kind) => {
    const channel = pickChannel(channels, kind, environmentId)
    return { kind, channel, status: channelStatus(kind, channel) }
  })
}
