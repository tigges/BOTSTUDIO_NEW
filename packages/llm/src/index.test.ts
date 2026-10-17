import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseLlmProvider, hasCloudLlm, resolveLlmEnv } from './index.js'

test('Gemini Flash wins over a paid OpenAI key', () => {
  assert.equal(chooseLlmProvider({ GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' }), 'gemini')
  assert.equal(chooseLlmProvider({ GROQ_API_KEY: 'q', OPENAI_API_KEY: 'o' }), 'groq')
  assert.equal(chooseLlmProvider({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' }), 'openai')
  assert.equal(chooseLlmProvider({ ANTHROPIC_API_KEY: 'a' }), 'anthropic')
  assert.equal(chooseLlmProvider({}), 'ollama')
  assert.equal(hasCloudLlm({ GEMINI_API_KEY: 'g' }), true)
  assert.equal(hasCloudLlm({}), false)
})

test('a leftover provider/apiKey bag still reads GEMINI_API_KEY from the process', () => {
  const previous = process.env['GEMINI_API_KEY']
  process.env['GEMINI_API_KEY'] = 'from-server'
  try {
    const resolved = resolveLlmEnv({
      provider: 'openai',
      apiKey: 'only-openai',
    })
    assert.equal(resolved['GEMINI_API_KEY'], 'from-server')
    assert.equal(chooseLlmProvider(resolved), 'gemini')
  } finally {
    if (previous === undefined) delete process.env['GEMINI_API_KEY']
    else process.env['GEMINI_API_KEY'] = previous
  }
})
