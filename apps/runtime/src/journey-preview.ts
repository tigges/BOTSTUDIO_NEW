import type { StudioCatalog } from '@ybot/shared'
import { usableContactName } from './contact-speech.js'
import { SessionMachine, type FlowGraph } from './engine.js'
import { copyJumpVariables, missingChapterLine } from './handoff.js'
import type { ExecutionServices, Session, SessionVariables } from './types.js'

export interface JourneyPreviewSnapshot {
  chapter: string
  currentNodeId: string
  status: Session['status']
  waitingFor?: Session['waitingFor']
  variables: SessionVariables
}

export interface JourneyTurn {
  handled: boolean
  text: string
  chapter: string
  session?: JourneyPreviewSnapshot
}

function previewServices(catalog?: StudioCatalog): ExecutionServices {
  return {
    llm: {
      classify: async () => ({ category: 'other', confidence: 0 }),
      embed: async () => ({ embeddings: [[]] }),
      complete: async () => ({ content: '' }),
      stream: async () => {},
    },
    db: {},
    httpFetch: fetch,
    catalog,
  } as unknown as ExecutionServices
}

const START_KINDS = new Set(['trigger_start', 'start', 'trigger'])
const MAX_HOPS = 6

function spokenFirstName(raw: string | null | undefined): string | undefined {
  const name = usableContactName(raw)
  return name ? name.split(' ')[0] : undefined
}

/** A reply may explain and then ask once. A second question is the next turn. */
function keepFirstQuestion(text: string): string {
  const trimmed = text.trim()
  const first = trimmed.indexOf('?')
  if (first < 0) return trimmed
  const later = trimmed.indexOf('?', first + 1)
  if (later < 0) return trimmed
  return trimmed.slice(0, first + 1).trim()
}

function startNodeId(graph: FlowGraph): string | undefined {
  return graph.nodes.find((node) => START_KINDS.has(node.data.kind))?.id
}

function snapshot(session: Session, chapter: string): JourneyPreviewSnapshot {
  return {
    chapter,
    currentNodeId: session.currentNodeId,
    status: session.status,
    waitingFor: session.waitingFor,
    variables: session.variables,
  }
}

function sessionFrom(graph: FlowGraph, message: string, chapter: string, saved?: JourneyPreviewSnapshot): Session | null {
  const start = startNodeId(graph)
  if (!start) return null
  const restart = !saved || saved.status === 'completed' || saved.status === 'handed_over' || saved.status === 'failed'
  const variables: SessionVariables = restart
    ? { flow: {}, global: {}, contact: { name: 'there' } }
    : {
        flow: { ...saved.variables.flow },
        global: { ...saved.variables.global },
        contact: { ...saved.variables.contact },
      }
  variables.flow['_last_user_message'] = message
  if (typeof variables.contact['name'] !== 'string' || !variables.contact['name']) {
    variables.contact['name'] = 'there'
  }
  return {
    id: 'preview',
    conversationId: 'preview',
    botId: 'preview',
    tenantId: 'preview',
    flowId: chapter,
    flowVersionId: 'preview',
    currentNodeId: restart ? start : saved.currentNodeId,
    variables,
    status: restart ? 'running' : saved.status,
    waitingFor: restart ? undefined : saved.waitingFor,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

/**
 * Walk the welcome and every chapter it hands off to.
 * A handoff is followed only when that chapter was passed in.
 */
export async function runJourneyPreview(input: {
  chapters: Array<{ name: string; graph: FlowGraph }>
  startChapter: string
  message: string
  environmentLabel: string
  session?: JourneyPreviewSnapshot
  catalog?: StudioCatalog
}): Promise<JourneyTurn> {
  const byName = new Map<string, FlowGraph>()
  for (const chapter of input.chapters) {
    if (!byName.has(chapter.name)) byName.set(chapter.name, chapter.graph)
  }
  const savedSession = input.session
  const restart = !savedSession || savedSession.status === 'completed' || savedSession.status === 'handed_over' || savedSession.status === 'failed'
  let chapterName = restart || !savedSession ? input.startChapter : savedSession.chapter
  let graph = byName.get(chapterName)
  if (!graph) {
    const missing = chapterName || 'The welcome'
    return {
      handled: true,
      text: missingChapterLine(missing, input.environmentLabel),
      chapter: chapterName,
    }
  }

  const machine = new SessionMachine(previewServices(input.catalog))
  const lines: string[] = []
  let saved: JourneyPreviewSnapshot | undefined = restart ? undefined : input.session
  let stopped = false
  const seen = new Set<string>()

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (seen.has(chapterName)) break
    seen.add(chapterName)
    const session = sessionFrom(graph, input.message, chapterName, saved)
    if (!session) return { handled: false, text: '', chapter: chapterName, session: saved }
    const result = await machine.run(session, graph, input.message)
    const given = spokenFirstName(String(result.session.variables.flow['guest_name'] ?? ''))
    if (given) result.session.variables.contact['name'] = given
    for (const message of result.newMessages) {
      const line = message.content.text.trim()
      if (line) lines.push(line)
    }
    saved = snapshot(result.session, chapterName)
    if (result.jumpToFlow) {
      const nextName = result.jumpToFlow
      const next = byName.get(nextName)
      if (!next) {
        lines.push(missingChapterLine(nextName, input.environmentLabel))
        saved = { ...saved, status: 'completed' }
        stopped = true
        break
      }
      const start = startNodeId(next)
      if (!start) {
        lines.push(missingChapterLine(nextName, input.environmentLabel))
        saved = { ...saved, status: 'completed' }
        stopped = true
        break
      }
      chapterName = nextName
      graph = next
      saved = {
        chapter: chapterName,
        currentNodeId: start,
        status: 'running',
        variables: copyJumpVariables(result.session.variables, input.message, String(result.session.variables.contact['name'] ?? '')),
      }
      continue
    }
    if (result.handover && lines.length === 0) {
      lines.push('A person on the team will follow up.')
    }
    break
  }

  const spoken = lines.slice()
  let text: string
  if (stopped) {
    const stop = spoken.pop() ?? ''
    const body = keepFirstQuestion(spoken.join('\n\n'))
    text = [body, stop].filter((line) => line.length > 0).join('\n\n')
  } else {
    text = keepFirstQuestion(spoken.join('\n\n'))
  }
  if (!text) return { handled: false, text: '', chapter: chapterName, session: saved }
  return { handled: true, text, chapter: chapterName, session: saved }
}
