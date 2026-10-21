import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LlmCallRecord } from '@botstudio/llm'
import { currentLlmScope, enterLlmScope, ledgerRow, withLlmScope } from './llm-ledger.js'

const record = (operation: LlmCallRecord['operation']): LlmCallRecord => ({
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  operation,
  inputTokens: 100,
  cachedTokens: 0,
  completionTokens: 20,
  reasoningTokens: 0,
  outputTokens: 20,
  latencyMs: 300,
  ttftMs: operation === 'stream' ? 120 : null,
  costUsd: 0.00008,
  ok: true,
  error: null,
})

test('a reply inside a chat is a runtime row tied to the chat and its environment', () => {
  const row = ledgerRow(record('stream'), { source: 'runtime', tenantId: 't1', botId: 'b1', conversationId: 'c1', environment: 'production', traceId: 'tr1' })
  assert.equal(row.source, 'runtime')
  assert.equal(row.conversationId, 'c1')
  assert.equal(row.environment, 'production')
  assert.equal(row.traceId, 'tr1')
  assert.equal(row.ttftMs, 120)
})

test('embeddings during a chat count as retrieval, other scopes keep their source', () => {
  assert.equal(ledgerRow(record('embed'), { source: 'runtime', traceId: 't' }).source, 'retrieval')
  assert.equal(ledgerRow(record('embed'), undefined).source, 'retrieval')
  assert.equal(ledgerRow(record('embed'), { source: 'authoring', traceId: 't' }).source, 'authoring')
  assert.equal(ledgerRow(record('complete'), { source: 'summarisation', traceId: 't' }).source, 'summarisation')
})

test('a call with no scope still gets a trace id', () => {
  const row = ledgerRow({ ...record('complete'), model: '' }, undefined)
  assert.ok(row.traceId.length > 0)
  assert.equal(row.model, 'unknown')
  assert.equal(row.tenantId, null)
})

test('a nested scope keeps the outer trace; entering a scope stays inside its job', async () => {
  await withLlmScope({ source: 'runtime', tenantId: 't1' }, async () => {
    const outer = currentLlmScope()!
    await withLlmScope({ source: 'retrieval' }, async () => {
      assert.equal(currentLlmScope()!.traceId, outer.traceId)
      assert.equal(currentLlmScope()!.tenantId, 't1')
    })
    await Promise.resolve()
    enterLlmScope({ source: 'runtime', conversationId: 'c9' })
    await new Promise((resolve) => setTimeout(resolve, 1))
    assert.equal(currentLlmScope()!.conversationId, 'c9')
    assert.equal(currentLlmScope()!.traceId, outer.traceId)
  })
  assert.equal(currentLlmScope(), undefined)
})
