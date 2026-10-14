/**
 * Starter flowcharts copied into each company.
 * The shape matches the Acme walkthrough. Company-specific words are filled in
 * at copy time. Each company keeps its own copy.
 */

import { assistantGreeting, greetingWelcomeGraph } from './greeting-welcome.js'
import { SAMPLE_ORDER_QUESTION, SAMPLE_ORDER_REPLY, SAMPLE_ORDER_NUMBER } from './sample-order.js'

export interface StarterFlow {
  name: string
  description: string
  tags: string[]
  /** Only the welcome flow is published, so the widget starts with a greeting. */
  publish: boolean
  graph: { nodes: object[]; edges: object[] }
}

export const SUPPORT_USE_CASES: Array<{ name: string; choice: string; phrases: string[] }> = [
  {
    name: 'Cancel order',
    choice: 'Cancel an order',
    phrases: ['cancel my order', 'cancel order', 'cancellation'],
  },
  {
    name: 'Change address',
    choice: 'Change address',
    phrases: ['delivery address', 'change address', 'new address', 'wrong address'],
  },
  {
    name: 'Talk to a person',
    choice: 'Talk to a person',
    phrases: ['speak to a person', 'talk to someone', 'talk to a person', 'real person', 'human agent'],
  },
]

/** Extra Acme support flows. Drafts for a new company. Sandbox publishes them. */
export function supportUseCaseFlows(): StarterFlow[] {
  const y = 120
  return [
    {
      name: 'Cancel order',
      description: 'Takes an order number and a reason, then asks the team to confirm if it already shipped',
      tags: ['orders', 'template'],
      publish: false,
      graph: {
        nodes: [
          { id: 'c1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Cancel order', config: {} } },
          { id: 'c2', type: 'flow-node', position: { x: 280, y }, data: { kind: 'send_message', label: 'Intro', config: { text: 'I can cancel an order that has not shipped yet.' } } },
          { id: 'c3', type: 'flow-node', position: { x: 480, y }, data: { kind: 'ask_question', label: 'Order number', config: { question: 'What is the order number?', variable: 'order_number' } } },
          { id: 'c4', type: 'flow-node', position: { x: 700, y }, data: { kind: 'ask_question', label: 'Reason', config: { question: 'Why do you want to cancel?', variable: 'cancel_reason', choices: ['Changed my mind', 'Ordered by mistake', 'Taking too long'] } } },
          { id: 'c5', type: 'flow-node', position: { x: 940, y }, data: { kind: 'send_message', label: 'Confirm', config: { text: 'I have noted order {{order_number}} ({{cancel_reason}}). If it has already shipped, a teammate will confirm the cancellation in this chat.' } } },
          { id: 'c6', type: 'flow-node', position: { x: 1180, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
        ],
        edges: [
          { id: 'e1', source: 'c1', target: 'c2' },
          { id: 'e2', source: 'c2', target: 'c3' },
          { id: 'e3', source: 'c3', target: 'c4' },
          { id: 'e4', source: 'c4', target: 'c5' },
          { id: 'e5', source: 'c5', target: 'c6' },
        ],
      },
    },
    {
      name: 'Change address',
      description: 'Collects a new delivery address and asks the team to confirm if the parcel has left',
      tags: ['orders', 'template'],
      publish: false,
      graph: {
        nodes: [
          { id: 'a1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Change address', config: {} } },
          { id: 'a2', type: 'flow-node', position: { x: 280, y }, data: { kind: 'send_message', label: 'Intro', config: { text: 'I can update the delivery address before the order ships.' } } },
          { id: 'a3', type: 'flow-node', position: { x: 500, y }, data: { kind: 'ask_question', label: 'Order number', config: { question: 'What is the order number?', variable: 'order_number' } } },
          { id: 'a4', type: 'flow-node', position: { x: 720, y }, data: { kind: 'ask_question', label: 'New address', config: { question: 'What is the new delivery address?', variable: 'new_address' } } },
          { id: 'a5', type: 'flow-node', position: { x: 960, y }, data: { kind: 'send_message', label: 'Confirm', config: { text: 'I have noted {{new_address}} for order {{order_number}}. A teammate will confirm the change if the parcel has already left.' } } },
          { id: 'a6', type: 'flow-node', position: { x: 1200, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
        ],
        edges: [
          { id: 'e1', source: 'a1', target: 'a2' },
          { id: 'e2', source: 'a2', target: 'a3' },
          { id: 'e3', source: 'a3', target: 'a4' },
          { id: 'e4', source: 'a4', target: 'a5' },
          { id: 'e5', source: 'a5', target: 'a6' },
        ],
      },
    },
    {
      name: 'Talk to a person',
      description: 'Tells the visitor a person is taking over, then hands the chat to the team',
      tags: ['handover', 'template'],
      publish: false,
      graph: {
        nodes: [
          { id: 't1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Talk to a person', config: {} } },
          { id: 't2', type: 'flow-node', position: { x: 300, y }, data: { kind: 'send_message', label: 'Tell them', config: { text: 'I am passing this chat to the team. Someone will continue here.' } } },
          { id: 't3', type: 'flow-node', position: { x: 540, y }, data: { kind: 'handover', label: 'Hand to the team', config: { team: 'support', priority: 'medium' } } },
          { id: 't4', type: 'flow-node', position: { x: 760, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
        ],
        edges: [
          { id: 'e1', source: 't1', target: 't2' },
          { id: 'e2', source: 't2', target: 't3' },
          { id: 'e3', source: 't3', target: 't4' },
        ],
      },
    },
  ]
}

function welcomeGraph(companyName: string): { nodes: object[]; edges: object[] } {
  const routes = [
    { handle: 'orders', phrases: ['order', 'tracking', 'where is my order'], flowName: 'Order Status' },
    { handle: 'returns', phrases: ['return', 'refund'], flowName: 'Return Request' },
    { handle: 'billing', phrases: ['invoice', 'billing', 'payment'], flowName: 'Billing' },
    ...SUPPORT_USE_CASES.map((item) => ({
      handle: item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      phrases: item.phrases,
      flowName: item.name,
    })),
  ]
  return greetingWelcomeGraph({
    greeting: assistantGreeting(companyName),
    followUp: 'Hi {{contact.name}}. What do you need help with?',
    routes,
    menu: 'I can help with an order, a return, billing, a cancellation, a delivery address, or a person on the team.',
    choices: routes.map((route) => route.flowName),
  })
}

/** Collects a return reason and opens a ticket. Draft until a pack publishes it. */
export function returnRequestFlow(): StarterFlow {
  const y = 120
  return {
    name: 'Return Request',
    description: 'Handles a return and opens a ticket',
    tags: ['returns'],
    publish: false,
    graph: {
      nodes: [
        { id: 'r1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Return Request', config: {} } },
        { id: 'r2', type: 'flow-node', position: { x: 280, y }, data: { kind: 'send_message', label: 'Policy intro', config: { text: 'I can help with returns. Our return window is 30 days from purchase.' } } },
        { id: 'r3', type: 'flow-node', position: { x: 480, y }, data: { kind: 'ask_question', label: 'Reason for return', config: { question: 'What is the reason for your return?', variable: 'return_reason', choices: ['Defective product', 'Wrong item', 'Changed mind', 'Not as described'] } } },
        { id: 'r4', type: 'flow-node', position: { x: 680, y }, data: { kind: 'set_variable', label: 'Set return type', config: { variable: 'return_type', value: '{{return_reason}}' } } },
        { id: 'r5', type: 'flow-node', position: { x: 880, y }, data: { kind: 'send_message', label: 'Return label', config: { text: 'I will send a return label to your email within 5 minutes.' } } },
        { id: 'r6', type: 'flow-node', position: { x: 1080, y }, data: { kind: 'create_ticket', label: 'Create return ticket', config: { subject: 'Return request: {{return_reason}}', priority: 'normal', team: 'returns' } } },
        { id: 'r7', type: 'flow-node', position: { x: 1280, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
      ],
      edges: [
        { id: 'e1', source: 'r1', target: 'r2' },
        { id: 'e2', source: 'r2', target: 'r3' },
        { id: 'e3', source: 'r3', target: 'r4' },
        { id: 'e4', source: 'r4', target: 'r5' },
        { id: 'e5', source: 'r5', target: 'r6' },
        { id: 'e6', source: 'r6', target: 'r7' },
      ],
    },
  }
}

export function starterFlows(companyName: string): StarterFlow[] {
  const y = 120
  return [
    {
      name: 'Welcome & Routing',
      description: 'Greets visitors and routes them to the right flow',
      tags: ['welcome', 'routing'],
      publish: true,
      graph: welcomeGraph(companyName),
    },
    {
      name: 'Order Status',
      description: 'Looks up an order and tells the customer where it is',
      tags: ['orders'],
      publish: false,
      graph: {
        nodes: [
          { id: 's1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Order Status Trigger', config: {} } },
          { id: 's2', type: 'flow-node', position: { x: 300, y }, data: { kind: 'ask_question', label: 'Ask order number', config: { question: SAMPLE_ORDER_QUESTION, variable: 'order_number' } } },
          { id: 'sample-order', type: 'flow-node', position: { x: 540, y }, data: { kind: 'condition', label: 'Sample order?', config: { conditions: [{ field: 'order_number', operator: 'equals', value: SAMPLE_ORDER_NUMBER }] } } },
          { id: 'sample-reply', type: 'flow-node', position: { x: 780, y: y - 140 }, data: { kind: 'send_message', label: 'Sample order', config: { text: SAMPLE_ORDER_REPLY } } },
          { id: 's3', type: 'flow-node', position: { x: 780, y: y + 140 }, data: { kind: 'http_request', label: 'Fetch order', config: { method: 'GET', url: 'https://api.acme.com/orders/{{order_number}}', headers: {} } } },
          { id: 's4', type: 'flow-node', position: { x: 1020, y: y + 140 }, data: { kind: 'condition', label: 'Order found?', config: { conditions: [{ field: 'ok', operator: 'equals', value: 'true' }] } } },
          { id: 's5', type: 'flow-node', position: { x: 1260, y }, data: { kind: 'send_message', label: 'Order details', config: { text: 'Order {{order_number}} came back with status {{status}}.' } } },
          { id: 's6', type: 'flow-node', position: { x: 1260, y: y + 220 }, data: { kind: 'handover', label: 'Escalate to agent', config: { team: 'support', priority: 'medium' } } },
          { id: 's7', type: 'flow-node', position: { x: 1500, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
        ],
        edges: [
          { id: 'e1', source: 's1', target: 's2' },
          { id: 'e2', source: 's2', target: 'sample-order' },
          { id: 'e-sample-yes', source: 'sample-order', target: 'sample-reply', sourceHandle: 'yes' },
          { id: 'e-sample-no', source: 'sample-order', target: 's3', sourceHandle: 'no' },
          { id: 'e-sample-end', source: 'sample-reply', target: 's7' },
          { id: 'e3', source: 's3', target: 's4' },
          { id: 'e4', source: 's4', sourceHandle: 'yes', target: 's5' },
          { id: 'e5', source: 's4', sourceHandle: 'no', target: 's6' },
          { id: 'e6', source: 's5', target: 's7' },
          { id: 'e7', source: 's6', target: 's7' },
        ],
      },
    },
    returnRequestFlow(),
    ...supportUseCaseFlows(),
    {
      name: 'Billing',
      description: 'Answers a billing question and records the account',
      tags: ['billing', 'template'],
      publish: false,
      graph: {
        nodes: [
          { id: 'b1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Billing', config: {} } },
          { id: 'b2', type: 'flow-node', position: { x: 280, y }, data: { kind: 'send_message', label: 'Intro', config: { text: 'I can help with a bill, an invoice, or a payment.' } } },
          { id: 'b3', type: 'flow-node', position: { x: 500, y }, data: { kind: 'ask_question', label: 'Ask account', config: { question: 'Which account or invoice should I look at?', variable: 'account' } } },
          { id: 'b4', type: 'flow-node', position: { x: 740, y }, data: { kind: 'send_message', label: 'Answer', config: { text: 'I have noted {{account}}. A teammate will confirm the balance in this chat if it needs a change.' } } },
          { id: 'b5', type: 'flow-node', position: { x: 980, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
        ],
        edges: [
          { id: 'e1', source: 'b1', target: 'b2' },
          { id: 'e2', source: 'b2', target: 'b3' },
          { id: 'e3', source: 'b3', target: 'b4' },
          { id: 'e4', source: 'b4', target: 'b5' },
        ],
      },
    },
    {
      name: 'Lead Capture',
      description: 'Collects contact details and sends them to the CRM',
      tags: ['sales'],
      publish: false,
      graph: {
        nodes: [
          { id: 'l1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Lead Capture Start', config: {} } },
          { id: 'l2', type: 'flow-node', position: { x: 280, y }, data: { kind: 'send_message', label: 'Intro', config: { text: 'I can take a few details and ask the team to follow up.' } } },
          { id: 'l3', type: 'flow-node', position: { x: 480, y }, data: { kind: 'ask_question', label: 'Company name', config: { question: 'What company are you from?', variable: 'company' } } },
          { id: 'l4', type: 'flow-node', position: { x: 680, y }, data: { kind: 'ask_question', label: 'Email', config: { question: 'What is your work email?', variable: 'email', validate: 'email' } } },
          { id: 'l5', type: 'flow-node', position: { x: 880, y }, data: { kind: 'ask_question', label: 'Team size', config: { question: 'How large is your team?', variable: 'team_size', choices: ['1-10', '11-50', '51-200', '200+'] } } },
          { id: 'l6', type: 'flow-node', position: { x: 1080, y }, data: { kind: 'http_request', label: 'Push to CRM', config: { method: 'POST', url: '', body: { email: '{{email}}', company: '{{company}}', team_size: '{{team_size}}' } } } },
          { id: 'l7', type: 'flow-node', position: { x: 1280, y }, data: { kind: 'send_message', label: 'Confirm', config: { text: 'Thanks {{contact.name}}. Someone from the team will be in touch within 24 hours.' } } },
          { id: 'l8', type: 'flow-node', position: { x: 1480, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
        ],
        edges: [
          { id: 'e1', source: 'l1', target: 'l2' },
          { id: 'e2', source: 'l2', target: 'l3' },
          { id: 'e3', source: 'l3', target: 'l4' },
          { id: 'e4', source: 'l4', target: 'l5' },
          { id: 'e5', source: 'l5', target: 'l6' },
          { id: 'e6', source: 'l6', target: 'l7' },
          { id: 'e7', source: 'l7', target: 'l8' },
        ],
      },
    },
    {
      name: 'CSAT Survey',
      description: 'Asks for a rating after a conversation is resolved',
      tags: ['csat'],
      publish: false,
      graph: {
        nodes: [
          { id: 'sv1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'CSAT Trigger', config: { event: 'conversation.resolved' } } },
          { id: 'sv2', type: 'flow-node', position: { x: 280, y }, data: { kind: 'send_message', label: 'Thank you', config: { text: 'Thanks for reaching out. We would like your feedback on this conversation.' } } },
          { id: 'sv3', type: 'flow-node', position: { x: 480, y }, data: { kind: 'ask_question', label: 'CSAT score', config: { question: 'How would you rate your experience? (1-5)', variable: 'csat_score', choices: ['1', '2', '3', '4', '5'] } } },
          { id: 'sv4', type: 'flow-node', position: { x: 680, y }, data: { kind: 'condition', label: 'Score < 3?', config: { conditions: [{ field: 'csat_score', operator: 'less_than', value: '3' }] } } },
          { id: 'sv5', type: 'flow-node', position: { x: 880, y: 60 }, data: { kind: 'ask_question', label: 'Ask for feedback', config: { question: 'Sorry to hear that. What could we do better?', variable: 'feedback' } } },
          { id: 'sv6', type: 'flow-node', position: { x: 880, y: 200 }, data: { kind: 'send_message', label: 'Positive response', config: { text: 'Thank you for the kind rating.' } } },
          { id: 'sv7', type: 'flow-node', position: { x: 1080, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
        ],
        edges: [
          { id: 'e1', source: 'sv1', target: 'sv2' },
          { id: 'e2', source: 'sv2', target: 'sv3' },
          { id: 'e3', source: 'sv3', target: 'sv4' },
          { id: 'e4', source: 'sv4', sourceHandle: 'yes', target: 'sv5' },
          { id: 'e5', source: 'sv4', sourceHandle: 'no', target: 'sv6' },
          { id: 'e6', source: 'sv5', target: 'sv7' },
          { id: 'e7', source: 'sv6', target: 'sv7' },
        ],
      },
    },
  ]
}

export interface GuidedFlowInput {
  greeting: string
  question: string
  handoff: boolean
}

/** A straight line of steps from a few answers: greeting, optional question, then end or handoff. */
export function guidedFlowGraph(input: GuidedFlowInput): { nodes: object[]; edges: object[] } {
  const y = 120
  const greeting = input.greeting.trim() || "Hi, I'm the assistant."
  const question = input.question.trim()
  const nodes: object[] = [
    { id: 'g1', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Start', config: {} } },
    { id: 'g2', type: 'flow-node', position: { x: 300, y }, data: { kind: 'ask_question', label: 'Opening', config: { question: greeting, variable: 'greeting_reply' } } },
  ]
  const edges: Array<{ id: string; source: string; target: string }> = [
    { id: 'e1', source: 'g1', target: 'g2' },
  ]
  let previous = 'g2'
  let x = 520
  if (question) {
    nodes.push({ id: 'g3', type: 'flow-node', position: { x, y }, data: { kind: 'ask_question', label: 'Question', config: { question, variable: 'answer' } } })
    edges.push({ id: 'e-ask', source: previous, target: 'g3' })
    previous = 'g3'
    x += 240
  }
  if (input.handoff) {
    nodes.push({ id: 'g4', type: 'flow-node', position: { x, y }, data: { kind: 'send_message', label: 'Hand off', config: { text: 'I am passing this chat to the team. Someone will continue here.' } } })
    edges.push({ id: 'e-hand-msg', source: previous, target: 'g4' })
    previous = 'g4'
    x += 240
    nodes.push({ id: 'g5', type: 'flow-node', position: { x, y }, data: { kind: 'handover', label: 'Hand to the team', config: { team: 'support', priority: 'medium' } } })
    edges.push({ id: 'e-hand', source: previous, target: 'g5' })
  } else {
    nodes.push({ id: 'g6', type: 'flow-node', position: { x, y }, data: { kind: 'end_flow', label: 'End', config: {} } })
    edges.push({ id: 'e-end', source: previous, target: 'g6' })
  }
  return { nodes, edges }
}

/** One welcome chart. A pasted line is the greeting. An empty start is a line to replace. */
export function draftWelcome(sample: string): StarterFlow {
  const line = sample.trim().slice(0, 2000) || 'Write the first line.'
  const asks = line.includes('?')
  return {
    name: 'Welcome',
    description: sample.trim()
      ? 'Draft welcome from an example conversation. Publish it to Sandbox when visitors should hear it.'
      : 'A blank welcome. Write the first line in the editor.',
    tags: ['welcome'],
    publish: false,
    graph: {
      nodes: [
        { id: 'start', type: 'flow-node', position: { x: 80, y: 80 }, data: { kind: 'trigger_start', label: 'Start', config: {} } },
        asks
          ? { id: 'welcome', type: 'flow-node', position: { x: 320, y: 80 }, data: { kind: 'ask_question', label: 'Welcome', config: { question: line, variable: 'greeting_reply' } } }
          : { id: 'welcome', type: 'flow-node', position: { x: 320, y: 80 }, data: { kind: 'send_message', label: 'Welcome', config: { text: line } } },
        { id: 'end', type: 'flow-node', position: { x: 560, y: 80 }, data: { kind: 'end_flow', label: 'End', config: {} } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'welcome' },
        { id: 'e2', source: 'welcome', target: 'end' },
      ],
    },
  }
}
