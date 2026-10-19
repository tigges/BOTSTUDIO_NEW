import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  alwaysHumanMatch,
  DEFAULT_HANDOVER_REASON,
  handoverFromConfig,
  handoverSummary,
  inspectFlowGraph,
} from '@ybot/shared'
import { isHeld, returnChange, ticketPriority } from './handover.js'
import { streamDoneEvent } from './widget-rating.js'

test('a full handover step becomes the contract', () => {
  const request = handoverFromConfig(
    {
      reason: 'Colour correction for {{contact.name}}',
      priority: 'critical',
      tags: 'colour, vip, colour',
      summary: '',
      variables: 'flow.service, preferred_day',
      queue: 'stylists',
      skills: 'colour\ncorrection',
      queuePriority: '9',
      context: 'summary_only',
    },
    { service: 'Balayage', preferred_day: 'Saturday', phone: '07700 900123', _last_user_message: 'hi' },
    (text) => text.replace('{{contact.name}}', 'Ana'),
  )
  assert.deepEqual(request, {
    reason: 'Colour correction for Ana',
    priority: 'critical',
    tags: ['colour', 'vip'],
    summary: '',
    variables: { service: 'Balayage', preferred_day: 'Saturday' },
    routing: { queue: 'stylists', skills: ['colour', 'correction'], priority: 9 },
    context: 'summary_only',
  })
})

test('an older step with team, note and a legacy priority still hands over in full', () => {
  const request = handoverFromConfig({ team: 'salon', note: 'Wants a colour patch test', priority: 'urgent' }, { service: 'Colour', _x: 'hidden' })
  assert.equal(request.reason, 'Wants a colour patch test')
  assert.equal(request.priority, 'high')
  assert.deepEqual(request.routing, { queue: 'salon', skills: [], priority: 3 })
  assert.equal(request.context, 'full_transcript')
  assert.deepEqual(request.variables, { service: 'Colour' })
})

test('a bare step gets the default reason, medium priority and the support queue', () => {
  const request = handoverFromConfig({})
  assert.equal(request.reason, DEFAULT_HANDOVER_REASON)
  assert.equal(request.priority, 'medium')
  assert.equal(request.routing.queue, 'support')
  assert.equal(request.routing.priority, 2)
})

test('the flow check blocks a priority or context the contract does not have', () => {
  const graph = {
    nodes: [
      { id: 's', data: { kind: 'trigger_start' } },
      { id: 'h', data: { kind: 'handover', label: 'Hand to the studio', config: { priority: 'asap', context: 'everything' } } },
    ],
    edges: [{ id: 'e', source: 's', target: 'h' }],
  }
  const codes = inspectFlowGraph(graph).filter((issue) => issue.level === 'block').map((issue) => issue.code)
  assert.deepEqual(codes, ['handover-priority', 'handover-context'])
  const fine = { ...graph, nodes: [graph.nodes[0]!, { id: 'h', data: { kind: 'transfer_agent', label: 'Agent', config: { priority: 'normal' } } }] }
  assert.deepEqual(inspectFlowGraph(fine).filter((issue) => issue.level === 'block'), [])
})

test('the always-human list matches words and phrases in any case, never inside other words', () => {
  const words = ['complaint', 'speak to a manager', 'lawyer']
  assert.equal(alwaysHumanMatch('I have a COMPLAINT.', words), 'complaint')
  assert.equal(alwaysHumanMatch('can I speak  to a manager please', words), 'speak to a manager')
  assert.equal(alwaysHumanMatch('my complaints were ignored', words), undefined)
  assert.equal(alwaysHumanMatch('anything', []), undefined)
})

test('the summary is written from the guest lines and the captured answers', () => {
  assert.equal(
    handoverSummary(['I would like a colour correction', 'Saturday please'], { preferred_day: 'Saturday' }),
    'Opened with “I would like a colour correction”. Latest: “Saturday please”. Known: preferred day: Saturday.',
  )
  assert.equal(handoverSummary([], {}), 'The guest has not written anything yet.')
})

test('a chat is held while escalated or assigned and open, never once closed', () => {
  assert.equal(isHeld({ status: 'escalated', assignedTo: null }), true)
  assert.equal(isHeld({ status: 'active', assignedTo: 'u1' }), true)
  assert.equal(isHeld({ status: 'active', assignedTo: null }), false)
  assert.equal(isHeld({ status: 'resolved', assignedTo: 'u1' }), false)
  assert.equal(isHeld(null), false)
})

test('every hand-back keeps the escalation on record', () => {
  const at = new Date('2026-10-19T18:00:00Z')
  assert.deepEqual(returnChange('resolved', at), { status: 'resolved', resolvedAt: at, outcome: 'escalated' })
  assert.deepEqual(returnChange('needs_bot', at), { status: 'active', assignedTo: null, resolvedAt: null, outcome: 'escalated' })
  assert.deepEqual(returnChange('needs_follow_up', at), { status: 'closed', resolvedAt: at, outcome: 'escalated' })
  assert.equal(ticketPriority('critical'), 'urgent')
  assert.equal(ticketPriority(undefined), 'medium')
})

test('the widget is told when a person has the chat', () => {
  assert.deepEqual(streamDoneEvent(false, true), { done: true, live: true })
  assert.deepEqual(streamDoneEvent(true), { done: true, ended: true })
})
