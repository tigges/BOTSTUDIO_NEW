// Session variable scopes
export type VarScope = 'flow' | 'global' | 'contact'

export interface SessionVariables {
  flow: Record<string, unknown>
  global: Record<string, unknown>
  contact: Record<string, unknown>
}

// A running conversation session
export interface Session {
  id: string
  conversationId: string
  botId: string
  tenantId: string
  flowId: string
  flowVersionId: string
  currentNodeId: string
  variables: SessionVariables
  status: 'running' | 'waiting_input' | 'completed' | 'failed' | 'handed_over'
  waitingFor?: { nodeId: string; variable: string; type: string; choices?: string[]; question?: string }
  createdAt: Date
  updatedAt: Date
}

// What a node executor receives
export interface NodeContext {
  session: Session
  nodeId: string
  nodeKind: string
  config: Record<string, unknown>
  input: Record<string, unknown>
  services: ExecutionServices
  /** Optional callback invoked with each streamed token for llm_generate nodes */
  streamChunk?: (chunk: string) => void
}

// What a node returns
export interface NodeResult {
  output: Record<string, unknown>
  nextNodeId?: string
  waitForInput?: { variable: string; type: string; choices?: string[]; question?: string }
  handover?: { team?: string; priority?: string; note?: string }
  /** Leave this graph and continue in the published flow with this name. */
  jumpToFlow?: string
  ticket?: { subject: string; description?: string }
  newMessages?: Array<{ direction: 'outbound'; content: { text: string } }>
  error?: string
}

// Injectable services for nodes to use
export interface ExecutionServices {
  llm: import('./llm-adapter.js').LlmAdapter
  db: import('@ybot/db').PrismaClient
  redis?: import('ioredis').Redis
  httpFetch: typeof fetch
  catalog?: import('@ybot/shared').StudioCatalog
}
