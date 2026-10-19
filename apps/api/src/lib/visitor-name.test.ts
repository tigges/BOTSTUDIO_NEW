import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fillNameTokens } from '@ybot/shared'
import { finishBotLines, nameThanksEndsTurn, planNameTurn, presentChatText } from './visitor-name.js'

test('a stored welcome with no name reads as there', () => {
  const stored = 'Hi {{contact.name}}! 👋 Welcome to Bella Hair Studio. How can I help you today?'
  assert.equal(presentChatText(stored, 'hi'), 'Hi there! 👋 Welcome to Bella Hair Studio. How can I help you today?')
  assert.equal(presentChatText(stored, 'Visitor'), 'Hi there! 👋 Welcome to Bella Hair Studio. How can I help you today?')
  assert.equal(fillNameTokens(stored, 'Sarah Jones'), 'Hi Sarah! 👋 Welcome to Bella Hair Studio. How can I help you today?')
  assert.equal(presentChatText(stored, '{{contact.name}}').includes('{{'), false)
})

test('an unknown visitor is not asked for a name the bot does not use', () => {
  const first = planNameTurn({ id: 'c', displayName: 'hi' }, 'hi')
  assert.equal(first.spoken, 'there')
  assert.equal(first.thanks, undefined)

  const asked = finishBotLines(
    ['Hi there! Welcome to Bella Hair Studio.'],
    { id: 'c', displayName: 'hi' },
    first.spoken,
    { conversationId: 'chat-1' },
  )
  assert.deepEqual(asked.lines, ['Hi there! Welcome to Bella Hair Studio.'])
  assert.equal(asked.metadata, undefined)

  const again = finishBotLines(
    ['We are open Monday to Saturday.'],
    { id: 'c', displayName: 'hi', metadata: asked.metadata },
    'there',
    { conversationId: 'chat-1' },
  )
  assert.deepEqual(again.lines, ['We are open Monday to Saturday.'])
  assert.equal(again.metadata, undefined)

  const waiting = finishBotLines(
    ["Hi, I'm Bella at Bella Hair Studio."],
    { id: 'c', displayName: 'hi' },
    'there',
    { waiting: true },
  )
  assert.deepEqual(waiting.lines, ["Hi, I'm Bella at Bella Hair Studio."])
  assert.equal(waiting.metadata, undefined)
})

test('a real name is used only after this chat asked', () => {
  const unasked = planNameTurn({ id: 'c', displayName: 'Visitor' }, 'Sarah Jones', 'chat-1')
  assert.equal(unasked.spoken, 'there')
  assert.equal(unasked.displayName, undefined)

  const opened = planNameTurn(
    { id: 'c', displayName: 'Visitor', metadata: { chatName: { conversationId: 'chat-1', nameAsked: true, awaitingName: true } } },
    'Sarah Jones',
    'chat-1',
  )
  assert.equal(opened.spoken, 'Sarah')
  assert.equal(opened.displayName, 'Sarah Jones')

  const waiting = planNameTurn(
    { id: 'c', displayName: 'Visitor', metadata: { chatName: { conversationId: 'chat-1', nameAsked: true, awaitingName: true } } },
    'Mary-Jane',
    'chat-1',
  )
  assert.equal(waiting.thanks, 'Thanks, Mary-Jane.')
  assert.equal(waiting.displayName, 'Mary-Jane')

  const notAName = planNameTurn(
    { id: 'c', displayName: 'Visitor', metadata: { chatName: { conversationId: 'chat-1', nameAsked: true, awaitingName: true } } },
    'I want a haircut',
    'chat-1',
  )
  assert.equal(notAName.thanks, undefined)
  assert.equal(notAName.spoken, 'there')
  const saved = notAName.metadata?.['chatName'] as { awaitingName?: boolean }
  assert.equal(saved.awaitingName, false)
})

test('ordinary words are not a name, even when we asked', () => {
  for (const word of ['help', 'features', 'N', 'hi there', 'book a colour']) {
    const plan = planNameTurn(
      { id: 'c', metadata: { chatName: { conversationId: 'chat-1', nameAsked: true, awaitingName: true } } },
      word,
      'chat-1',
    )
    assert.equal(plan.thanks, undefined, word)
    assert.equal(plan.spoken, 'there', word)
  }
})

test('a flow that already asked the name does not glue it onto the menu', () => {
  const asked = finishBotLines(
    ["What's your name?"],
    { id: 'c' },
    'there',
    { conversationId: 'chat-1' },
  )
  assert.deepEqual(asked.lines, ["What's your name?"])
  const state = asked.metadata?.['chatName'] as { nameAsked?: boolean; awaitingName?: boolean }
  assert.equal(state.nameAsked, true)
  assert.equal(state.awaitingName, true)
  const menu = finishBotLines(
    ['Ask me about features, the inbox, the free plan, or how to start.'],
    { id: 'c', metadata: asked.metadata },
    'there',
    { conversationId: 'chat-1' },
  )
  assert.deepEqual(menu.lines, ['Ask me about features, the inbox, the free plan, or how to start.'])
})

test('a new chat does not reuse a name remembered from an earlier chat', () => {
  const earlier = planNameTurn(
    { id: 'c', displayName: 'Visitor', metadata: { chatName: { conversationId: 'chat-1', nameAsked: true, awaitingName: true } } },
    'Sophie Turner',
    'chat-1',
  )
  const contact = { id: 'c', displayName: 'Sophie Turner', metadata: earlier.metadata }
  const opened = planNameTurn(contact, 'hi', 'chat-2')
  assert.equal(opened.spoken, 'there')
  assert.equal(opened.thanks, undefined)
  const sameChat = planNameTurn(contact, 'hello', 'chat-1')
  assert.equal(sameChat.spoken, 'Sophie')

  const asked = finishBotLines(
    ['Cuts start from £35.'],
    contact,
    'there',
    { conversationId: 'chat-2' },
  )
  assert.deepEqual(asked.lines, ['Cuts start from £35.'])
  assert.equal(asked.metadata, undefined)
})

test('a waiting chart keeps going after the name', () => {
  assert.equal(nameThanksEndsTurn('Thanks, Sophie.', 'waiting_input'), false)
  assert.equal(nameThanksEndsTurn('Thanks, Sophie.', 'running'), true)
  assert.equal(nameThanksEndsTurn('Thanks, Sophie.', null), true)
  assert.equal(nameThanksEndsTurn(undefined, 'waiting_input'), false)
})
