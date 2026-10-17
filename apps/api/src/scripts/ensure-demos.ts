/**
 * Idempotent demo data for the two showcase companies.
 *
 * Acme Corp (already on the live site):
 *   charles@acme.com  password set by the account owner, never reset here
 *   demo@acme.com     / Demo1234!        shared demo login
 *   qa@acme.com       / QaDemo1234!      GitHub live QA admin (override with QA_ACCOUNT_PASSWORD)
 *
 * Bella Hair Studio (created here if missing):
 *   charles@bella.com / password123
 *   demo@bella.com    / Demo1234!
 *
 * QA Lab (created here if missing; live QA does not write to it):
 *   qa@qalab.com      / QaDemo1234!
 *
 * Running this again does not duplicate chats, does not edit an existing
 * Order Status graph, and does not reset passwords.
 * Bella gains a Sandbox. The hair studio pack is her live welcome on
 * Sandbox and Production. The retail shop menu is not her widget.
 * Owned Bella demo chats keep their names and move to the top of the inbox.
 * A clash on (flowId, version) from two seeds is retried.
 * Live QA only reads the named use cases. Demo traffic is a separate run.
 */

import bcrypt from 'bcryptjs'
import { prisma } from '@ybot/db'
import { hairStudioPack } from '@ybot/shared'
import { environmentsToRefresh, isShopWelcomeGraph, retryOnUnique } from '../lib/bella-salon-sync.js'
import { publishedSource } from '../lib/copy-graphs.js'
import { installStarterFlows } from '../lib/install-starter-flows.js'
import { installHairStudioPack } from '../lib/install-corporate-pack.js'

const DEMO_PASSWORD = 'Demo1234!'
const CHARLES_PASSWORD = 'password123'
const QA_PASSWORD = process.env['QA_ACCOUNT_PASSWORD'] || 'QaDemo1234!'

const BELLA_SLUG = 'bella-hair-studio'
const BELLA_NAME = 'Bella Hair Studio'
const RULE_NAME = 'Note when a customer message arrives'

const OPENING_HOURS = {
  sla: { first_response: '1', resolution: '24' },
  workingHours: {
    start: '09:00',
    end: '18:00',
    timezone: 'Europe/London',
    awayMessage: "Thanks for your message. We're currently outside our working hours and will reply when the team is back.",
  },
}

const BELLA_NAMES = ['Emma Clarke', 'Olivia Bennett', 'Sophie Turner', 'Jack Murray', 'Aisha Khan', 'Noah Patel']
const ACME_NAMES = ['Alice Johnson', 'Bob Smith', 'Carol White', 'David Lee', 'Eve Brown']

const BELLA_CHATS: Array<{ subject: string; lines: Array<{ role: 'user' | 'bot'; text: string }> }> = [
  {
    subject: 'Booking inquiry',
    lines: [
      { role: 'user', text: 'Hi, I would like to book a haircut please.' },
      { role: 'bot', text: "Hi, I'm Bella from Bella Hair Studio. Cuts start from £35. Which day works for you?" },
      { role: 'user', text: 'Thursday afternoon if possible.' },
      { role: 'bot', text: 'I have noted a cut on Thursday afternoon. The studio will confirm the time in this chat.' },
    ],
  },
  {
    subject: 'Opening hours query',
    lines: [
      { role: 'user', text: 'What are your opening hours?' },
      { role: 'bot', text: 'We are open Monday to Saturday, 9 am to 6 pm. You can message any time.' },
    ],
  },
  {
    subject: 'Balayage price',
    lines: [
      { role: 'user', text: 'How much is a balayage?' },
      { role: 'bot', text: 'Balayage starts from £90. A consultation is free and takes about 15 minutes.' },
      { role: 'user', text: 'Yes please, how do I book that?' },
      { role: 'bot', text: 'I can note a consultation and the day. The studio will confirm the time in this chat.' },
    ],
  },
  {
    subject: 'Colour correction',
    lines: [
      { role: 'user', text: 'I need colour correction after a home dye.' },
      { role: 'bot', text: 'Colour correction is quoted after we see your hair. It often takes 3 to 5 hours.' },
      { role: 'user', text: 'Can I come in on Saturday?' },
      { role: 'bot', text: 'I have noted a consultation on Saturday. The studio will confirm the time in this chat.' },
    ],
  },
  {
    subject: 'Cancel appointment',
    lines: [
      { role: 'user', text: 'I need to cancel my appointment tomorrow.' },
      { role: 'bot', text: 'I can note that cancellation. Would you like another day this week?' },
      { role: 'user', text: 'Next Tuesday please.' },
      { role: 'bot', text: 'I have noted a move to Tuesday. The studio will confirm the new time in this chat.' },
    ],
  },
  {
    subject: 'Gift voucher',
    lines: [
      { role: 'user', text: 'Do you sell gift vouchers?' },
      { role: 'bot', text: 'Yes. Vouchers are £25, £50, or £100, and they last 12 months.' },
      { role: 'user', text: 'I will take a £50 one.' },
      { role: 'bot', text: 'Share the name to print on it and the studio will email the voucher.' },
    ],
  },
]

const ACME_CHATS: Array<{ subject: string; lines: Array<{ role: 'user' | 'bot'; text: string }> }> = [
  {
    subject: 'Where is order AC-20441',
    lines: [
      { role: 'user', text: 'Can you tell me where order AC-20441 is?' },
      { role: 'bot', text: 'AC-20441 left the warehouse yesterday and is due on Thursday.' },
      { role: 'user', text: 'Thanks, that is all I needed.' },
    ],
  },
  {
    subject: 'Damaged kettle return',
    lines: [
      { role: 'user', text: 'The kettle in my order arrived damaged.' },
      { role: 'bot', text: 'Sorry about that. I can start a return and email a label today.' },
      { role: 'user', text: 'Yes please.' },
      { role: 'bot', text: 'The return is open. The label is on its way to your inbox.' },
    ],
  },
  {
    subject: 'Invoice for extra seats',
    lines: [
      { role: 'user', text: 'Our last invoice has two seats I do not recognise.' },
      { role: 'bot', text: 'Those seats were added on the 12th. I can ask billing to send the breakdown.' },
      { role: 'user', text: 'Please do.' },
    ],
  },
  {
    subject: 'Password reset email missing',
    lines: [
      { role: 'user', text: 'The password reset email never arrived.' },
      { role: 'bot', text: 'I have sent a fresh link. Check spam if it is not in the inbox within a minute.' },
    ],
  },
  {
    subject: 'Speak to a person',
    lines: [
      { role: 'user', text: 'I would like to talk to someone on the team.' },
      { role: 'bot', text: 'I am passing this to Sarah. She will pick up the chat shortly.' },
    ],
  },
]

export async function ensureDemos() {
  const acme = await ensureAcme()
  const bella = await ensureBella()
  const qaLab = await ensureQaLab()
  const { applyDemoProgram } = await import('./demo-program.js')
  const program = await applyDemoProgram()
  return { acme, bella, qaLab, program }
}

async function ensureAcme() {
  const charles = await prisma.user.findFirst({ where: { email: 'charles@acme.com' } })
  if (!charles) return { status: 'skipped', reason: 'charles@acme.com is not in this database' }

  const tenant = await prisma.tenant.findUnique({ where: { id: charles.tenantId } })
  if (!tenant) return { status: 'skipped', reason: 'Acme tenant missing' }

  await ensureUser(tenant.id, 'demo@acme.com', 'Demo', DEMO_PASSWORD)
  await ensureUser(tenant.id, 'qa@acme.com', 'QA', QA_PASSWORD)

  const bot = await prisma.bot.findFirst({
    where: { tenantId: tenant.id, name: 'Acme Support Bot' },
  }) ?? await prisma.bot.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } })
  if (!bot) return { status: 'partial', tenant: tenant.slug, reason: 'no bot' }

  const channel = await prisma.channel.findFirst({
    where: { tenantId: tenant.id, botId: bot.id, kind: 'web' },
    orderBy: { createdAt: 'asc' },
  })
  const env = await prisma.environment.findFirst({
    where: { tenantId: tenant.id, botId: bot.id },
    orderBy: { createdAt: 'asc' },
  })
  const publishEnv = channel?.environmentId ?? env?.id ?? null
  const flowsAdded = await ensureFlows(tenant.id, bot.id, tenant.name, publishEnv)
  const flowsBound = publishEnv ? await bindPublishedFlows(bot.id, publishEnv) : 0
  const hoursSet = await ensureOpeningHours(tenant.id, bot.id)
  const ruleAdded = await ensureRule(tenant.id, bot.id)
  const chatsAdded = channel && env
    ? await ensureChats({
        prefix: 'enrich-acme',
        tenantId: tenant.id,
        botId: bot.id,
        channelId: channel.id,
        environmentId: env.id,
        templates: ACME_CHATS,
        repeats: 1,
      })
    : 0

  return {
    status: 'ok',
    tenant: tenant.slug,
    flowsAdded,
    flowsBound,
    hoursSet,
    ruleAdded,
    chatsAdded,
  }
}

async function ensureBella() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: BELLA_SLUG },
    update: { name: BELLA_NAME },
    create: { name: BELLA_NAME, slug: BELLA_SLUG, plan: 'pro', dataRegion: 'eu' },
  })

  await ensureUser(tenant.id, 'charles@bella.com', 'Charles', CHARLES_PASSWORD)
  await ensureUser(tenant.id, 'demo@bella.com', 'Demo', DEMO_PASSWORD)

  const bot = await prisma.bot.upsert({
    where: { id: 'bella-bot' },
    update: { name: 'Bella', personaName: 'Bella', status: 'active' },
    create: {
      id: 'bella-bot',
      tenantId: tenant.id,
      name: 'Bella',
      personaName: 'Bella',
      description: 'Books appointments and answers questions for Bella Hair Studio',
      status: 'active',
    },
  })

  await prisma.botConfig.upsert({
    where: { botId: bot.id },
    update: {},
    create: {
      tenantId: tenant.id,
      botId: bot.id,
      model: 'gemini-2.0-flash',
      temperature: 0.3,
      maxTokens: 2048,
      systemPrompt: `You are Bella, the receptionist for ${BELLA_NAME}. Help with bookings, prices, and opening hours. Be warm and brief.`,
      inboxConfig: OPENING_HOURS,
    },
  })

  const env = await prisma.environment.upsert({
    where: { botId_kind: { botId: bot.id, kind: 'production' } },
    update: {},
    create: {
      id: 'bella-env-production',
      tenantId: tenant.id,
      botId: bot.id,
      kind: 'production',
      name: 'Production',
      isActive: true,
    },
  })

  await prisma.channel.upsert({
    where: { id: 'bella-web' },
    update: {},
    create: {
      id: 'bella-web',
      tenantId: tenant.id,
      botId: bot.id,
      environmentId: env.id,
      name: 'Website Chat',
      kind: 'web',
      isActive: true,
      config: { primaryColor: '#7c3aed', greeting: "Hi, I'm Bella. How can I help today?" },
    },
  })
  await prisma.channel.upsert({
    where: { id: 'bella-whatsapp' },
    update: { isActive: false },
    create: {
      id: 'bella-whatsapp',
      tenantId: tenant.id,
      botId: bot.id,
      environmentId: env.id,
      name: 'WhatsApp',
      kind: 'whatsapp',
      isActive: false,
      config: { phoneNumberId: 'demo_phone', accessToken: 'demo_token', verifyToken: 'demo_verify' },
    },
  })

  // The shop starter pack would publish a retail welcome on this page.
  const flowsAdded = 0
  const flowsBound = await bindPublishedFlows(bot.id, env.id)
  const ruleAdded = await ensureRule(tenant.id, bot.id)
  const chatsAdded = await ensureChats({
    prefix: 'enrich-bella',
    tenantId: tenant.id,
    botId: bot.id,
    channelId: 'bella-web',
    environmentId: env.id,
    templates: BELLA_CHATS,
    repeats: 4,
  })
  const benchmark = await ensureBellaBenchmark()

  return { status: 'ok', tenant: tenant.slug, flowsAdded, flowsBound, ruleAdded, chatsAdded, benchmark }
}

const BELLA_RETAIL_DRAFTS = ['Welcome & Routing', 'Order Status', 'Billing', 'Lead Capture', 'Return Request', 'Cancel order', 'Change address']

const STALE_BELLA_LINES = [
  'Sunday 10 am to 4 pm',
  'Balayage starts from £120',
  'I have booked that for you',
  'Moved to Tuesday at the same time',
  'Saturday late morning is open',
]

function messageText(content: unknown): string {
  if (content && typeof content === 'object' && 'text' in content && typeof (content as { text: unknown }).text === 'string') {
    return (content as { text: string }).text
  }
  return ''
}

/**
 * Gives Bella a Sandbox and the hair studio pack.
 * Sandbox and Production both speak that pack, so the public page is the salon.
 * A published retail welcome is retired. Retail drafts are removed.
 */
export async function ensureBellaBenchmark() {
  const bot = await prisma.bot.findUnique({ where: { id: 'bella-bot' } })
  if (!bot) return { status: 'skipped' as const, reason: 'bella-bot missing' }

  const sandbox = await prisma.environment.upsert({
    where: { botId_kind: { botId: bot.id, kind: 'sandbox' } },
    update: { name: 'Sandbox', isActive: true },
    create: {
      id: 'bella-env-sandbox',
      tenantId: bot.tenantId,
      botId: bot.id,
      kind: 'sandbox',
      name: 'Sandbox',
      isActive: true,
    },
  })

  await prisma.channel.upsert({
    where: { id: 'bella-web-sandbox' },
    update: { environmentId: sandbox.id, name: 'Website Chat (Sandbox)', isActive: true },
    create: {
      id: 'bella-web-sandbox',
      tenantId: bot.tenantId,
      botId: bot.id,
      environmentId: sandbox.id,
      name: 'Website Chat (Sandbox)',
      kind: 'web',
      isActive: true,
      config: { primaryColor: '#7c3aed', greeting: "Hi, I'm Bella. How can I help today?" },
    },
  })

  const pack = await installHairStudioPack(bot.tenantId, bot.id, BELLA_NAME, sandbox.id)
  const production = await prisma.environment.upsert({
    where: { botId_kind: { botId: bot.id, kind: 'production' } },
    update: { name: 'Production', isActive: true },
    create: {
      id: 'bella-env-production',
      tenantId: bot.tenantId,
      botId: bot.id,
      kind: 'production',
      name: 'Production',
      isActive: true,
    },
  })
  const environmentIds = [sandbox.id, production.id]
  const refreshed = await refreshBellaSalonGraphs(bot.tenantId, bot.id, environmentIds)
  const shopWelcome = await retireBellaShopWelcome(bot.id)
  const retired = await retireBellaRetailDrafts(bot.tenantId, bot.id)
  const chatsRefreshed = await refreshStaleBellaChats()
  return { status: 'ok' as const, sandboxId: sandbox.id, pack, refreshed, shopWelcome, retired, chatsRefreshed }
}

/** Publishes the current hair studio pack onto Bella where the saved graph differs. */
async function refreshBellaSalonGraphs(tenantId: string, botId: string, environmentIds: string[]) {
  const pack = hairStudioPack(BELLA_NAME)
  let published = 0
  for (const starter of pack.flows) {
    let flow = await prisma.flow.findFirst({ where: { tenantId, botId, name: starter.name } })
    if (!flow) {
      flow = await prisma.flow.create({
        data: {
          tenantId,
          botId,
          name: starter.name,
          description: starter.description,
          kind: 'flow',
          tags: starter.tags,
        },
      })
    } else {
      const tags = [...new Set([...flow.tags, ...starter.tags])]
      if (tags.length !== flow.tags.length || flow.description !== starter.description) {
        flow = await prisma.flow.update({
          where: { id: flow.id },
          data: { tags, description: starter.description },
        })
      }
    }
    published += await publishPackGraph(tenantId, flow.id, starter.graph, environmentIds)
  }
  return published
}

/** Writes the next version. A concurrent seed may already have taken that number. */
async function publishPackGraph(tenantId: string, flowId: string, graph: unknown, environmentIds: string[]) {
  return retryOnUnique(async () => {
    const versions = await prisma.flowVersion.findMany({ where: { flowId }, orderBy: { version: 'desc' } })
    const latest = environmentIds.flatMap((environmentId) => {
      const current = publishedSource(versions, environmentId)
      return current ? [{ environmentId, graph: current.graph }] : []
    })
    const needed = environmentsToRefresh(graph, latest, environmentIds)
    if (needed.length === 0) return 0
    let version = versions[0]?.version ?? 0
    for (const environmentId of needed) {
      version += 1
      await prisma.flowVersion.create({
        data: {
          tenantId,
          flowId,
          version,
          status: 'published',
          environmentId,
          graph: graph as object,
          publishedAt: new Date(),
        },
      })
    }
    return needed.length
  })
}

async function retireBellaShopWelcome(botId: string) {
  const flow = await prisma.flow.findFirst({
    where: { botId, name: 'Welcome & Routing' },
    include: { versions: true },
  })
  if (!flow) return 0
  let retired = 0
  for (const version of flow.versions) {
    if (version.status !== 'published' || !isShopWelcomeGraph(flow.name, version.graph)) continue
    await prisma.flowVersion.update({ where: { id: version.id }, data: { status: 'draft' } })
    retired += 1
  }
  return retired
}

async function retireBellaRetailDrafts(tenantId: string, botId: string): Promise<string[]> {
  const flows = await prisma.flow.findMany({
    where: { tenantId, botId, name: { in: BELLA_RETAIL_DRAFTS } },
    include: { versions: { select: { id: true, status: true } } },
  })
  const removable = flows.filter((flow) => (
    !flow.tags.includes('salon')
    && !flow.tags.includes('corporate')
    && flow.versions.every((version) => version.status !== 'published')
  ))
  const removed: string[] = []
  for (const flow of removable) {
    const versionIds = flow.versions.map((version) => version.id)
    if (versionIds.length > 0) {
      await prisma.stepLog.deleteMany({ where: { flowVersionId: { in: versionIds } } })
    }
    await prisma.flowSession.deleteMany({ where: { botId, flowId: flow.id } })
    await prisma.flow.deleteMany({ where: { id: flow.id, tenantId, botId } })
    removed.push(flow.name)
  }
  return removed
}

async function refreshStaleBellaChats(): Promise<number> {
  let refreshed = 0
  const total = BELLA_CHATS.length * 4
  for (let i = 0; i < total; i++) {
    const id = `enrich-bella-convo-${i + 1}`
    const existing = await prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!existing) continue
    const stale = existing.messages.some((message) => STALE_BELLA_LINES.some((line) => messageText(message.content).includes(line)))
    if (!stale) continue
    const template = BELLA_CHATS[i % BELLA_CHATS.length]!
    await prisma.message.deleteMany({ where: { conversationId: id } })
    let msgTime = new Date(existing.createdAt)
    for (const line of template.lines) {
      msgTime = new Date(msgTime.getTime() + 45_000)
      await prisma.message.create({
        data: {
          tenantId: existing.tenantId,
          conversationId: id,
          direction: line.role === 'user' ? 'inbound' : 'outbound',
          authorKind: line.role,
          authorId: line.role === 'user' ? existing.contactId : existing.botId,
          content: { text: line.text },
          createdAt: msgTime,
        },
      })
    }
    await prisma.conversation.update({ where: { id }, data: { subject: template.subject } })
    refreshed += 1
  }
  return refreshed
}

async function ensureQaLab() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'qa-lab' },
    update: { name: 'QA Lab' },
    create: { name: 'QA Lab', slug: 'qa-lab', plan: 'pro', dataRegion: 'eu' },
  })
  await ensureUser(tenant.id, 'qa@qalab.com', 'QA', QA_PASSWORD)
  const bot = await prisma.bot.upsert({
    where: { id: 'qa-lab-bot' },
    update: { name: 'QA Lab Bot', personaName: 'QA', status: 'active' },
    create: {
      id: 'qa-lab-bot',
      tenantId: tenant.id,
      name: 'QA Lab Bot',
      personaName: 'QA',
      description: 'Scratch bot for the nightly save and edit suite',
      status: 'active',
    },
  })
  await prisma.botConfig.upsert({
    where: { botId: bot.id },
    update: {},
    create: {
      tenantId: tenant.id,
      botId: bot.id,
      model: 'gemini-2.0-flash',
      temperature: 0.3,
      maxTokens: 512,
      systemPrompt: 'You are the QA Lab bot. Keep answers short.',
      inboxConfig: {},
    },
  })
  await prisma.environment.upsert({
    where: { botId_kind: { botId: bot.id, kind: 'sandbox' } },
    update: { name: 'Sandbox', isActive: true },
    create: {
      id: 'qa-lab-env-sandbox',
      tenantId: tenant.id,
      botId: bot.id,
      kind: 'sandbox',
      name: 'Sandbox',
      isActive: true,
    },
  })
  const env = await prisma.environment.upsert({
    where: { botId_kind: { botId: bot.id, kind: 'production' } },
    update: {},
    create: {
      id: 'qa-lab-env-production',
      tenantId: tenant.id,
      botId: bot.id,
      kind: 'production',
      name: 'Production',
      isActive: true,
    },
  })
  await prisma.channel.upsert({
    where: { id: 'qa-lab-web' },
    update: {},
    create: {
      id: 'qa-lab-web',
      tenantId: tenant.id,
      botId: bot.id,
      environmentId: env.id,
      name: 'QA Website Chat',
      kind: 'web',
      isActive: true,
      config: { primaryColor: '#6366f1', greeting: 'QA Lab widget' },
    },
  })
  const flowsAdded = await ensureFlows(tenant.id, bot.id, 'QA Lab', env.id)
  const flowsBound = await bindPublishedFlows(bot.id, env.id)
  return { status: 'ok', tenant: tenant.slug, flowsAdded, flowsBound }
}

async function ensureUser(tenantId: string, email: string, displayName: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { tenantId_email: { tenantId, email } } })
  const user = existing ?? await prisma.user.create({
    data: {
      tenantId,
      email,
      displayName,
      passwordHash: await bcrypt.hash(password, 10),
    },
  })
  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId, userId: user.id } },
    update: { role: 'ADMIN' },
    create: { tenantId, userId: user.id, role: 'ADMIN' },
  })
  return user
}

async function bindPublishedFlows(botId: string, environmentId: string) {
  const result = await prisma.flowVersion.updateMany({
    where: { status: 'published', environmentId: null, flow: { botId } },
    data: { environmentId },
  })
  return result.count
}

async function ensureFlows(tenantId: string, botId: string, companyName: string, environmentId: string | null) {
  return installStarterFlows(tenantId, botId, companyName, environmentId)
}

async function ensureOpeningHours(tenantId: string, botId: string) {
  const cfg = await prisma.botConfig.findUnique({ where: { botId } })
  const current = cfg?.inboxConfig
  const empty = !current || typeof current !== 'object' || Array.isArray(current) || Object.keys(current).length === 0
  if (!empty) return false
  await prisma.botConfig.upsert({
    where: { botId },
    update: { inboxConfig: OPENING_HOURS },
    create: {
      tenantId,
      botId,
      systemPrompt: 'You are a helpful support assistant.',
      inboxConfig: OPENING_HOURS,
    },
  })
  return true
}

async function ensureRule(tenantId: string, botId: string) {
  const found = await prisma.automationRule.findFirst({ where: { tenantId, botId, name: RULE_NAME } })
  if (found) return false
  await prisma.automationRule.create({
    data: {
      tenantId,
      botId,
      name: RULE_NAME,
      description: 'Writes an audit entry for every inbound customer message.',
      trigger: 'message.received',
      conditions: '',
      actions: ['notify_supervisor'],
      status: 'active',
    },
  })
  return true
}

async function refreshOwnedLines(opts: {
  tenantId: string
  botId: string
  conversationId: string
  contactId: string
  createdAt: Date
  lines: Array<{ role: 'user' | 'bot'; text: string }>
}) {
  const existing = await prisma.message.findMany({
    where: { conversationId: opts.conversationId },
    select: { content: true },
  })
  const blob = existing.map((row) => JSON.stringify(row.content)).join('\n')
  if (opts.lines.every((line) => blob.includes(line.text))) return
  await prisma.message.deleteMany({ where: { conversationId: opts.conversationId } })
  let msgTime = new Date(opts.createdAt)
  for (const line of opts.lines) {
    msgTime = new Date(msgTime.getTime() + 45_000)
    await prisma.message.create({
      data: {
        tenantId: opts.tenantId,
        conversationId: opts.conversationId,
        direction: line.role === 'user' ? 'inbound' : 'outbound',
        authorKind: line.role,
        authorId: line.role === 'user' ? opts.contactId : opts.botId,
        content: { text: line.text },
        createdAt: msgTime,
      },
    })
  }
}

async function ensureChats(opts: {
  prefix: string
  tenantId: string
  botId: string
  channelId: string
  environmentId: string
  templates: Array<{ subject: string; lines: Array<{ role: 'user' | 'bot'; text: string }> }>
  repeats: number
}) {
  let added = 0
  const total = opts.templates.length * opts.repeats
  for (let i = 0; i < total; i++) {
    const template = opts.templates[i % opts.templates.length]!
    const person = opts.prefix === 'enrich-bella'
      ? BELLA_NAMES[i % BELLA_NAMES.length]!
      : ACME_NAMES[i % ACME_NAMES.length]!
    const id = `${opts.prefix}-convo-${i + 1}`
    const existing = await prisma.conversation.findUnique({ where: { id } })
    const contactId = `${opts.prefix}-contact-${i + 1}`
    if (existing) {
      await prisma.contact.updateMany({
        where: { id: existing.contactId ?? contactId },
        data: { displayName: person },
      })
      await prisma.conversation.update({
        where: { id },
        data: { updatedAt: new Date(Date.now() - i * 1000) },
      })
      if (opts.prefix === 'enrich-acme') {
        await refreshOwnedLines({
          tenantId: opts.tenantId,
          botId: opts.botId,
          conversationId: id,
          contactId: existing.contactId ?? contactId,
          createdAt: existing.createdAt,
          lines: template.lines,
        })
      }
      continue
    }

    const daysAgo = total - i
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
    createdAt.setUTCHours(9 + (i % 8), (i * 7) % 60, 0, 0)
    const status = i % 5 === 0 ? 'escalated' : i % 2 === 0 ? 'resolved' : 'active'
    const resolvedAt = status === 'resolved' ? new Date(createdAt.getTime() + 30 * 60 * 1000) : null

    const contact = await prisma.contact.upsert({
      where: { id: contactId },
      update: { displayName: person },
      create: {
        id: contactId,
        tenantId: opts.tenantId,
        displayName: person,
        email: `${opts.prefix}.${i + 1}@example.com`,
        channelId: opts.channelId,
        createdAt,
      },
    })

    await prisma.conversation.create({
      data: {
        id,
        tenantId: opts.tenantId,
        botId: opts.botId,
        environmentId: opts.environmentId,
        channelId: opts.channelId,
        contactId: contact.id,
        status,
        subject: template.subject,
        createdAt,
        updatedAt: resolvedAt ?? createdAt,
        resolvedAt,
      },
    })

    let msgTime = new Date(createdAt)
    for (const line of template.lines) {
      msgTime = new Date(msgTime.getTime() + 45_000)
      await prisma.message.create({
        data: {
          tenantId: opts.tenantId,
          conversationId: id,
          direction: line.role === 'user' ? 'inbound' : 'outbound',
          authorKind: line.role,
          authorId: line.role === 'user' ? contact.id : opts.botId,
          content: { text: line.text },
          createdAt: msgTime,
        },
      })
    }

    if (status === 'resolved') {
      await prisma.csatResponse.create({
        data: {
          tenantId: opts.tenantId,
          conversationId: id,
          rating: i % 6 === 0 ? -1 : 1,
          comment: i % 6 === 0 ? 'Took a while to get an answer.' : 'Quick and friendly.',
          createdAt: resolvedAt ?? createdAt,
        },
      })
    }
    added += 1
  }
  return added
}

const isDirectRun = process.argv[1]?.endsWith('ensure-demos.ts') || process.argv[1]?.endsWith('ensure-demos.js')
if (isDirectRun) {
  ensureDemos()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
      return prisma.$disconnect()
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
