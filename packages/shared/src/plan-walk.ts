/**
 * Plan walk: which plan, then that plan's price.
 * Sales follow-up: one email question, a beat, then a person from sales.
 */

import { EMAIL_QUESTION } from './contact-speech.js'
import type { StarterFlow } from './flow-templates.js'

export interface PlanChoice {
  title: string
  phrases: string[]
  say: string
}

function handleFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function spokenChoices(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0] ?? ''
  const copy = [...names]
  const last = copy.pop()
  return `${copy.join(', ')}, or ${last}`
}

export function planWalkFlow(input: {
  name: string
  tag: string
  choices: PlanChoice[]
  salesFlow?: string
}): StarterFlow | null {
  if (input.choices.length < 2) return null
  const intro = `Which plan? ${spokenChoices(input.choices.map((choice) => choice.title))}.`
  const y = 80
  const routes = input.choices.map((choice) => ({
    handle: handleFor(choice.title),
    phrases: choice.phrases,
  }))
  const nodes: object[] = [
    { id: 'start', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: input.name, config: {} } },
    { id: 'open', type: 'flow-node', position: { x: 300, y }, data: { kind: 'route_topic', label: 'If they already said', config: { routes } } },
    { id: 'ask', type: 'flow-node', position: { x: 560, y }, data: { kind: 'ask_question', label: 'Which plan', config: { question: intro, variable: 'request' } } },
    { id: 'pick', type: 'flow-node', position: { x: 820, y }, data: { kind: 'route_topic', label: 'Which one', config: { routes } } },
    { id: 'again', type: 'flow-node', position: { x: 1600, y }, data: { kind: 'ask_question', label: 'Continue', config: { question: 'Shall I ask sales to follow up?', variable: 'request' } } },
    { id: 'again-route', type: 'flow-node', position: { x: 1860, y }, data: { kind: 'route_topic', label: 'Sales or another', config: { routes: [...routes, { handle: 'sales', phrases: ['yes', 'please', 'follow up', 'sales', 'demo', 'talk to sales'] }] } } },
  ]
  const edges: object[] = [
    { id: 'e-start', source: 'start', target: 'open' },
    { id: 'e-open-other', source: 'open', target: 'ask', sourceHandle: 'other' },
    { id: 'e-ask', source: 'ask', target: 'pick' },
    { id: 'e-pick-other', source: 'pick', target: 'ask', sourceHandle: 'other' },
    { id: 'e-again', source: 'again', target: 'again-route' },
    { id: 'e-again-other', source: 'again-route', target: 'ask', sourceHandle: 'other' },
  ]
  input.choices.forEach((choice, index) => {
    const handle = handleFor(choice.title)
    const row = y + index * 90
    nodes.push({
      id: `say-${handle}`,
      type: 'flow-node',
      position: { x: 1120, y: row },
      data: { kind: 'send_message', label: choice.title, config: { text: choice.say } },
    })
    edges.push({ id: `e-open-${handle}`, source: 'open', target: `say-${handle}`, sourceHandle: handle })
    edges.push({ id: `e-pick-${handle}`, source: 'pick', target: `say-${handle}`, sourceHandle: handle })
    edges.push({ id: `e-again-${handle}`, source: 'again-route', target: `say-${handle}`, sourceHandle: handle })
    edges.push({ id: `e-say-${handle}`, source: `say-${handle}`, target: 'again' })
  })
  if (input.salesFlow) {
    nodes.push({
      id: 'sales',
      type: 'flow-node',
      position: { x: 2120, y },
      data: { kind: 'execute_flow', label: input.salesFlow, config: { flowName: input.salesFlow } },
    })
    edges.push({ id: 'e-sales', source: 'again-route', target: 'sales', sourceHandle: 'sales' })
  }
  return {
    name: input.name,
    description: 'Asks which plan, says that price, then offers a sales follow-up.',
    tags: [input.tag, 'template', 'pricing'],
    publish: true,
    graph: { nodes, edges },
  }
}

export function emailFollowUpFlow(input: {
  name: string
  tag: string
  companyName: string
  personaName?: string | null
}): StarterFlow {
  const company = input.companyName.trim() || 'the team'
  const voice = input.personaName?.trim() || 'the assistant'
  const y = 120
  return {
    name: input.name,
    description: 'Asks for one email, then a person from sales continues.',
    tags: [input.tag, 'template', 'sales'],
    publish: true,
    graph: {
      nodes: [
        { id: 'start', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: input.name, config: {} } },
        { id: 'ask', type: 'flow-node', position: { x: 320, y }, data: { kind: 'ask_question', label: 'Email', config: { question: EMAIL_QUESTION, variable: 'email', validate: 'email' } } },
        { id: 'wait', type: 'flow-node', position: { x: 560, y }, data: { kind: 'send_message', label: 'One moment', config: { text: 'One moment please.' } } },
        { id: 'ticket', type: 'flow-node', position: { x: 800, y }, data: { kind: 'create_ticket', label: 'Sales inbox', config: { subject: `Sales follow-up for {{email}}`, description: `Follow up with {{email}} about paid plans at ${company}.` } } },
        {
          id: 'sales',
          type: 'flow-node',
          position: { x: 1040, y },
          data: {
            kind: 'ask_question',
            label: 'Sales',
            config: {
              question: `Hi, this is ${voice} from ${company} sales. I am here to help you look at the paid plans. How can I help you today?`,
              variable: 'sales_request',
            },
          },
        },
        { id: 'end', type: 'flow-node', position: { x: 1320, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask' },
        { id: 'e2', source: 'ask', target: 'wait' },
        { id: 'e3', source: 'wait', target: 'ticket' },
        { id: 'e4', source: 'ticket', target: 'sales' },
        { id: 'e5', source: 'sales', target: 'end' },
      ],
    },
  }
}
