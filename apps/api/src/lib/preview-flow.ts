import { SessionMachine, keepFirstQuestion, shapeTurn } from '@ybot/runtime'
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

export { keepFirstQuestion }

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

function classifyOnlyLlm(llm?: unknown) {
  const classify = llm && typeof llm === 'object' && typeof (llm as { classify?: unknown }).classify === 'function'
    ? (llm as { classify: (text: string, params: { categories: string[] }) => Promise<{ category: string; confidence: number }> }).classify.bind(llm)
    : async () => ({ category: 'other', confidence: 0 })
  return {
    classify,
    embed: async () => ({ embeddings: [[]] }),
    complete: async () => ({ content: '' }),
    stream: async () => {},
  }
}

function previewServices(catalog?: StudioCatalog, llm?: unknown): ExecutionServices {
  return {
    llm: classifyOnlyLlm(llm),
    db: {},
    httpFetch: fetch,
    catalog,
  } as unknown as ExecutionServices
}

/**
 * Walk the chart on the canvas. complete() is not asked, so the model cannot add a list of questions.
 * Phrase miss may classify among this chart's handles when llm is passed.
 */
export async function runCanvasPreview(input: {
  graph: FlowGraph
  message: string
  session?: PreviewSnapshot
  catalog?: StudioCatalog
  llm?: unknown
}): Promise<PreviewTurn> {
  const session = sessionFrom(input.graph, input.message, input.session)
  if (!session) return { handled: false, text: '' }
  const machine = new SessionMachine(previewServices(input.catalog, input.llm))
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
  const text = shapeTurn(lines.join('\n\n'))
  if (!text) return { handled: false, text: '', session: snapshot(result.session) }
  return { handled: true, text, session: snapshot(result.session) }
}
