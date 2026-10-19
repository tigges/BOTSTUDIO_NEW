/**
 * Bot bundles: a readable JSON or YAML file with the bot's chapters (working
 * copy), tools, guardrail policies, personal-data settings and eval suites.
 *
 * Secrets never travel: a tool names its Auth Profile, and the profile must
 * exist (with its secret) in the workspace that imports the file. Tool steps
 * refer to tools as "@tool:<name>" so a bundle moves between bots.
 *
 * Import writes drafts. It never changes a published version or the release
 * guests hear; publishing stays a separate, gated step.
 */

import { prisma } from '@ybot/db'
import YAML from 'yaml'
import { z } from 'zod'
import {
  EVAL_LIMITS,
  evalIssues,
  guardrailIssues,
  parseEvalScenarios,
  parseGuardrailRules,
  parsePrivacySettings,
  privacyIssues,
  toolIssues,
  type EvalScenario,
  type GuardrailRule,
  type PrivacySettings,
  type ToolDraft,
} from '@ybot/shared'
import { hideSecrets } from '@ybot/db'
import { newestByFlow } from './entry-flow.js'

export const BUNDLE_FORMAT = 'botstudio.bundle'
export const BUNDLE_VERSION = 1
const TOOL_REF = '@tool:'

export interface BundleChapter {
  name: string
  description?: string
  tags: string[]
  graph: { nodes: unknown[]; edges: unknown[] }
}

export interface BundleTool {
  name: string
  kind: string
  description: string
  effect: string
  parameters: unknown[]
  returns: Record<string, unknown>
  config: Record<string, unknown>
  /** The Auth Profile's name. The secret itself never leaves the workspace. */
  authProfile: string | null
}

export interface Bundle {
  format: typeof BUNDLE_FORMAT
  version: typeof BUNDLE_VERSION
  exportedAt: string
  bot: { name: string }
  chapters: BundleChapter[]
  tools: BundleTool[]
  guardrailPolicies: Array<{ name: string; active: boolean; rules: GuardrailRule[] }>
  privacy: PrivacySettings | null
  evalSuites: Array<{ name: string; gate: boolean; scenarios: EvalScenario[] }>
}

export type ImportMode = 'skip' | 'merge' | 'replace'
export const IMPORT_MODES: ImportMode[] = ['skip', 'merge', 'replace']

export type BundleKind = 'chapter' | 'tool' | 'guardrail_policy' | 'privacy' | 'eval_suite'

export interface PlanItem {
  kind: BundleKind
  name: string
  action: 'create' | 'update' | 'unchanged' | 'keep' | 'delete' | 'invalid'
  note?: string
}

export interface ImportPlan {
  mode: ImportMode
  items: PlanItem[]
  warnings: string[]
}

export class BundleError extends Error {
  constructor(message: string, public issues: string[] = []) {
    super(message)
  }
}

/** Replaces tool ids in tool steps, both ways. */
function mapToolRefs(graph: unknown, map: (value: string) => string): unknown {
  if (Array.isArray(graph)) return graph.map((item) => mapToolRefs(item, map))
  if (!graph || typeof graph !== 'object') return graph
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(graph as Record<string, unknown>)) {
    out[key] = key === 'toolId' && typeof value === 'string' ? map(value) : mapToolRefs(value, map)
  }
  return out
}

function graphOf(raw: unknown): BundleChapter['graph'] {
  const graph = raw && typeof raw === 'object' ? raw as { nodes?: unknown; edges?: unknown } : {}
  return { nodes: Array.isArray(graph.nodes) ? graph.nodes : [], edges: Array.isArray(graph.edges) ? graph.edges : [] }
}

function sanitiseConfig(config: unknown): Record<string, unknown> {
  const clean = hideSecrets(config)
  return clean && typeof clean === 'object' && !Array.isArray(clean) ? clean as Record<string, unknown> : {}
}

export async function buildBundle(botId: string, tenantId: string): Promise<Bundle> {
  const [bot, versions, tools, policies, config, suites] = await Promise.all([
    prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { name: true } }),
    prisma.flowVersion.findMany({ where: { flow: { botId, tenantId } }, include: { flow: true } }),
    prisma.tool.findMany({ where: { botId, tenantId }, include: { authProfile: { select: { name: true } } }, orderBy: { name: 'asc' } }),
    prisma.guardrailPolicy.findMany({ where: { botId, tenantId }, orderBy: { createdAt: 'asc' } }),
    prisma.botConfig.findUnique({ where: { botId }, select: { privacy: true } }),
    prisma.evalSuite.findMany({ where: { botId, tenantId }, orderBy: { createdAt: 'asc' } }),
  ])
  if (!bot) throw new BundleError('Bot not found.')
  const toolNames = new Map(tools.map((tool) => [tool.id, tool.name]))
  const toRef = (id: string) => (toolNames.has(id) ? `${TOOL_REF}${toolNames.get(id)}` : id)
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    bot: { name: bot.name },
    chapters: newestByFlow(versions)
      .sort((a, b) => a.flow.name.localeCompare(b.flow.name))
      .map((row) => ({
        name: row.flow.name,
        ...(row.flow.description ? { description: row.flow.description } : {}),
        tags: row.flow.tags,
        graph: graphOf(mapToolRefs(row.graph, toRef)),
      })),
    tools: tools.map((tool) => ({
      name: tool.name,
      kind: tool.kind,
      description: tool.description,
      effect: tool.effect,
      parameters: Array.isArray(tool.parameters) ? tool.parameters : [],
      returns: tool.returns && typeof tool.returns === 'object' ? tool.returns as Record<string, unknown> : {},
      config: sanitiseConfig(tool.config),
      authProfile: tool.authProfile?.name ?? null,
    })),
    guardrailPolicies: policies.map((policy) => ({ name: policy.name, active: policy.active, rules: parseGuardrailRules(policy.rules) })),
    privacy: config ? parsePrivacySettings(config.privacy) : null,
    evalSuites: suites.map((suite) => ({ name: suite.name, gate: suite.gate, scenarios: parseEvalScenarios(suite.scenarios) })),
  }
}

export function serialiseBundle(bundle: Bundle, format: 'json' | 'yaml'): string {
  return format === 'yaml' ? YAML.stringify(bundle, { lineWidth: 0 }) : `${JSON.stringify(bundle, null, 2)}\n`
}

const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT, { errorMap: () => ({ message: `This is not a BotStudio bundle: "format" must be "${BUNDLE_FORMAT}".` }) }),
  version: z.literal(BUNDLE_VERSION, { errorMap: () => ({ message: `This bundle's "version" is not ${BUNDLE_VERSION}. Export it again from a current BotStudio.` }) }),
  exportedAt: z.string().default(''),
  bot: z.object({ name: z.string().default('') }).default({ name: '' }),
  chapters: z.array(z.object({
    name: z.string().trim().min(1, 'Every chapter needs a name.').max(120),
    description: z.string().max(2000).optional(),
    tags: z.array(z.string().max(60)).max(20).default([]),
    graph: z.object({ nodes: z.array(z.unknown()).max(500), edges: z.array(z.unknown()).max(1000) }),
  })).max(100).default([]),
  tools: z.array(z.object({
    name: z.string(),
    kind: z.string(),
    description: z.string().max(2000),
    effect: z.string(),
    parameters: z.array(z.unknown()).max(50).default([]),
    returns: z.record(z.unknown()).default({}),
    config: z.record(z.unknown()).default({}),
    authProfile: z.string().nullable().default(null),
  })).max(100).default([]),
  guardrailPolicies: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    active: z.boolean().default(false),
    rules: z.array(z.unknown()).max(100).default([]),
  })).max(20).default([]),
  privacy: z.unknown().nullable().default(null),
  evalSuites: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    gate: z.boolean().default(true),
    scenarios: z.array(z.unknown()).max(EVAL_LIMITS.scenarios).default([]),
  })).max(50).default([]),
})

/** Reads JSON or YAML (YAML is a superset of JSON, so one parser reads both). */
export function parseBundle(text: string): Bundle {
  let raw: unknown
  try {
    raw = YAML.parse(text)
  } catch (err) {
    const where = err instanceof Error ? err.message.split('\n')[0] : ''
    throw new BundleError(`The file is not valid JSON or YAML. ${where}`.trim())
  }
  const parsed = bundleSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'file'}: ${issue.message}`)
    throw new BundleError(issues[0] ?? 'The bundle could not be read.', issues)
  }
  const data = parsed.data
  return {
    ...data,
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    chapters: data.chapters.map((chapter) => ({ ...chapter, graph: graphOf(chapter.graph) })),
    tools: data.tools as BundleTool[],
    guardrailPolicies: data.guardrailPolicies.map((policy) => ({ ...policy, rules: parseGuardrailRules(policy.rules) })),
    privacy: data.privacy ? parsePrivacySettings(data.privacy) : null,
    evalSuites: data.evalSuites.map((suite) => ({ ...suite, scenarios: parseEvalScenarios(suite.scenarios) })),
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function toolDraft(tool: BundleTool): ToolDraft {
  return { ...tool, authProfileId: null } as unknown as ToolDraft
}

function itemProblem(kind: BundleKind, item: unknown): string | undefined {
  if (kind === 'tool') return toolIssues(toolDraft(item as BundleTool))[0]?.message
  if (kind === 'guardrail_policy') return guardrailIssues((item as Bundle['guardrailPolicies'][number]).rules)[0]?.message
  if (kind === 'eval_suite') return evalIssues((item as Bundle['evalSuites'][number]).scenarios)[0]?.message
  return undefined
}

function comparable(kind: BundleKind, item: Record<string, unknown>): unknown {
  if (kind === 'guardrail_policy') return { rules: item['rules'] }
  return item
}

/**
 * What an import would do, item by item. Same name means same item.
 *   skip     add what is new, leave what exists
 *   merge    add what is new, update what exists, keep the rest
 *   replace  like merge, and remove what the file does not have
 */
export function planImport(current: Bundle, incoming: Bundle, mode: ImportMode, profiles: string[] = [], publishedChapters: string[] = []): ImportPlan {
  const published = new Set(publishedChapters)
  const items: PlanItem[] = []
  const warnings: string[] = []
  const lists: Array<[BundleKind, Array<{ name: string }>, Array<{ name: string }>]> = [
    ['chapter', current.chapters, incoming.chapters],
    ['tool', current.tools, incoming.tools],
    ['guardrail_policy', current.guardrailPolicies, incoming.guardrailPolicies],
    ['eval_suite', current.evalSuites, incoming.evalSuites],
  ]
  for (const [kind, have, want] of lists) {
    const existing = new Map(have.map((item) => [item.name, item]))
    const seen = new Set<string>()
    for (const item of want) {
      if (seen.has(item.name)) {
        items.push({ kind, name: item.name, action: 'invalid', note: `"${item.name}" appears twice in the file. Only the first is imported.` })
        continue
      }
      seen.add(item.name)
      const problem = itemProblem(kind, item)
      if (problem) {
        items.push({ kind, name: item.name, action: 'invalid', note: problem })
        continue
      }
      const old = existing.get(item.name)
      if (!old) items.push({ kind, name: item.name, action: 'create' })
      else if (mode === 'skip') items.push({ kind, name: item.name, action: 'keep', note: 'Already exists; skip mode leaves it as it is.' })
      else if (same(comparable(kind, old as Record<string, unknown>), comparable(kind, item as Record<string, unknown>))) items.push({ kind, name: item.name, action: 'unchanged' })
      else items.push({ kind, name: item.name, action: 'update', ...(kind === 'chapter' ? { note: 'Saved as a new draft. Production keeps playing its live release until you publish.' } : {}) })
    }
    if (mode === 'replace') {
      for (const item of have) {
        if (seen.has(item.name)) continue
        if (kind === 'chapter' && published.has(item.name)) {
          items.push({ kind, name: item.name, action: 'keep', note: 'Not in the file, but it has been published, so chats and releases still point at it. Delete it from the Journey page if you no longer need it.' })
        } else {
          items.push({ kind, name: item.name, action: 'delete' })
        }
      }
    }
  }
  if (incoming.privacy) {
    const problem = privacyIssues(incoming.privacy)[0]?.message
    const next = current.privacy ? { ...incoming.privacy, revealToAgents: current.privacy.revealToAgents } : incoming.privacy
    if (problem) items.push({ kind: 'privacy', name: 'Personal data', action: 'invalid', note: problem })
    else if (mode === 'skip' && current.privacy) items.push({ kind: 'privacy', name: 'Personal data', action: 'keep' })
    else if (same(current.privacy, next)) items.push({ kind: 'privacy', name: 'Personal data', action: 'unchanged' })
    else items.push({ kind: 'privacy', name: 'Personal data', action: 'update' })
    if (incoming.privacy.revealToAgents && !current.privacy?.revealToAgents) {
      warnings.push('The file shows personal data to human agents. Import keeps this off; an admin can turn it on in Safety.')
    }
  }
  const known = new Set(profiles)
  for (const tool of incoming.tools) {
    if (tool.authProfile && !known.has(tool.authProfile)) {
      warnings.push(`Tool "${tool.name}" uses the Auth Profile "${tool.authProfile}", which this workspace does not have. Create it in Tools → Auth Profiles, then attach it to the tool.`)
    }
  }
  const toolNames = new Set([...current.tools.map((tool) => tool.name), ...incoming.tools.map((tool) => tool.name)])
  for (const chapter of incoming.chapters) {
    const refs = JSON.stringify(chapter.graph).match(/"@tool:([^"]+)"/g) ?? []
    for (const ref of refs) {
      const name = ref.slice(TOOL_REF.length + 1, -1)
      if (!toolNames.has(name)) warnings.push(`Chapter "${chapter.name}" runs the tool "${name}", which is neither in the file nor on this bot. The chapter cannot be published until the step points at a tool.`)
    }
  }
  return { mode, items, warnings }
}

export async function planForBot(botId: string, tenantId: string, incoming: Bundle, mode: ImportMode): Promise<ImportPlan> {
  const [current, profiles, published] = await Promise.all([
    buildBundle(botId, tenantId),
    prisma.authProfile.findMany({ where: { tenantId }, select: { name: true } }),
    prisma.flow.findMany({ where: { botId, tenantId, versions: { some: { status: 'published' } } }, select: { name: true } }),
  ])
  return planImport(current, incoming, mode, profiles.map((profile) => profile.name), published.map((flow) => flow.name))
}

/** Applies a plan made by planForBot from the same file. Chapters become drafts; nothing is published. */
export async function applyImport(botId: string, tenantId: string, incoming: Bundle, plan: ImportPlan): Promise<void> {
  const act = (kind: BundleKind, name: string) => plan.items.find((item) => item.kind === kind && item.name === name)?.action
  const profiles = new Map((await prisma.authProfile.findMany({ where: { tenantId }, select: { id: true, name: true } })).map((p) => [p.name, p.id]))

  await prisma.$transaction(async (tx) => {
    for (const tool of incoming.tools) {
      const action = act('tool', tool.name)
      if (action !== 'create' && action !== 'update') continue
      const data = {
        kind: tool.kind,
        description: tool.description,
        effect: tool.effect,
        parameters: tool.parameters as object[],
        returns: tool.returns as object,
        config: tool.config as object,
        authProfileId: tool.authProfile ? profiles.get(tool.authProfile) ?? null : null,
      }
      await tx.tool.upsert({
        where: { botId_name: { botId, name: tool.name } },
        create: { tenantId, botId, name: tool.name, ...data },
        update: data,
      })
    }
    const toolIds = new Map((await tx.tool.findMany({ where: { botId }, select: { id: true, name: true } })).map((tool) => [tool.name, tool.id]))
    const fromRef = (value: string) => (value.startsWith(TOOL_REF) ? toolIds.get(value.slice(TOOL_REF.length)) ?? value : value)

    const flows = await tx.flow.findMany({ where: { botId, tenantId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } })
    const flowByName = new Map(flows.map((flow) => [flow.name, flow]))
    for (const chapter of incoming.chapters) {
      const action = act('chapter', chapter.name)
      if (action !== 'create' && action !== 'update') continue
      const graph = mapToolRefs(chapter.graph, fromRef) as object
      const flow = flowByName.get(chapter.name)
      if (!flow) {
        const created = await tx.flow.create({ data: { tenantId, botId, name: chapter.name, description: chapter.description, tags: chapter.tags } })
        await tx.flowVersion.create({ data: { tenantId, flowId: created.id, version: 1, status: 'draft', graph, variables: [] } })
        continue
      }
      await tx.flow.update({ where: { id: flow.id }, data: { tags: chapter.tags, ...(chapter.description !== undefined ? { description: chapter.description } : {}) } })
      const newest = flow.versions[0]
      if (newest && newest.status !== 'published') {
        await tx.flowVersion.update({ where: { id: newest.id }, data: { graph } })
      } else {
        await tx.flowVersion.create({ data: { tenantId, flowId: flow.id, version: (newest?.version ?? 0) + 1, status: 'draft', graph, variables: [] } })
      }
    }

    const hasActive = await tx.guardrailPolicy.count({ where: { botId, active: true } })
    let activated = hasActive > 0
    for (const policy of incoming.guardrailPolicies) {
      const action = act('guardrail_policy', policy.name)
      if (action === 'create') {
        const active = policy.active && !activated
        if (active) activated = true
        await tx.guardrailPolicy.create({ data: { tenantId, botId, name: policy.name, active, rules: policy.rules as object[] } })
      } else if (action === 'update') {
        await tx.guardrailPolicy.updateMany({ where: { botId, name: policy.name }, data: { rules: policy.rules as object[] } })
      }
    }

    for (const suite of incoming.evalSuites) {
      const action = act('eval_suite', suite.name)
      if (action === 'create') {
        await tx.evalSuite.create({ data: { tenantId, botId, name: suite.name, gate: suite.gate, scenarios: suite.scenarios as unknown as object } })
      } else if (action === 'update') {
        await tx.evalSuite.updateMany({ where: { botId, name: suite.name }, data: { gate: suite.gate, scenarios: suite.scenarios as unknown as object } })
      }
    }

    if (incoming.privacy && act('privacy', 'Personal data') === 'update') {
      const current = await tx.botConfig.findUnique({ where: { botId }, select: { privacy: true } })
      const privacy = { ...incoming.privacy, revealToAgents: current ? parsePrivacySettings(current.privacy).revealToAgents : false }
      await tx.botConfig.upsert({ where: { botId }, create: { tenantId, botId, privacy: privacy as object }, update: { privacy: privacy as object } })
    }

    const doomed = (kind: BundleKind) => plan.items.filter((item) => item.kind === kind && item.action === 'delete').map((item) => item.name)
    if (doomed('chapter').length) await tx.flow.deleteMany({ where: { botId, tenantId, name: { in: doomed('chapter') } } })
    if (doomed('tool').length) await tx.tool.deleteMany({ where: { botId, tenantId, name: { in: doomed('tool') } } })
    if (doomed('guardrail_policy').length) await tx.guardrailPolicy.deleteMany({ where: { botId, tenantId, name: { in: doomed('guardrail_policy') } } })
    if (doomed('eval_suite').length) await tx.evalSuite.deleteMany({ where: { botId, tenantId, name: { in: doomed('eval_suite') } } })
  })
}
