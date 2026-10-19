/**
 * Demo data program. Safe to run on every boot and from ensure-demos.
 *
 * Acme Support Bot stays the training company. QA Lab gets one copy.
 * A nightly-sized batch fills Acme Sandbox. The product bot on the
 * marketing site only grows from real visitor chats.
 */

import { prisma } from '@ybot/db'
import bcrypt from 'bcryptjs'
import { proposeDraftFlows } from '../lib/draft-flows.js'
import { attachDestination, extendWelcomeGraph } from '../lib/welcome-routes.js'
import { assistantGreeting, greetingWelcomeGraph, starterFlows, withSampleOrder } from '@ybot/shared'
import { graphAction, publishedSource } from '../lib/copy-graphs.js'
import { stockWelcomeKind, type StockWelcomeKind } from '../lib/stock-welcome.js'
import { SUPPORT_USE_CASES, supportUseCaseFlows } from './starter-flows.js'

const DEMO_PASSWORD = 'Demo1234!'
const ACME_BOT_NAME = 'Acme Support Bot'
const REF_BOT_ID = 'acme-ref-bot'
const PRODUCT_SLUG = 'botstudio'
const PRODUCT_BOT_ID = 'botstudio-bot'
const PRODUCT_CHANNEL_ID = 'botstudio-web'
const SYNTH_CAP = 24

const SUPPORT_ROUTES = [
  { handle: 'orders', phrases: ['order', 'tracking', 'delivery', 'where is'], flowName: 'Order Status' },
  { handle: 'returns', phrases: ['return', 'refund', 'damaged', 'broken'], flowName: 'Return Request' },
  { handle: 'billing', phrases: ['invoice', 'billing', 'payment', 'charge', 'seat'], flowName: 'Billing' },
]

const PRODUCT_GUIDE = [
  'BotStudio builds bots that answer from your own flows and content.',
  'A website widget message is saved as an inbox chat. The published flow answers. Working hours affect people and the queue clock. The bot keeps answering.',
  'The free plan needs no credit card. Start at https://app.botstudio.uk/sign-in?mode=register',
  'Acme Support Bot is the training company for admins and agents. The landing-page bot answers questions about BotStudio.',
].join('\n')

interface GraphNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: { kind: string; label: string; config: Record<string, unknown> }
}

function node(id: string, x: number, y: number, kind: string, label: string, config: Record<string, unknown> = {}): GraphNode {
  return { id, type: 'flow-node', position: { x, y }, data: { kind, label, config } }
}

function supportWelcomeGraph(companyName: string) {
  return greetingWelcomeGraph({
    greeting: assistantGreeting(companyName),
    followUp: 'What do you need help with?',
    routes: SUPPORT_ROUTES.map((route) => ({ ...route, flowName: route.flowName })),
    menu: 'I can help with orders, returns, and billing. Tell me which one you need.',
    choices: ['Order status', 'Returns', 'Billing'],
  })
}

function billingGraph() {
  const y = 120
  return {
    nodes: [
      node('b1', 80, y, 'trigger_start', 'Billing'),
      node('b2', 300, y, 'send_message', 'Intro', { text: 'I can help with invoices and charges.' }),
      node('b3', 520, y, 'ask_question', 'Ask account', { question: 'Which account or invoice should I look at?', variable: 'invoice' }),
      node('b4', 760, y, 'send_message', 'Answer', { text: 'I have noted {{invoice}}. A billing teammate will confirm the details in this chat.' }),
      node('b5', 1000, y, 'end_flow', 'End'),
    ],
    edges: [
      { id: 'e1', source: 'b1', target: 'b2' },
      { id: 'e2', source: 'b2', target: 'b3' },
      { id: 'e3', source: 'b3', target: 'b4' },
      { id: 'e4', source: 'b4', target: 'b5' },
    ],
  }
}

function productWelcomeGraph() {
  return greetingWelcomeGraph({
    greeting: assistantGreeting('BotStudio'),
    followUp: 'What would you like to know?',
    routes: [
      { handle: 'features', phrases: ['feature', 'benefit'], answer: 'BotStudio answers from your own flows and content. Your team steps in from the inbox when a person should take over.' },
      { handle: 'inbox', phrases: ['inbox', 'dashboard', 'flowchart', 'flow chart'], answer: 'A message on this widget is saved as a chat. In the console, open Inbox to see it, then open the flow that answered. The overview counts the same chats.' },
      { handle: 'plan', phrases: ['price', 'pricing', 'free plan', 'cost', 'credit card'], answer: 'The free plan needs no credit card. Start at https://app.botstudio.uk/sign-in?mode=register' },
      { handle: 'start', phrases: ['sign up', 'signup', 'register', 'start free', 'create an account'], answer: 'You can start free at https://app.botstudio.uk/sign-in?mode=register' },
    ],
    menu: 'Ask me about features, the inbox, the free plan, or how to start.',
    choices: ['Features', 'Inbox', 'Free plan', 'Start free'],
  })
}

function graphForStockKind(kind: StockWelcomeKind, companyName: string) {
  if (kind === 'product') return productWelcomeGraph()
  if (kind === 'support') return supportWelcomeGraph(companyName)
  return starterFlows(companyName).find((flow) => flow.name === 'Welcome & Routing')?.graph ?? null
}

function graphHasRouter(graph: unknown): boolean {
  if (!graph || typeof graph !== 'object' || !('nodes' in graph)) return false
  const nodes = (graph as { nodes?: Array<{ data?: { kind?: string } }> }).nodes ?? []
  return nodes.some((item) => item.data?.kind === 'route_topic')
}

async function acmeBot() {
  const owner = await prisma.user.findFirst({ where: { email: 'charles@acme.com' } })
    ?? await prisma.user.findFirst({ where: { email: 'demo@acme.com' } })
  if (!owner) return null
  return prisma.bot.findFirst({
    where: { tenantId: owner.tenantId, name: ACME_BOT_NAME },
    include: { environments: true },
  })
}

async function publishNamed(botId: string, tenantId: string, environmentId: string, name: string, graph?: { nodes: object[]; edges: object[] }) {
  let flow = await prisma.flow.findFirst({ where: { botId, name } })
  if (!flow) {
    if (!graph) return false
    flow = await prisma.flow.create({
      data: { tenantId, botId, name, description: `${name} for the live demo`, kind: 'flow', tags: ['destination'] },
    })
    await prisma.flowVersion.create({
      data: { tenantId, flowId: flow.id, version: 1, status: 'published', environmentId, graph, publishedAt: new Date() },
    })
    return true
  }
  const published = await prisma.flowVersion.findFirst({ where: { flowId: flow.id, status: 'published', environmentId } })
  if (published) return false
  const latest = await prisma.flowVersion.findFirst({ where: { flowId: flow.id }, orderBy: { version: 'desc' } })
  if (!latest) return false
  if (latest.status === 'draft') {
    await prisma.flowVersion.update({
      where: { id: latest.id },
      data: { status: 'published', environmentId, publishedAt: latest.publishedAt ?? new Date() },
    })
    return true
  }
  await prisma.flowVersion.create({
    data: {
      tenantId,
      flowId: flow.id,
      version: latest.version + 1,
      status: 'published',
      environmentId,
      graph: latest.graph as object,
      publishedAt: new Date(),
    },
  })
  return true
}

async function ensureWelcomeRouter(botId: string, tenantId: string, environmentId: string, companyName: string) {
  const flow = await prisma.flow.findFirst({ where: { botId, name: 'Welcome & Routing' } })
  if (!flow) return false
  if (!flow.tags.includes('welcome')) {
    await prisma.flow.update({ where: { id: flow.id }, data: { tags: [...new Set([...flow.tags, 'welcome'])] } })
  }
  const latest = await prisma.flowVersion.findFirst({ where: { flowId: flow.id }, orderBy: { version: 'desc' } })
  const routerSource = latest && graphHasRouter(latest.graph) ? latest.graph : supportWelcomeGraph(companyName)
  const already = await prisma.flowVersion.findFirst({
    where: { flowId: flow.id, status: 'published', environmentId },
    orderBy: { version: 'desc' },
  })
  if (already && graphHasRouter(already.graph)) return false
  await prisma.flowVersion.create({
    data: {
      tenantId,
      flowId: flow.id,
      version: (latest?.version ?? 0) + 1,
      status: 'published',
      environmentId,
      graph: routerSource as object,
      publishedAt: new Date(),
    },
  })
  return true
}

/** Replaces a stock stacked welcome. A chart that already greets, or a custom edit, stays. */
async function refreshStockWelcomeGraphs(botId: string, tenantId: string, environmentIds: string[], companyName: string) {
  const flows = await prisma.flow.findMany({
    where: { botId, name: { in: ['Welcome & Routing', 'Product welcome'] } },
    include: { versions: { orderBy: { version: 'desc' } } },
  })
  let published = 0
  for (const flow of flows) {
    let version = flow.versions[0]?.version ?? 0
    for (const environmentId of environmentIds) {
      const current = publishedSource(flow.versions, environmentId)
      const kind = stockWelcomeKind(current?.graph)
      if (!kind) continue
      const graph = graphForStockKind(kind, companyName)
      if (!graph) continue
      version += 1
      const created = await prisma.flowVersion.create({
        data: {
          tenantId,
          flowId: flow.id,
          version,
          status: 'published',
          environmentId,
          graph: graph as object,
          publishedAt: new Date(),
        },
      })
      flow.versions.unshift(created)
      published += 1
    }
  }
  return published
}

async function ensureSupportRouting() {
  const bot = await acmeBot()
  if (!bot) return { status: 'skipped' as const }
  const targets = bot.environments.filter((env) => env.kind === 'production' || env.kind === 'sandbox')
  if (targets.length === 0) return { status: 'skipped' as const, reason: 'no environment' }
  const tenant = await prisma.tenant.findUnique({ where: { id: bot.tenantId } })
  const companyName = tenant?.name ?? 'Acme Corp'
  let welcome = false
  let billing = false
  let orders = false
  let returns = false
  for (const env of targets) {
    billing = await publishNamed(bot.id, bot.tenantId, env.id, 'Billing', billingGraph()) || billing
    orders = await publishNamed(bot.id, bot.tenantId, env.id, 'Order Status') || orders
    returns = await publishNamed(bot.id, bot.tenantId, env.id, 'Return Request') || returns
    welcome = await ensureWelcomeRouter(bot.id, bot.tenantId, env.id, companyName) || welcome
  }
  const refreshed = await refreshStockWelcomeGraphs(bot.id, bot.tenantId, targets.map((env) => env.id), companyName)
  return { status: 'ok' as const, welcome, billing, orders, returns, refreshed }
}

const SANDBOX_CHANNEL_NAMES: Record<string, string> = {
  'Bella Hair Studio': 'Acme website',
  'Bella 2': 'Acme website 2',
}

async function renameSandboxChannels(botId: string, environmentId: string) {
  const channels = await prisma.channel.findMany({ where: { botId, environmentId } })
  let renamed = 0
  for (const channel of channels) {
    const name = SANDBOX_CHANNEL_NAMES[channel.name]
    if (!name) continue
    await prisma.channel.update({ where: { id: channel.id }, data: { name } })
    renamed += 1
  }
  return renamed
}

async function publishSandboxWelcome(botId: string, environmentId: string) {
  const welcome = await prisma.flowVersion.findFirst({
    where: {
      status: 'published',
      environmentId,
      flow: { botId, OR: [{ tags: { has: 'welcome' } }, { name: 'Welcome & Routing' }] },
    },
    orderBy: { publishedAt: 'desc' },
  })
  if (!welcome) return false
  const before = JSON.stringify(welcome.graph)
  const destinations = SUPPORT_USE_CASES.map((item) => ({ flowName: item.name, phrases: item.phrases, choice: item.choice }))
  const next = extendWelcomeGraph(structuredClone(welcome.graph) as unknown as Parameters<typeof extendWelcomeGraph>[0], destinations)
  if (!next || JSON.stringify(next) === before) return false
  const latest = await prisma.flowVersion.findFirst({ where: { flowId: welcome.flowId }, orderBy: { version: 'desc' } })
  await prisma.flowVersion.create({
    data: {
      tenantId: welcome.tenantId,
      flowId: welcome.flowId,
      version: (latest?.version ?? welcome.version) + 1,
      status: 'published',
      environmentId,
      graph: next as object,
      publishedAt: new Date(),
    },
  })
  return true
}

/** Sandbox-only Acme flows. Production keeps the orders, returns, and billing router. */
async function ensureSandboxUseCases() {
  const bot = await acmeBot()
  if (!bot) return { status: 'skipped' as const }
  const sandbox = bot.environments.find((env) => env.kind === 'sandbox')
  if (!sandbox) return { status: 'skipped' as const, reason: 'no sandbox' }
  let published = 0
  for (const flow of supportUseCaseFlows()) {
    if (await publishNamed(bot.id, bot.tenantId, sandbox.id, flow.name, flow.graph)) published += 1
  }
  const renamed = await renameSandboxChannels(bot.id, sandbox.id)
  const routed = await publishSandboxWelcome(bot.id, sandbox.id)
  return { status: 'ok' as const, published, renamed, routed }
}

async function syncFlowCopies(sourceBotId: string, tenantId: string, botId: string) {
  const [sourceEnvs, labEnvs, sourceFlows] = await Promise.all([
    prisma.environment.findMany({ where: { botId: sourceBotId } }),
    prisma.environment.findMany({ where: { botId } }),
    prisma.flow.findMany({
      where: { botId: sourceBotId },
      include: { versions: { orderBy: { version: 'desc' } } },
    }),
  ])
  let flows = 0
  let updated = 0
  for (const source of sourceFlows) {
    let labFlow = await prisma.flow.findFirst({ where: { botId, name: source.name } })
    if (!labFlow) {
      labFlow = await prisma.flow.create({
        data: {
          tenantId,
          botId,
          name: source.name,
          description: source.description,
          kind: source.kind,
          tags: source.tags,
        },
      })
      flows += 1
    }
    for (const kind of ['sandbox', 'production']) {
      const sourceEnv = sourceEnvs.find((env) => env.kind === kind)
      const labEnv = labEnvs.find((env) => env.kind === kind)
      if (!sourceEnv || !labEnv) continue
      const sourceVersion = publishedSource(source.versions, sourceEnv.id)
      if (!sourceVersion) continue
      const current = await prisma.flowVersion.findFirst({
        where: { flowId: labFlow.id, status: 'published', environmentId: labEnv.id },
        orderBy: { version: 'desc' },
      })
      const action = graphAction(current?.graph ?? null, sourceVersion.graph)
      if (action === 'keep') continue
      if (action === 'update' && current) {
        await prisma.flowVersion.update({ where: { id: current.id }, data: { graph: sourceVersion.graph as object } })
        updated += 1
        continue
      }
      const latest = await prisma.flowVersion.findFirst({ where: { flowId: labFlow.id }, orderBy: { version: 'desc' } })
      await prisma.flowVersion.create({
        data: {
          tenantId,
          flowId: labFlow.id,
          version: (latest?.version ?? 0) + 1,
          status: 'published',
          environmentId: labEnv.id,
          graph: sourceVersion.graph as object,
          publishedAt: new Date(),
        },
      })
      updated += 1
    }
    const sourceDraft = source.versions.find((version) => version.status !== 'published')
    if (!sourceDraft) continue
    const labDraft = await prisma.flowVersion.findFirst({ where: { flowId: labFlow.id, status: { not: 'published' } } })
    if (labDraft) continue
    const latest = await prisma.flowVersion.findFirst({ where: { flowId: labFlow.id }, orderBy: { version: 'desc' } })
    await prisma.flowVersion.create({
      data: {
        tenantId,
        flowId: labFlow.id,
        version: (latest?.version ?? 0) + 1,
        status: 'draft',
        graph: sourceDraft.graph as object,
      },
    })
  }
  return { flows, updated }
}

async function copyRows(sourceBotId: string, tenantId: string, botId: string) {
  const { flows, updated } = await syncFlowCopies(sourceBotId, tenantId, botId)

  let intents = 0
  for (const row of await prisma.intent.findMany({ where: { botId: sourceBotId } })) {
    const found = await prisma.intent.findFirst({ where: { botId, name: row.name } })
    if (found) continue
    await prisma.intent.create({
      data: { tenantId, botId, name: row.name, description: row.description, utterances: row.utterances, responses: row.responses as object },
    })
    intents += 1
  }

  let faqs = 0
  for (const row of await prisma.faq.findMany({ where: { botId: sourceBotId } })) {
    const found = await prisma.faq.findFirst({ where: { botId, question: row.question } })
    if (found) continue
    await prisma.faq.create({ data: { tenantId, botId, question: row.question, answer: row.answer, tags: row.tags } })
    faqs += 1
  }

  let sources = 0
  for (const row of await prisma.knowledgeSource.findMany({ where: { botId: sourceBotId }, include: { documents: { take: 2 } } })) {
    const found = await prisma.knowledgeSource.findFirst({ where: { botId, name: row.name } })
    if (found) continue
    const source = await prisma.knowledgeSource.create({
      data: { tenantId, botId, name: row.name, kind: row.kind, config: row.config as object },
    })
    for (const doc of row.documents) {
      await prisma.document.create({
        data: { tenantId, knowledgeSourceId: source.id, title: doc.title, content: doc.content.slice(0, 8000), status: 'ready', metadata: {} },
      })
    }
    sources += 1
  }
  return { flows, updated, intents, faqs, sources }
}

async function copySampleChats(sourceBotId: string, tenantId: string, botId: string) {
  const rows = await prisma.conversation.findMany({
    where: { botId: sourceBotId },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 8 }, contact: true },
    orderBy: { createdAt: 'asc' },
    take: 6,
  })
  let chats = 0
  for (let i = 0; i < rows.length; i++) {
    const source = rows[i]!
    const id = `acme-ref-sample-${i + 1}`
    const existing = await prisma.conversation.findUnique({ where: { id } })
    if (existing) continue
    const contactId = `acme-ref-contact-${i + 1}`
    await prisma.contact.upsert({
      where: { id: contactId },
      update: {},
      create: {
        id: contactId,
        tenantId,
        displayName: source.contact?.displayName ?? `Sample ${i + 1}`,
        email: `acme-ref.${i + 1}@example.com`,
      },
    })
    await prisma.conversation.create({
      data: {
        id,
        tenantId,
        botId,
        environmentId: 'acme-ref-env-production',
        channelId: 'acme-ref-web',
        contactId,
        status: source.status,
        subject: source.subject,
        createdAt: source.createdAt,
      },
    })
    for (const message of source.messages) {
      await prisma.message.create({
        data: {
          tenantId,
          conversationId: id,
          direction: message.direction,
          authorKind: message.authorKind,
          content: message.content as object,
          createdAt: message.createdAt,
        },
      })
    }
    chats += 1
  }
  return chats
}

async function copyAcmeIntoQaLab() {
  const source = await acmeBot()
  const lab = await prisma.tenant.findUnique({ where: { slug: 'qa-lab' } })
  if (!source || !lab) return { status: 'skipped' as const }
  const bot = await prisma.bot.upsert({
    where: { id: REF_BOT_ID },
    update: { name: ACME_BOT_NAME, personaName: 'Cal', status: 'active' },
    create: {
      id: REF_BOT_ID,
      tenantId: lab.id,
      name: ACME_BOT_NAME,
      personaName: 'Cal',
      description: 'Copy of the Acme training bot. The nightly scratch bot is separate.',
      status: 'active',
    },
  })
  await prisma.environment.upsert({
    where: { botId_kind: { botId: bot.id, kind: 'sandbox' } },
    update: {},
    create: { id: 'acme-ref-env-sandbox', tenantId: lab.id, botId: bot.id, kind: 'sandbox', name: 'Sandbox' },
  })
  await prisma.environment.upsert({
    where: { botId_kind: { botId: bot.id, kind: 'production' } },
    update: {},
    create: { id: 'acme-ref-env-production', tenantId: lab.id, botId: bot.id, kind: 'production', name: 'Production' },
  })
  await prisma.channel.upsert({
    where: { id: 'acme-ref-web' },
    update: {},
    create: {
      id: 'acme-ref-web',
      tenantId: lab.id,
      botId: bot.id,
      environmentId: 'acme-ref-env-production',
      name: 'Reference website',
      kind: 'web',
      isActive: true,
      config: {},
    },
  })
  const copied = await copyRows(source.id, lab.id, bot.id)
  const chats = await copySampleChats(source.id, lab.id, bot.id)
  return { status: 'ok' as const, ...copied, chats }
}

const SEED_CHATS: Array<{ subject: string; lines: Array<{ role: 'user' | 'bot'; text: string }> }> = [
  { subject: 'Password reset', lines: [{ role: 'user', text: 'I forgot my password and need an account reset.' }, { role: 'bot', text: 'I can help you reset your account. What email is on the account?' }] },
  { subject: 'Cannot sign in', lines: [{ role: 'user', text: "I cannot sign in. Can you reset my password?" }, { role: 'bot', text: 'Send the email on the account and I will start the reset.' }] },
  { subject: 'Reset link', lines: [{ role: 'user', text: 'The reset my password link never arrived.' }, { role: 'bot', text: 'I can send a fresh password reset link.' }] },
  { subject: 'Order AC-20441', lines: [{ role: 'user', text: 'Where is my order AC-20441?' }, { role: 'bot', text: 'AC-20441 left the warehouse yesterday and arrives Thursday.' }] },
  { subject: 'Damaged item', lines: [{ role: 'user', text: 'I need to return a damaged kettle.' }, { role: 'bot', text: 'I can start that return. What is the reason?' }] },
  { subject: 'Extra seats', lines: [{ role: 'user', text: 'The last invoice has two seats I do not recognise.' }, { role: 'bot', text: 'I will ask billing to send the breakdown.' }] },
  { subject: 'Speak to a person', lines: [{ role: 'user', text: 'I would like to talk to someone on the team.' }, { role: 'bot', text: 'I am passing this chat to the team.' }] },
  { subject: 'Delivery day', lines: [{ role: 'user', text: 'Can you check the delivery date for my order?' }, { role: 'bot', text: 'Share the order number and I will look it up.' }] },
]

async function ensureSyntheticChats() {
  const bot = await acmeBot()
  if (!bot) return { status: 'skipped' as const }
  const sandbox = bot.environments.find((env) => env.kind === 'sandbox')
  if (!sandbox) return { status: 'skipped' as const }
  const channel = await prisma.channel.findFirst({
    where: { botId: bot.id, environmentId: sandbox.id },
    orderBy: { createdAt: 'asc' },
  })
  if (!channel) return { status: 'skipped' as const, reason: 'sandbox has no channel' }

  let added = 0
  for (let i = 0; i < SEED_CHATS.length; i++) {
    added += await insertSynth(bot.tenantId, bot.id, sandbox.id, channel.id, `synth-acme-seed-${i + 1}`, SEED_CHATS[i]!, i)
  }
  const existing = await prisma.conversation.count({ where: { botId: bot.id, id: { startsWith: 'synth-acme-' } } })
  if (existing < SYNTH_CAP) {
    const day = new Date().toISOString().slice(0, 10)
    const template = SEED_CHATS[existing % SEED_CHATS.length]!
    added += await insertSynth(bot.tenantId, bot.id, sandbox.id, channel.id, `synth-acme-${day}`, template, existing)
  }
  return { status: 'ok' as const, added }
}

async function insertSynth(tenantId: string, botId: string, environmentId: string, channelId: string, id: string, template: (typeof SEED_CHATS)[number], index: number) {
  const existing = await prisma.conversation.findUnique({ where: { id } })
  if (existing) return 0
  const createdAt = new Date(Date.now() - (index + 1) * 60 * 60 * 1000)
  const contactId = `${id}-contact`
  await prisma.contact.upsert({
    where: { id: contactId },
    update: {},
    create: { id: contactId, tenantId, displayName: `Training ${index + 1}`, email: `${id}@example.com`, channelId },
  })
  await prisma.conversation.create({
    data: { id, tenantId, botId, environmentId, channelId, contactId, status: 'active', subject: template.subject, createdAt },
  })
  let at = createdAt
  for (const line of template.lines) {
    at = new Date(at.getTime() + 30_000)
    await prisma.message.create({
      data: {
        tenantId,
        conversationId: id,
        direction: line.role === 'user' ? 'inbound' : 'outbound',
        authorKind: line.role,
        content: { text: line.text },
        createdAt: at,
      },
    })
  }
  return 1
}

async function ensureDashboard(id: string, tenantId: string, botId: string, name: string) {
  const found = await prisma.dashboard.findUnique({ where: { id } })
  if (found) return false
  await prisma.dashboard.create({
    data: {
      id,
      tenantId,
      botId,
      name,
      widgets: {
        create: [
          { id: `${id}-conversations`, tenantId, kind: 'metric', title: 'Conversations', config: { metric: 'totalConversations' } },
          { id: `${id}-contacts`, tenantId, kind: 'metric', title: 'Contacts', config: { metric: 'totalContacts' } },
          { id: `${id}-resolution`, tenantId, kind: 'metric', title: 'Resolution rate', config: { metric: 'resolutionRate' } },
        ],
      },
    },
  })
  return true
}

async function ensureUser(tenantId: string, email: string, displayName: string) {
  const existing = await prisma.user.findUnique({ where: { tenantId_email: { tenantId, email } } })
  const user = existing ?? await prisma.user.create({
    data: { tenantId, email, displayName, passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10) },
  })
  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId, userId: user.id } },
    update: { role: 'ADMIN' },
    create: { tenantId, userId: user.id, role: 'ADMIN' },
  })
}

async function ensureProductBot() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: PRODUCT_SLUG },
    update: { name: 'BotStudio' },
    create: { name: 'BotStudio', slug: PRODUCT_SLUG, plan: 'pro', dataRegion: 'eu' },
  })
  await ensureUser(tenant.id, 'demo@botstudio.uk', 'Demo')
  const bot = await prisma.bot.upsert({
    where: { id: PRODUCT_BOT_ID },
    update: { name: 'BotStudio', personaName: 'BotStudio', status: 'active' },
    create: {
      id: PRODUCT_BOT_ID,
      tenantId: tenant.id,
      name: 'BotStudio',
      personaName: 'BotStudio',
      description: 'Answers questions about BotStudio on the marketing site',
      status: 'active',
    },
  })
  await prisma.botConfig.upsert({
    where: { botId: bot.id },
    update: {},
    create: {
      tenantId: tenant.id,
      botId: bot.id,
      systemPrompt: 'You are the BotStudio guide. Explain the product, the inbox, and how to start free. Do not take payment.',
      inboxConfig: {
        sla: { first_response: '1', resolution: '24' },
        workingHours: { start: '09:00', end: '18:00', timezone: 'Europe/London', awayMessage: 'Thanks for your message. The team will reply when they are back. I can still answer questions about BotStudio.' },
      },
    },
  })
  const env = await prisma.environment.upsert({
    where: { botId_kind: { botId: bot.id, kind: 'production' } },
    update: {},
    create: { id: 'botstudio-env-production', tenantId: tenant.id, botId: bot.id, kind: 'production', name: 'Production' },
  })
  await prisma.channel.upsert({
    where: { id: PRODUCT_CHANNEL_ID },
    update: { allowedDomains: ['botstudio.uk', 'www.botstudio.uk', 'app.botstudio.uk'], isActive: true },
    create: {
      id: PRODUCT_CHANNEL_ID,
      tenantId: tenant.id,
      botId: bot.id,
      environmentId: env.id,
      name: 'Marketing site',
      kind: 'web',
      isActive: true,
      allowedDomains: ['botstudio.uk', 'www.botstudio.uk', 'app.botstudio.uk'],
      config: { primaryColor: '#111827', greeting: 'Ask me about BotStudio' },
    },
  })
  let flow = await prisma.flow.findFirst({ where: { botId: bot.id, name: 'Product welcome' } })
  if (!flow) {
    flow = await prisma.flow.create({
      data: {
        tenantId: tenant.id,
        botId: bot.id,
        name: 'Product welcome',
        description: 'Answers feature, inbox, and signup questions from the marketing site',
        tags: ['welcome', 'product'],
      },
    })
    await prisma.flowVersion.create({
      data: {
        tenantId: tenant.id,
        flowId: flow.id,
        version: 1,
        status: 'published',
        environmentId: env.id,
        graph: productWelcomeGraph() as object,
        publishedAt: new Date(),
      },
    })
  }
  await refreshStockWelcomeGraphs(bot.id, tenant.id, [env.id], 'BotStudio')
  const source = await prisma.knowledgeSource.findFirst({ where: { botId: bot.id, name: 'BotStudio guide' } })
  if (!source) {
    const created = await prisma.knowledgeSource.create({
      data: { tenantId: tenant.id, botId: bot.id, name: 'BotStudio guide', kind: 'text', config: {} },
    })
    await prisma.document.create({
      data: { tenantId: tenant.id, knowledgeSourceId: created.id, title: 'BotStudio guide', content: PRODUCT_GUIDE, status: 'ready' },
    })
  }
  const dashboard = await ensureDashboard('botstudio-ops-dashboard', tenant.id, bot.id, 'Live operations')
  return { status: 'ok' as const, dashboard }
}

async function linkPublishedDrafts(botId: string) {
  const flows = await prisma.flow.findMany({
    where: { botId, name: { in: ['Password Reset', 'WhatsApp channel', 'Single sign-on'] } },
    include: { versions: { where: { status: 'published' } } },
  })
  let linked = 0
  for (const flow of flows) {
    for (const version of flow.versions) {
      if (!version.environmentId) continue
      if (await attachDestination(botId, version.environmentId, flow.name)) linked += 1
    }
  }
  return linked
}

async function ensureSampleOrderReply() {
  const bot = await acmeBot()
  if (!bot) return { status: 'skipped' as const }
  const flows = await prisma.flow.findMany({
    where: { botId: bot.id, name: 'Order Status' },
    include: { versions: true },
  })
  let updated = 0
  for (const flow of flows) {
    for (const version of flow.versions) {
      const raw = version.graph
      if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { nodes?: unknown }).nodes)) continue
      const next = withSampleOrder(raw as { nodes: Array<{ id: string; data?: { kind?: string; config?: Record<string, unknown> } }>; edges: Array<{ id: string; source: string; target: string }> })
      if (!next.changed) continue
      await prisma.flowVersion.update({ where: { id: version.id }, data: { graph: next.graph as object } })
      updated += 1
    }
  }
  return { status: 'ok' as const, updated }
}

export async function applyDemoProgram() {
  const sampleOrders = await ensureSampleOrderReply()
  const routing = await ensureSupportRouting()
  const useCases = await ensureSandboxUseCases()
  const reference = await copyAcmeIntoQaLab()
  const synthetic = await ensureSyntheticChats()
  const product = await ensureProductBot()
  const acme = await acmeBot()
  const drafts = acme ? await proposeDraftFlows(acme.id) : []
  const productDrafts = await proposeDraftFlows(PRODUCT_BOT_ID)
  const linked = acme ? await linkPublishedDrafts(acme.id) : 0
  const productLinked = await linkPublishedDrafts(PRODUCT_BOT_ID)
  let dashboard = false
  if (acme) dashboard = await ensureDashboard('acme-ops-dashboard', acme.tenantId, acme.id, 'Live operations')
  const lab = await prisma.tenant.findUnique({ where: { slug: 'qa-lab' } })
  if (lab) await ensureDashboard('acme-ref-ops-dashboard', lab.id, REF_BOT_ID, 'Live operations')
  return { sampleOrders, routing, useCases, reference, synthetic, product, drafts, productDrafts, linked, productLinked, dashboard }
}
