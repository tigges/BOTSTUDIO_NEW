/**
 * Connection check for a flow graph.
 * Repair covers lines the bot can fix without guessing: a Start with no line,
 * a route line tied to a handle that does not exist, and Yes/No names.
 * A missing branch with no obvious destination stays for a person to decide.
 */

import { handoverContext, handoverPriority } from './handover.js'

export interface CheckNode {
  id: string
  data?: { kind?: string; label?: string; config?: Record<string, unknown> }
}

export interface CheckEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
}

export interface CheckGraph {
  nodes: CheckNode[]
  edges: CheckEdge[]
}

export type IssueLevel = 'repair' | 'block' | 'note'

export interface FlowIssue {
  level: IssueLevel
  code: string
  nodeId?: string
  message: string
}

export interface CheckOptions {
  /** Names of flows on this bot. A jump to an unknown name is a gap. */
  flowNames?: string[]
}

const TERMINALS = new Set(['end_flow', 'resolve', 'handover', 'transfer_agent', 'execute_flow'])
const LINEAR = new Set([
  'start', 'trigger_start', 'send_message', 'ask_question', 'set_variable',
  'classify_intent', 'create_ticket', 'delay', 'llm_generate', 'llm_prompt', 'send_email',
  'buttons', 'carousel', 'quick_replies',
])
const OPERATORS = new Set(['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_set', 'is_empty'])

function kindOf(node: CheckNode): string {
  return node.data?.kind ?? ''
}

function labelOf(node: CheckNode | undefined, fallback = 'This step'): string {
  const label = node?.data?.label?.trim()
  return label || fallback
}

function configOf(node: CheckNode): Record<string, unknown> {
  return node.data?.config ?? {}
}

function isStart(kind: string): boolean {
  return kind === 'trigger_start' || kind === 'start'
}

function outs(edges: CheckEdge[], id: string): CheckEdge[] {
  return edges.filter((edge) => edge.source === id)
}

function routeList(node: CheckNode): Array<{ handle: string; flowName?: string; phrases: string[] }> {
  const raw = configOf(node)['routes']
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const handle = String((item as { handle?: string }).handle ?? '').trim()
    if (!handle) return []
    const flowName = (item as { flowName?: string }).flowName
    const phrases = Array.isArray((item as { phrases?: unknown }).phrases)
      ? (item as { phrases: unknown[] }).phrases.map((phrase) => String(phrase).toLowerCase().trim()).filter(Boolean)
      : []
    return [{ handle, flowName: typeof flowName === 'string' ? flowName : undefined, phrases }]
  })
}

function overlappingPhrases(node: CheckNode): string[] {
  const owner = new Map<string, string>()
  const overlaps: string[] = []
  for (const route of routeList(node)) {
    for (const phrase of route.phrases) {
      const prev = owner.get(phrase)
      if (prev && prev !== route.handle && !overlaps.includes(phrase)) overlaps.push(phrase)
      else if (!prev) owner.set(phrase, route.handle)
    }
  }
  return overlaps
}

function routeHandles(node: CheckNode): string[] {
  const handles = routeList(node).map((route) => route.handle)
  if (!handles.includes('other')) handles.push('other')
  return handles
}

function startTarget(nodes: CheckNode[]): CheckNode | undefined {
  return nodes.find((node) => kindOf(node) === 'route_topic') ?? nodes.find((node) => !isStart(kindOf(node)))
}

function isYes(handle: string | null | undefined): boolean {
  return handle === 'yes' || handle === 'true'
}

function isNo(handle: string | null | undefined): boolean {
  return handle === 'no' || handle === 'false'
}

export function inspectFlowGraph(graph: CheckGraph | null | undefined, options: CheckOptions = {}): FlowIssue[] {
  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []
  const issues: FlowIssue[] = []
  if (nodes.length === 0) {
    return [{ level: 'block', code: 'empty', message: 'This flow has no steps.' }]
  }

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const starts = nodes.filter((node) => isStart(kindOf(node)))
  if (starts.length === 0) {
    issues.push({ level: 'block', code: 'no-start', message: 'Add a Start step. The chat has nowhere to begin.' })
  }
  if (starts.length > 1) {
    issues.push({ level: 'note', code: 'many-starts', message: 'This flow has more than one Start. The bot uses the first one.' })
  }

  const dangling = edges.filter((edge) => !byId.has(edge.source) || !byId.has(edge.target))
  if (dangling.length > 0) {
    issues.push({ level: 'repair', code: 'dangling', message: 'A line points at a step that is not on the canvas. It will be removed.' })
  }

  const start = starts[0]
  const entry = start ? startTarget(nodes) : undefined
  if (start && outs(edges, start.id).length === 0 && entry) {
    issues.push({
      level: 'repair',
      code: 'start-unlinked',
      nodeId: start.id,
      message: `Start has no line, so the chat never begins. Connect it to ${labelOf(entry)}.`,
    })
  }

  for (const node of nodes) {
    const kind = kindOf(node)
    const label = labelOf(node)
    const leaving = outs(edges, node.id)
    const config = configOf(node)

    if (kind === 'lookup_catalog') {
      for (const handle of ['found', 'other']) {
        if (leaving.some((edge) => edge.sourceHandle === handle)) continue
        issues.push({
          level: 'block',
          code: 'missing-route',
          nodeId: node.id,
          message: `${label} has no line for ${handle}. That answer has nowhere to go.`,
        })
      }
    }

    if (kind === 'route_topic') {
      const overlap = overlappingPhrases(node)
      if (overlap.length > 0) {
        issues.push({
          level: 'note',
          code: 'phrase-overlap',
          nodeId: node.id,
          message: `${label} uses the same phrase on two routes (${overlap.slice(0, 3).join(', ')}). The longer match still wins.`,
        })
      }
      const allowed = new Set(routeHandles(node))
      const stray = leaving.filter((edge) => !edge.sourceHandle || !allowed.has(edge.sourceHandle))
      if (stray.length > 0) {
        issues.push({
          level: 'repair',
          code: 'stray-route',
          nodeId: node.id,
          message: `${label} has ${stray.length === 1 ? 'a line' : `${stray.length} lines`} that ${stray.length === 1 ? 'is' : 'are'} not tied to a route. The bot never follows ${stray.length === 1 ? 'it' : 'them'}.`,
        })
      }
      for (const handle of routeHandles(node)) {
        if (leaving.some((edge) => edge.sourceHandle === handle)) continue
        const route = routeList(node).find((item) => item.handle === handle)
        const destination = handle === 'other' ? undefined : destinationFor(nodes, route?.flowName, handle)
        issues.push({
          level: destination ? 'repair' : 'block',
          code: 'missing-route',
          nodeId: node.id,
          message: destination
            ? `${label} has no line for ${handle}. Connect it to ${labelOf(destination)}.`
            : `${label} has no line for ${handle}. That answer has nowhere to go.`,
        })
      }
    }

    if (kind === 'condition') {
      const yes = leaving.some((edge) => isYes(edge.sourceHandle))
      const no = leaving.some((edge) => isNo(edge.sourceHandle))
      if (!yes || !no) {
        issues.push({
          level: 'block',
          code: 'condition-branch',
          nodeId: node.id,
          message: `${label} needs its own Yes line and No line.`,
        })
      } else if (leaving.some((edge) => edge.sourceHandle === 'true' || edge.sourceHandle === 'false')) {
        issues.push({
          level: 'repair',
          code: 'condition-names',
          nodeId: node.id,
          message: `${label} uses True and False. The bot follows Yes and No, so those lines will be renamed.`,
        })
      }
      const conditions = Array.isArray(config['conditions']) ? config['conditions'] as Array<{ field?: string; operator?: string }> : []
      for (const condition of conditions) {
        const operator = condition.operator ?? ''
        if (operator && !OPERATORS.has(operator)) {
          issues.push({
            level: 'block',
            code: 'condition-operator',
            nodeId: node.id,
            message: `${label} uses “${operator}”, which the bot does not understand.`,
          })
        }
        const field = condition.field ?? ''
        if (field.startsWith('response.') && nodes.some((item) => kindOf(item) === 'http_request')) {
          issues.push({
            level: 'note',
            code: 'condition-field',
            nodeId: node.id,
            message: `${label} looks at ${field}. A lookup stores status, data, and ok, so this test does not see a match.`,
          })
        }
      }
    }

    if (kind === 'send_message' && !String(config['text'] ?? '').trim()) {
      issues.push({ level: 'block', code: 'empty-message', nodeId: node.id, message: `${label} has no message for the visitor.` })
    }
    if (kind === 'ask_question' && !String(config['question'] ?? '').trim()) {
      issues.push({ level: 'block', code: 'empty-question', nodeId: node.id, message: `${label} has no question.` })
    }
    if (kind === 'http_request' && !String(config['url'] ?? '').trim()) {
      issues.push({ level: 'note', code: 'empty-url', nodeId: node.id, message: `${label} has no address to call.` })
    }
    if (kind === 'execute_flow') {
      const flowName = String(config['flowName'] ?? '').trim()
      if (!flowName) {
        issues.push({ level: 'block', code: 'empty-jump', nodeId: node.id, message: `${label} does not name the flow to open.` })
      } else if (options.flowNames && !options.flowNames.includes(flowName)) {
        issues.push({ level: 'block', code: 'missing-flow', nodeId: node.id, message: `${label} opens “${flowName}”, and this bot has no flow with that name.` })
      } else if (leaving.length > 0) {
        issues.push({ level: 'note', code: 'jump', nodeId: node.id, message: `${label} opens ${flowName}. The line after this step does not run.` })
      }
    }

    if (kind === 'handover' || kind === 'transfer_agent') {
      if (!handoverPriority(config['priority'])) {
        issues.push({
          level: 'block',
          code: 'handover-priority',
          nodeId: node.id,
          message: `${label} uses priority “${String(config['priority'])}”. Pick low, medium, high or critical.`,
        })
      }
      if (!handoverContext(config['context'])) {
        issues.push({
          level: 'block',
          code: 'handover-context',
          nodeId: node.id,
          message: `${label} sends “${String(config['context'])}” to the team. Pick the full transcript or the summary only.`,
        })
      }
    }

    if (!TERMINALS.has(kind) && leaving.length === 0 && !(isStart(kind) && entry)) {
      issues.push({ level: 'block', code: 'dead-end', nodeId: node.id, message: `${label} has no line onward. The chat stops there.` })
    }
    if (LINEAR.has(kind) && leaving.length > 1) {
      issues.push({ level: 'note', code: 'extra-lines', nodeId: node.id, message: `${label} has several lines. The bot follows only the first.` })
    }
  }

  if (start && outs(edges, start.id).length > 0) {
    const seen = new Set<string>()
    const queue = [start.id]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (seen.has(id)) continue
      seen.add(id)
      for (const edge of outs(edges, id)) queue.push(edge.target)
    }
    for (const node of nodes) {
      if (seen.has(node.id)) continue
      issues.push({ level: 'block', code: 'unreachable', nodeId: node.id, message: `${labelOf(node)} is not connected to Start.` })
    }
  }

  for (const node of nodes) {
    if (kindOf(node) !== 'route_topic') continue
    const other = outs(edges, node.id).find((edge) => edge.sourceHandle === 'other')
    if (!other) continue
    const seen = new Set<string>([node.id])
    let current = other.target
    for (let guard = 0; guard < nodes.length && current; guard += 1) {
      if (seen.has(current)) {
        const revisited = current === node.id ? 'itself' : labelOf(byId.get(current))
        issues.push({
          level: 'note',
          code: 'cycle',
          nodeId: node.id,
          message: `${labelOf(node)} sends an unmatched reply back to ${revisited}, so that path repeats.`,
        })
        break
      }
      seen.add(current)
      const step = byId.get(current)
      if (!step || TERMINALS.has(kindOf(step))) break
      const leaving = outs(edges, current)
      if (leaving.length === 0) break
      const next = kindOf(step) === 'route_topic'
        ? leaving.find((edge) => edge.sourceHandle === 'other') ?? leaving[0]
        : leaving[0]
      current = next?.target ?? ''
    }
  }

  return issues
}

function destinationFor(nodes: CheckNode[], flowName: string | undefined, handle: string): CheckNode | undefined {
  return nodes.find((node) => {
    if (kindOf(node) !== 'execute_flow') return false
    const name = String(configOf(node)['flowName'] ?? '').trim()
    return name === flowName || name === handle || labelOf(node) === flowName || labelOf(node) === handle
  })
}

export function repairFlowGraph<T extends CheckGraph>(graph: T): { graph: T; repairs: FlowIssue[] } {
  const next = JSON.parse(JSON.stringify(graph)) as T
  const repairs: FlowIssue[] = []
  const nodes = next.nodes ?? []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  let edges = (next.edges ?? []).filter((edge) => {
    const keep = byId.has(edge.source) && byId.has(edge.target)
    return keep
  })
  if (edges.length !== (next.edges ?? []).length) {
    repairs.push({ level: 'repair', code: 'dangling', message: 'Removed a line that pointed at a missing step.' })
  }

  const kept: CheckEdge[] = []
  let stray = 0
  let afterJump = 0
  for (const edge of edges) {
    const source = byId.get(edge.source)
    if (source && kindOf(source) === 'execute_flow') {
      afterJump += 1
      continue
    }
    if (source && kindOf(source) === 'route_topic') {
      const allowed = new Set(routeHandles(source))
      if (!edge.sourceHandle || !allowed.has(edge.sourceHandle)) {
        stray += 1
        continue
      }
    }
    if (source && kindOf(source) === 'condition') {
      if (edge.sourceHandle === 'true') edge.sourceHandle = 'yes'
      if (edge.sourceHandle === 'false') edge.sourceHandle = 'no'
    }
    kept.push(edge)
  }
  if (stray > 0) {
    repairs.push({
      level: 'repair',
      code: 'stray-route',
      message: stray === 1
        ? 'Removed a line that was not tied to a route.'
        : `Removed ${stray} lines that were not tied to a route.`,
    })
  }
  if (afterJump > 0) {
    repairs.push({
      level: 'repair',
      code: 'jump',
      message: afterJump === 1
        ? 'Removed the line after a jump. That line never runs.'
        : `Removed ${afterJump} lines after a jump. Those lines never run.`,
    })
  }
  edges = kept

  for (const node of nodes) {
    if (kindOf(node) !== 'route_topic') continue
    for (const route of routeList(node)) {
      if (edges.some((edge) => edge.source === node.id && edge.sourceHandle === route.handle)) continue
      const destination = destinationFor(nodes, route.flowName, route.handle)
      if (!destination) continue
      edges.push({
        id: `repair-${node.id}-${route.handle}`,
        source: node.id,
        target: destination.id,
        sourceHandle: route.handle,
      })
      repairs.push({
        level: 'repair',
        code: 'missing-route',
        nodeId: node.id,
        message: `Connected ${labelOf(node)} “${route.handle}” to ${labelOf(destination)}.`,
      })
    }
  }

  for (const node of nodes) {
    if (kindOf(node) !== 'condition') continue
    if (edges.some((edge) => edge.source === node.id && (edge.sourceHandle === 'yes' || edge.sourceHandle === 'no'))) {
      const renamed = (graph.edges ?? []).some((edge) => edge.source === node.id && (edge.sourceHandle === 'true' || edge.sourceHandle === 'false'))
      if (renamed) {
        repairs.push({ level: 'repair', code: 'condition-names', nodeId: node.id, message: `Renamed the Yes and No lines on ${labelOf(node)}.` })
      }
    }
  }

  for (const node of nodes) {
    if (kindOf(node) !== 'condition') continue
    const config = configOf(node)
    const conditions = Array.isArray(config['conditions']) ? config['conditions'] as Array<{ field?: string; operator?: string; value?: string }> : []
    let changed = false
    for (const condition of conditions) {
      if (!condition.field?.startsWith('response.')) continue
      condition.field = 'ok'
      condition.operator = 'equals'
      condition.value = 'true'
      changed = true
    }
    if (changed) {
      repairs.push({
        level: 'repair',
        code: 'condition-field',
        nodeId: node.id,
        message: `${labelOf(node)} now checks whether the lookup succeeded.`,
      })
    }
  }

  for (const node of nodes) {
    if (kindOf(node) !== 'send_message') continue
    const config = configOf(node)
    const text = String(config['text'] ?? '')
    if (!text.includes('{{response.')) continue
    config['text'] = text
      .replaceAll('{{response.status}}', '{{status}}')
      .replaceAll('{{response.estimated_delivery}}', 'the details in the lookup')
  }

  const routes = nodes.filter((node) => kindOf(node) === 'route_topic')
  const ask = nodes.find((node) => kindOf(node) === 'ask_question')
  const end = nodes.find((node) => kindOf(node) === 'end_flow')
  const menu = nodes.find((node) => kindOf(node) === 'send_message' && /menu/i.test(labelOf(node)))
  if (routes.length > 0 && inspectFlowGraph({ nodes, edges }).some((issue) => issue.code === 'cycle')) {
    const trial = edges.slice()
    if (ask && routes.length > 1) {
      const withoutAsk = trial.filter((edge) => edge.source !== ask.id)
      trial.length = 0
      trial.push(...withoutAsk, { id: `repair-${ask.id}-route`, source: ask.id, target: routes[routes.length - 1]!.id })
    }
    if (menu && end) {
      const withoutMenu = trial.filter((edge) => edge.source !== menu.id)
      trial.length = 0
      trial.push(...withoutMenu, { id: `repair-${menu.id}-end`, source: menu.id, target: end.id })
    }
    const changed = trial.length !== edges.length || trial.some((edge, index) => edge.source !== edges[index]?.source || edge.target !== edges[index]?.target)
    if (changed && !inspectFlowGraph({ nodes, edges: trial }).some((issue) => issue.code === 'cycle')) {
      edges = trial
      repairs.push({ level: 'repair', code: 'cycle', message: 'The unmatched reply now ends, instead of asking again.' })
    }
  }

  const start = nodes.find((node) => isStart(kindOf(node)))
  const target = start ? startTarget(nodes) : undefined
  if (start && target && !edges.some((edge) => edge.source === start.id)) {
    edges.push({ id: `repair-${start.id}-${target.id}`, source: start.id, target: target.id, sourceHandle: 'out' })
    repairs.push({ level: 'repair', code: 'start-unlinked', nodeId: start.id, message: `Connected Start to ${labelOf(target)}.` })
  }

  next.edges = edges as T['edges']
  return { graph: next, repairs }
}
