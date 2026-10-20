import type { FlowGraph, GraphNode } from './engine.js'
import { matchTopic } from './topic-route.js'

/**
 * The parts of a conversation every bot handles the same way, whatever chart it runs:
 * a hello, thanks, a goodbye, "are you a bot?", "what can you do?", "sorry, what?".
 * They are answered once here, before the chart, so no chart has to model them and none
 * replies "Sorry, I didn't catch that" to a "hi".
 */
export type BasicAct = 'greeting' | 'how_are_you' | 'thanks' | 'goodbye' | 'bot_question' | 'help' | 'repeat'

const ACTS: Array<[BasicAct, RegExp]> = [
  ['how_are_you', /^(?:(?:hi|hello|hey|hiya)\s+)?(?:how are you(?: doing| today)?|how's it going|how are things|you ok|are you ok|how do you do)$/],
  ['greeting', /^(?:hi|hello|hey|hiya|heya|howdy|yo|hi there|hello there|hey there|hiya there|good (?:morning|afternoon|evening|day)|morning|afternoon|evening|greetings)(?: there)?$/],
  ['thanks', /^(?:thanks|thank you|thank you so much|thanks so much|thanks a lot|many thanks|cheers|ta|thx|ty|much appreciated)$/],
  ['goodbye', /^(?:bye|goodbye|bye bye|see you|see ya|cya|take care|that's all|that is all|that's everything|have a good day|have a nice day)$/],
  ['bot_question', /^(?:are you (?:a |an )?(?:bot|robot|real|human|person|ai|computer|machine|real person)|am i (?:talking|speaking|chatting) (?:to|with) (?:a |an )?(?:bot|robot|real person|person|human|ai)|is this (?:a |an )?(?:bot|robot|real person|human|ai))$/],
  ['help', /^(?:help|help me|can you help|can you help me|what can you do|what do you do|what can you help with|what can i ask|options|menu|what are my options|what are the options)$/],
  ['repeat', /^(?:sorry|what|pardon|huh|come again|say that again|can you repeat that|repeat that|repeat|i don't understand|i dont understand|i didn't understand|i didnt understand|i'm confused|im confused|what do you mean)$/],
]

/** The message is only a conversational move, with nothing else asked. */
export function basicAct(text: string): BasicAct | undefined {
  const cleaned = text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(?:please|mate|again|then)$/, '')
  if (!cleaned || cleaned.length > 48) return undefined
  return ACTS.find(([, pattern]) => pattern.test(cleaned))?.[0]
}

function routeNodesAfter(graph: FlowGraph, nodeId: string): GraphNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const here = byId.get(nodeId)
  if (here?.data.kind === 'route_topic') return [here]
  return graph.edges
    .filter((edge) => edge.source === nodeId)
    .map((edge) => byId.get(edge.target))
    .filter((node): node is GraphNode => node?.data.kind === 'route_topic')
}

/** The chart already has a route for these words ("thanks" closing an offer), so it answers, not the basics. */
function chartHears(graph: FlowGraph, nodeId: string, text: string): boolean {
  for (const node of routeNodesAfter(graph, nodeId)) {
    const routes = ((node.data.config['routes'] as Array<{ handle?: string; phrases?: string[] }> | undefined) ?? [])
      .map((route) => ({ handle: String(route.handle ?? ''), phrases: route.phrases ?? [] }))
      .filter((route) => route.handle)
    if (matchTopic(text, routes) !== 'other') return true
  }
  return false
}

export interface BasicReply {
  act: BasicAct
  text: string
  /** The question is still open: the chat stays where it was. */
  keepWaiting: boolean
}

/**
 * Answer a basic move while the bot waits on a question, then ask that question again.
 * Undefined when the message is not a basic move, the chart has its own route for it,
 * or an AI step is holding the conversation.
 */
export function basicsReply(input: {
  text: string
  graph: FlowGraph
  nodeId: string
  question?: string
  waitingType?: string
}): BasicReply | undefined {
  if (input.waitingType === 'ai') return undefined
  // An opener that only waits for the guest to speak ("Hi, I'm James.") moves on by itself.
  if (input.question !== undefined && !input.question.trim().endsWith('?')) return undefined
  const act = basicAct(input.text)
  if (!act) return undefined
  if (chartHears(input.graph, input.nodeId, input.text)) return undefined
  const question = input.question?.trim()
  const then = (lead: string) => (question ? `${lead} ${question}` : lead)
  switch (act) {
    case 'greeting':
      return { act, keepWaiting: true, text: then('Hi!') }
    case 'how_are_you':
      return { act, keepWaiting: true, text: then("I'm doing well, thanks for asking.") }
    case 'thanks':
      return { act, keepWaiting: true, text: then("You're welcome.") }
    case 'goodbye':
      return { act, keepWaiting: true, text: "Thanks for chatting. If you need anything else, I'm here." }
    case 'bot_question':
      return { act, keepWaiting: true, text: then("I'm a virtual assistant, not a person. If you'd rather talk to someone on the team, just say so.") }
    case 'help':
      return { act, keepWaiting: true, text: then('Happy to help.') }
    case 'repeat':
      return { act, keepWaiting: true, text: question ? `Sure. ${question}` : 'Sorry, let me try again. What can I help with?' }
  }
}
