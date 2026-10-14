/**
 * The Flows page reads the published welcome and draws one card plus its doors.
 * A graph with no greeting is not a map.
 */

interface MapNode {
  id: string
  position?: { x?: number; y?: number }
  data?: { kind?: string; config?: Record<string, unknown> }
}

interface MapEdge {
  source?: string
  target?: string
  sourceHandle?: string | null
}

function asGraph(graph: unknown): { nodes: MapNode[]; edges: MapEdge[] } | null {
  if (!graph || typeof graph !== 'object') return null
  const record = graph as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(record.nodes)) return null
  const nodes = record.nodes.filter((node): node is MapNode => (
    !!node && typeof node === 'object' && typeof (node as MapNode).id === 'string'
  ))
  const edges = Array.isArray(record.edges)
    ? record.edges.filter((edge): edge is MapEdge => !!edge && typeof edge === 'object')
    : []
  return { nodes, edges }
}

function spoken(node: MapNode | undefined): string {
  const config = node?.data?.config ?? {}
  const text = String(config['text'] ?? config['question'] ?? '').trim()
  return text
}

/** The first line a visitor hears, walking out of Start. */
export function welcomeGreeting(graph: unknown): string {
  const parsed = asGraph(graph)
  if (!parsed) return ''
  const byId = new Map(parsed.nodes.map((node) => [node.id, node]))
  const start = parsed.nodes.find((node) => {
    const kind = node.data?.kind ?? ''
    return kind === 'trigger_start' || kind === 'start' || kind === 'trigger'
  })
  let id = start?.id
  const seen = new Set<string>()
  while (id && !seen.has(id)) {
    seen.add(id)
    const node = byId.get(id)
    if (!node) break
    const kind = node.data?.kind ?? ''
    const line = spoken(node)
    if (line && (kind === 'send_message' || kind === 'ask_question')) return line
    const leaving = parsed.edges.filter((edge) => edge.source === id && typeof edge.target === 'string')
    const onward = leaving.find((edge) => !edge.sourceHandle || edge.sourceHandle === 'out') ?? leaving[0]
    id = onward?.target
  }
  return ''
}

export interface WelcomeDoor {
  flowName: string
}

/** execute_flow doors, top to bottom, each name once. */
export function welcomeDoors(graph: unknown): WelcomeDoor[] {
  const parsed = asGraph(graph)
  if (!parsed) return []
  const doors = parsed.nodes
    .filter((node) => node.data?.kind === 'execute_flow')
    .map((node) => ({
      flowName: String(node.data?.config?.['flowName'] ?? '').trim(),
      y: node.position?.y ?? 0,
      x: node.position?.x ?? 0,
    }))
    .filter((door) => door.flowName.length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const seen = new Set<string>()
  const unique: WelcomeDoor[] = []
  for (const door of doors) {
    if (seen.has(door.flowName)) continue
    seen.add(door.flowName)
    unique.push({ flowName: door.flowName })
  }
  return unique
}

/** Visitor lines on a chart, in the order the steps were drawn, up to five. */
export function spokenLines(graph: unknown, limit = 5): string[] {
  const parsed = asGraph(graph)
  if (!parsed) return []
  const lines: string[] = []
  for (const node of parsed.nodes) {
    const kind = node.data?.kind ?? ''
    if (kind !== 'send_message' && kind !== 'ask_question') continue
    const line = spoken(node).replace(/\{\{[^}]+\}\}/g, '').replace(/\s+/g, ' ').trim()
    if (!line) continue
    lines.push(line)
    if (lines.length >= limit) break
  }
  return lines
}
