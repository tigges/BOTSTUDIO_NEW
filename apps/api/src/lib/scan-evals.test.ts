/**
 * Pin evals for website import. Freeze HTML plus the jobs a guest should get.
 * Recreate HubSpot / BBC / Vodafone only after this file is green.
 * Live Bella and Yuzu stay as they are.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { draftWebsiteChat, pageFromHtml } from '@botstudio/shared'
import {
  draftWebsiteChatWithModel,
  jobsFromModelPages,
} from './site-jobs.js'

const YUZU = `<!doctype html>
<html><head><title>Yuzu Hair &amp; Beauty | Japanese hair salon, Ealing Broadway</title></head>
<body>
<p>Ladies wash, cut and style from £58 with a stylist, £87 with a senior. Kids from £29.</p>
<p>Colour Roots, full head and Illumina colouring. Colour guests need a patch test at least 48 hours before. From £75</p>
<p>Yuzu Hair &amp; Beauty works at 5 Dickens Yard, Longfield Avenue, Ealing, W5 2TD. Open Tuesday to Friday 10am to 8pm and Saturday 9am to 6pm. Monday and Sunday closed.</p>
<p>Contact 5 Dickens Yard Longfield Avenue Ealing, W5 2TD 020 8840 2244 info@yuzuhairandbeauty.co.uk</p>
<p>Please complete a patch test at least 48 hours before your appointment.</p>
<a href="https://www.phorest.com/salon/yuzuhairandbeauty">Book your appointment</a>
</body></html>`

function spoken(draft: { doors: Array<{ flowName: string; title: string; answer: string }> }): string {
  return draft.doors.map((door) => `${door.flowName} ${door.title} ${door.answer}`).join('\n')
}

function vodafonePages() {
  const home = pageFromHtml(
    'https://www.vodafone.co.uk/',
    `<html><head><title>Vodafone on The Nation's Network</title></head><body>
      <p>Switching to us is easy and we'll help you at every step.</p>
      <p>Phones, SIM only and broadband on the UK network.</p>
    </body></html>`,
  )
  const missing = pageFromHtml(
    'https://www.vodafone.com/plans',
    `<html><head><title>Page not found</title></head><body>
      <p>You've come to a page of the Vodafone website that doesn't exist. Try the homepage or search.</p>
    </body></html>`,
  )
  const sim = pageFromHtml(
    'https://www.vodafone.co.uk/sim-only/best-sim-only-deals',
    `<html><head><title>Best SIM Only Deals</title></head><body>
      <p>Unlimited Extra Plus £10 Stay Free at £100</p>
      <p>Unlimited data and EU roaming just £26 a month on a SIM only plan.</p>
      <p>All our pay monthly SIM only plans come with 5G as standard across the UK.</p>
    </body></html>`,
  )
  return { home, missing, sim, pages: [home, missing, sim] }
}

function bbcPages() {
  const home = pageFromHtml(
    'https://www.bbc.co.uk/',
    `<html><head><title>BBC - Home</title></head><body>
      <p>The BBC is not responsible for the content of external sites.</p>
      <p>Disorder broke out in cities across the country on a day in which more than half a million joined cost of living protests.</p>
      <p>The BBC is the world's leading public service broadcaster. We inform, educate and entertain.</p>
    </body></html>`,
  )
  const sport = pageFromHtml(
    'https://www.bbc.co.uk/sport',
    `<html><head><title>Sport</title></head><body>
      <p>WBO champion Daniel Dubois underlines his status as Britain's leading heavyweight with a devastating second-round stoppage of Fabio Wardley.</p>
      <p>Follow live boxing scores, fixtures, results and the latest fight news from around the world.</p>
    </body></html>`,
  )
  const access = pageFromHtml(
    'https://www.bbc.co.uk/accessibility',
    `<html><head><title>Accessibility</title></head><body>
      <p>The BBC is not responsible for the content of external sites.</p>
    </body></html>`,
  )
  const complaints = pageFromHtml(
    'https://www.bbc.co.uk/contact/complaints',
    `<html><head><title>Complaints</title></head><body>
      <p>If you would like to understand how we collect and use personal data, please refer to our privacy notice.</p>
    </body></html>`,
  )
  const contact = pageFromHtml(
    'https://www.bbc.co.uk/contact',
    `<html><head><title>Contact Home</title></head><body>
      <p>Choose from these areas for information or help about our programmes and services.</p>
    </body></html>`,
  )
  return { home, sport, access, complaints, contact, pages: [home, sport, access, complaints, contact] }
}

function hubspotPages() {
  const home = pageFromHtml(
    'https://www.hubspot.com/',
    `<html><head><title>HubSpot | Software</title></head><body>
      <p>See all app integrations Case Studies See all case studies a11y text suffix Remarkable results.</p>
      <p>After just one year, the CRM customers acquire 129% more leads, close 36% more deals.</p>
      <p>Contacts, companies, and deals live on one customer record, so every team sees the same history.</p>
    </body></html>`,
  )
  const pricing = pageFromHtml(
    'https://www.hubspot.com/pricing',
    `<html><head><title>Pricing</title></head><body>
      <p>HubSpot CRM pipeline marketing automation</p>
      <h2>Free</h2><p>No credit card required</p><p>£0/mo</p>
      <h2>Starter</h2><p>£7/mo/seat</p>
      <p>Email and in-app chat support. Keep your CRM up to date with AI.</p>
    </body></html>`,
  )
  return { home, pricing, pages: [home, pricing] }
}

test('yuzu.hair stays on the authored salon walk, even if a model invents jobs', async () => {
  const page = pageFromHtml('https://yuzu.hair/', YUZU)
  const draft = await draftWebsiteChatWithModel({
    pages: [page],
    companyName: 'Yuzu',
    personaName: 'Bella',
    complete: async () => JSON.stringify({
      jobs: [{
        name: 'Plans',
        phrases: ['plans'],
        answer: 'Ladies wash, cut and style from £58 with a stylist, £87 with a senior. Kids from £29.',
      }],
    }),
  })
  assert.equal(draft.clusterId, 'hair')
  assert.equal(draft.greeting, "Hi, I'm Bella at Yuzu. What's your name?")
  assert.deepEqual(draft.doors.map((door) => door.title), ['Where we are', 'Hours', 'Services', 'Book'])
  assert.equal(draft.doors.some((door) => /^plans?/i.test(door.flowName)), false)
  assert.match(draft.doors[0]!.answer, /5 Dickens Yard/)
  assert.equal(/£\s*\d/.test(draft.doors[2]!.answer), false)
})

test('Vodafone jobs keep the SIM price and drop 404s, switching slogans, and invented SaaS', async () => {
  const { pages } = vodafonePages()
  const jobs = await jobsFromModelPages(pages, async () => JSON.stringify({
    jobs: [
      {
        name: 'Page not found',
        phrases: ['404'],
        answer: "You've come to a page of the Vodafone website that doesn't exist. Try the homepage or search.",
      },
      {
        name: 'What we do',
        phrases: ['what we do', 'switching'],
        answer: "Switching to us is easy and we'll help you at every step.",
      },
      {
        name: 'Plans',
        phrases: ['plans', 'sim only'],
        answer: 'Unlimited data and EU roaming just £26 a month on a SIM only plan.',
      },
      {
        name: 'Pricing',
        phrases: ['pricing'],
        answer: 'Starter Professional and Enterprise seats include a sandbox and a credit-card checkout at £81.',
      },
    ],
  }))
  assert.ok(jobs)
  assert.deepEqual(jobs!.map((job) => job.flowName), ['Plans'])
  assert.match(jobs![0]!.answer, /£26 a month/)

  const draft = await draftWebsiteChatWithModel({
    pages,
    companyName: 'Vodafone',
    personaName: 'Voda',
    complete: async () => JSON.stringify({
      jobs: [
        { name: 'What we do', phrases: ['switching'], answer: "Switching to us is easy and we'll help you at every step." },
        { name: 'Plans', phrases: ['plans', 'sim only'], answer: 'Unlimited data and EU roaming just £26 a month on a SIM only plan.' },
      ],
    }),
  })
  const text = spoken(draft)
  assert.match(text, /£26 a month/)
  assert.equal(/switching to us is easy|help you at every step|page not found|credit-card/i.test(text), false)
  assert.ok(draft.doors.some((door) => /^plans?/i.test(door.flowName) || /^plans?/i.test(door.title)))
  assert.ok(draft.doors.some((door) => door.flowName === 'Talk to a person'))
})

test('BBC jobs drop fight recaps, disclaimers, and privacy-notice stand-ins even when they were on the page', async () => {
  const { pages, contact } = bbcPages()
  const jobs = await jobsFromModelPages(pages, async () => JSON.stringify({
    jobs: [
      {
        name: 'Sport',
        phrases: ['sport', 'boxing'],
        answer: "WBO champion Daniel Dubois underlines his status as Britain's leading heavyweight with a devastating second-round stoppage of Fabio Wardley.",
      },
      {
        name: 'Home',
        phrases: ['home'],
        answer: 'The BBC is not responsible for the content of external sites.',
      },
      {
        name: 'Accessibility',
        phrases: ['accessibility'],
        answer: 'The BBC is not responsible for the content of external sites.',
      },
      {
        name: 'Complaints',
        phrases: ['complaints'],
        answer: 'If you would like to understand how we collect and use personal data, please refer to our privacy notice.',
      },
      {
        name: 'Contact',
        phrases: ['contact'],
        answer: 'Choose from these areas for information or help about our programmes and services.',
      },
    ],
  }))
  assert.ok(jobs)
  assert.deepEqual(jobs!.map((job) => job.flowName), ['Contact'])
  assert.match(jobs![0]!.answer, /programmes and services/)

  const draft = await draftWebsiteChatWithModel({
    pages,
    companyName: 'BBC',
    personaName: 'Bella',
    complete: async () => JSON.stringify({
      jobs: [{
        name: 'Contact',
        phrases: ['contact'],
        answer: 'Choose from these areas for information or help about our programmes and services.',
      }],
    }),
  })
  const text = spoken(draft)
  assert.equal(/Daniel Dubois|second-round stoppage|not responsible for the content of external sites|privacy notice|disorder broke out/i.test(text), false)
  assert.equal(draft.doors.some((door) => /^sport$/i.test(door.flowName) || /^accessibility$/i.test(door.flowName)), false)
  assert.ok(draft.doors.some((door) => /contact/i.test(door.flowName)))
  assert.ok(draft.doors.some((door) => door.flowName === 'Talk to a person'))
  assert.equal(contact.text.includes('programmes and services'), true)
})

test('HubSpot jobs keep CRM copy and drop a11y chrome and campaign stats', async () => {
  const { pages } = hubspotPages()
  const jobs = await jobsFromModelPages(pages, async () => JSON.stringify({
    jobs: [
      {
        name: 'Integrations',
        phrases: ['integrations'],
        answer: 'See all app integrations Case Studies See all case studies a11y text suffix Remarkable results.',
      },
      {
        name: 'Results',
        phrases: ['results'],
        answer: 'After just one year, the CRM customers acquire 129% more leads, close 36% more deals.',
      },
      {
        name: 'The customer record',
        phrases: ['contacts', 'crm'],
        answer: 'Contacts, companies, and deals live on one customer record, so every team sees the same history.',
      },
      {
        name: 'Plans',
        phrases: ['plans', 'pricing'],
        answer: 'Free is £0 a month. Starter is £7 a month per seat with email and in-app chat support.',
      },
    ],
  }))
  assert.ok(jobs)
  assert.deepEqual(jobs!.map((job) => job.flowName), ['The customer record', 'Plans'])
  assert.match(jobs!.map((job) => job.answer).join('\n'), /one customer record/)
  assert.match(jobs!.map((job) => job.answer).join('\n'), /£0 a month/)
  assert.equal(/a11y|129% more leads/i.test(jobs!.map((job) => job.answer).join('\n')), false)
})

test('a silent model still uses the regex map, which already passes these sites', async () => {
  const yuzu = draftWebsiteChat({
    pages: [pageFromHtml('https://yuzu.hair/', YUZU)],
    companyName: 'Yuzu',
    personaName: 'Bella',
  })
  assert.deepEqual(yuzu.doors.map((door) => door.title), ['Where we are', 'Hours', 'Services', 'Book'])

  const vodafone = await draftWebsiteChatWithModel({
    pages: vodafonePages().pages,
    companyName: 'Vodafone',
    personaName: 'Voda',
    complete: null,
  })
  assert.ok(vodafone.doors.some((door) => /^plans?/i.test(door.flowName) || /^plans?/i.test(door.title)))
  assert.match(spoken(vodafone), /£26 a month/)
  assert.equal(/switching to us is easy/i.test(spoken(vodafone)), false)

  const bbc = await draftWebsiteChatWithModel({
    pages: bbcPages().pages,
    companyName: 'BBC',
    personaName: 'Bella',
    complete: null,
  })
  assert.equal(/Daniel Dubois|privacy notice|not responsible for the content of external sites/i.test(spoken(bbc)), false)
})
