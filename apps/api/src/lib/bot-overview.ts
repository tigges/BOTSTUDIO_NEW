/**
 * What the Overview page shows for one bot. The layout follows how far the bot
 * has come: nothing built, something built but nothing live, or a release live
 * in Production. Production numbers leave test-run chats out.
 */

import { prisma } from '@ybot/db'
import { botStage, filledBusinessFields, setupChecklist, type BotFootprint, type BotStage, type ChecklistItem } from '@ybot/shared'

const DAY = 86_400_000

export interface OverviewRelease {
  number: number
  note: string | null
  createdAt: string
  live: boolean
}

export interface OverviewActivity {
  id: string
  action: string
  who: string | null
  createdAt: string
}

export interface BotOverview {
  stage: BotStage
  footprint: BotFootprint
  checklist: ChecklistItem[]
  /** Production, last 7 days, test runs left out. */
  production: {
    chats: number
    /** Handed to the team, whether or not a person has finished them. */
    handedOver: number
    /** Still with the bot or waiting for a person. */
    open: number
    costUsd: number | null
    /** Null when there were no chats to divide by. */
    costPerChatUsd: number | null
  }
  releases: OverviewRelease[]
  /** Null when the reader may not see the audit trail. */
  activity: OverviewActivity[] | null
}

interface FlowSketch {
  name: string
  versions: Array<{ version: number; status: string; createdAt: Date; updatedAt: Date }>
}

/** The draft welcome every new bot starts with does not count as built until someone edits or publishes it. */
export function isUntouchedStarterWelcome(flow: FlowSketch): boolean {
  if (flow.name !== 'Welcome' || flow.versions.length !== 1) return false
  const only = flow.versions[0]!
  return only.version === 1 && only.status === 'draft' && only.updatedAt.getTime() - only.createdAt.getTime() < 1000
}

export function costPerChat(costUsd: number | null, chats: number): number | null {
  if (costUsd == null || chats === 0) return null
  return costUsd / chats
}

export async function loadBotOverview(tenantId: string, botId: string, opts: { canSeeActivity: boolean; now?: Date }): Promise<BotOverview | null> {
  const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, include: { environments: true, config: true } })
  if (!bot) return null
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - 7 * DAY)
  const production = bot.environments.find((env) => env.kind === 'production') ?? null
  const sandbox = bot.environments.find((env) => env.kind === 'sandbox') ?? null

  const [documents, faqs, flows, tools, productionChannels, sandboxChats, prodChats, cost, releases, liveRelease] = await Promise.all([
    prisma.document.count({ where: { tenantId, knowledgeSource: { botId } } }),
    prisma.faq.count({ where: { tenantId, botId } }),
    prisma.flow.findMany({ where: { tenantId, botId }, select: { id: true, name: true, versions: { select: { version: true, status: true, environmentId: true, createdAt: true, updatedAt: true } } } }),
    prisma.tool.count({ where: { tenantId, botId } }),
    production ? prisma.channel.count({ where: { tenantId, botId, environmentId: production.id, isActive: true } }) : 0,
    sandbox ? prisma.conversation.count({ where: { tenantId, botId, environmentId: sandbox.id, testRunId: null } }) : 0,
    production
      ? prisma.conversation.groupBy({ by: ['status', 'outcome'], where: { tenantId, botId, environmentId: production.id, testRunId: null, createdAt: { gte: since } }, _count: { _all: true } })
      : [],
    production
      ? prisma.llmCall.aggregate({ where: { tenantId, botId, environment: 'production', createdAt: { gte: since } }, _sum: { costUsd: true }, _count: { _all: true } })
      : null,
    production ? prisma.botRelease.findMany({ where: { botId, environmentId: production.id }, orderBy: { number: 'desc' }, take: 3 }) : [],
    production?.liveReleaseId ? prisma.botRelease.findUnique({ where: { id: production.liveReleaseId }, select: { number: true } }) : null,
  ])

  let chats = 0
  let handedOver = 0
  let open = 0
  for (const row of prodChats) {
    const n = row._count._all
    chats += n
    if (row.status === 'escalated' || row.outcome === 'escalated') handedOver += n
    if (row.status === 'active' || row.status === 'escalated') open += n
  }
  const costUsd = cost && cost._count._all > 0 ? cost._sum.costUsd ?? 0 : null

  const footprint: BotFootprint = {
    businessFields: filledBusinessFields(bot.config?.business),
    knowledgeItems: documents + faqs,
    flows: flows.filter((flow) => !isUntouchedStarterWelcome(flow)).length,
    tools,
    productionChannels,
    sandboxChats,
    productionChats7d: chats,
    liveRelease: liveRelease?.number ?? null,
    publishedFlows: production
      ? flows.filter((flow) => flow.versions.some((v) => v.status === 'published' && v.environmentId === production.id)).length
      : 0,
  }

  let activity: OverviewActivity[] | null = null
  if (opts.canSeeActivity) {
    const rows = await prisma.activity.findMany({
      where: { tenantId, resourceId: { in: [botId, ...flows.map((flow) => flow.id)] } },
      include: { user: { select: { displayName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    })
    activity = rows.map((row) => ({
      id: row.id,
      action: row.action,
      who: row.user?.displayName || row.user?.email || null,
      createdAt: row.createdAt.toISOString(),
    }))
  }

  return {
    stage: botStage(footprint),
    footprint,
    checklist: setupChecklist(footprint),
    production: {
      chats,
      handedOver,
      open,
      costUsd,
      costPerChatUsd: costPerChat(costUsd, chats),
    },
    releases: releases.map((release) => ({
      number: release.number,
      note: release.note,
      createdAt: release.createdAt.toISOString(),
      live: release.id === production?.liveReleaseId,
    })),
    activity,
  }
}
