import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hairStudioPack } from '@ybot/shared'
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
