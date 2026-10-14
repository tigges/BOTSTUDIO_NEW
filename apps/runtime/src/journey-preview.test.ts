import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hairStudioPack } from '@ybot/shared'
import { runJourneyPreview } from './journey-preview.js'
import type { FlowGraph } from './engine.js'

function salonChapters(company = 'Yuzu') {
  return hairStudioPack(company, 'Bella').flows.map((flow) => ({
    name: flow.name,
    graph: flow.graph as unknown as FlowGraph,
  }))
}

test('a request on the welcome continues in that chapter and keeps the name', async () => {
  const chapters = salonChapters()
  const hello = await runJourneyPreview({
    chapters,
    startChapter: 'Salon welcome',
    message: 'where are you',
    environmentLabel: 'Sandbox',
  })
  assert.match(hello.text, /What's your name\?/)
  assert.equal(hello.chapter, 'Salon welcome')
  assert.equal(hello.text.includes('Rosewood'), false)

  const named = await runJourneyPreview({
    chapters,
    startChapter: 'Salon welcome',
    message: 'Ada',
    environmentLabel: 'Sandbox',
    session: hello.session,
  })
  assert.match(named.text, /14 Rosewood Lane/)
  assert.equal(named.chapter, 'Location')
  assert.equal(named.session?.variables.contact['name'], 'Ada')
  assert.equal(named.session?.variables.flow['guest_name'], 'Ada')
})

test('a price named before the name is answered in the prices chapter', async () => {
  const chapters = salonChapters()
  const hello = await runJourneyPreview({
    chapters,
    startChapter: 'Salon welcome',
    message: 'how much is a haircut',
    environmentLabel: 'Sandbox',
  })
  assert.match(hello.text, /What's your name\?/)
  assert.equal(hello.chapter, 'Salon welcome')

  const priced = await runJourneyPreview({
    chapters,
    startChapter: 'Salon welcome',
    message: 'Ada',
    environmentLabel: 'Sandbox',
    session: hello.session,
  })
  assert.match(priced.text, /£35/)
  assert.equal(priced.chapter, 'Services and prices')
  assert.equal(priced.text.includes("What's your name"), false)
})

test('a handoff to a chapter that is not on this map stops', async () => {
  const chapters = salonChapters().filter((chapter) => chapter.name !== 'Location')
  const hello = await runJourneyPreview({
    chapters,
    startChapter: 'Salon welcome',
    message: 'where are you',
    environmentLabel: 'Production',
  })
  const stopped = await runJourneyPreview({
    chapters,
    startChapter: 'Salon welcome',
    message: 'Ada',
    environmentLabel: 'Production',
    session: hello.session,
  })
  assert.match(stopped.text, /Location is not on this Production map\./)
  assert.equal(stopped.text.includes('Rosewood'), false)
  assert.equal(stopped.chapter, 'Salon welcome')
})
