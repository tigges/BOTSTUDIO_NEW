import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MODEL_IDS, answerLength, documentQuality, readBotSettings, toolWaitHandoverConfig } from '@ybot/shared'

const valid = { model: 'gemini-flash-latest', responseLength: 'short', toolWaitEscalateSeconds: 10 }

test('valid settings come back typed', () => {
  assert.deepEqual(readBotSettings(valid, MODEL_IDS), { ok: true, settings: valid })
  const off = readBotSettings({ ...valid, toolWaitEscalateSeconds: null }, MODEL_IDS)
  assert.deepEqual(off, { ok: true, settings: { ...valid, toolWaitEscalateSeconds: null } })
  const blank = readBotSettings({ ...valid, toolWaitEscalateSeconds: '' }, MODEL_IDS)
  assert.equal(blank.ok && blank.settings.toolWaitEscalateSeconds, null)
})

test('each bad value names its field', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...valid, model: '' }, 'model'],
    [{ ...valid, model: 'gpt-2' }, 'model'],
    [{ ...valid, responseLength: 'huge' }, 'responseLength'],
    [{ ...valid, toolWaitEscalateSeconds: 2 }, 'toolWaitEscalateSeconds'],
    [{ ...valid, toolWaitEscalateSeconds: 121 }, 'toolWaitEscalateSeconds'],
    [{ ...valid, toolWaitEscalateSeconds: 4.5 }, 'toolWaitEscalateSeconds'],
    [{ ...valid, toolWaitEscalateSeconds: 'soon' }, 'toolWaitEscalateSeconds'],
  ]
  for (const [body, field] of cases) {
    const result = readBotSettings(body, MODEL_IDS)
    assert.equal(result.ok, false, JSON.stringify(body))
    assert.equal(!result.ok && result.field, field)
  }
  assert.equal(readBotSettings(null, MODEL_IDS).ok, false)
})

test('response length sets the instruction and never raises a tighter stored budget', () => {
  assert.equal(answerLength('short').maxTokens, 400)
  assert.equal(answerLength('long').maxTokens, 1600)
  assert.equal(answerLength('long', 600).maxTokens, 600)
  assert.equal(answerLength('nonsense').maxTokens, 800)
  assert.match(answerLength('short').instruction, /one or two short sentences/)
})

test('a tool-wait handover names the tool and the wait', () => {
  const config = toolWaitHandoverConfig('Diary lookup', 8)
  assert.equal(config['priority'], 'high')
  assert.deepEqual(config['tags'], ['tool-wait'])
  assert.match(String(config['reason']), /^Diary lookup did not answer within 8 seconds/)
  assert.match(String(toolWaitHandoverConfig('', 8)['reason']), /^A tool did not/)
})

test('FAQ documents point at saving an FAQ, not syncing', () => {
  const quality = documentQuality({ status: 'ready', sourceKind: 'faq', chars: 120, letterShare: 0.9, repeatedLineShare: 0, chunks: 0, embeddedChunks: 0 })
  assert.match(quality.issues.join(' '), /Save any FAQ to index them/)
  assert.ok(!quality.issues.some((issue) => /Very little text/.test(issue)))
})
