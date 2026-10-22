import { prisma } from '@botstudio/db'
import { toolParametersSchema, type ToolParameter } from '@botstudio/shared'
import { loadPrivacy, renderDeepFor } from './privacy.js'
import { defaultToolDeps, runTool, type ToolDeps, type ToolResult, type ToolRunContext } from './tool-runner.js'

const withProfile = { authProfile: { select: { id: true, name: true, kind: true, settings: true, secretEnc: true } } } as const

export async function findTool(tenantId: string, botId: string, toolId: string) {
  return prisma.tool.findFirst({ where: { id: toolId, tenantId, botId }, include: withProfile })
}

type ToolWithProfile = NonNullable<Awaited<ReturnType<typeof findTool>>>

/** The console shape: JSON Schema included, credentials reduced to the profile's name. */
export function presentTool(tool: ToolWithProfile | Omit<ToolWithProfile, 'authProfile'> & { authProfile?: { id: string; name: string } | null }) {
  const parameters = (Array.isArray(tool.parameters) ? tool.parameters : []) as unknown as ToolParameter[]
  return {
    id: tool.id,
    botId: tool.botId,
    name: tool.name,
    kind: tool.kind,
    description: tool.description,
    parameters,
    schema: toolParametersSchema(parameters),
    returns: tool.returns,
    effect: tool.effect,
    config: tool.config,
    authProfileId: tool.authProfileId,
    authProfileName: tool.authProfile?.name ?? null,
    createdAt: tool.createdAt.toISOString(),
    updatedAt: tool.updatedAt.toISOString(),
  }
}

/** Runs a tool and records the run. Arguments and output are stored without the profile's secret. */
export async function runAndRecord(tool: ToolWithProfile, args: Record<string, unknown> | undefined, ctx: ToolRunContext, deps: ToolDeps = defaultToolDeps()): Promise<ToolResult & { runId: string }> {
  const result = await runTool(tool, args, ctx, deps)
  const privacy = await loadPrivacy(tool.botId)
  const kept = <T,>(value: T) => renderDeepFor('tool_output', value, privacy, tool.tenantId)
  const row = await prisma.toolRun.create({
    data: {
      tenantId: tool.tenantId,
      toolId: tool.id,
      conversationId: ctx.conversationId ?? null,
      source: ctx.source,
      actorId: ctx.actorId ?? null,
      ok: result.ok,
      status: result.status ?? null,
      durationMs: result.durationMs,
      attempts: result.attempts,
      input: kept(args ?? {}) as object,
      output: kept(result.output ?? null) as object,
      error: result.error ? kept(result.error) : null,
    },
  })
  return { ...result, runId: row.id }
}

/** What flows call: run by id inside one bot, recorded against the conversation. */
export function toolRunnerFor(tenantId: string, botId: string, ctx: ToolRunContext) {
  return async (toolId: string, args: Record<string, unknown>): Promise<ToolResult> => {
    const tool = await findTool(tenantId, botId, toolId)
    if (!tool) return { ok: false, output: null, error: 'This tool is no longer in the Tools list.', durationMs: 0, attempts: 0 }
    return runAndRecord(tool, args, ctx)
  }
}
