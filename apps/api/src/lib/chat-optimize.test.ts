import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyChatFindings,
  draftWebsiteChat,
  findingsFromChat,
  hairStudioPack,
  pageFromHtml,
} from '@ybot/shared'

function locationRoutes(graph: { nodes: Array<{ data: { kind: string; config: Record<string, unknown> } }> }) {
  const node = graph.nodes.find((item) => item.data.kind === 'route_topic')
  return ((node?.data.config['routes'] as Array<{ handle: string; phrases: string[] }> | undefined) ?? [])
}

test('ok after Want the hours is a finding, and apply moves yes onto Salon hours', () => {
  const pack = hairStudioPack('Yuzu', 'Bella')
  const location = pack.flows.find((flow) => flow.name === 'Location')!
  const hoursRoute = locationRoutes(location.graph as never).find((route) => route.handle === 'hours')
  const bookRoute = locationRoutes(location.graph as never).find((route) => route.handle === 'book')
  assert.ok(hoursRoute?.phrases.includes('ok'))
  assert.equal(bookRoute?.phrases.includes('ok'), false)

  const older = {
    ...location,
    graph: {
      ...location.graph,
      nodes: (location.graph.nodes as Array<{ id: string; data: { kind: string; config: Record<string, unknown> } }>).map((node) => {
        if (node.data.kind !== 'route_topic') return node
        const routes = (node.data.config['routes'] as Array<{ handle: string; phrases: string[] }>) ?? []
        return {
          ...node,
          data: {
            ...node.data,
            config: {
              ...node.data.config,
              routes: routes.map((route) => (
                route.handle === 'hours'
                  ? { ...route, phrases: ['hours', 'opening hours', 'when are you open'] }
                  : route.handle === 'book'
                    ? { ...route, phrases: ['book', 'booking', 'yes', 'please', 'ok', 'okay', 'yeah'] }
                    : route
              )),
            },
          },
        }
      }),
    },
  }
  const lines = [
    { role: 'assistant' as const, content: "Hi, I'm Bella at Yuzu. What's your name?", chapter: 'Salon welcome' },
    { role: 'user' as const, content: 'where are you' },
    { role: 'assistant' as const, content: 'Yuzu is at 14 Rosewood Lane.\n\nWant the hours?', chapter: 'Location' },
    { role: 'user' as const, content: 'ok' },
    { role: 'assistant' as const, content: 'Have you been to us before?', chapter: 'Book an appointment' },
  ]
  const findings = findingsFromChat({
    lines,
    chapters: pack.flows.map((flow) => flow.name === 'Location' ? older : flow),
  })
  const offer = findings.find((finding) => finding.kind === 'offer_yes')
  assert.ok(offer)
  assert.equal(offer?.applyable, true)
  const applied = applyChatFindings({
    chapters: pack.flows.map((flow) => flow.name === 'Location' ? older : flow),
    findings: [offer!],
  })
  const next = applied.chapters.find((chapter) => chapter.name === 'Location')!
  const nextHours = locationRoutes(next.graph).find((route) => route.handle === 'hours')
  const nextBook = locationRoutes(next.graph).find((route) => route.handle === 'book')
  assert.ok(nextHours?.phrases.includes('ok'))
  assert.equal(nextBook?.phrases.includes('ok'), false)
})

test('a greeting that asks for a name twice keeps one ask', () => {
  const findings = findingsFromChat({
    lines: [
      { role: 'assistant', content: "Hi, I'm James at Hubspot. What's your name?", chapter: 'Welcome' },
      { role: 'user', content: 'Toto' },
      { role: 'assistant', content: "What's your name?", chapter: 'Welcome' },
    ],
    chapters: [{
      name: 'Welcome',
      graph: {
        nodes: [
          { id: 'greet', data: { kind: 'ask_question', config: { question: "Hi, I'm James at Hubspot. What's your name?", variable: 'greeting_reply' } } },
          { id: 'name', data: { kind: 'ask_question', config: { question: "What's your name?", variable: 'guest_name' } } },
        ],
        edges: [{ id: 'e', source: 'greet', target: 'name' }],
      },
    }],
  })
  const named = findings.find((finding) => finding.kind === 'name_once')
  assert.ok(named)
  const applied = applyChatFindings({
    chapters: [{
      name: 'Welcome',
      graph: {
        nodes: [
          { id: 'greet', data: { kind: 'ask_question', config: { question: "Hi, I'm James at Hubspot. What's your name?", variable: 'greeting_reply' } } },
          { id: 'name', data: { kind: 'ask_question', config: { question: "What's your name?", variable: 'guest_name' } } },
        ],
        edges: [{ id: 'e', source: 'greet', target: 'name' }],
      },
    }],
    findings: [named!],
  })
  const greet = applied.chapters[0]!.graph.nodes.find((node) => node.id === 'greet')
  const keep = applied.chapters[0]!.graph.nodes.find((node) => node.id === 'name')
  assert.equal(/What's your name/.test(String(greet?.data.config['question'] ?? '')), false)
  assert.match(String(greet?.data.config['question'] ?? ''), /James at Hubspot/)
  assert.equal(keep?.data.config['question'], "What's your name?")
})

test('homepage nav chrome is a note, not an automatic chart edit', () => {
  const findings = findingsFromChat({
    lines: [
      { role: 'assistant', content: 'Products Solutions Pricing Resources Partners Company Get a demo Free tools' },
    ],
    chapters: [],
    notes: [{ lineContent: 'Products Solutions', text: 'Answer from the marketing page instead.' }],
  })
  assert.equal(findings.some((finding) => finding.kind === 'nav_chrome' && finding.applyable === false), true)
  assert.equal(findings.some((finding) => finding.kind === 'note'), true)
})

test('a scanned hair location chart hears ok as hours', () => {
  const home = pageFromHtml('https://yuzu.hair/', `<title>Yuzu</title>
<p>Yuzu Hair and Beauty works at 5 Dickens Yard, Longfield Avenue, Ealing, W5 2TD.</p>
<p>Open Tuesday to Friday 10am to 8pm and Saturday 9am to 6pm.</p>
<a href="https://www.phorest.com/salon/yuzuhairandbeauty">Book</a>`)
  const draft = draftWebsiteChat({ pages: [home], companyName: 'Yuzu', personaName: 'Bella' })
  const location = draft.flows.find((flow) => flow.name === 'Location')
  assert.ok(location)
  const hours = locationRoutes(location!.graph as never).find((route) => route.handle === 'hours')
  const book = locationRoutes(location!.graph as never).find((route) => route.handle === 'book')
  assert.ok(hours?.phrases.includes('ok'))
  assert.equal(book?.phrases.includes('ok'), false)
})
