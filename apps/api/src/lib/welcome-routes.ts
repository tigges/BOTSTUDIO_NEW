import { prisma } from '@botstudio/db'
import { DRAFT_RECIPES } from './draft-flows.js'

interface RouteConfig {
  handle: string
  phrases: string[]
  flowName?: string
}

interface GraphNode {
  id: string
  type?: string
  position?: { x: number; y: number }
  data: { kind: string; label: string; config: Record<string, unknown> }
}

interface GraphEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function handleFor(flowName: string): string {
  return flowName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function destinationPhrases(flowName: string): string[] | undefined {
  return DRAFT_RECIPES.find((recipe) => recipe.name === flowName)?.phrases
}

/** Add a handoff to a published flow. Returns false when the welcome graph has no router yet. */
export function withDestination(graph: Graph, flowName: string, phrases: string[]): Graph | null {
  if (!graph.nodes.some((node) => node.data.kind === 'route_topic')) return null
  const handle = handleFor(flowName)
  const nodes = graph.nodes.map((node) => {
    if (node.data.kind !== 'route_topic') return node
    const routes = [...((node.data.config['routes'] as RouteConfig[] | undefined) ?? [])]
    if (routes.some((route) => route.flowName === flowName || route.handle === handle)) return node
    return {
      ...node,
      data: {
        ...node.data,
        config: { ...node.data.config, routes: [...routes, { handle, phrases, flowName }] },
      },
    }
  })
  const execId = `go-${handle}`
  if (!nodes.some((node) => node.id === execId)) {
    nodes.push({
      id: execId,
      type: 'flow-node',
      position: { x: 1100, y: 40 },
      data: { kind: 'execute_flow', label: flowName, config: { flowName } },
    })
  }
  const edges = [...graph.edges]
  for (const node of nodes) {
    if (node.data.kind !== 'route_topic') continue
    if (edges.some((edge) => edge.source === node.id && edge.sourceHandle === handle)) continue
    edges.push({ id: `${node.id}-${handle}`, source: node.id, target: execId, sourceHandle: handle })
  }
  return { nodes, edges }
}

export interface WelcomeDestination {
  flowName: string
  phrases: string[]
  choice: string
}

/** Add handoffs and menu choices. A second call with the same destinations leaves the graph as it is. */
export function extendWelcomeGraph(graph: Graph, destinations: WelcomeDestination[]): Graph | null {
  let current: Graph = graph
  for (const destination of destinations) {
    const next = withDestination(current, destination.flowName, destination.phrases)
    if (!next) return null
    current = next
  }
  const choices = destinations.map((destination) => destination.choice)
  const nodes = current.nodes.map((node) => {
    if (node.data.kind === 'ask_question') {
      const existing = [...((node.data.config['choices'] as string[] | undefined) ?? [])]
      const missing = choices.filter((choice) => !existing.includes(choice))
      if (missing.length === 0) return node
      return {
        ...node,
        data: { ...node.data, config: { ...node.data.config, choices: [...existing, ...missing] } },
      }
    }
    if (node.data.kind === 'send_message') {
      const text = node.data.config['text']
      if (typeof text === 'string' && text.includes('orders, returns, and billing') && !text.includes('cancellation')) {
        return {
          ...node,
          data: {
            ...node.data,
            config: {
              ...node.data.config,
              text: 'I can help with orders, returns, billing, a cancellation, a delivery address, or a person on the team. Tell me which one you need.',
            },
          },
        }
      }
    }
    return node
  })
  const handoffs = nodes.filter((node) => node.id.startsWith('go-'))
  handoffs.forEach((node, index) => {
    node.position = { x: 1100, y: 40 + index * 90 }
  })
  return { nodes, edges: current.edges }
}

/**
 * After a person publishes a suggested flow, the welcome flow in that
 * environment learns the handoff. A second call changes nothing.
 */
export async function attachDestination(botId: string, environmentId: string, flowName: string): Promise<boolean> {
  const phrases = destinationPhrases(flowName)
  if (!phrases) return false
  const welcome = await prisma.flowVersion.findFirst({
    where: {
      status: 'published',
      environmentId,
      flow: { botId, OR: [{ tags: { has: 'welcome' } }, { name: 'Welcome & Routing' }, { name: 'Product welcome' }] },
    },
    include: { flow: true },
    orderBy: { publishedAt: 'desc' },
  })
  if (!welcome) return false
  const current = welcome.graph as unknown as Graph
  const handle = handleFor(flowName)
  const present = current.nodes.some((node) => node.data.kind === 'route_topic' && ((node.data.config['routes'] as RouteConfig[] | undefined) ?? []).some((route) => route.flowName === flowName || route.handle === handle))
  if (present) return false
  const next = withDestination(current, flowName, phrases)
  if (!next) return false
  const latest = await prisma.flowVersion.findFirst({
    where: { flowId: welcome.flowId },
    orderBy: { version: 'desc' },
  })
  const version = (latest?.version ?? welcome.version) + 1
  await prisma.flowVersion.create({
    data: {
      tenantId: welcome.tenantId,
      flowId: welcome.flowId,
      version,
      status: 'published',
      environmentId,
      graph: next as object,
      publishedAt: new Date(),
    },
  })
  return true
}
