import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FlowGraph } from './engine.js'
import { basicAct, basicsReply } from './conversation-basics.js'
import { choiceAlreadyHeard } from './nodes/executors.js'

const welcome = {
  nodes: [
    { id: 'ask', type: 'flow-node', position: { x: 0, y: 0 }, data: { kind: 'ask_question', label: 'Ask', config: { question: 'What can I help with?', variable: 'request' } } },
    { id: 'route', type: 'flow-node', position: { x: 0, y: 0 }, data: { kind: 'route_topic', label: 'Route', config: { routes: [
      { handle: 'book', phrases: ['book', 'appointment'] },
      { handle: 'close', phrases: ['no thanks', 'thanks', "that's all"] },
    ] } } },
  ],
  edges: [{ id: 'e1', source: 'ask', target: 'route' }],
} as unknown as FlowGraph

test('basic moves are heard on their own, and a real request is not', () => {
  assert.equal(basicAct('hi'), 'greeting')
  assert.equal(basicAct('Hello there!'), 'greeting')
  assert.equal(basicAct('good morning'), 'greeting')
  assert.equal(basicAct('hi, how are you?'), 'how_are_you')
  assert.equal(basicAct('Thank you so much'), 'thanks')
  assert.equal(basicAct('Are you a bot?'), 'bot_question')
  assert.equal(basicAct('am I talking to a real person'), 'bot_question')
  assert.equal(basicAct('what can you do?'), 'help')
  assert.equal(basicAct('sorry?'), 'repeat')
  assert.equal(basicAct('bye'), 'goodbye')
  assert.equal(basicAct('hi, how much is a check-up?'), undefined)
  assert.equal(basicAct('I want to book'), undefined)
  assert.equal(basicAct('Priya'), undefined)
  assert.equal(basicAct('yes'), undefined)
})

test('a hello answers and asks the open question again, instead of "didn\'t catch that"', () => {
  assert.deepEqual(basicsReply({ text: 'hi', graph: welcome, nodeId: 'ask', question: 'What can I help with?' }), {
    act: 'greeting', keepWaiting: true, text: 'Hi! What can I help with?',
  })
  assert.match(basicsReply({ text: 'are you a bot?', graph: welcome, nodeId: 'ask', question: 'What can I help with?' })!.text, /virtual assistant, not a person.*What can I help with\?$/)
  assert.equal(basicsReply({ text: 'sorry?', graph: welcome, nodeId: 'ask', question: 'What can I help with?' })!.text, 'Sure. What can I help with?')
})

test('the chart keeps words it has its own route for, and an AI step keeps the conversation', () => {
  assert.equal(basicsReply({ text: 'thanks', graph: welcome, nodeId: 'ask', question: 'Anything else?' }), undefined)
  assert.equal(basicsReply({ text: 'hi', graph: welcome, nodeId: 'ask', question: 'Which plan?', waitingType: 'ai' }), undefined)
  assert.equal(basicsReply({ text: 'I need a check-up', graph: welcome, nodeId: 'ask', question: 'What can I help with?' }), undefined)
})

test('a question whose answer the guest already gave is not asked again', () => {
  const choices = ['a check-up', 'a hygiene clean', 'a treatment', "I'm new"]
  assert.equal(choiceAlreadyHeard(choices, 'I need a check-up'), 'a check-up')
  assert.equal(choiceAlreadyHeard(choices, 'can I book a checkup please'), 'a check-up')
  assert.equal(choiceAlreadyHeard(choices, 'I want to book'), undefined)
  assert.equal(choiceAlreadyHeard(choices, 'a check-up and a hygiene clean'), undefined)
  assert.equal(choiceAlreadyHeard(choices, "I'm new here"), undefined)
  assert.equal(choiceAlreadyHeard(undefined, 'I need a check-up'), undefined)
})

test('"again?" asks for the question once more, and an annoyed guest gets an apology and the question', () => {
  assert.equal(basicAct('again?'), 'repeat')
  assert.equal(basicAct('say that again'), 'repeat')
  assert.equal(basicAct('stupid'), 'frustrated')
  assert.equal(basicAct("this is useless"), 'frustrated')
  assert.equal(basicAct("you're not helping"), 'frustrated')
  assert.equal(basicAct('my tooth is broken'), undefined)
  const offer = 'I can help you with a booking or prices. What would you like?'
  assert.equal(basicsReply({ text: 'stupid', graph: welcome, nodeId: 'ask', question: offer })!.text, `Sorry, I haven't been much help so far. ${offer}`)
  assert.equal(basicsReply({ text: 'what can you do?', graph: welcome, nodeId: 'ask', question: offer })!.text, `Sure. ${offer}`)
})
