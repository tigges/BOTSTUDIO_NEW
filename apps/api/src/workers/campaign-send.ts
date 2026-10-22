/**
 * Campaign send worker — fans out a campaign to contacts matching the campaign
 * audience filters, creates CampaignDelivery records, and optionally sends
 * emails via SendGrid (if SENDGRID_API_KEY is set).
 *
 * Audience filters (stored as campaign.filters JSON):
 *   hasEmail  – only contacts with an email address (default true for email channel)
 *   hasPhone  – only contacts with a phone number
 *   channel   – only contacts who first came via this channel kind
 *   tags      – contact must have ALL of these tags
 *
 * Without external credentials the worker marks deliveries as "simulated".
 */

import { prisma, type Prisma } from '@botstudio/db'

let cuidCounter = 0
function createId() { return `cmp_${Date.now()}_${++cuidCounter}` }

interface CampaignFilters {
  hasEmail?: boolean
  hasPhone?: boolean
  channel?: string
  tags?: string[]
}

// ── Build Prisma where clause from filters ─────────────────────────────────────
function buildContactWhere(tenantId: string, filters: CampaignFilters): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { tenantId }

  if (filters.hasEmail) where.email = { not: null }
  if (filters.hasPhone) where.phone = { not: null }
  if (filters.tags && filters.tags.length > 0) {
    where.tags = { hasEvery: filters.tags }
  }
  if (filters.channel) {
    // Filter by contacts who have at least one conversation through the given channel kind
    where.conversations = {
      some: { channel: { kind: filters.channel } },
    }
  }

  return where
}

// ── Optional SendGrid integration ─────────────────────────────────────────────
async function trySendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env['SENDGRID_API_KEY']
  const from = process.env['SENDGRID_FROM_EMAIL'] ?? process.env['FROM_EMAIL'] ?? 'noreply@botstudio.uk'
  if (!key) return false
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    })
    return res.ok || res.status === 202
  } catch { return false }
}

// ── Main campaign send ─────────────────────────────────────────────────────────
export async function processCampaignSend(payload: {
  tenantId: string
  botId: string
  campaignId: string
}): Promise<void> {
  const { tenantId, botId, campaignId } = payload

  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } })
  if (!campaign || campaign.status !== 'running') return

  const subject = campaign.subject ?? campaign.name
  const bodyHtml = campaign.body ?? `<p>${campaign.name}</p>`

  // Parse audience filters — default to requiring email for email campaigns
  const rawFilters = (campaign.filters ?? {}) as CampaignFilters
  const filters: CampaignFilters = {
    hasEmail: rawFilters.hasEmail ?? (campaign.channel === 'email' ? true : undefined),
    hasPhone: rawFilters.hasPhone,
    channel: rawFilters.channel,
    tags: rawFilters.tags?.length ? rawFilters.tags : undefined,
  }

  const contactWhere = buildContactWhere(tenantId, filters)

  const contacts = await prisma.contact.findMany({
    where: contactWhere,
    take: 5000,
    select: { id: true, email: true, displayName: true },
  })

  if (contacts.length === 0) {
    await prisma.campaign.updateMany({ where: { id: campaignId }, data: { status: 'completed' } })
    console.log(`[campaign-send] Campaign ${campaignId} — no contacts matched filters`)
    return
  }

  // Create delivery records in bulk (skip existing)
  for (const contact of contacts) {
    try {
      await prisma.campaignDelivery.create({
        data: {
          id: createId(),
          tenantId,
          campaignId,
          contactId: contact.id,
          email: contact.email,
          status: 'pending',
        },
      })
    } catch { /* skip duplicates */ }
  }

  // Process each delivery
  let sentCount = 0
  for (const contact of contacts) {
    if (!contact.email) continue
    try {
      const personalised = bodyHtml.replace(/{{name}}/g, contact.displayName ?? 'there')
      const sent = await trySendEmail(contact.email, subject, personalised)
      await prisma.campaignDelivery.updateMany({
        where: { campaignId, contactId: contact.id },
        data: { status: sent ? 'sent' : 'simulated', sentAt: new Date() },
      })
      sentCount++
    } catch (err) {
      await prisma.campaignDelivery.updateMany({
        where: { campaignId, contactId: contact.id },
        data: { status: 'failed', error: err instanceof Error ? err.message : 'Unknown' },
      })
    }
    await new Promise((r) => setTimeout(r, 50))
  }

  await prisma.campaign.updateMany({
    where: { id: campaignId },
    data: { status: 'completed', sentAt: new Date() },
  })

  console.log(`[campaign-send] Campaign ${campaignId} completed — ${sentCount}/${contacts.length} delivered`)
}

// ── BullMQ worker entrypoint ──────────────────────────────────────────────────
export async function startCampaignWorker(): Promise<void> {
  try {
    const { Worker } = await import('bullmq')
    const ioredis = await import('ioredis')
    const IORedis = ioredis.default ?? ioredis as unknown as new (url: string, opts: object) => object
    const connection = new (IORedis as unknown as new (url: string, opts: object) => object)(
      process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      { maxRetriesPerRequest: null },
    )
    new Worker('campaign-send', async (job) => {
      await processCampaignSend(job.data)
    }, { connection, concurrency: 2 })
    console.log('[campaign-send worker] started')
  } catch (err) {
    console.warn('[campaign-send worker] not started (Redis unavailable):', err instanceof Error ? err.message : err)
  }
}
