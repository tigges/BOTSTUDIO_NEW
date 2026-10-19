export type NodeKind =
  | 'start'
  | 'send_message'
  | 'ask_question'
  | 'condition'
  | 'set_variable'
  | 'http_request'
  | 'execute_flow'
  | 'transfer_agent'
  | 'resolve'
  | 'delay'
  | 'send_email'
  | 'llm_prompt'
  | 'knowledge_search'
  | 'buttons'
  | 'carousel'
  | 'quick_replies'
  // Backend runtime aliases (kept for backward-compat with saved graphs)
  | 'trigger_start'
  | 'llm_generate'
  | 'end_flow'
  | 'handover'
  | 'search_knowledge'
  | 'classify_intent'
  | 'create_ticket'
  | 'route_topic'
  | 'lookup_catalog'
  | 'run_tool'

export interface NodePort {
  id: string
  label?: string
  type: 'source' | 'target'
}

export interface NodeDefinition {
  kind: NodeKind
  label: string
  description: string
  category: 'trigger' | 'message' | 'logic' | 'action' | 'integration' | 'end' | 'runtime_alias'
  icon: string
  color: string
  ports: NodePort[]
  configSchema?: Record<string, unknown>
}

export const NODE_DEFINITIONS: Record<NodeKind, NodeDefinition> = {
  start: {
    kind: 'start',
    label: 'Start',
    description: 'Flow entry point',
    category: 'trigger',
    icon: 'play',
    color: '#22c55e',
    ports: [{ id: 'out', label: 'Next', type: 'source' }],
  },
  send_message: {
    kind: 'send_message',
    label: 'Send Message',
    description: 'Send text, image, or rich content',
    category: 'message',
    icon: 'message-square',
    color: '#3b82f6',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  ask_question: {
    kind: 'ask_question',
    label: 'Ask Question',
    description: 'Ask for user input and store in variable',
    category: 'message',
    icon: 'help-circle',
    color: '#8b5cf6',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  condition: {
    kind: 'condition',
    label: 'Condition',
    description: 'Branch based on expression',
    category: 'logic',
    icon: 'git-branch',
    color: '#f59e0b',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'true', label: 'True', type: 'source' },
      { id: 'false', label: 'False', type: 'source' },
    ],
  },
  set_variable: {
    kind: 'set_variable',
    label: 'Set Variable',
    description: 'Assign a value to a variable',
    category: 'logic',
    icon: 'variable',
    color: '#f59e0b',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  http_request: {
    kind: 'http_request',
    label: 'HTTP Request',
    description: 'Call an external API',
    category: 'integration',
    icon: 'globe',
    color: '#06b6d4',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'success', label: 'Success', type: 'source' },
      { id: 'error', label: 'Error', type: 'source' },
    ],
  },
  run_tool: {
    kind: 'run_tool',
    label: 'Run tool',
    description: 'Run a tool from the Tools list and keep its result',
    category: 'integration',
    icon: 'wrench',
    color: '#0ea5e9',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'success', label: 'Success', type: 'source' },
      { id: 'error', label: 'Error', type: 'source' },
    ],
  },
  execute_flow: {
    kind: 'execute_flow',
    label: 'Execute Flow',
    description: 'Jump to another flow',
    category: 'action',
    icon: 'workflow',
    color: '#6366f1',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  transfer_agent: {
    kind: 'transfer_agent',
    label: 'Transfer to Agent',
    description: 'Escalate to a human agent',
    category: 'action',
    icon: 'headphones',
    color: '#ec4899',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  resolve: {
    kind: 'resolve',
    label: 'Resolve',
    description: 'Mark conversation as resolved',
    category: 'end',
    icon: 'check-circle',
    color: '#22c55e',
    ports: [{ id: 'in', type: 'target' }],
  },
  delay: {
    kind: 'delay',
    label: 'Delay',
    description: 'Wait before continuing',
    category: 'logic',
    icon: 'clock',
    color: '#64748b',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  send_email: {
    kind: 'send_email',
    label: 'Send Email',
    description: 'Send an email',
    category: 'action',
    icon: 'mail',
    color: '#3b82f6',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  llm_prompt: {
    kind: 'llm_prompt',
    label: 'LLM Prompt',
    description: 'Generate AI response',
    category: 'action',
    icon: 'sparkles',
    color: '#a855f7',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  knowledge_search: {
    kind: 'knowledge_search',
    label: 'Knowledge Search',
    description: 'Search knowledge base (RAG)',
    category: 'action',
    icon: 'search',
    color: '#06b6d4',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'found', label: 'Found', type: 'source' },
      { id: 'not_found', label: 'Not Found', type: 'source' },
    ],
  },
  buttons: {
    kind: 'buttons',
    label: 'Buttons',
    description: 'Present clickable button choices',
    category: 'message',
    icon: 'layout',
    color: '#3b82f6',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  carousel: {
    kind: 'carousel',
    label: 'Carousel',
    description: 'Swipeable card carousel',
    category: 'message',
    icon: 'layers',
    color: '#3b82f6',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  quick_replies: {
    kind: 'quick_replies',
    label: 'Quick Replies',
    description: 'Fast-select reply chips',
    category: 'message',
    icon: 'zap',
    color: '#3b82f6',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },

  // ── Backend runtime node kind aliases ──────────────────────────────────────
  trigger_start: {
    kind: 'trigger_start',
    label: 'Start',
    description: 'Flow entry point',
    category: 'runtime_alias',
    icon: 'play',
    color: '#22c55e',
    ports: [{ id: 'out', label: 'Next', type: 'source' }],
  },
  llm_generate: {
    kind: 'llm_generate',
    label: 'LLM Generate',
    description: 'Generate AI response',
    category: 'runtime_alias',
    icon: 'sparkles',
    color: '#a855f7',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  end_flow: {
    kind: 'end_flow',
    label: 'End Flow',
    description: 'Mark conversation as resolved',
    category: 'runtime_alias',
    icon: 'check-circle',
    color: '#22c55e',
    ports: [{ id: 'in', type: 'target' }],
  },
  handover: {
    kind: 'handover',
    label: 'Handover to Agent',
    description: 'Escalate to a human agent',
    category: 'runtime_alias',
    icon: 'headphones',
    color: '#ec4899',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  search_knowledge: {
    kind: 'search_knowledge',
    label: 'Search Knowledge',
    description: 'Search knowledge base (RAG)',
    category: 'runtime_alias',
    icon: 'search',
    color: '#06b6d4',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'found', label: 'Found', type: 'source' },
      { id: 'not_found', label: 'Not Found', type: 'source' },
    ],
  },
  classify_intent: {
    kind: 'classify_intent',
    label: 'Classify Intent',
    description: 'Classify user intent via LLM',
    category: 'runtime_alias',
    icon: 'git-branch',
    color: '#f59e0b',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
  route_topic: {
    kind: 'route_topic',
    label: 'Route by topic',
    description: 'Send the visitor to the branch that matches what they said',
    category: 'runtime_alias',
    icon: 'git-branch',
    color: '#f59e0b',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'other', label: 'Other', type: 'source' },
    ],
  },
  lookup_catalog: {
    kind: 'lookup_catalog',
    label: 'Look up a fact',
    description: 'Speak one catalog fact, such as a price or the address',
    category: 'runtime_alias',
    icon: 'search',
    color: '#06b6d4',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'found', label: 'Found', type: 'source' },
      { id: 'other', label: 'Other', type: 'source' },
    ],
  },
  create_ticket: {
    kind: 'create_ticket',
    label: 'Create Ticket',
    description: 'Create a support ticket',
    category: 'runtime_alias',
    icon: 'file-text',
    color: '#3b82f6',
    ports: [
      { id: 'in', type: 'target' },
      { id: 'out', label: 'Next', type: 'source' },
    ],
  },
}
