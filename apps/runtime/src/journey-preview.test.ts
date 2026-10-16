import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatPlain, draftWebsiteChat, hairStudioPack, pageFromHtml } from '@ybot/shared'
import { runJourneyPreview } from './journey-preview.js'
import type { FlowGraph } from './engine.js'

function salonWalk(company = 'Yuzu') {
  const pack = hairStudioPack(company, 'Bella')
  return {
    chapters: pack.flows.map((flow) => ({
      name: flow.name,
      graph: flow.graph as unknown as FlowGraph,
    })),
    catalog: pack.catalog,
  }
}

test('the test chat opens on the greeting and does not burn a fake hi', async () => {
  const { chapters, catalog } = salonWalk()
  const open = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  assert.match(open.text, /What's your name\?/)
  assert.equal(open.chapter, 'Salon welcome')
  assert.equal(open.session?.status, 'waiting_input')
})

test('a request on the welcome continues in that chapter and keeps the name', async () => {
  const { chapters, catalog } = salonWalk()
  const hello = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'where are you',
    environmentLabel: 'Sandbox',
  })
  assert.match(hello.text, /14 Rosewood Lane/)
  assert.equal(hello.chapter, 'Location')
  assert.equal(hello.text.includes("What's your name"), false)
})

test('cut opens the price, and services after hours does not dead-end', async () => {
  const { chapters, catalog } = salonWalk()
  const open = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const cut = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'cut',
    environmentLabel: 'Sandbox',
    session: open.session,
  })
  assert.match(cut.text, /£35/)
  assert.equal(cut.chapter, 'Services and prices')
  assert.equal(cut.text.includes("What would you like done"), false)

  const hours = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'salon hours',
    environmentLabel: 'Sandbox',
    session: cut.session,
  })
  assert.match(hours.text, /Monday to Saturday/)
  assert.match(hours.text, /Shall I book/)
  assert.equal(/where we are/.test(hours.text), false)
  assert.equal((hours.text.match(/\?/g) ?? []).length, 1)
  assert.equal(hours.chapter, 'Salon hours')

  const services = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'services',
    environmentLabel: 'Sandbox',
    session: hours.session,
  })
  assert.match(services.text, /thinking of|£/)
  assert.equal(services.chapter, 'Services and prices')
  assert.equal(services.text.includes('I can also help with hours, prices, or a booking.'), false)
})

test('a finished chapter offers the map instead of greeting again', async () => {
  const { chapters, catalog } = salonWalk()
  const priced = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'how much is a haircut',
    environmentLabel: 'Sandbox',
  })
  const booked = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'no',
    environmentLabel: 'Sandbox',
    session: priced.session,
  })
  const again = await runJourneyPreview({
    chapters,
    catalog,
    startChapter: 'Salon welcome',
    message: 'catalog',
    environmentLabel: 'Sandbox',
    session: booked.session,
  })
  assert.match(again.text, /What would you like/)
  assert.equal(again.text.includes("What's your name"), false)
  assert.equal(again.text.includes("Hi, I'm Bella"), false)
})

test('a handoff to a chapter that is not on this map stops', async () => {
  const walk = salonWalk()
  const chapters = walk.chapters.filter((chapter) => chapter.name !== 'Location')
  const hello = await runJourneyPreview({
    chapters,
    catalog: walk.catalog,
    startChapter: 'Salon welcome',
    message: 'where are you',
    environmentLabel: 'Production',
  })
  const stopped = await runJourneyPreview({
    chapters,
    catalog: walk.catalog,
    startChapter: 'Salon welcome',
    message: 'Ada',
    environmentLabel: 'Production',
    session: hello.session,
  })
  assert.match(stopped.text, /Location is not on this Production map\./)
  assert.equal(stopped.text.includes('Rosewood'), false)
  assert.equal(stopped.chapter, 'Salon welcome')
})

test('colour qualifies the booking instead of reading a Tuesday offer', async () => {
  const home = pageFromHtml('https://yuzu.hair/', `<title>Yuzu</title>
<p>Yuzu Hair and Beauty works at 5 Dickens Yard, Longfield Avenue, Ealing, W5 2TD.</p>
<p>Open Tuesday to Friday 10am to 8pm and Saturday 9am to 6pm. Monday and Sunday closed.</p>
<p>Every Tuesday, 50% off your most expensive colour service with a full-priced wash, cut and blow-dry.</p>
<p>Every Wednesday, 25% off blow-dries.</p>
<a href="https://www.phorest.com/salon/yuzuhairandbeauty">Book</a>`)
  const draft = draftWebsiteChat({ pages: [home], companyName: 'Yuzu', personaName: 'Bella' })
  const chapters = draft.flows.map((flow) => ({
    name: flow.name,
    graph: flow.graph as unknown as FlowGraph,
  }))
  const open = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const colour = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'color',
    environmentLabel: 'Sandbox',
    session: open.session,
  })
  assert.equal(colour.chapter, 'Book an appointment')
  assert.match(colour.text, /colour work/i)
  assert.equal(/50%|Every Tuesday/i.test(colour.text), false)
  assert.equal(/phorest\.com/i.test(colour.text), false)
  assert.equal((colour.text.match(/\?/g) ?? []).length, 1)

  const need = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'full head',
    environmentLabel: 'Sandbox',
    session: colour.session,
  })
  assert.match(need.text, /cut with the colour/i)
  const upsell = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'yes',
    environmentLabel: 'Sandbox',
    session: need.session,
  })
  assert.match(upsell.text, /senior stylist/i)
  const stylist = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'senior',
    environmentLabel: 'Sandbox',
    session: upsell.session,
  })
  assert.match(stylist.text, /When would suit/i)
  const when = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'Tuesday afternoon',
    environmentLabel: 'Sandbox',
    session: stylist.session,
  })
  assert.match(when.text, /What's your name/)
  const named = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'Sophie',
    environmentLabel: 'Sandbox',
    session: when.session,
  })
  assert.match(named.text, /mobile/i)
  const mobile = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '07700 900123',
    environmentLabel: 'Sandbox',
    session: named.session,
  })
  assert.match(mobile.text, /confirm/i)
  assert.match(chatPlain(mobile.text), /Phorest/)
  assert.equal(/https?:\/\//.test(chatPlain(mobile.text)), false)
  assert.match(mobile.text, /\[Phorest\]\(/)
  assert.equal(mobile.chapter, 'Book an appointment')
})

test('cut then men hears Gents instead of the whole map', async () => {
  const home = pageFromHtml('https://yuzu.hair/', `<title>Yuzu</title>
<p>Yuzu Hair and Beauty works at 5 Dickens Yard, Longfield Avenue, Ealing, W5 2TD.</p>
<p>Open Tuesday to Friday 10am to 8pm and Saturday 9am to 6pm. Monday and Sunday closed.</p>
<a href="https://www.phorest.com/salon/yuzuhairandbeauty">Book</a>`)
  const prices = pageFromHtml('https://yuzu.hair/prices/', `<title>Price list</title>
<h2>Cut &amp; style</h2>
<table>
<tr><th>Service</th><th>Senior</th><th>Stylist</th></tr>
<tr><th>Ladies wash, cut &amp; style</th><td data-label="Senior">£87</td><td data-label="Stylist">£58</td></tr>
<tr><th>Gents wash, cut &amp; style</th><td data-label="Senior">£45</td><td data-label="Stylist">£38</td></tr>
<tr><th>Kids (12 &amp; under)</th><td data-label="Senior">£29</td><td data-label="Stylist">£23</td></tr>
<tr><th>Teens (13-16) boys</th><td data-label="Senior">£35</td><td data-label="Stylist">£29</td></tr>
<tr><th>Blow-dry</th><td data-label="Senior">£28</td><td data-label="Stylist">£22</td></tr>
</table>
<h2>Colour</h2>
<table>
<tr><th>Service</th><th>Senior</th><th>Stylist</th></tr>
<tr><th>Full head</th><td data-label="Senior">£101</td><td data-label="Stylist">£87</td></tr>
<tr><th>Roots</th><td data-label="Senior">£88</td><td data-label="Stylist">£75</td></tr>
</table>`)
  const draft = draftWebsiteChat({ pages: [home, prices], companyName: 'Yuzu', personaName: 'Bella' })
  const chapters = draft.flows.map((flow) => ({
    name: flow.name,
    graph: flow.graph as unknown as FlowGraph,
  }))
  const open = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: '',
    environmentLabel: 'Sandbox',
  })
  const cut = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'cut',
    environmentLabel: 'Sandbox',
    session: open.session,
  })
  assert.match(cut.text, /which cut/i)
  assert.match(cut.text, /Ladies/)
  assert.match(cut.text, /or another/)
  assert.equal(/Ladies wash/.test(cut.text), false)
  assert.equal(cut.chapter, 'Services and prices')

  const men = await runJourneyPreview({
    chapters,
    catalog: draft.catalog,
    startChapter: 'Salon welcome',
    message: 'men',
    environmentLabel: 'Sandbox',
    session: cut.session,
  })
  assert.match(men.text, /£45|£38/)
  assert.equal(men.chapter, 'Services and prices')
  assert.equal(/where we are/.test(men.text), false)
  assert.equal(/What would you like/.test(men.text), false)
})
