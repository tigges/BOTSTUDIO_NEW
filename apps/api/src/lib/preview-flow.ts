import { SessionMachine } from '@ybot/runtime'
import type { ExecutionServices, FlowGraph, Session, SessionVariables } from '@ybot/runtime'
import { spokenFirstName, type StudioCatalog } from '@ybot/shared'

export interface PreviewSnapshot {
  currentNodeId: string
  status: Session['status']
  waitingFor?: Session['waitingFor']
  variables: SessionVariables
}

export interface PreviewTurn {
  handled: boolean
  text: string
  session?: PreviewSnapshot
}

/** A reply may explain and then ask once. A second question is the next turn. */
export function keepFirstQuestion(text: string): string {
  const trimmed = text.trim()
  const first = trimmed.indexOf('?')
  if (first < 0) return trimmed
  const later = trimmed.indexOf('?', first + 1)
  if (later < 0) return trimmed
  return trimmed.slice(0, first + 1).trim()
}

function startNodeId(graph: FlowGraph): string | undefined {
  return graph.nodes.find((node) => node.data.kind === 'trigger_start' || node.data.kind === 'start')?.id
}

function snapshot(session: Session): PreviewSnapshot {
  return {
    currentNodeId: session.currentNodeId,
    status: session.status,
    waitingFor: session.waitingFor,
    variables: session.variables,
  }
}

function sessionFrom(graph: FlowGraph, message: string, saved?: PreviewSnapshot): Session | null {
  const start = startNodeId(graph)
  if (!start) return null
  const restart = !saved || saved.status === 'completed'
  const variables: SessionVariables = restart
    ? { flow: {}, global: {}, contact: { name: 'there' } }
    : {
        flow: { ...saved.variables.flow },
        global: { ...saved.variables.global },
        contact: { ...saved.variables.contact },
      }
  variables.flow['_last_user_message'] = message
  if (typeof variables.contact['name'] !== 'string' || !variables.contact['name']) {
    variables.contact['name'] = 'there'
  }
  return {
    id: 'preview',
    conversationId: 'preview',
    botId: 'preview',
    tenantId: 'preview',
    flowId: 'preview',
    flowVersionId: 'preview',
    currentNodeId: restart ? start : saved.currentNodeId,
    variables,
    status: restart ? 'running' : saved.status,
    waitingFor: restart ? undefined : saved.waitingFor,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function previewServices(catalog?: StudioCatalog): ExecutionServices {
  return {
    llm: {
      classify: async () => ({ category: 'other', confidence: 0 }),
      embed: async () => ({ embeddings: [[]] }),
      complete: async () => ({ content: '' }),
      stream: async () => {},
    },
    db: {},
    httpFetch: fetch,
    catalog,
  } as unknown as ExecutionServices
}

/**
 * Walk the chart on the canvas. The model is not asked, so it cannot add a list of questions.
 */
export async function runCanvasPreview(input: {
  graph: FlowGraph
  message: string
  session?: PreviewSnapshot
  catalog?: StudioCatalog
}): Promise<PreviewTurn> {
  const session = sessionFrom(input.graph, input.message, input.session)
  if (!session) return { handled: false, text: '' }
  const machine = new SessionMachine(previewServices(input.catalog))
  const result = await machine.run(session, input.graph, input.message)
  const given = spokenFirstName(String(result.session.variables.flow['guest_name'] ?? ''))
  if (given) result.session.variables.contact['name'] = given
  const lines = result.newMessages.map((message) => message.content.text.trim()).filter((line) => line.length > 0)
  if (result.jumpToFlow && lines.length === 0) {
    lines.push(`This step continues in ${result.jumpToFlow}.`)
  }
  if (result.handover && lines.length === 0) {
    lines.push('A person on the team will follow up.')
  }
  const text = keepFirstQuestion(lines.join('\n\n'))
  if (!text) return { handled: false, text: '', session: snapshot(result.session) }
  return { handled: true, text, session: snapshot(result.session) }
}
