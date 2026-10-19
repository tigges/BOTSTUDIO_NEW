import { hoursFromCatalog, takeBookingTime, type HandoverRequest } from '@ybot/shared'
import { usableContactName } from './contact-speech.js'
import type { NodeContext, NodeResult, Session, ExecutionServices } from './types.js'
import {
  executeTriggerStart, executeSendMessage, executeAskQuestion,
  executeSetVariable, executeCondition, executeHttpRequest,
  executeClassifyIntent, executeHandover, executeCreateTicket, executeEndFlow,
  executeSearchKnowledge, executeLlmGenerate, executeRouteTopic, executeExecuteFlow,
  executeLookupCatalog, executeRunTool,
} from './nodes/executors.js'

type NodeExecutor = (ctx: NodeContext) => Promise<NodeResult>

const EXECUTORS: Record<string, NodeExecutor> = {
  trigger_start:    executeTriggerStart,
  send_message:     executeSendMessage,
  ask_question:     executeAskQuestion,
  set_variable:     executeSetVariable,
  condition:        executeCondition,
  http_request:     executeHttpRequest,
  classify_intent:  executeClassifyIntent,
  route_topic:      executeRouteTopic,
  execute_flow:     executeExecuteFlow,
  lookup_catalog:   executeLookupCatalog,
  run_tool:         executeRunTool,
  handover:         executeHandover,
  transfer_agent:   executeHandover,
  create_ticket:    executeCreateTicket,
  end_flow:         executeEndFlow,
  search_knowledge: executeSearchKnowledge,
  llm_generate:     executeLlmGenerate,
  llm_prompt:       executeLlmGenerate,
}

export interface GraphNode {
  id: string
  data: { kind: string; label: string; config: Record<string, unknown> }
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

export interface FlowGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** Yes/No on the canvas used to be saved as true/false. Both names are the same branch. */
function handlesMatch(edgeHandle: string | undefined, wanted: string): boolean {
  if (!edgeHandle) return false
  if (edgeHandle === wanted) return true
  const aliases: Record<string, string> = { yes: 'true', true: 'yes', no: 'false', false: 'no' }
  return aliases[wanted] === edgeHandle
}

export class SessionMachine {
  private services: ExecutionServices

  constructor(services: ExecutionServices) {
    this.services = services
  }

  // Run the flow graph from a given node, continuing until waiting_input, handover, or end
  async run(session: Session, graph: FlowGraph, incomingText?: string, streamChunk?: (chunk: string) => void): Promise<{
    session: Session
    newMessages: Array<{ direction: 'outbound'; content: { text: string } }>
    waitForInput?: Session['waitingFor']
    handover?: HandoverRequest
    jumpToFlow?: string
    ticket?: { subject: string; description?: string }
    completed?: boolean
  }> {
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))
    const edgeMap = new Map<string, GraphEdge[]>()
    for (const e of graph.edges) {
      if (!edgeMap.has(e.source)) edgeMap.set(e.source, [])
      edgeMap.get(e.source)!.push(e)
    }

    const allNewMessages: Array<{ direction: 'outbound'; content: { text: string } }> = []
    let ticket: { subject: string; description?: string } | undefined

    let aiReply: string | undefined
    // An AI step takes the reply itself and decides whether it is finished, so the chat stays on that node.
    if (session.status === 'waiting_input' && session.waitingFor?.type === 'ai' && incomingText) {
      aiReply = incomingText
      session.currentNodeId = session.waitingFor.nodeId || session.currentNodeId
      session.waitingFor = undefined
      session.status = 'running'
    }

    // If session is waiting for input, resume from that node with the user's text
    if (session.status === 'waiting_input' && session.waitingFor && incomingText) {
      const { variable } = session.waitingFor
      if (variable === 'guest_name' && !usableContactName(incomingText)) {
        delete session.variables.flow[variable]
      } else if (variable === 'preferred_time' || variable === 'preferred_day') {
        const taken = takeBookingTime({
          heard: incomingText,
          previousDay: String(session.variables.flow['preferred_day'] ?? ''),
          hoursText: hoursFromCatalog(this.services.catalog),
          stylist: String(session.variables.flow['stylist'] ?? 'senior'),
          now: this.services.now?.() ?? new Date(),
          offered: session.waitingFor.choices,
        })
        if (taken.ask) {
          if (taken.day) session.variables.flow['preferred_day'] = taken.day
          session.status = 'waiting_input'
          session.waitingFor = {
            ...session.waitingFor,
            variable: 'preferred_time',
            question: taken.ask,
            choices: taken.slots,
          }
          return {
            session,
            newMessages: [{ direction: 'outbound', content: { text: taken.ask } }],
            waitForInput: session.waitingFor,
          }
        }
        if (taken.spoken) {
          session.variables.flow['preferred_time'] = taken.spoken
          if (taken.day) session.variables.flow['preferred_day'] = taken.day
        } else {
          session.variables.flow[variable] = incomingText
        }
      } else {
        session.variables.flow[variable] = incomingText
      }
      session.waitingFor = undefined
      session.status = 'running'
      // Advance past the waiting node (e.g. ask_question) — don't re-execute it
      session.currentNodeId = this.nextNode(session.currentNodeId, edgeMap, undefined)
    }

    let currentId = session.currentNodeId
    const visited = new Set<string>()
    const MAX_STEPS = 50

    while (currentId && visited.size < MAX_STEPS) {
      if (visited.has(currentId)) break
      visited.add(currentId)

      const node = nodeMap.get(currentId)
      if (!node) break

      const executor = EXECUTORS[node.data.kind]
      if (!executor) {
        currentId = this.nextNode(currentId, edgeMap, undefined)
        continue
      }

      const ctx: NodeContext = {
        session, nodeId: currentId, nodeKind: node.data.kind,
        config: node.data.config ?? {},
        input: session.variables.flow,
        services: this.services,
        streamChunk: node.data.kind === 'llm_generate' ? streamChunk : undefined,
        ...(aiReply !== undefined && currentId === session.currentNodeId ? { reply: aiReply } : {}),
      }
      aiReply = undefined

      const result = await executor(ctx)

      // Merge output variables into flow scope
      Object.assign(session.variables.flow, result.output)

      if (result.newMessages) allNewMessages.push(...result.newMessages)
      if (result.ticket) ticket = result.ticket

      if (result.handover) {
        session.status = 'handed_over'
        session.currentNodeId = currentId
        return { session, newMessages: allNewMessages, handover: result.handover, ticket }
      }

      if (result.jumpToFlow) {
        session.currentNodeId = currentId
        return { session, newMessages: allNewMessages, jumpToFlow: result.jumpToFlow, ticket }
      }

      if (result.waitForInput) {
        session.status = 'waiting_input'
        session.waitingFor = { nodeId: currentId, ...result.waitForInput }
        session.currentNodeId = currentId
        return { session, newMessages: allNewMessages, waitForInput: session.waitingFor, ticket }
      }

      if (node.data.kind === 'end_flow') {
        session.status = 'completed'
        return { session, newMessages: allNewMessages, completed: true, ticket }
      }

      const nextHandle = typeof result.nextNodeId === 'string' ? result.nextNodeId : undefined
      currentId = this.nextNode(currentId, edgeMap, nextHandle)
    }

    session.currentNodeId = currentId
    return { session, newMessages: allNewMessages, ticket }
  }

  private nextNode(nodeId: string, edgeMap: Map<string, GraphEdge[]>, handle?: string): string {
    const edges = edgeMap.get(nodeId) ?? []
    if (handle) {
      const match = edges.find((edge) => handlesMatch(edge.sourceHandle, handle))
      if (match) return match.target
      // An AI step without its own turn-limit line carries on along its usual line.
      if (handle === 'max_turns') return edges[0]?.target ?? ''
      if (handle === 'out') return edges.find((edge) => edge.sourceHandle !== 'max_turns')?.target ?? ''
      return edges.find((edge) => !edge.sourceHandle)?.target ?? ''
    }
    return edges[0]?.target ?? ''
  }
}
