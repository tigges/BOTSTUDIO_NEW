import assert from 'node:assert/strict'
import { test } from 'node:test'
import { draftWebsiteChat, hairStudioPack, pageFromHtml } from '@botstudio/shared'
import type { FlowGraph } from './engine.js'
import { acceptedHoursOffer, hearChapter, isPersonDoor, isSmallTalk, isTopicSwitch, listenForChapter, looksLikeQuestion, mapTopics, offerOnMap, sameQuestion, shapeTurn, steerInstruction, wantsOffer, welcomeMissReply } from './map-listen.js'

function salonChapters() {
  const pack = hairStudioPack('Yuzu', 'Bella')
  return {
    chapters: pack.flows.map((flow) => ({ name: flow.name, graph: flow.graph as unknown as FlowGraph })),
    catalog: pack.catalog,
  }
}

test('a service word opens prices, not the welcome', () => {
  const { chapters, catalog } = salonChapters()
  assert.equal(listenForChapter({ chapters, catalog, text: 'cut', current: 'Salon welcome' }), 'Services and prices')
  assert.equal(listenForChapter({ chapters, catalog, text: 'services', current: 'Salon hours' }), 'Services and prices')
  assert.equal(listenForChapter({ chapters, catalog, text: 'book a haircut', current: 'Salon welcome' }), 'Book an appointment')
  assert.equal(listenForChapter({ chapters, catalog, text: 'colour', current: 'Salon welcome' }), 'Book an appointment')
  assert.equal(listenForChapter({ chapters, catalog, text: 'color', current: 'Offers' }), 'Book an appointment')
  assert.equal(listenForChapter({ chapters, catalog, text: 'how much is colour', current: 'Salon welcome' }), 'Services and prices')
  assert.equal(listenForChapter({ chapters, catalog, text: 'hi', current: 'Salon welcome' }), undefined)
})

test('a promotion stays quiet unless they ask, and a colour answer is not a deal', () => {
  const home = pageFromHtml('https://yuzu.hair/', `<title>Yuzu</title>
<p>Every Tuesday, 50% off your most expensive colour service with a full-priced wash, cut and blow-dry.</p>
<p>Every Wednesday, 25% off blow-dries.</p>
<a href="https://www.phorest.com/salon/yuzuhairandbeauty">Book</a>`)
  const draft = draftWebsiteChat({ pages: [home], companyName: 'Yuzu', personaName: 'Bella' })
  const chapters = draft.flows.map((flow) => ({ name: flow.name, graph: flow.graph as unknown as FlowGraph }))
  const catalog = draft.catalog
  assert.equal(wantsOffer('red full head'), false)
  assert.equal(wantsOffer('Tuesday afternoon'), false)
  assert.equal(wantsOffer('any discounts?'), true)
  assert.equal(wantsOffer('what offers do you have'), true)
  assert.equal(isTopicSwitch('red full head'), false)
  assert.equal(isTopicSwitch('color'), true)
  assert.notEqual(listenForChapter({ chapters, catalog, text: 'red full head', current: 'Services and prices' }), 'Offers')
  assert.equal(listenForChapter({ chapters, catalog, text: 'colour on Tuesday', current: 'Salon welcome' }), 'Book an appointment')
  assert.equal(listenForChapter({ chapters, catalog, text: 'any discounts?', current: 'Salon welcome' }), 'Offers')
  assert.equal(listenForChapter({ chapters, catalog, text: 'what offers do you have', current: 'Services and prices' }), 'Offers')
})

test('a phrase miss can classify one of this map\'s chapters', async () => {
  const chapters = [
    {
      name: 'Welcome',
      graph: { nodes: [{ id: 's', data: { kind: 'trigger_start', label: 'Start', config: {} } }], edges: [] },
    },
    {
      name: 'Plans',
      graph: { nodes: [{ id: 's', data: { kind: 'trigger_start', label: 'Start', config: {} } }], edges: [] },
    },
    {
      name: 'Hours',
      graph: { nodes: [{ id: 's', data: { kind: 'trigger_start', label: 'Start', config: {} } }], edges: [] },
    },
  ]
  assert.equal(await hearChapter({ chapters, text: 'plans', current: 'Welcome' }), 'Plans')
  assert.equal(
    await hearChapter(
      { chapters, text: 'how much for unlimited data roaming', current: 'Welcome' },
      { classify: async () => ({ category: 'Plans', confidence: 0.9 }) },
    ),
    'Plans',
  )
  let called = false
  assert.equal(
    await hearChapter(
      { chapters, text: 'plans', current: 'Welcome' },
      {
        classify: async () => {
          called = true
          return { category: 'Hours', confidence: 1 }
        },
      },
    ),
    'Plans',
  )
  assert.equal(called, false)
  assert.equal(await hearChapter({ chapters, text: 'how much for unlimited data roaming', current: 'Welcome' }), undefined)
})

test('words that belong to the chapter the guest is in keep them there instead of asking the model', async () => {
  const start = { id: 's', data: { kind: 'trigger_start', label: 'Start', config: {} } }
  const chapters = [
    { name: 'Welcome', graph: { nodes: [start], edges: [] } },
    { name: 'Change or cancel', graph: { nodes: [start], edges: [] } },
    { name: 'Book a visit', graph: { nodes: [start], edges: [] } },
  ]
  let called = false
  const llm = { classify: async () => { called = true; return { category: 'Book a visit', confidence: 0.9 } } }
  assert.equal(await hearChapter({ chapters, text: 'cancel it', current: 'Change or cancel' }, llm), undefined)
  assert.equal(called, false)
  assert.equal(await hearChapter({ chapters, text: 'book me in for a cleaning', current: 'Change or cancel' }, llm), 'Book a visit')
})

test('a finished chapter offers the doors instead of repeating itself', () => {
  const { chapters } = salonChapters()
  const offer = offerOnMap(chapters, 'Salon hours')
  assert.match(offer, /prices/)
  assert.match(offer, /book/)
  assert.match(offer, /What would you like/)
  assert.equal(offer.includes('welcome'), false)
  assert.equal(/questions/.test(offer), false)
  assert.equal(sameQuestion("What's your name?", 'whats your name'), true)
  assert.equal(sameQuestion("What's your name?", 'What would you like done?'), false)
  assert.equal(isSmallTalk('thanks'), true)
  assert.equal(isSmallTalk('cut'), false)
  assert.equal(acceptedHoursOffer('Want the hours?', 'ok'), true)
  assert.equal(acceptedHoursOffer('Want the hours?', 'yes please'), true)
  assert.equal(acceptedHoursOffer('Want the hours?', 'book'), false)
  assert.equal(acceptedHoursOffer('Shall I book a time?', 'ok'), false)
})

test('a long which-one list becomes three short names, and hours asks one next thing', () => {
  const listed = shapeTurn(
    'Which cut & style? Ladies wash, cut & style, Gents wash, cut & style, Kids (12 & under), Teens (13-16) boys, Blow-dry.',
  )
  assert.match(listed, /Which cut/)
  assert.match(listed, /Ladies/)
  assert.match(listed, /Gents/)
  assert.match(listed, /Kids/)
  assert.match(listed, /or another/)
  assert.equal(/Ladies wash/.test(listed), false)
  assert.equal(/Blow-dry/.test(listed), false)
  assert.equal((listed.match(/\?/g) ?? []).length, 1)

  const hours = shapeTurn(
    'Yuzu is open Tuesday to Friday 10am to 8pm. Want where we are, a price, or to book?',
    'Salon hours',
  )
  assert.match(hours, /Shall I book a time/)
  assert.equal(/where we are/.test(hours), false)
  assert.equal((hours.match(/\?/g) ?? []).length, 1)

  const already = 'Which cut & style? Ladies, Gents, or Kids — or another.'
  assert.equal(shapeTurn(already), already)

  const plans = shapeTurn('Which plan? Free, Starter, Professional, or Enterprise.')
  assert.equal(plans, 'Which plan? Free, Starter, Professional, or Enterprise.')
})

test('the topic offer skips the person door, puts booking first, and a miss never says "didn\'t catch that"', () => {
  const say = (name: string) => ({ name, graph: { nodes: [{ id: 's', data: { kind: 'trigger_start', label: 'Start', config: {} } }], edges: [] } as unknown as FlowGraph })
  const jump = (id: string, flowName: string) => ({ id, data: { kind: 'execute_flow', label: flowName, config: { flowName } } })
  const welcome = {
    name: 'Practice welcome',
    graph: { nodes: [jump('a', 'Dental pain or emergency'), jump('b', 'Prices and finance'), jump('c', 'Book a visit'), jump('d', 'Talk to a person')], edges: [] } as unknown as FlowGraph,
  }
  const chapters = [welcome, say('Dental pain or emergency'), say('Prices and finance'), say('Book a visit'), say('Talk to a person')]
  assert.deepEqual(mapTopics(chapters), ['a booking', 'an urgent problem', 'prices'])
  assert.equal(offerOnMap(chapters), 'I can help you with a booking, an urgent problem, or prices. What would you like?')
  assert.equal(isPersonDoor('Talk to a person'), true)
  assert.equal(isPersonDoor('Speak to the team'), true)
  assert.equal(isPersonDoor('Book a visit'), false)
  const misses = [1, 2, 3].map((n) => welcomeMissReply(chapters, n))
  assert.equal(new Set(misses).size, 3)
  assert.ok(misses.every((line) => !/didn't catch/i.test(line) && /a booking, an urgent problem, or prices/.test(line)))
  assert.equal(looksLikeQuestion('again?'), false)
  assert.equal(looksLikeQuestion('xyz'), false)
  assert.equal(looksLikeQuestion('do you do sedation?'), true)
  assert.equal(looksLikeQuestion('my daughter needs her braces checked soon'), true)
  assert.match(steerInstruction(chapters), /a booking, an urgent problem, or prices/)
  assert.match(steerInstruction(chapters), /Do not say you are passing the chat/)
})
