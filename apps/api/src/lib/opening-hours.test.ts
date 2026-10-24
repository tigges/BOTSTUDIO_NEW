import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DENTAL_BLUEPRINT, draftWebsiteChat, formatWeeklyHours, hoursSentence, pageFromHtml, pickWeek } from '@botstudio/shared'
import { draftWebsiteChatWithModel } from './site-jobs.js'

const read = (text: string) => {
  const picked = pickWeek([{ text }])
  return picked ? hoursSentence(picked.best.hours) : null
}

const LAYOUTS: Array<[string, string, string]> = [
  ['colon after the day', 'Working Hours\nMonday : 8 am - 6 pm\nTuesday - Thursday : 8 am - 5 pm\nFriday : 8 am - 4 pm\nSaturday : 8 am - 1 pm\nSunday : Closed',
    'Monday 8am to 6pm. Tuesday to Thursday 8am to 5pm. Friday 8am to 4pm. Saturday 8am to 1pm. Sunday closed.'],
  ['short days, 24-hour clock', 'Opening Times\nMon–Fri 09:00–17:30\nSat 10:00–14:00\nSun Closed',
    'Monday to Friday 9am to 5:30pm. Saturday 10am to 2pm. Sunday closed.'],
  ['weekdays and weekends', 'We are open Weekdays 9am-5pm, Weekends closed.',
    'Monday to Friday 9am to 5pm. Saturday and Sunday closed.'],
  ['times before the days', 'Our team is open 9am to 5pm, Monday to Friday. Saturday 10am - 2pm.',
    'Monday to Friday 9am to 5pm. Saturday 10am to 2pm.'],
  ['a lunch break', 'Surgery hours\nMonday | 9am – 1pm, 2pm – 5:30pm\nTuesday | 9am – 1pm, 2pm – 5:30pm\nWednesday | 9am – 1pm\nThursday | 9am – 1pm, 2pm – 7pm\nFriday | 9am – 1pm, 2pm – 5pm',
    'Monday and Tuesday 9am to 5:30pm. Wednesday 9am to 1pm. Thursday 9am to 7pm. Friday 9am to 5pm.'],
  ['a table with dotted times', 'Day | Hours\nMonday | 8.30am - 5.30pm\nTuesday | 8.30am - 5.30pm\nWednesday | 8.30am - 5.30pm\nThursday | 8.30am - 8pm\nFriday | 8.30am - 5pm\nSaturday | Closed\nSunday | Closed',
    'Monday to Wednesday 8:30am to 5:30pm. Thursday 8:30am to 8pm. Friday 8:30am to 5pm. Saturday and Sunday closed.'],
  ['day and time on separate lines', 'Opening hours\nMonday\n9:00 am – 5:00 pm\nTuesday\n9:00 am – 5:00 pm\nWednesday\n9:00 am – 5:00 pm\nThursday\n9:00 am – 5:00 pm\nFriday\n9:00 am – 5:00 pm',
    'Monday to Friday 9am to 5pm.'],
  ['seven days a week', 'Open 7 days a week 10am - 10pm', 'Monday to Sunday 10am to 10pm.'],
  ['daily and noon', 'Hours: Daily 12 noon - 11pm', 'Monday to Sunday 12pm to 11pm.'],
  ['a.m. and p.m.', 'Mon - Fri 8 a.m. to 6 p.m., Sat 9 a.m. to 12 noon', 'Monday to Friday 8am to 6pm. Saturday 9am to 12pm.'],
  ['no am or pm', 'Opening hours Mon-Thu 9-5.30 Fri 9-4', 'Monday to Thursday 9am to 5:30pm. Friday 9am to 4pm.'],
  ['until and till', 'Tuesday to Thursday 8.30am until 5pm, Friday 8.30am till 3pm, Monday closed',
    'Tuesday to Thursday 8:30am to 5pm. Friday 8:30am to 3pm. Monday closed.'],
  ['lists of days', 'Mon, Wed & Fri: 9am - 6pm\nTue & Thu: 10am - 8pm\nSat/Sun: closed',
    'Monday 9am to 6pm. Tuesday 10am to 8pm. Wednesday 9am to 6pm. Thursday 10am to 8pm. Friday 9am to 6pm. Saturday and Sunday closed.'],
  ['one day under a heading', 'Opening hours: Saturday 10am - 2pm', 'Saturday 10am to 2pm.'],
]

for (const [layout, text, expected] of LAYOUTS) {
  test(`opening hours read from any layout: ${layout}`, () => {
    assert.equal(read(text), expected)
  })
}

test('one day mentioned in passing is not the opening hours', () => {
  assert.equal(read('Join us Saturday 10am-2pm for our open day! Bring the kids.'), null)
  assert.equal(read('Results in 3 - 4 weeks. Our monthly newsletter.'), null)
})

test('the week a site repeats wins over one page that differs', () => {
  const footer = (monday: string) => `Opening hours Mon ${monday} Tue-Fri 9am-5pm Sat closed`
  const picked = pickWeek([{ text: footer('9am-5pm') }, { text: footer('9am-7pm') }, { text: footer('9am-5pm') }])
  assert.equal(hoursSentence(picked!.best.hours), 'Monday to Friday 9am to 5pm. Saturday closed.')
  assert.equal(hoursSentence(picked!.other!.hours), 'Monday 9am to 7pm. Tuesday to Friday 9am to 5pm. Saturday closed.')
})

test('a "this week" widget filled in by a script, on every page, does not hide the full week on one page', () => {
  const widget = 'Market opening times this week\nMonday\nClosed\nTuesday\n–\nWednesday\n–\nThursday\n–\nFriday\n–\nSaturday\n–\nSunday\n–'
  const pages = [
    { text: `${widget}\nVisit us\nOpening hours\nMonday\nClosed\nTuesday – Friday\n10am – 5pm\nSaturday\n9am – 5pm\nSunday\n10am – 4pm` },
    ...Array.from({ length: 9 }, () => ({ text: `${widget}\nOur story` })),
  ]
  assert.equal(hoursSentence(pickWeek(pages)!.best.hours), 'Tuesday to Friday 10am to 5pm. Saturday 9am to 5pm. Sunday 10am to 4pm. Monday closed.')
  assert.equal(pickWeek(pages.slice(1)), null)
})

const JSON_LD = (data: object) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`

test('hours a site declares for search engines are read when the page text shows none', () => {
  const specification = pageFromHtml('https://gallery.example/', `<html><head>${JSON_LD({
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'Museum',
      openingHoursSpecification: [
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['https://schema.org/Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '10:00:00', closes: '18:00:00' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '00:00', closes: '00:00' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Saturday', opens: '10:00', closes: '14:00', validFrom: '2026-12-24', validThrough: '2026-12-24' },
      ],
    }],
  })}</head><body><p>Today's opening times</p><div id="hours-widget"></div></body></html>`)
  assert.equal(read(specification.text), null)
  assert.equal(hoursSentence(pickWeek([specification])!.best.hours), 'Tuesday to Sunday 10am to 6pm. Monday closed.')

  const text = pageFromHtml('https://cafe.example/', `<html><head>${JSON_LD({ '@type': 'CafeOrCoffeeShop', openingHours: 'Mo-Fr 07:30-17:00, Sa,Su 09:00-15:00' })}</head><body></body></html>`)
  assert.equal(hoursSentence(pickWeek([text])!.best.hours), 'Monday to Friday 7:30am to 5pm. Saturday and Sunday 9am to 3pm.')

  const microdata = pageFromHtml('https://garage.example/', '<div itemscope itemtype="https://schema.org/AutoRepair"><meta itemprop="openingHours" content="Mo-Sa 08:00-18:00"></div>')
  assert.equal(hoursSentence(pickWeek([microdata])!.best.hours), 'Monday to Saturday 8am to 6pm.')

  const allDay = pageFromHtml('https://locksmith.example/', `<html><head>${JSON_LD({ '@type': 'Locksmith', openingHours: ['Mo-Su'] })}</head></html>`)
  assert.equal(hoursSentence(pickWeek([allDay])!.best.hours), 'Monday to Sunday open all day.')

  const both = pageFromHtml('https://cafe.example/', `<html><head>${JSON_LD({ openingHours: 'Mo-Fr 07:30-17:00' })}</head><body><p>Opening hours: Monday to Friday 8am - 4pm</p></body></html>`)
  assert.equal(hoursSentence(pickWeek([both])!.best.hours), 'Monday to Friday 8am to 4pm.')
})

const SITE_WITHOUT_HEADING = (body: string) => `<html><head><title>Northfield Physio</title></head><body>
<p>Northfield Physio treats back pain, sports injuries and joint problems. Book a physiotherapy assessment online.</p>
<p>14 Mill Lane, Leeds LS1 4AB</p>
<table><tr><td>Mon – Fri</td><td>08:00 – 19:00</td></tr><tr><td>Saturday</td><td>9.00am – 12 noon</td></tr><tr><td>Sunday</td><td>Closed</td></tr></table>
${body}</body></html>`
const WEEK = 'Monday to Friday 8am to 7pm. Saturday 9am to 12pm. Sunday closed.'

test('every import path finds hours with no heading, in a table, in any business', async () => {
  const page = pageFromHtml('https://northfield.example/', SITE_WITHOUT_HEADING(''))

  const fromPages = draftWebsiteChat({ pages: [page], companyName: 'Northfield Physio' })
  assert.deepEqual(fromPages.facts.find((fact) => fact.label === 'Hours'), { label: 'Hours', text: WEEK })

  const fromModel = await draftWebsiteChatWithModel({
    pages: [page],
    companyName: 'Northfield Physio',
    complete: async () => JSON.stringify({ jobs: [{ name: 'Treatments', phrases: ['treatments'], answer: 'Northfield Physio treats back pain, sports injuries and joint problems.' }] }),
  })
  assert.deepEqual(fromModel.facts.find((fact) => fact.label === 'Hours'), { label: 'Hours', text: WEEK })

  const mentioned = pageFromHtml('https://market.example/visit-us/', SITE_WITHOUT_HEADING('<p>Opening times, travel instructions and maps: everything you need for your visit.</p>'))
  const withMention = draftWebsiteChat({ pages: [mentioned], companyName: 'Northfield Market' })
  assert.deepEqual(withMention.facts.find((fact) => fact.label === 'Hours'), { label: 'Hours', text: WEEK })

  const salon = pageFromHtml('https://studio.example/', SITE_WITHOUT_HEADING('<p>Studio Nine is a hair salon. Our stylists cut, colour and style hair.</p>'))
  const salonDraft = draftWebsiteChat({ pages: [salon], companyName: 'Studio Nine' })
  assert.equal(salonDraft.doors.find((door) => door.title === 'Hours')?.blurb, WEEK)

  const profile = DENTAL_BLUEPRINT.extract([page], '2026-10-24T19:00:00.000Z')
  assert.equal(profile.fields.hours?.status, 'found')
  assert.equal(formatWeeklyHours(profile.fields.hours!.value as never), 'Monday to Friday 8am to 7pm; Saturday 9am to 12pm; closed on Sunday.')
})
