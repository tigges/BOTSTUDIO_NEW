/**
 * Harbour Dental (reference): the dental blueprint as a working bot, with data on
 * every page. Journey, business details, Knowledge, guardrails and evals come from
 * the blueprint installer; the release goes through the same gate as Publish; chats
 * are the blueprint's own replies to sample patients, finished by a person where
 * the journey hands over. Lives in the Acme workspace.
 *
 * Idempotent: each part is added only when it is missing, nothing is edited or
 * deleted, so changes made in the console stay.
 */

import { prisma } from '@botstudio/db'
import {
  DENTAL_BLUEPRINT,
  HTTP_TOOL_DEFAULTS,
  personaAvatar,
  type BusinessProfile,
  type HandoverContract,
  type ToolParameter,
} from '@botstudio/shared'
import { installBlueprint } from '../lib/install-blueprint.js'
import { ensureWebChannels } from '../lib/web-channels.js'
import { logChapterEntry } from '../lib/journey-traffic.js'
import { createRelease, productionEnvironment, releaseCandidate, workingCopy } from '../lib/releases.js'
import { runGate, runSuite } from '../lib/evals.js'
import { runTestTurn } from '../lib/test-chat.js'
import { findTool, runAndRecord } from '../lib/tools-store.js'
import { parseInboxPolicy, type InboxPolicy } from '../lib/sla.js'
import { enqueueKnowledgeSync } from '../queues.js'
import { REFERENCE_CHATS, playReferenceChat, referenceJourney, type ReferenceChat } from './dental-reference-chats.js'
import { DENTAL_REF_BOT_ID, PRACTICE_PLACEHOLDER_BASE, PRACTICE_PROFILE_NAME } from '../lib/practice-sandbox.js'

export { DENTAL_REF_BOT_ID }

const BOT_NAME = 'Harbour Dental (reference)'
const OWNER_EMAIL = 'charles@acme.com'
const DAY = 86_400_000
const AUTH_PROFILE = PRACTICE_PROFILE_NAME

type Journey = ReturnType<typeof referenceJourney>

export async function ensureDentalReference(now = new Date()) {
  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL }, select: { id: true, tenantId: true } })
  if (!owner) return { status: 'skipped', reason: `${OWNER_EMAIL} is not in this database` }
  const tenantId = owner.tenantId
  const profile: BusinessProfile = DENTAL_BLUEPRINT.sample()
  const journey = referenceJourney(profile)
  const created = await ensureBot(tenantId, profile)
  const memory = await ensureMemory(tenantId)
  const evalRuns = await ensureEvalRuns(tenantId, journey, owner.id)
  const release = await ensureRelease(tenantId, journey, owner.id)
  const workflows = await ensureWorkflows(tenantId, now)
  const tools = await ensureTools(tenantId, workflows.recallId, owner.id, now)
  const knowledge = await ensureKnowledge(tenantId)
  const chats = await ensureChats(tenantId, owner.id, journey, now)
  return { status: 'ok', botId: DENTAL_REF_BOT_ID, created, memory, evalRuns, release, workflows: workflows.added, tools, knowledge, chats }
}

/** Returning patients are recognised by name; only set while nobody has configured memory for the bot. */
async function ensureMemory(tenantId: string): Promise<boolean> {
  const config = await prisma.botConfig.findUnique({ where: { botId: DENTAL_REF_BOT_ID }, select: { memory: true } })
  const current = config?.memory
  if (current && typeof current === 'object' && Object.keys(current).length > 0) return false
  const memory = { enabled: true, keys: ['guest_name', 'visit_type', 'preferred_times'], days: 180 }
  await prisma.botConfig.upsert({
    where: { botId: DENTAL_REF_BOT_ID },
    create: { tenantId, botId: DENTAL_REF_BOT_ID, memory },
    update: { memory },
  })
  return true
}

async function ensureBot(tenantId: string, profile: BusinessProfile): Promise<boolean> {
  const existing = await prisma.bot.findUnique({ where: { id: DENTAL_REF_BOT_ID }, select: { tenantId: true } })
  if (existing) return false
  const persona = DENTAL_BLUEPRINT.persona
  const bot = await prisma.bot.create({
    data: {
      id: DENTAL_REF_BOT_ID,
      tenantId,
      name: BOT_NAME,
      personaName: persona,
      description: 'The dental practice blueprint, set up end to end: journey, business details, knowledge, tools, workflows, evals, a live release and sample patient chats.',
      avatarUrl: personaAvatar(persona, DENTAL_BLUEPRINT.accent),
      environments: {
        create: [
          { tenantId, kind: 'sandbox', name: 'Sandbox' },
          { tenantId, kind: 'production', name: 'Production' },
        ],
      },
    },
    include: { environments: true },
  })
  await ensureWebChannels(tenantId, bot.id)
  const sandbox = bot.environments.find((env) => env.kind === 'sandbox')
  await installBlueprint(tenantId, bot.id, sandbox?.id ?? null, DENTAL_BLUEPRINT, { ...profile, personaName: persona })
  return true
}

function quietTurn(journey: Journey): typeof runTestTurn {
  return (input) => runTestTurn({ ...input, catalog: journey.bundle.catalog }, journey.deps)
}

/** One manual run on the working copy. The publish run comes with the release. */
async function ensureEvalRuns(tenantId: string, journey: Journey, ownerId: string) {
  if (await prisma.evalRun.count({ where: { botId: DENTAL_REF_BOT_ID } })) return 0
  const suite = await prisma.evalSuite.findFirst({ where: { botId: DENTAL_REF_BOT_ID, gate: true }, select: { id: true, name: true, scenarios: true } })
  if (!suite) return 0
  const snapshot = await workingCopy(DENTAL_REF_BOT_ID)
  const run = await runSuite({
    tenantId,
    botId: DENTAL_REF_BOT_ID,
    suite,
    snapshot,
    target: { kind: 'working_copy', chapters: snapshot.chapters.map((chapter) => ({ name: chapter.name, version: chapter.version })) },
    trigger: 'manual',
    createdBy: ownerId,
  }, { turn: quietTurn(journey) })
  return run.status === 'passed' ? 1 : 0
}

/** Release 1 on Production through the same eval gate as Publish. Releases cannot be edited, so it is dated today. */
async function ensureRelease(tenantId: string, journey: Journey, ownerId: string) {
  const production = await productionEnvironment(DENTAL_REF_BOT_ID, tenantId)
  if (production.liveReleaseId) return { number: null, added: false }
  const candidate = await releaseCandidate(DENTAL_REF_BOT_ID, production.id)
  const gate = await runGate({ tenantId, botId: DENTAL_REF_BOT_ID, snapshot: candidate.snapshot, createdBy: ownerId }, { turn: quietTurn(journey) })
  if (!gate.passed) return { number: null, added: false, gate: gate.runs.map((run) => `${run.suiteName}: ${run.failed} failed`) }
  const release = await createRelease({
    tenantId,
    botId: DENTAL_REF_BOT_ID,
    environmentId: production.id,
    candidate,
    note: 'First release: the Harbour Dental blueprint with the practice details filled in.',
    evalRunIds: gate.runs.map((run) => run.id),
    createdBy: ownerId,
  })
  await prisma.activity.create({
    data: { tenantId, userId: ownerId, action: 'release.published', resource: 'bot', resourceId: DENTAL_REF_BOT_ID, metadata: { number: release.number, environment: 'Production' } },
  })
  return { number: release.number, added: true }
}

const WORKFLOWS = [
  {
    key: 'recall',
    name: 'Send a check-up recall',
    description: 'Six months after a check-up, message the patient to book the next one.',
    trigger: 'schedule',
    conditions: '',
    actions: ["send_message:Hi {{first_name}}, it's been six months since your check-up at Harbour Dental. Would you like to book the next one?"],
    status: 'draft',
    runCount: 0,
  },
  {
    key: 'handover',
    name: 'Tell the practice manager about every handover',
    description: 'Each chat the bot passes to reception appears in the audit log for the practice manager.',
    trigger: 'conversation.escalated',
    conditions: '',
    actions: ['notify_supervisor'],
    status: 'active',
    runCount: 4,
  },
  {
    key: 'low-rating',
    name: 'Follow up a thumbs-down',
    description: 'A patient who rates a chat badly gets a "Follow up" label and the practice manager is told.',
    trigger: 'csat.submitted',
    conditions: JSON.stringify([{ field: 'csat_rating', operator: 'equals', value: -1 }]),
    actions: ['add_label:Follow up', 'notify_supervisor'],
    status: 'active',
    runCount: 1,
  },
  {
    key: 'feedback',
    name: 'Ask for feedback after a resolved chat',
    description: 'When a chat is resolved, ask the patient how it went.',
    trigger: 'conversation.resolved',
    conditions: '',
    actions: ['send_message:Thanks for chatting with Harbour Dental. How did we do?'],
    status: 'paused',
    runCount: 9,
  },
] as const

async function ensureWorkflows(tenantId: string, now: Date) {
  let added = 0
  let recallId = ''
  for (const [index, flow] of WORKFLOWS.entries()) {
    let row = await prisma.automationRule.findFirst({ where: { botId: DENTAL_REF_BOT_ID, name: flow.name }, select: { id: true } })
    if (!row) {
      row = await prisma.automationRule.create({
        data: {
          tenantId,
          botId: DENTAL_REF_BOT_ID,
          name: flow.name,
          description: flow.description,
          trigger: flow.trigger,
          conditions: flow.conditions,
          actions: [...flow.actions],
          status: flow.status,
          runCount: flow.runCount,
          lastRunAt: flow.runCount ? new Date(now.getTime() - (index + 1) * DAY) : null,
        },
        select: { id: true },
      })
      added++
    }
    if (flow.key === 'recall') recallId = row.id
  }
  return { added, recallId }
}

const param = (name: string, type: ToolParameter['type'], description: string, required = true, extra: Partial<ToolParameter> = {}): ToolParameter => ({ name, type, description, required, ...extra })

const FINANCE_CODE = `async function main(args) {
  const price = Number(args.price)
  const months = Number(args.months || 12)
  if (!(price > 0)) return { eligible: false, reason: 'Send the treatment price in pounds.' }
  if (price < 1000) return { eligible: false, reason: '0% finance starts at £1,000.' }
  if (![6, 9, 12].includes(months)) return { eligible: false, reason: 'Finance runs over 6, 9 or 12 months.' }
  return { eligible: true, months, monthly: Math.round((price / months) * 100) / 100, apr: 0 }
}
`

async function ensureTools(tenantId: string, recallId: string, ownerId: string, now: Date) {
  if (await prisma.tool.count({ where: { botId: DENTAL_REF_BOT_ID } })) return 0
  const profile = await prisma.authProfile.upsert({
    where: { tenantId_name: { tenantId, name: AUTH_PROFILE } },
    create: { tenantId, name: AUTH_PROFILE, kind: 'api_key', settings: { headerName: 'X-Api-Key' }, createdBy: ownerId },
    update: {},
  })
  const base = PRACTICE_PLACEHOLDER_BASE
  const tools = [
    {
      name: 'Find free appointment slots',
      kind: 'http',
      description: 'Lists open appointment slots for a visit type on a day. Use before offering times to a patient.',
      parameters: [
        param('visit_type', 'string', 'The kind of visit.', true, { enum: ['check-up', 'hygiene', 'new patient exam', 'emergency'] }),
        param('date', 'string', 'The day to look at, as YYYY-MM-DD.'),
      ],
      returns: { type: 'array', description: 'Slots with start time, dentist and length in minutes.' },
      effect: 'read',
      config: { ...HTTP_TOOL_DEFAULTS, url: `${base}/slots?type={{visit_type}}&date={{date}}`, timeoutMs: 8_000, retries: 2 },
      authProfileId: profile.id,
    },
    {
      name: 'Hold an appointment',
      kind: 'http',
      description: 'Holds a slot for a patient for 15 minutes while reception confirms it. Only after the patient picked the slot.',
      parameters: [
        param('slot_id', 'string', 'The slot from Find free appointment slots.'),
        param('patient_name', 'string', 'Full name for the booking.'),
        param('phone', 'string', 'Number reception can call to confirm.'),
      ],
      returns: { type: 'object', description: 'The hold with its reference and expiry time.' },
      effect: 'write',
      config: { ...HTTP_TOOL_DEFAULTS, method: 'POST', url: `${base}/holds`, timeoutMs: 10_000, retries: 1, idempotencyHeader: 'Idempotency-Key' },
      authProfileId: profile.id,
    },
    {
      name: 'Estimate monthly finance',
      kind: 'function',
      description: 'Works out the monthly payment for 0% finance on a treatment price. Finance starts at £1,000 and runs 6, 9 or 12 months.',
      parameters: [
        param('price', 'number', 'Treatment price in pounds.'),
        param('months', 'integer', 'How many months to spread it over.', false, { enum: ['6', '9', '12'] }),
      ],
      returns: { type: 'object', description: 'Whether finance applies, and the monthly amount.' },
      effect: 'read',
      config: { code: FINANCE_CODE, timeoutMs: 2_000 },
      authProfileId: null,
    },
    {
      name: 'Search the patient guide',
      kind: 'knowledge',
      description: "Finds passages in the practice's patient guide and business details, with their sources.",
      parameters: [param('query', 'string', 'What the patient wants to know.')],
      returns: { type: 'array', description: 'Matching passages with their source document.' },
      effect: 'read',
      config: { topK: 4 },
      authProfileId: null,
    },
    {
      name: 'Send a check-up recall',
      kind: 'workflow',
      description: 'Starts the recall workflow for a patient who is due a check-up.',
      parameters: [param('contact_id', 'string', 'The patient to remind.')],
      returns: { type: 'object', description: 'Whether the workflow started.' },
      effect: 'side_effect',
      config: { workflowId: recallId },
      authProfileId: null,
    },
  ]
  const ids: Record<string, string> = {}
  for (const tool of tools) {
    const row = await prisma.tool.create({
      data: { tenantId, botId: DENTAL_REF_BOT_ID, ...tool, parameters: tool.parameters as object[], returns: tool.returns, config: tool.config as object },
    })
    ids[tool.name] = row.id
  }
  const finance = await findTool(tenantId, DENTAL_REF_BOT_ID, ids['Estimate monthly finance']!)
  if (finance) {
    await runAndRecord(finance, { price: 2950, months: 12 }, { source: 'console', actorId: ownerId }).catch(() => undefined)
    await runAndRecord(finance, { price: 395 }, { source: 'console', actorId: ownerId }).catch(() => undefined)
  }
  const at = (days: number) => new Date(now.getTime() - days * DAY)
  await prisma.toolRun.createMany({
    data: [
      { tenantId, toolId: ids['Find free appointment slots']!, source: 'console', actorId: ownerId, ok: true, status: 200, durationMs: 182, input: { visit_type: 'check-up', date: '2026-10-21' }, output: [{ slot_id: 'S-1021-0900', start: '09:00', dentist: 'Dr Okafor', minutes: 30 }, { slot_id: 'S-1021-1130', start: '11:30', dentist: 'Dr Patel', minutes: 30 }], createdAt: at(12) },
      { tenantId, toolId: ids['Find free appointment slots']!, source: 'inbox', actorId: ownerId, ok: true, status: 200, durationMs: 214, input: { visit_type: 'emergency', date: '2026-10-09' }, output: [{ slot_id: 'S-1009-1130', start: '11:30', dentist: 'Dr Okafor', minutes: 20 }], createdAt: at(11) },
      { tenantId, toolId: ids['Find free appointment slots']!, source: 'console', actorId: ownerId, ok: false, status: 401, durationMs: 95, attempts: 1, input: { visit_type: 'hygiene', date: '2026-10-22' }, error: 'The practice system said 401 Unauthorized. Check the key in the Auth Profile "Harbour Dental practice system".', createdAt: at(13) },
      { tenantId, toolId: ids['Hold an appointment']!, source: 'inbox', actorId: ownerId, ok: true, status: 201, durationMs: 341, input: { slot_id: 'S-1009-1130', patient_name: 'Priya Shah', phone: '+44 7700 900102' }, output: { hold: 'H-55210', expires: '2026-10-09T11:15:00Z' }, createdAt: at(11) },
    ],
  })
  return tools.length
}

const PATIENT_GUIDE = `# Harbour Dental patient guide

## Your first visit
Arrive 10 minutes early. We text you a link to a medical history form before the visit; please fill it in at home. Bring a list of any medicines you take.

## Nervous patients
Tell us when you book. Dr Patel offers a 20-minute introduction with no treatment, and we can agree a stop signal before any work starts. Sedation is available for longer treatment after an assessment.

## After an extraction
Do not rinse for 24 hours. Avoid hot drinks, smoking and alcohol for 48 hours. Some bleeding is normal; bite on a clean gauze pad for 20 minutes. If bleeding has not stopped after an hour, call us, or NHS 111 out of hours.

## Whitening
Home whitening uses custom trays made from a scan of your teeth. Expect results in two to three weeks. Teeth can feel sensitive for a few days; use a toothpaste for sensitive teeth.

## Children
Children under 18 on a family care plan are seen free. We recommend a first visit by their first birthday.

## Payment
We take card and contactless. You pay for each appointment on the day. 0% finance is available on treatment over £1,000.
`

const FAQS = [
  { question: 'Do you see children?', answer: 'Yes. Children under 18 on a family care plan are seen free. We recommend a first visit by their first birthday.', tags: ['children', 'family'] },
  { question: 'Can I get sedation?', answer: 'Yes, for longer treatment after an assessment with the dentist. Tell us when you book if you are nervous.', tags: ['nervous', 'sedation'] },
  { question: 'Do you take NHS patients?', answer: 'Harbour Dental is a private practice. Our care plans spread the cost of routine visits from £10.50 a month.', tags: ['nhs', 'plans'] },
  { question: 'How long does whitening take?', answer: 'Home whitening shows results in two to three weeks with custom trays made from a scan of your teeth.', tags: ['whitening'] },
  { question: 'What should I do after an extraction?', answer: 'Do not rinse for 24 hours, and avoid hot drinks, smoking and alcohol for 48 hours. If bleeding has not stopped after an hour, call us.', tags: ['aftercare'] },
]

const INTENTS = [
  { name: 'book_visit', description: 'The patient wants an appointment.', utterances: ['book a check-up', 'can I get an appointment', 'I need to see a dentist', 'book a hygiene clean', 'any slots on Tuesday'] },
  { name: 'dental_pain', description: 'Pain, swelling, a broken or knocked-out tooth.', utterances: ['my tooth hurts', 'I broke a tooth', 'my face is swollen', 'toothache all night', 'my filling fell out'] },
  { name: 'prices', description: 'Fees, finance and care plans.', utterances: ['how much is a check-up', 'price of implants', 'can I pay monthly', 'do you have a care plan', 'what does whitening cost'] },
]

async function ensureKnowledge(tenantId: string) {
  let added = 0
  const guide = await prisma.knowledgeSource.findFirst({ where: { botId: DENTAL_REF_BOT_ID, kind: 'file' } })
  if (!guide) {
    const config = { text: PATIENT_GUIDE, filename: 'patient-guide.md', sizeBytes: Buffer.byteLength(PATIENT_GUIDE) }
    const source = await prisma.knowledgeSource.create({ data: { tenantId, botId: DENTAL_REF_BOT_ID, name: 'Patient guide', kind: 'file', config } })
    await enqueueKnowledgeSync({ tenantId, sourceId: source.id, botId: DENTAL_REF_BOT_ID, kind: 'file', config: { text: PATIENT_GUIDE, filename: config.filename } }).catch(() => {})
    added++
  }
  if (!(await prisma.faq.count({ where: { botId: DENTAL_REF_BOT_ID } }))) {
    await prisma.faq.createMany({ data: FAQS.map((faq) => ({ tenantId, botId: DENTAL_REF_BOT_ID, ...faq })) })
    added += FAQS.length
  }
  for (const intent of INTENTS) {
    const exists = await prisma.intent.findUnique({ where: { botId_name: { botId: DENTAL_REF_BOT_ID, name: intent.name } }, select: { id: true } })
    if (exists) continue
    await prisma.intent.create({ data: { tenantId, botId: DENTAL_REF_BOT_ID, ...intent } })
    added++
  }
  return added
}

const LABEL_COLORS: Record<string, string> = { Emergency: '#ef4444', 'New patient': '#14b8a6', Booking: '#6366f1', 'Follow up': '#f59e0b' }

/** When a chat line was written: the day and hour from the script, then a little later for each line. */
function startOf(chat: ReferenceChat, now: Date): Date {
  if (chat.daysAgo === 0) return new Date(now.getTime() + chat.hour * 3_600_000)
  const day = new Date(now.getTime() - chat.daysAgo * DAY)
  day.setUTCHours(chat.hour, 4 + (chat.id.length % 50), 0, 0)
  return day
}

async function ensureChats(tenantId: string, ownerId: string, journey: Journey, now: Date) {
  const production = await prisma.environment.findFirst({ where: { botId: DENTAL_REF_BOT_ID, kind: 'production' }, select: { id: true } })
  const channel = await prisma.channel.findFirst({ where: { botId: DENTAL_REF_BOT_ID, environmentId: production?.id, kind: 'web' }, select: { id: true } })
  if (!production) return 0
  const config = await prisma.botConfig.findUnique({ where: { botId: DENTAL_REF_BOT_ID }, select: { inboxConfig: true } })
  const policy = parseInboxPolicy(config?.inboxConfig)
  let added = 0
  for (const chat of REFERENCE_CHATS) {
    if (await prisma.conversation.findUnique({ where: { id: chat.id }, select: { id: true } })) continue
    await saveChat(chat, { tenantId, ownerId, environmentId: production.id, channelId: channel?.id ?? null, journey, now, policy })
    added++
  }
  return added
}

async function saveChat(chat: ReferenceChat, ctx: { tenantId: string; ownerId: string; environmentId: string; channelId: string | null; journey: Journey; now: Date; policy: InboxPolicy }) {
  const { tenantId, ownerId } = ctx
  const started = startOf(chat, ctx.now)
  const played = await playReferenceChat(chat, ctx.journey, { tenantId, botId: DENTAL_REF_BOT_ID }, started)
  const state = played.state
  const p = chat.patient
  await prisma.contact.upsert({
    where: { id: p.id },
    create: { id: p.id, tenantId, displayName: p.name, email: p.email ?? null, phone: p.phone ?? null, tags: p.tags, channelId: ctx.channelId, metadata: { source: 'Harbour Dental website' }, createdAt: started },
    update: {},
  })

  let clock = started.getTime()
  const messages: Array<{ direction: string; authorKind: string; authorId: string | null; text: string; at: Date }> = []
  for (const line of played.lines) {
    clock += line.role === 'bot' ? 2_000 : 35_000
    messages.push(line.role === 'bot'
      ? { direction: 'outbound', authorKind: 'bot', authorId: null, text: line.text, at: new Date(clock) }
      : { direction: 'inbound', authorKind: 'user', authorId: null, text: line.text, at: new Date(clock) })
  }
  const handedAt = new Date(clock)
  for (const line of chat.person ?? []) {
    clock += line.from === 'agent' ? 150_000 : 60_000
    messages.push(line.from === 'agent'
      ? { direction: 'outbound', authorKind: 'agent', authorId: ownerId, text: line.text, at: new Date(clock) }
      : { direction: 'inbound', authorKind: 'user', authorId: null, text: line.text, at: new Date(clock) })
  }
  const lastAt = new Date(clock)
  const guestSpoke = played.lines.some((line) => line.role === 'guest')

  let status: string = state.status
  let outcome: string | null = state.outcome
  let resolvedAt: Date | null = null
  let assignedTo: string | null = null
  let handover = state.handover as HandoverContract | null
  if (handover) {
    handover = { ...handover, at: handedAt.toISOString() }
    if (chat.assigned) assignedTo = ownerId
    if (chat.returned) {
      handover.returned = { outcome: chat.returned.outcome, at: lastAt.toISOString(), by: ownerId, ...(chat.returned.note ? { note: chat.returned.note } : {}) }
      status = chat.returned.outcome === 'needs_follow_up' ? 'closed' : 'resolved'
      resolvedAt = lastAt
    }
    outcome = 'escalated'
  } else if (!guestSpoke) {
    status = 'closed'; outcome = 'abandoned'; resolvedAt = lastAt
  } else if (status === 'active' && chat.daysAgo > 0) {
    status = 'resolved'; outcome = 'contained_partial'; resolvedAt = lastAt
  } else if (status === 'resolved') {
    resolvedAt = lastAt
  }

  await prisma.conversation.create({
    data: {
      id: chat.id,
      tenantId,
      botId: DENTAL_REF_BOT_ID,
      environmentId: ctx.environmentId,
      channelId: ctx.channelId,
      contactId: p.id,
      status,
      assignedTo,
      subject: chat.subject ?? state.subject ?? null,
      outcome,
      handover: (handover as object | null) ?? undefined,
      createdAt: started,
      updatedAt: lastAt,
      resolvedAt,
      firstRespondedAt: messages.find((m) => m.authorKind !== 'user')?.at ?? null,
      firstResponseDueAt: new Date(started.getTime() + ctx.policy.sla.firstResponseHours * 3_600_000),
      resolutionDueAt: new Date(started.getTime() + ctx.policy.sla.resolutionHours * 3_600_000),
    },
  })
  await prisma.message.createMany({
    data: messages.map((m) => ({ tenantId, conversationId: chat.id, direction: m.direction, authorKind: m.authorKind, authorId: m.authorId, content: { text: m.text }, createdAt: m.at })),
  })

  const chapters = [...new Set(played.lines.filter((line) => line.role === 'bot' && line.chapter).map((line) => line.chapter!))]
  for (const [index, chapter] of chapters.entries()) {
    await logChapterEntry(prisma, { tenantId, botId: DENTAL_REF_BOT_ID, conversationId: chat.id, chapter, at: new Date(started.getTime() + index * 30_000) })
  }

  if (chapters.includes('Care plans')) {
    await prisma.llmCall.create({
      data: {
        tenantId, botId: DENTAL_REF_BOT_ID, conversationId: chat.id, traceId: `${chat.id}-plans`, source: 'runtime', environment: 'production',
        provider: 'google', model: 'gemini-2.0-flash', operation: 'complete',
        inputTokens: 1_840, cachedTokens: 1_024, completionTokens: 96, outputTokens: 96, latencyMs: 820, ttftMs: 310, costUsd: 0.000222, createdAt: new Date(started.getTime() + 40_000),
      },
    })
  }

  for (const name of chat.labels ?? []) {
    const label = await prisma.label.upsert({ where: { tenantId_name: { tenantId, name } }, create: { tenantId, name, color: LABEL_COLORS[name] ?? '#94a3b8' }, update: {} })
    await prisma.conversationLabel.create({ data: { conversationId: chat.id, labelId: label.id } })
  }
  if (chat.csat) {
    await prisma.csatResponse.create({ data: { tenantId, conversationId: chat.id, rating: chat.csat, ...(chat.csat < 0 ? { comment: 'Wanted a price for whitening in the surgery, not at home.' } : {}), createdAt: new Date(lastAt.getTime() + 30_000) } })
  }

  if (state.ticket) {
    const done = chat.daysAgo > 5
    await prisma.ticket.create({
      data: {
        tenantId, conversationId: chat.id, subject: state.ticket.subject, description: state.ticket.description,
        status: done ? 'resolved' : 'in_progress', priority: 'medium', tags: chat.labels ?? [], assignedTo: ownerId,
        resolvedAt: done ? new Date(lastAt.getTime() + 2 * 3_600_000) : null, createdAt: lastAt,
      },
    })
  }
  if (chat.returned?.outcome === 'needs_follow_up' && handover) {
    await prisma.ticket.create({
      data: {
        tenantId, conversationId: chat.id, subject: `Follow up: ${handover.reason}`.slice(0, 180),
        description: [handover.summary, chat.returned.note].filter(Boolean).join('\n\n'),
        status: 'open', priority: handover.priority === 'critical' ? 'critical' : handover.priority === 'high' ? 'high' : 'medium',
        tags: chat.labels ?? [], assignedTo: ownerId, createdAt: lastAt,
      },
    })
  }

  for (const [key, value] of Object.entries(p.memory ?? {})) {
    await prisma.contactMemory.upsert({
      where: { contactId_key: { contactId: p.id, key } },
      create: { tenantId, contactId: p.id, key, value, botId: DENTAL_REF_BOT_ID, conversationId: chat.id, expiresAt: new Date(ctx.now.getTime() + 180 * DAY) },
      update: {},
    })
  }
}

