import assert from 'node:assert/strict'
import { test } from 'node:test'
import { starterFlows } from '@botstudio/shared'
import { stockWelcomeKind } from './stock-welcome.js'

test('a stock stacked welcome is recognised and the new greeting is not', () => {
  assert.equal(stockWelcomeKind({
    text: 'Hi {{contact.name}}. Welcome to Acme. How can I help?',
    ask: 'What do you need help with?',
  }), 'starter')
  assert.equal(stockWelcomeKind({
    text: 'Hi {{contact.name}}! Welcome to Acme. How can I help you today?',
    ask: 'What do you need help with?',
  }), 'support')
  assert.equal(stockWelcomeKind({
    text: 'Hi {{contact.name}}! I can tell you what BotStudio does.',
    ask: 'What would you like to know?',
  }), 'product')
  const welcome = starterFlows('Acme Corp').find((flow) => flow.name === 'Welcome & Routing')
  assert.equal(stockWelcomeKind(welcome?.graph), null)
  assert.match(JSON.stringify(welcome?.graph), /Hi, I'm the assistant from Acme Corp/)
  assert.equal(stockWelcomeKind({ text: "Hi, I'm the assistant from Acme. How can I help? What do you need help with?" }), null)
  assert.equal(stockWelcomeKind(null), null)
})
