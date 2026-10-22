import type { FlowGraph, Session, SessionMachine } from '@botstudio/runtime'

type RunResult = Awaited<ReturnType<SessionMachine['run']>>

function spoke(result: RunResult): boolean {
  return result.newMessages.some((message) => message.content.text.trim().length > 0)
}

/**
 * Run one visitor turn. When the saved session is stuck on a node that says
 * nothing (the welcome flow does this after the question is answered), start
 * the published flow again so the visitor still gets a reply.
 */
export async function runFlowTurn(
  machine: SessionMachine,
  session: Session,
  graph: FlowGraph,
  startNodeId: string,
  userText: string,
): Promise<RunResult> {
  const result = await machine.run(session, graph, userText)
  if (spoke(result) || result.handover || result.jumpToFlow) return result
  return machine.run(
    {
      ...session,
      currentNodeId: startNodeId,
      status: 'running',
      waitingFor: undefined,
    },
    graph,
    userText,
  )
}
