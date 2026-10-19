/**
 * The LLM call ledger: one llm_calls row per provider call.
 * Callers open a scope (who is asking and why); every call inside it is attributed to that scope.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { prisma } from '@ybot/db'
import { setLlmRecorder, type LlmCallRecord } from '@ybot/llm'

export type LlmSource = 'runtime' | 'retrieval' | 'guardrail' | 'eval' | 'summarisation' | 'authoring'

export interface LlmScope {
  source: LlmSource
  tenantId?: string
  botId?: string
  conversationId?: string
  environment?: string
  traceId?: string
}

const scopes = new AsyncLocalStorage<LlmScope & { traceId: string }>()

/** Runs fn with every LLM call inside it attributed to this scope. A nested scope keeps the outer trace. */
export function withLlmScope<T>(scope: LlmScope, fn: () => T): T {
  const outer = scopes.getStore()
  return scopes.run({ ...outer, ...scope, traceId: scope.traceId ?? outer?.traceId ?? randomUUID() }, fn)
}

/** Attributes the rest of the current request or job to this scope. */
export function enterLlmScope(scope: LlmScope): void {
  const outer = scopes.getStore()
  scopes.enterWith({ ...outer, ...scope, traceId: scope.traceId ?? outer?.traceId ?? randomUUID() })
}

/** The scope for a chat: its tenant, bot and environment kind (test traffic stays out of production numbers). */
export async function conversationScope(conversationId: string, source: LlmSource = 'runtime'): Promise<LlmScope> {
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { tenantId: true, botId: true, environment: { select: { kind: true } } },
  }).catch(() => null)
  return {
    source,
    conversationId,
    tenantId: convo?.tenantId,
    botId: convo?.botId,
    environment: convo?.environment?.kind,
  }
}

export function currentLlmScope(): (LlmScope & { traceId: string }) | undefined {
  return scopes.getStore()
}

/** The row a call becomes. Embeddings during a chat are retrieval, not the reply itself. */
export function ledgerRow(record: LlmCallRecord, scope: (LlmScope & { traceId: string }) | undefined) {
  const source: LlmSource = record.operation === 'embed' && (!scope || scope.source === 'runtime')
    ? 'retrieval'
    : scope?.source ?? 'runtime'
  return {
    tenantId: scope?.tenantId ?? null,
    botId: scope?.botId ?? null,
    conversationId: scope?.conversationId ?? null,
    traceId: scope?.traceId ?? randomUUID(),
    source,
    environment: scope?.environment ?? null,
    provider: record.provider,
    model: record.model || 'unknown',
    operation: record.operation,
    inputTokens: record.inputTokens,
    cachedTokens: record.cachedTokens,
    completionTokens: record.completionTokens,
    reasoningTokens: record.reasoningTokens,
    outputTokens: record.outputTokens,
    latencyMs: record.latencyMs,
    ttftMs: record.ttftMs,
    costUsd: record.costUsd,
    ok: record.ok,
    error: record.error,
  }
}

export function installLlmLedger(log: (message: string) => void = console.warn): void {
  let warned = false
  setLlmRecorder((record) => {
    const row = ledgerRow(record, scopes.getStore())
    prisma.llmCall.create({ data: row }).catch((err: unknown) => {
      if (warned) return
      warned = true
      log(`[llm-ledger] could not write a call row: ${err instanceof Error ? err.message : String(err)}`)
    })
  })
}

/** Cost and call count per conversation; conversations without calls are absent, never zero. */
export async function costByConversation(conversationIds: string[]): Promise<Map<string, { costUsd: number | null; calls: number }>> {
  if (conversationIds.length === 0) return new Map()
  const rows = await prisma.llmCall.groupBy({
    by: ['conversationId'],
    where: { conversationId: { in: conversationIds } },
    _sum: { costUsd: true },
    _count: { _all: true },
  })
  return new Map(rows.flatMap((row) => row.conversationId
    ? [[row.conversationId, { costUsd: row._sum.costUsd, calls: row._count._all }] as const]
    : []))
}
