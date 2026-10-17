import type { StudioCatalog } from '@ybot/shared'
import { usableContactName } from './contact-speech.js'
import { SessionMachine, type FlowGraph } from './engine.js'
import { copyJumpVariables, missingChapterLine } from './handoff.js'
import { acceptedHoursOffer, hoursChapterName, isSmallTalk, isTopicSwitch, listenForChapter, offerOnMap, questionFrom, sameQuestion, shapeTurn } from './map-listen.js'
import type { ExecutionServices, Session, SessionVariables } from './types.js'

export interface JourneyPreviewSnapshot {
  chapter: string
  currentNodeId: string
  status: Session['status']
  waitingFor?: Session['waitingFor']
  variables: SessionVariables
  lastQuestion?: string
}

export interface JourneyTurn {
  handled: boolean
  text: string
  chapter: string
  session?: JourneyPreviewSnapshot
}

function previewServices(catalog?: StudioCatalog, now?: Date): ExecutionServices {
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
    now: now ? () => now : undefined,
  } as unknown as ExecutionServices
}

const START_KINDS = new Set(['trigger_start', 'start', 'trigger'])
const MAX_HOPS = 6

function spokenFirstName(raw: string | null | undefined): string | undefined {
  const name = usableContactName(raw)
  return name ? name.split(' ')[0] : undefined
}

function startNodeId(graph: FlowGraph): string | undefined {
  return graph.nodes.find((node) => START_KINDS.has(node.data.kind))?.id
}

function snapshot(session: Session, chapter: string, lastQuestion?: string): JourneyPreviewSnapshot {
  return {
    chapter,
    currentNodeId: session.currentNodeId,
    status: session.status,
    waitingFor: session.waitingFor,
    variables: session.variables,
    lastQuestion,
  }
}

function sessionFrom(graph: FlowGraph, message: string, chapter: string, saved?: JourneyPreviewSnapshot): Session | null {
  const start = startNodeId(graph)
  if (!start) return null
  const fresh = !saved
  const variables: SessionVariables = fresh
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
    currentNodeId: fresh ? start : saved.currentNodeId,
    variables,
    status: fresh ? 'running' : saved.status,
    waitingFor: fresh ? undefined : saved.waitingFor,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function beginChapter(
  graph: FlowGraph,
  name: string,
  message: string,
  previous?: JourneyPreviewSnapshot,
): JourneyPreviewSnapshot | undefined {
  const start = startNodeId(graph)
  if (!start) return undefined
  const variables = previous
    ? copyJumpVariables(previous.variables, message, String(previous.variables.contact['name'] ?? ''))
    : { flow: { _last_user_message: message }, global: {}, contact: { name: 'there' } }
  return {
    chapter: name,
    currentNodeId: start,
    status: 'running',
    waitingFor: undefined,
    variables,
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
  now?: Date
}): Promise<JourneyTurn> {
  const byName = new Map<string, FlowGraph>()
  for (const chapter of input.chapters) {
    if (!byName.has(chapter.name)) byName.set(chapter.name, chapter.graph)
  }
  const heard = input.message.trim()
  const opening = !heard && !input.session
  let chapterName = input.startChapter
  let saved: JourneyPreviewSnapshot | undefined
  const previous = input.session

  if (!previous || previous.status === 'handed_over' || previous.status === 'failed') {
    chapterName = input.startChapter
    saved = undefined
  } else if (previous.status === 'completed') {
    const nextName = heard && !isSmallTalk(heard)
      ? listenForChapter({ chapters: input.chapters, catalog: input.catalog, text: heard, current: previous.chapter })
      : undefined
    const nextGraph = nextName ? byName.get(nextName) : undefined
    if (nextName && nextGraph) {
      chapterName = nextName
      saved = beginChapter(nextGraph, nextName, input.message, previous)
    } else {
      return {
        handled: true,
        text: offerOnMap(input.chapters, previous.chapter),
        chapter: previous.chapter,
        session: { ...previous, lastQuestion: offerOnMap(input.chapters, previous.chapter) },
      }
    }
  } else {
    const hoursName = hoursChapterName(input.chapters)
    const hoursGraph = hoursName ? byName.get(hoursName) : undefined
    if (hoursName && hoursGraph && previous.chapter !== hoursName && acceptedHoursOffer(previous.lastQuestion, heard)) {
      chapterName = hoursName
      saved = beginChapter(hoursGraph, hoursName, 'opening hours', previous)
    } else {
      chapterName = previous.chapter
      saved = previous
    }
  }

  let graph = byName.get(chapterName)
  if (!graph) {
    const missing = chapterName || 'The welcome'
    return {
      handled: true,
      text: missingChapterLine(missing, input.environmentLabel),
      chapter: chapterName,
    }
  }

  const machine = new SessionMachine(previewServices(input.catalog, input.now))
  const lines: string[] = []
  let stopped = false
  const seen = new Set<string>()
  const originChapter = chapterName
  let retriedSameQuestion = false

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (seen.has(chapterName)) break
    seen.add(chapterName)
    const session = sessionFrom(graph, input.message, chapterName, saved)
    if (!session) return { handled: false, text: '', chapter: chapterName, session: saved }
    const hopStart = lines.length
    const result = await machine.run(session, graph, input.message)
    const given = spokenFirstName(String(result.session.variables.flow['guest_name'] ?? ''))
    if (given) result.session.variables.contact['name'] = given
    for (const message of result.newMessages) {
      const line = message.content.text.trim()
      if (line) lines.push(line)
    }
    saved = snapshot(result.session, chapterName, result.session.waitingFor?.question ?? questionFrom(lines.at(-1) ?? ''))

    if (result.jumpToFlow) {
      const nextName = result.jumpToFlow
      const next = byName.get(nextName)
      if (!next) {
        lines.push(missingChapterLine(nextName, input.environmentLabel))
        saved = { ...saved, status: 'completed' }
        stopped = true
        break
      }
      const jumped = beginChapter(next, nextName, input.message, saved)
      if (!jumped) {
        lines.push(missingChapterLine(nextName, input.environmentLabel))
        saved = { ...saved, status: 'completed' }
        stopped = true
        break
      }
      chapterName = nextName
      graph = next
      saved = jumped
      continue
    }

    if (
      chapterName === originChapter
      && !opening
      && heard
      && !isSmallTalk(heard)
      && !/^book/i.test(chapterName)
      && (!previous?.waitingFor || isTopicSwitch(heard))
    ) {
      const nextName = listenForChapter({
        chapters: input.chapters,
        catalog: input.catalog,
        text: heard,
        current: chapterName,
      })
      const next = nextName ? byName.get(nextName) : undefined
      if (nextName && next) {
        const jumped = beginChapter(next, nextName, input.message, saved)
        if (jumped) {
          lines.length = hopStart
          chapterName = nextName
          graph = next
          saved = jumped
          continue
        }
      }
    }

    if (result.handover && lines.length === 0) {
      lines.push('A person on the team will follow up.')
    }

    const asked = result.session.waitingFor?.question ?? questionFrom(lines.at(-1) ?? '')
    const holdingTime = result.session.waitingFor?.variable === 'preferred_time'
    if (!opening && asked && !holdingTime && sameQuestion(asked, previous?.lastQuestion) && !retriedSameQuestion) {
      const restarted = beginChapter(graph, chapterName, input.message, saved)
      if (restarted) {
        retriedSameQuestion = true
        lines.length = hopStart
        saved = restarted
        seen.delete(chapterName)
        continue
      }
    }
    if (!opening && asked && !holdingTime && sameQuestion(asked, previous?.lastQuestion)) {
      const offer = offerOnMap(input.chapters, chapterName)
      if (lines.length > hopStart) lines[lines.length - 1] = offer
      else lines.push(offer)
      saved = { ...saved, lastQuestion: offer }
    }
    break
  }

  const spoken = lines.slice()
  let text: string
  if (stopped) {
    const stop = spoken.pop() ?? ''
    const body = shapeTurn(spoken.join('\n\n'), chapterName)
    text = [body, stop].filter((line) => line.length > 0).join('\n\n')
  } else {
    text = shapeTurn(spoken.join('\n\n'), chapterName)
  }
  if (!text) return { handled: false, text: '', chapter: chapterName, session: saved }
  return { handled: true, text, chapter: chapterName, session: saved }
}
