import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine, type FlowGraph } from '@ybot/runtime'
import type { ExecutionServices, Session } from '@ybot/runtime'
import { draftWebsiteChat, inspectFlowGraph, pageFromHtml } from '@ybot/shared'
import { chooseShopHomes, chooseSitePages } from '@ybot/shared'
import {
  answerGrounded,
  chooseShopHomesWithModel,
  chooseSitePagesWithModel,
  cloudLlmComplete,
  draftSiteSpecWithModel,
  draftWebsiteChatWithModel,
  importProviders,
  jobsFromModelPages,
  pageTextsWithoutChrome,
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

function session(text: string): Session {
  return {
    id: 's1',
    conversationId: 'c1',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId: 'start',
    variables: { flow: { _last_user_message: text }, global: {}, contact: { name: 'Ada' } },
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function simPages() {
  const home = pageFromHtml(
    'https://www.vodafone.com/',
    `<html><head><title>Vodafone</title></head><body>
      <h1>Welcome to Vodafone</h1>
      <p>As one of the largest telcos in Europe and Africa, Vodafone's mission is to connect everyone.</p>
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

const vodafoneLinks = [
  { href: 'https://www.vodafone.co.uk/sim-only/best-sim-only-deals', text: 'SIM only' },
  { href: 'https://www.vodafone.co.uk/mobile/pay-monthly-contracts', text: 'Pay monthly' },
  { href: 'https://www.vodafone.co.uk/help', text: 'Help' },
  { href: 'https://www.vodafone.co.uk/about', text: 'About us' },
  { href: 'https://www.vodafone.co.uk/careers', text: 'Careers' },
  { href: 'https://www.vodafone.co.uk/contact', text: 'Contact' },
  { href: 'https://www.vodafone.co.uk/our-impact', text: 'Our impact' },
]

test('a menu repeated on every page does not crowd out what each page says', () => {
  const menu = 'Skip to main content Phones and devices Pay monthly phones Pay as you go phones Refurbished phones iPads and Tablets Smartwatches Laptops Accessories Upgrade Trade in Check coverage'
  const page = (url: string, body: string) => pageFromHtml(url, `<html><head><title>Vodafone</title></head><body><p>${menu}</p><p>${body}</p></body></html>`)
  const texts = pageTextsWithoutChrome([
    page('https://www.vodafone.co.uk/', 'The UK network with 5G in more places than any other.'),
    page('https://www.vodafone.co.uk/sim-only', 'Unlimited data and EU roaming just £26 a month on a SIM only plan.'),
    page('https://www.vodafone.co.uk/broadband', 'Full fibre broadband from £24 a month with no upfront fees.'),
  ])
  assert.match(texts[0]!, /^The UK network with 5G/)
  assert.match(texts[0]!, /Smartwatches/)
  assert.match(texts[1]!, /£26 a month/)
  assert.match(texts[2]!, /£24 a month/)
  assert.equal(/Smartwatches|Check coverage/.test(`${texts[1]} ${texts[2]}`), false)
  assert.deepEqual(pageTextsWithoutChrome([page('https://www.vodafone.co.uk/', 'Only page.')]), [`Vodafone ${menu} Only page.`])
})

test('an answer is grounded only when the pages stated it', () => {
  const blob = 'unlimited data and eu roaming just £26 a month on a sim only plan.'
  assert.equal(answerGrounded('Unlimited data and EU roaming just £26 a month on a SIM only plan.', blob), true)
  assert.equal(
    answerGrounded('Our Free plan is £100 a month and Plus is £10 with a sandbox and credit-card seats.', blob),
    false,
  )
  assert.equal(answerGrounded('too short', blob), false)
})

test('model jobs keep page copy and drop 404s and invented prices', async () => {
  const { pages } = simPages()
  const jobs = await jobsFromModelPages(pages, async () => JSON.stringify({
    jobs: [
      {
        name: 'Page not found',
        phrases: ['404'],
        answer: "You've come to a page of the Vodafone website that doesn't exist. Try the homepage or search.",
      },
      {
        name: 'Plans',
        phrases: ['plans', 'sim only', 'pay monthly'],
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
  assert.equal(/page not found|doesn't exist|Starter Professional|credit-card/i.test(jobs!.map((job) => job.answer).join('\n')), false)
})

test('a fenced JSON payload still becomes a plans chapter that can answer', async () => {
  const { pages } = simPages()
  const draft = await draftWebsiteChatWithModel({
    pages,
    companyName: 'Vodafone',
    personaName: 'Voda',
    complete: async () => `\`\`\`json
{"jobs":[{"name":"Plans","phrases":["plans","sim only"],"answer":"Unlimited data and EU roaming just £26 a month on a SIM only plan."}]}
\`\`\``,
  })
  assert.equal(draft.greeting, "Hi, I'm Voda at Vodafone.")
  assert.match(draft.note, /assistant drafted the map/i)
  const plans = draft.doors.find((door) => /^plans?/i.test(door.flowName) || /^plans?/i.test(door.title))
  assert.ok(plans)
  assert.equal(plans!.phrases.includes('plans'), true)
  assert.match(plans!.answer, /£26 a month/)
  assert.ok(draft.doors.some((door) => door.flowName === 'Talk to a person'))
  assert.equal(draft.doors.some((door) => /page not found/i.test(`${door.flowName} ${door.title} ${door.answer}`)), false)
  const welcome = JSON.stringify(draft.flows.find((flow) => /welcome/i.test(flow.name))?.graph ?? {})
  assert.match(welcome, /"plans"/)
  const planFlow = draft.flows.find((flow) => flow.name === plans!.flowName)
  assert.ok(planFlow)
  const machine = new SessionMachine({ llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices)
  const spoken = await machine.run(session('plans'), planFlow!.graph as unknown as FlowGraph, 'plans')
  assert.match(spoken.newMessages.map((message) => message.content.text).join('\n'), /SIM only|£26/)
  const names = draft.flows.map((flow) => flow.name)
  for (const flow of draft.flows) {
    const issues = inspectFlowGraph(flow.graph as Parameters<typeof inspectFlowGraph>[0], { flowNames: names })
    assert.deepEqual(issues.filter((issue) => issue.level === 'block' || issue.level === 'repair'), [], flow.name)
  }
})

test('invented jobs fall back to the page compiler', async () => {
  const { home } = simPages()
  const regex = draftWebsiteChat({ pages: [home], companyName: 'Vodafone', personaName: 'Voda' })
  const draft = await draftWebsiteChatWithModel({
    pages: [home],
    companyName: 'Vodafone',
    personaName: 'Voda',
    complete: async () => JSON.stringify({
      jobs: [{
        name: 'Pricing',
        phrases: ['pricing', 'plans'],
        answer: 'Starter Professional and Enterprise seats include a sandbox and a credit-card checkout at £81.',
      }],
    }),
  })
  assert.deepEqual(draft.doors.map((door) => door.flowName), regex.doors.map((door) => door.flowName))
  assert.equal(/Starter Professional|credit-card checkout/i.test(draft.doors.map((door) => door.answer).join('\n')), false)
  assert.equal(draft.doors.some((door) => /^plans?/i.test(door.flowName)), false)
})

test('a thrown complete() uses the regex map', async () => {
  const { pages } = simPages()
  const regex = draftWebsiteChat({ pages, companyName: 'Vodafone', personaName: 'Voda' })
  const draft = await draftWebsiteChatWithModel({
    pages,
    companyName: 'Vodafone',
    personaName: 'Voda',
    complete: async () => {
      throw new Error('import model timed out')
    },
  })
  assert.deepEqual(draft.doors.map((door) => door.flowName), regex.doors.map((door) => door.flowName))
})

test('the draft says whether the model drafted it, and why not', async () => {
  const { pages } = simPages()
  const reasons: Array<{ by: string; why: string }> = []
  const draft = (complete: (() => Promise<string>) | null) => draftWebsiteChatWithModel({
    pages,
    companyName: 'Vodafone',
    personaName: 'Voda',
    complete,
    report: (report) => reasons.push(report),
  })
  await draft(async () => JSON.stringify({ jobs: [{ name: 'Plans', phrases: ['plans'], answer: 'Unlimited data and EU roaming just £26 a month on a SIM only plan.' }] }))
  await draft(async () => { throw new Error('Groq error 429: {"error":{"message":"Rate limit reached"}}') })
  await draft(async () => { throw new Error('import model timed out') })
  await draft(async () => 'Sorry, I cannot help with that.')
  await draft(async () => JSON.stringify({ jobs: [{ name: 'Pricing', phrases: ['pricing'], answer: 'Starter Professional and Enterprise seats include a sandbox at £81 a seat.' }] }))
  const yuzu = await draftWebsiteChatWithModel({
    pages: [pageFromHtml('https://yuzu.hair/', YUZU)],
    companyName: 'Yuzu',
    complete: async () => '{}',
    report: (report) => reasons.push(report),
  })
  assert.equal(yuzu.clusterId, 'hair')
  assert.deepEqual(reasons.map((reason) => reason.by), ['model', 'pages', 'pages', 'pages', 'pages', 'pages'])
  assert.match(reasons[0]!.why, /drafted 1 topic from/)
  assert.match(reasons[1]!.why, /rate limited \(HTTP 429\)/)
  assert.match(reasons[2]!.why, /longer than 45 seconds/)
  assert.match(reasons[3]!.why, /without any topics/)
  assert.match(reasons[4]!.why, /none matched what the pages state/)
  assert.match(reasons[5]!.why, /salon map/)
})

test('a retired Groq model hands the import to the next key, and the reason names the model', async () => {
  const realFetch = globalThis.fetch
  const asked: string[] = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url)
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
    asked.push(`${new URL(href).host} ${body.model}`)
    if (href.includes('groq')) {
      return new Response('{"error":{"message":"The model does not exist","code":"model_not_found"}}', { status: 404 })
    }
    return new Response(JSON.stringify({
      content: [{ text: '{"jobs":[{"name":"Plans","phrases":["plans"],"answer":"Unlimited data and EU roaming just £26 a month on a SIM only plan."}]}' }],
      model: body.model,
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200 })
  }) as typeof fetch
  try {
    const env = { GROQ_API_KEY: 'g', GROQ_MODEL: 'llama-retired', ANTHROPIC_API_KEY: 'a' }
    assert.deepEqual(importProviders(env).map((provider) => `${provider.name} ${provider.model}`), ['Groq llama-retired', 'Anthropic claude-sonnet-4-5'])
    const chained = cloudLlmComplete(5_000, env)!
    const reports: Array<{ by: string; why: string }> = []
    const draft = await draftWebsiteChatWithModel({
      pages: simPages().pages,
      companyName: 'Vodafone',
      personaName: 'Voda',
      complete: chained,
      report: (report) => reports.push(report),
    })
    assert.deepEqual(asked, ['api.groq.com llama-retired', 'api.anthropic.com claude-sonnet-4-5'])
    assert.equal(chained.answeredBy, 'Anthropic')
    assert.deepEqual(reports, [{ by: 'model', why: 'Anthropic drafted 1 topic from the pages.' }])
    assert.ok(draft.doors.some((door) => /£26 a month/.test(door.answer)))

    const groqOnly = cloudLlmComplete(5_000, { GROQ_API_KEY: 'g', GROQ_MODEL: 'llama-retired' })!
    const failed: Array<{ by: string; why: string }> = []
    await draftWebsiteChatWithModel({ pages: simPages().pages, companyName: 'Vodafone', complete: groqOnly, report: (report) => failed.push(report) })
    assert.equal(failed[0]?.by, 'pages')
    assert.equal(failed[0]?.why, 'Groq has no model called llama-retired (HTTP 404). Set GROQ_MODEL on the API to a current model.')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('no complete() uses the regex map', async () => {
  const { pages } = simPages()
  const regex = draftWebsiteChat({ pages, companyName: 'Vodafone', personaName: 'Voda' })
  const draft = await draftWebsiteChatWithModel({
    pages,
    companyName: 'Vodafone',
    personaName: 'Voda',
    complete: null,
  })
  assert.deepEqual(draft.doors.map((door) => door.flowName), regex.doors.map((door) => door.flowName))
})

test('page picking keeps model urls that were on the site, and drops invented ones', async () => {
  const picked = await chooseSitePagesWithModel({
    homeUrl: 'https://www.vodafone.co.uk/',
    links: vodafoneLinks,
    limit: 2,
    complete: async () => JSON.stringify({
      urls: [
        'https://www.vodafone.co.uk/contact',
        'https://evil.example/phishing',
        'https://www.vodafone.co.uk/help',
      ],
    }),
  })
  assert.deepEqual(picked, [
    'https://www.vodafone.co.uk/contact',
    'https://www.vodafone.co.uk/help',
  ])
})

test('page picking falls back to regex order when the model fails', async () => {
  const ranked = chooseSitePages({
    homeUrl: 'https://www.vodafone.co.uk/',
    links: vodafoneLinks,
    limit: 2,
  })
  const thrown = await chooseSitePagesWithModel({
    homeUrl: 'https://www.vodafone.co.uk/',
    links: vodafoneLinks,
    limit: 2,
    complete: async () => {
      throw new Error('import model timed out')
    },
  })
  const silent = await chooseSitePagesWithModel({
    homeUrl: 'https://www.vodafone.co.uk/',
    links: vodafoneLinks,
    limit: 2,
    complete: null,
  })
  assert.deepEqual(thrown, ranked)
  assert.deepEqual(silent, ranked)
})

test('shop picking keeps a listed country shop and drops a made-up host', async () => {
  const links = [
    { href: 'https://www.vodafone.de/', text: 'Deutschland' },
    { href: 'https://www.vodafone.co.uk/', text: 'United Kingdom' },
    { href: 'https://www.vodafone.es/', text: 'España' },
  ]
  const picked = await chooseShopHomesWithModel({
    homeUrl: 'https://www.vodafone.com/',
    links,
    limit: 1,
    complete: async () => JSON.stringify({
      urls: ['https://www.vodafone.de/', 'https://shops.example/'],
    }),
  })
  assert.deepEqual(picked, ['https://www.vodafone.de/'])
  const regex = chooseShopHomes({ homeUrl: 'https://www.vodafone.com/', links, limit: 1 })
  const silent = await chooseShopHomesWithModel({
    homeUrl: 'https://www.vodafone.com/',
    links,
    limit: 1,
    complete: null,
  })
  assert.deepEqual(silent, regex)
  assert.deepEqual(regex, ['https://www.vodafone.co.uk/'])
})

test('a hair studio keeps the authored salon walk even when a model replies', async () => {
  const page = pageFromHtml('https://yuzu.hair/', YUZU)
  const draft = await draftWebsiteChatWithModel({
    pages: [page],
    companyName: 'Yuzu',
    personaName: 'Bella',
    complete: async () => JSON.stringify({
      jobs: [{
        name: 'Invented',
        phrases: ['invented'],
        answer: 'Ladies wash, cut and style from £58 with a stylist, £87 with a senior. Kids from £29.',
      }],
    }),
  })
  assert.equal(draft.clusterId, 'hair')
  assert.equal(draft.greeting, "Hi, I'm Bella at Yuzu. What's your name?")
  assert.deepEqual(draft.doors.map((door) => door.title), ['Where we are', 'Hours', 'Services', 'Book'])
  assert.equal(draft.doors.some((door) => door.flowName === 'Invented'), false)
  assert.equal(/£\s*\d/.test(draft.doors[2]!.answer), false)
})

test('a saved template from jobs leaves brand names off', async () => {
  const page = pageFromHtml(
    'https://www.cevro.ai/',
    `<html><head><title>Cevro AI</title></head><body>
      <h1>The AI Player Support Platform Built for iGaming</h1>
      <p>Cevro deploys AI agents that handle player queries end-to-end across bonuses, KYC, payments, RG.</p>
      <p>Book a demo with our team to see how Cevro can help.</p>
    </body></html>`,
  )
  const spec = await draftSiteSpecWithModel({
    pages: [page],
    companyName: 'Northwind',
    complete: async () => JSON.stringify({
      jobs: [{
        name: 'Player support',
        phrases: ['support', 'kyc'],
        answer: 'Cevro deploys AI agents that handle player queries end-to-end across bonuses, KYC, payments, RG.',
      }],
    }),
  })
  assert.equal(/Cevro/i.test(JSON.stringify(spec.topics)), false)
  assert.ok(spec.topics.some((topic) => /AI agents|player queries/i.test(topic.answer)))
  assert.ok(spec.topics.some((topic) => topic.flowName === 'Talk to a person'))
  assert.match(spec.body, /assistant drafted the map/i)
})
