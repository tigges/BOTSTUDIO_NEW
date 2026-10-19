import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine } from './engine.js'
import type { FlowGraph } from './engine.js'
import type { ExecutionServices, Session } from './types.js'

function session(flow: Record<string, unknown>): Session {
  return {
    id: 's1',
    conversationId: 'c1',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId: 'start',
    variables: { flow, global: {}, contact: { name: 'Ana' } },
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

for (const kind of ['handover', 'transfer_agent']) {
  test(`a ${kind} step stops the journey and carries the handover contract`, async () => {
    const machine = new SessionMachine({ llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices)
    const graph: FlowGraph = {
      nodes: [
        { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
        { id: 'say', data: { kind: 'send_message', label: 'Say', config: { text: 'I am passing this chat to the studio.' } } },
        {
          id: 'hand',
          data: {
            kind,
            label: 'Hand to the studio',
            config: { reason: 'Colour correction for {{contact.name}}', priority: 'high', tags: 'colour', queue: 'stylists', variables: 'service' },
          },
        },
        { id: 'after', data: { kind: 'send_message', label: 'After', config: { text: 'This never runs.' } } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'say' },
        { id: 'e2', source: 'say', target: 'hand' },
        { id: 'e3', source: 'hand', target: 'after' },
      ],
    }
    const result = await machine.run(session({ service: 'Balayage', budget: 'none' }), graph, 'I need my colour fixed')
    assert.equal(result.session.status, 'handed_over')
    assert.deepEqual(result.newMessages.map((message) => message.content.text), ['I am passing this chat to the studio.'])
    assert.deepEqual(result.handover, {
      reason: 'Colour correction for Ana',
      priority: 'high',
      tags: ['colour'],
      summary: '',
      variables: { service: 'Balayage' },
      routing: { queue: 'stylists', skills: [], priority: 3 },
      context: 'full_transcript',
    })
  })
}
