import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine, type FlowGraph } from '@ybot/runtime'
import type { ExecutionServices, Session } from '@ybot/runtime'
import {
  SALON_WELCOME_NAME,
  flowCatalog,
  hairStudioPack,
  inspectFlowGraph,
  planHairStudioImport,
  spokenLines,
  welcomeDoors,
  welcomeGreeting,
} from '@ybot/shared'
import { environmentsNeedingGraph } from './bella-salon-sync.js'

function session(text: string, name = 'Ada', start = 'start'): Session {
  return {
    id: 's1',
    conversationId: 'c1',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId: start,
    variables: { flow: { _last_user_message: text }, global: {}, contact: { name } },
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function atStart(graph: FlowGraph, text: string, name = 'Ada'): Session {
  const start = graph.nodes.find((node) => node.data.kind === 'trigger_start')?.id ?? 'start'
  return session(text, name, start)
}

interface TurnNode {
  id: string
  data?: { kind?: string; config?: Record<string, unknown> }
}

function questionCount(node: TurnNode | undefined): number {
  const config = node?.data?.config ?? {}
  const text = String(config['text'] ?? config['question'] ?? '')
  return (text.match(/\?/g) ?? []).length
}

/**
 * A turn may answer and then ask once. Two question marks before the chart waits is too many.
 * An ask_question ends the turn, so the next question is a later reply.
 */
function stackedTurn(graph: unknown): string | undefined {
  if (!graph || typeof graph !== 'object') return undefined
  const record = graph as { nodes?: unknown; edges?: unknown }
  const nodes = Array.isArray(record.nodes) ? record.nodes.filter((node): node is TurnNode => (
    !!node && typeof node === 'object' && typeof (node as TurnNode).id === 'string'
  )) : []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const next = new Map<string, string[]>()
  for (const edge of Array.isArray(record.edges) ? record.edges : []) {
    if (!edge || typeof edge !== 'object') continue
    const link = edge as { source?: unknown; target?: unknown }
    if (typeof link.source !== 'string' || typeof link.target !== 'string') continue
    next.set(link.source, [...(next.get(link.source) ?? []), link.target])
  }
  function walk(id: string, asked: number, seen: Set<string>): string | undefined {
    if (seen.has(id)) return undefined
    const node = byId.get(id)
    if (!node) return undefined
    const count = asked + questionCount(node)
    if (count > 1) return id
    if (node.data?.kind === 'ask_question') return undefined
    const further = new Set(seen)
    further.add(id)
    for (const target of next.get(id) ?? []) {
      const hit = walk(target, count, further)
      if (hit) return hit
    }
    return undefined
  }
  for (const node of nodes) {
    const hit = walk(node.id, 0, new Set())
    if (hit) return `${node.id}->${hit}`
  }
  return undefined
}

function spoken(result: { newMessages: Array<{ content: { text: string } }> }): string {
  return result.newMessages.map((message) => message.content.text).join('\n')
}

/** The live runner stores the new reply before it resumes a waiting question. */
async function reply(
  machine: SessionMachine,
  previous: { session: Session },
  graph: FlowGraph,
  text: string,
  name?: string,
) {
  previous.session.variables.flow['_last_user_message'] = text
  if (name) previous.session.variables.contact = { name }
  return machine.run(previous.session, graph, text)
}

test('a salon widget answers prices, bookings, and the Bella address', async () => {
  const pack = hairStudioPack('Bella Hair Studio')
  const names = pack.flows.map((flow) => flow.name)
  const lookup = new Set(['Services and prices', 'Location', 'Salon hours'])
  assert.equal(new Set(names).size, names.length)
  assert.ok(pack.catalog.facts.some((fact) => fact.id === 'cut' && /£35/.test(fact.fact)))
  assert.ok(pack.catalog.facts.some((fact) => fact.id === 'location' && /14 Rosewood Lane/.test(fact.fact)))
  for (const intent of pack.intents) {
    const flow = pack.flows.find((item) => item.name === intent.name)
    assert.ok(flow, intent.name)
    const faq = pack.faqs.find((item) => item.question === intent.description)
    assert.equal(faq?.answer, intent.responses[0]!.text)
    if (lookup.has(intent.name)) continue
    assert.match(JSON.stringify(flow.graph), new RegExp(intent.responses[0]!.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  for (const flow of pack.flows) {
    const issues = inspectFlowGraph(flow.graph as Parameters<typeof inspectFlowGraph>[0], { flowNames: names })
    const blocking = issues.filter((issue) => issue.level === 'block' || issue.level === 'repair')
    assert.deepEqual(blocking, [], flow.name)
    assert.equal(JSON.stringify(flow.graph).includes('http_request'), false, flow.name)
    assert.equal(stackedTurn(flow.graph), undefined, flow.name)
    assert.deepEqual(
      environmentsNeedingGraph(flow.graph, [], ['bella-env-sandbox', 'bella-env-production']),
      ['bella-env-sandbox', 'bella-env-production'],
      flow.name,
    )
  }

  const welcome = pack.flows.find((flow) => flow.name === SALON_WELCOME_NAME)!
  const machine = new SessionMachine({ llm: {}, db: {}, httpFetch: fetch, catalog: pack.catalog } as unknown as ExecutionServices)
  const graph = welcome.graph as unknown as FlowGraph
  const greeting = "Hi, I'm Bella at Bella Hair Studio. What's your name?"
  const greetings = (welcome.graph as { nodes: Array<{ data?: { config?: Record<string, unknown> } }> }).nodes.filter((node) => {
    const text = `${node.data?.config?.['text'] ?? ''} ${node.data?.config?.['question'] ?? ''}`
    return text.includes("Hi, I'm Bella")
  })
  assert.equal(greetings.length, 1)
  assert.deepEqual(welcomeDoors(welcome.graph).map((door) => door.flowName), [
    'Location',
    'Salon hours',
    'Services and prices',
    'Book an appointment',
    'Cancel appointment',
    'Reschedule',
  ])
  assert.equal(welcomeGreeting(welcome.graph), greeting)

  async function afterName(text: string) {
    const first = await machine.run(session(text, 'there'), graph, text)
    assert.equal(first.jumpToFlow, undefined, text)
    assert.equal(first.session.status, 'waiting_input', text)
    assert.equal(spoken(first), greeting, text)
    assert.equal((spoken(first).match(/\?/g) ?? []).length, 1, text)
    return reply(machine, first, graph, 'Sophie', 'Sophie')
  }

  const hours = await afterName('What are your opening hours?')
  assert.equal(hours.jumpToFlow, 'Salon hours')
  assert.equal(spoken(hours).includes("Hi, I'm Bella"), false)

  const prices = await afterName('How much is a haircut?')
  assert.equal(prices.jumpToFlow, 'Services and prices')

  const book = await afterName('Can I book a colour?')
  assert.equal(book.jumpToFlow, 'Book an appointment')

  const where = await afterName('Where are you?')
  assert.equal(where.jumpToFlow, 'Location')

  const cancel = await afterName('Please cancel my booking')
  assert.equal(cancel.jumpToFlow, 'Cancel appointment')

  const move = await afterName('Can I move my appointment to Friday?')
  assert.equal(move.jumpToFlow, 'Reschedule')

  const hello = await machine.run(session('hello', 'Ada'), graph, 'hello')
  assert.equal(spoken(hello), greeting)
  const namedHello = await reply(machine, hello, graph, 'Sophie', 'Sophie')
  assert.equal(spoken(namedHello), 'Are you after a price, the hours, or to book?')
  const haircut = await reply(machine, namedHello, graph, 'a haircut')
  assert.equal(haircut.jumpToFlow, 'Services and prices')
  assert.equal(spoken(haircut).includes("Hi, I'm Bella"), false)

  const helloBook = await machine.run(session('hello', 'Ada'), graph, 'hello')
  const namedBook = await reply(machine, helloBook, graph, 'Sophie', 'Sophie')
  const bookCut = await reply(machine, namedBook, graph, 'book a haircut')
  assert.equal(bookCut.jumpToFlow, 'Book an appointment')

  const helloAgain = await machine.run(session('hello', 'there'), graph, 'hello')
  const namedAgain = await reply(machine, helloAgain, graph, 'Sophie', 'Sophie')
  const hoursLater = await reply(machine, namedAgain, graph, 'What are your opening hours?')
  assert.equal(hoursLater.jumpToFlow, 'Salon hours')

  const lighter = await afterName("I'd like to go lighter")
  assert.equal(lighter.jumpToFlow, 'Book an appointment')

  const reaction = await afterName('I had an allergic reaction')
  assert.equal(reaction.jumpToFlow, undefined)
  assert.equal(spoken(reaction), 'Are you after a price, the hours, or to book?')

  const voiced = hairStudioPack('Rose Studio', 'Yuzu')
  assert.equal(
    welcomeGreeting(voiced.flows.find((flow) => flow.name === SALON_WELCOME_NAME)?.graph),
    "Hi, I'm Yuzu at Rose Studio. What's your name?",
  )

  const pricesFlow = pack.flows.find((flow) => flow.name === 'Services and prices')!
  const pricesSpoken = await machine.run(session('how much is a haircut'), pricesFlow.graph as unknown as FlowGraph, 'how much is a haircut')
  assert.match(spoken(pricesSpoken), /£35/)
  assert.match(spoken(pricesSpoken), /book/i)
  assert.equal(pricesSpoken.session.status, 'waiting_input')
  const pricesMenu = await machine.run(session('prices'), pricesFlow.graph as unknown as FlowGraph, 'prices')
  assert.match(spoken(pricesMenu), /thinking of/)
  assert.equal(/£35/.test(spoken(pricesMenu)), false)

  const location = pack.flows.find((flow) => flow.name === 'Location')!
  const address = await machine.run(session('address'), location.graph as unknown as FlowGraph, 'address')
  const addressText = address.newMessages.map((message) => message.content.text).join('\n')
  assert.match(addressText, /14 Rosewood Lane/)
  assert.match(addressText, /Want the hours/)
  assert.equal(/a price, or to book/.test(addressText), false)
  assert.equal((addressText.match(/\?/g) ?? []).length, 1)
  assert.equal(address.session.status, 'waiting_input')
  const hoursDoor = await reply(machine, address, location.graph as unknown as FlowGraph, 'ok')
  assert.equal(hoursDoor.jumpToFlow, 'Salon hours')

  const hoursFlow = pack.flows.find((flow) => flow.name === 'Salon hours')!
  const hoursSpoken = await machine.run(session('hours'), hoursFlow.graph as unknown as FlowGraph, 'hours')
  const hoursText = hoursSpoken.newMessages.map((message) => message.content.text).join('\n')
  assert.match(hoursText, /Monday to Saturday, 09:00 to 18:00/)
  assert.match(hoursText, /Shall I book a time/)
  assert.equal(hoursText.includes('Sunday'), false)
  assert.equal(/where we are/.test(hoursText), false)
  assert.equal((hoursText.match(/\?/g) ?? []).length, 1)
  assert.equal(hoursSpoken.session.status, 'waiting_input')
  const bookDoor = await reply(machine, hoursSpoken, hoursFlow.graph as unknown as FlowGraph, 'ok')
  assert.equal(bookDoor.jumpToFlow, 'Book an appointment')

  const voucherFlow = pack.flows.find((flow) => flow.name === 'Gift voucher')!
  const voucherSpoken = await machine.run(session('voucher'), voucherFlow.graph as unknown as FlowGraph, 'voucher')
  assert.match(voucherSpoken.newMessages.map((message) => message.content.text).join('\n'), /£25, £50, or £100/)

  const bookFlow = pack.flows.find((flow) => flow.name === 'Book an appointment')!
  const bookGraph = bookFlow.graph as unknown as FlowGraph
  assert.match(JSON.stringify(bookGraph), /Consultation/)
  assert.ok(spokenLines(bookGraph, 20).some((line) => line.includes('been to us before')))

  const colour = await machine.run(atStart(bookGraph, 'Can I book a colour?', 'there'), bookGraph, 'Can I book a colour?')
  assert.match(spoken(colour), /colour work/)
  assert.match(spoken(colour), /roots/)
  assert.equal((spoken(colour).match(/\?/g) ?? []).length, 1)
  assert.equal(spoken(colour).includes('What would you like done'), false)
  assert.equal(/50%|Every Tuesday/i.test(spoken(colour)), false)
  const qualified = await reply(machine, colour, bookGraph, 'Full head')
  assert.match(spoken(qualified), /cut with the colour/)
  const alreadyNamed = await machine.run(atStart(bookGraph, 'red full head colour', 'there'), bookGraph, 'red full head colour')
  assert.match(spoken(alreadyNamed), /cut with the colour/)
  assert.equal(/colour work/.test(spoken(alreadyNamed)), false)
  assert.equal(/50%|Every Tuesday/i.test(spoken(alreadyNamed)), false)
  const upsell = await reply(machine, qualified, bookGraph, 'yes')
  assert.match(spoken(upsell), /senior stylist/)
  assert.match(spoken(upsell), /usual choice/)
  const stylist = await reply(machine, upsell, bookGraph, 'senior')
  assert.match(spoken(stylist), /Saturday morning or a weekday after 5/)
  const day = await reply(machine, stylist, bookGraph, 'Saturday morning')
  assert.match(spoken(day), /Saturday with a senior stylist I have 10am, or 11am\. Which time\?/)
  assert.equal((spoken(day).match(/\?/g) ?? []).length, 1)
  const time = await reply(machine, day, bookGraph, '10am')
  assert.match(spoken(time), /What's your name/)
  const named = await reply(machine, time, bookGraph, 'Sophie', 'Sophie')
  assert.match(spoken(named), /mobile/)
  const mobile = await reply(machine, named, bookGraph, '07700 900123')
  assert.match(spoken(mobile), /confirm/)
  assert.match(spoken(mobile), /text/)
  assert.match(spoken(mobile), /Sophie/)
  assert.equal(/https?:\/\//.test(spoken(mobile)), false)
  assert.equal(mobile.session.status, 'completed')
  assert.equal(mobile.ticket?.subject, 'Booking for Saturday at 10am')

  const cut = await machine.run(atStart(bookGraph, 'book a haircut'), bookGraph, 'book a haircut')
  assert.match(spoken(cut), /been to us before/)
  assert.equal(spoken(cut).includes('I can book that'), false)
  assert.equal((spoken(cut).match(/\?/g) ?? []).length, 1)
  assert.equal(spoken(cut).includes('patch test'), false)
  const returning = await reply(machine, cut, bookGraph, 'I have been before')
  assert.match(spoken(returning), /Saturday morning or a weekday after 5/)
  assert.equal(spoken(returning).includes('patch test'), false)
  const cutWhen = await reply(machine, returning, bookGraph, 'a weekday after 5')
  assert.equal((spoken(cutWhen).match(/\?/g) ?? []).length, 1)
  const cutDay = await reply(machine, cutWhen, bookGraph, 'Tuesday')
  assert.match(spoken(cutDay), /Tuesday with a senior stylist I have 10am, 2pm, or 5pm\. Which time\?/)
  const cutTime = await reply(machine, cutDay, bookGraph, '5pm')
  assert.match(spoken(cutTime), /Tuesday at 5pm/)
  assert.match(spoken(cutTime), /24 hours/)
  assert.match(spoken(cutTime), /Ada/)
  assert.equal(spoken(cutTime).includes('card details'), false)

  const newCut = await machine.run(atStart(bookGraph, 'book a haircut', 'Ada'), bookGraph, 'book a haircut')
  const notBeen = await reply(machine, newCut, bookGraph, 'I have not been')
  assert.match(spoken(notBeen), /hoping for with the cut/)
  assert.equal(spoken(notBeen).includes('Saturday morning'), false)

  const correctionFlow = pack.flows.find((flow) => flow.name === 'Colour correction')!
  const correctionGraph = correctionFlow.graph as unknown as FlowGraph
  const handed = await machine.run(atStart(correctionGraph, 'home dye'), correctionGraph, 'home dye')
  assert.equal(handed.handover?.routing.queue, 'salon')
  assert.equal(handed.handover?.priority, 'medium')
  assert.match(spoken(handed), /passing this chat to the studio/)
})

test('cancel, reschedule, and consultation answer and then ask once', async () => {
  const pack = hairStudioPack('Bella Hair Studio')
  const machine = new SessionMachine({ llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices)
  const steps: Array<[string, string, string]> = [
    ['Cancel appointment', 'note a cancellation', 'What name is the appointment under'],
    ['Reschedule', 'note a new time', 'What name is the appointment under'],
    ['Consultation', 'free and takes about 15 minutes', 'Saturday morning or a weekday after 5'],
  ]
  for (const [name, answer, followUp] of steps) {
    const graph = pack.flows.find((flow) => flow.name === name)!.graph as unknown as FlowGraph
    const turn = await machine.run(atStart(graph, name), graph, name)
    assert.match(spoken(turn), new RegExp(answer))
    assert.match(spoken(turn), new RegExp(followUp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.equal((spoken(turn).match(/\?/g) ?? []).length, 1, name)
    assert.equal(turn.session.status, 'waiting_input', name)
  }
})

test('a salon with no welcome publishes Salon welcome', () => {
  const plan = planHairStudioImport({
    companyName: 'Bella Hair Studio',
    existingFlowNames: [],
    existingIntentNames: [],
    existingQuestions: [],
    publishedWelcome: false,
  })
  assert.equal(plan.flows.find((flow) => flow.name === SALON_WELCOME_NAME)?.publish, true)
  assert.match(JSON.stringify(plan.flows.find((flow) => flow.name === SALON_WELCOME_NAME)?.graph), /Bella Hair Studio/)
})

test('Bella keeps her current welcome and gains a salon draft', () => {
  const plan = planHairStudioImport({
    companyName: 'Bella Hair Studio',
    existingFlowNames: ['Welcome & Routing', 'Talk to a person'],
    existingIntentNames: [],
    existingQuestions: ['What is your return policy?'],
    publishedWelcome: true,
  })
  const draft = plan.flows.find((flow) => flow.name === SALON_WELCOME_NAME)
  assert.equal(draft?.publish, false)
  assert.equal(plan.flows.some((flow) => flow.name === 'Welcome & Routing'), false)
  assert.equal(plan.flows.find((flow) => flow.name === 'Services and prices')?.publish, true)
  assert.equal(plan.faqs.some((faq) => faq.question === 'What is your return policy?'), false)

  const again = planHairStudioImport({
    companyName: 'Bella Hair Studio',
    existingFlowNames: ['Welcome & Routing', ...plan.flows.map((flow) => flow.name)],
    existingIntentNames: plan.intents.map((intent) => intent.name),
    existingQuestions: plan.faqs.map((faq) => faq.question),
    publishedWelcome: true,
  })
  assert.deepEqual(again.flows, [])
  assert.deepEqual(again.intents, [])
  assert.deepEqual(again.faqs, [])
})

test('the new-flow list includes the salon answers once', () => {
  const names = flowCatalog('Bella Hair Studio').map((flow) => flow.name)
  assert.ok(names.includes('Salon welcome'))
  assert.ok(names.includes('Services and prices'))
  assert.ok(names.includes('Reschedule'))
  assert.ok(names.includes('Gift voucher'))
  assert.ok(names.includes('Patch test'))
  assert.ok(names.includes('Order Status'))
  assert.equal(new Set(names).size, names.length)
})
