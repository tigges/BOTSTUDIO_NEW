/**
 * Opening shape shared by the welcomes.
 * The first line is a greeting and it waits. A later "hi" asks the pack's next question.
 * No name question: nothing after the welcome uses the name, so asking it only costs a turn.
 * A first message that is already a request is greeted and handed to that flow.
 */

export function assistantGreeting(companyName: string): string {
  const company = companyName.trim() || 'the team'
  return `Hi, I'm the assistant at ${company}.`
}

export interface GreetingRoute {
  handle: string
  phrases: string[]
  flowName?: string
  answer?: string
}

export function greetingWelcomeGraph(input: {
  greeting: string
  followUp: string
  routes: GreetingRoute[]
  menu: string
  choices?: string[]
}): { nodes: object[]; edges: object[] } {
  const y = 80
  const low = y + Math.max(input.routes.length, 1) * 72 + 120
  const followConfig: Record<string, unknown> = { question: input.followUp, variable: 'request' }
  if (input.choices && input.choices.length > 0) followConfig['choices'] = input.choices
  const nodes: object[] = [
    { id: 'start', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Start', config: {} } },
    { id: 'save', type: 'flow-node', position: { x: 300, y }, data: { kind: 'set_variable', label: 'Keep the request', config: { variable: 'topic', value: '{{_last_user_message}}' } } },
    { id: 'route', type: 'flow-node', position: { x: 540, y }, data: { kind: 'route_topic', label: 'Route the opening', config: { routes: input.routes.map(routeConfig) } } },
    ask('greet', 820, low, 'Hello', input.greeting, 'greeting_reply'),
    { id: 'route2', type: 'flow-node', position: { x: 1080, y: low }, data: { kind: 'route_topic', label: 'Route the reply', config: { routes: input.routes.map(routeConfig) } } },
    { id: 'follow', type: 'flow-node', position: { x: 1340, y: low }, data: { kind: 'ask_question', label: 'Ask', config: followConfig } },
    { id: 'route3', type: 'flow-node', position: { x: 1600, y: low }, data: { kind: 'route_topic', label: 'Route what they want', config: { routes: input.routes.map(routeConfig) } } },
    { id: 'menu', type: 'flow-node', position: { x: 1860, y: low + 160 }, data: { kind: 'send_message', label: 'Offer a next step', config: { text: input.menu } } },
    { id: 'end', type: 'flow-node', position: { x: 2120, y: low + 160 }, data: { kind: 'end_flow', label: 'End', config: {} } },
  ]
  const edges: object[] = [
    { id: 'e-start', source: 'start', target: 'save' },
    { id: 'e-save', source: 'save', target: 'route' },
    { id: 'e-other', source: 'route', target: 'greet', sourceHandle: 'other' },
    { id: 'e-greet', source: 'greet', target: 'route2' },
    { id: 'e-other-2', source: 'route2', target: 'follow', sourceHandle: 'other' },
    { id: 'e-follow', source: 'follow', target: 'route3' },
    { id: 'e-other-3', source: 'route3', target: 'menu', sourceHandle: 'other' },
    { id: 'e-end', source: 'menu', target: 'end' },
  ]
  input.routes.forEach((route, index) => {
    const row = y + index * 72
    const greetId = `hi-${route.handle}`
    const targetId = route.flowName ? `go-${route.handle}` : `say-${route.handle}`
    nodes.push(say(greetId, 820, row, 'Greet', input.greeting))
    if (route.flowName) {
      nodes.push({
        id: targetId,
        type: 'flow-node',
        position: { x: 1100, y: row },
        data: { kind: 'execute_flow', label: route.flowName, config: { flowName: route.flowName } },
      })
    } else {
      nodes.push(say(targetId, 1100, row, route.handle, route.answer ?? input.menu))
      edges.push({ id: `e-end-${route.handle}`, source: targetId, target: 'end' })
    }
    edges.push({ id: `e-${route.handle}`, source: 'route', target: greetId, sourceHandle: route.handle })
    edges.push({ id: `e-hi-${route.handle}`, source: greetId, target: targetId })
    edges.push({ id: `e2-${route.handle}`, source: 'route2', target: targetId, sourceHandle: route.handle })
    edges.push({ id: `e3-${route.handle}`, source: 'route3', target: targetId, sourceHandle: route.handle })
  })
  return { nodes, edges }
}

function routeConfig(route: GreetingRoute) {
  return { handle: route.handle, phrases: route.phrases, ...(route.flowName ? { flowName: route.flowName } : {}) }
}

function ask(id: string, x: number, y: number, label: string, question: string, variable: string) {
  return { id, type: 'flow-node', position: { x, y }, data: { kind: 'ask_question', label, config: { question, variable } } }
}

function say(id: string, x: number, y: number, label: string, text: string) {
  return { id, type: 'flow-node', position: { x, y }, data: { kind: 'send_message', label, config: { text } } }
}
