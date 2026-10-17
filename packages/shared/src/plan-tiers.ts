/**
 * SaaS pricing pages (Free / Starter / Professional / Enterprise) become
 * plan doors. Brand names stay off. Hair price lists use website-scan instead.
 */

export interface PlanTier {
  name: string
  price: string
  blurb: string
  phrases: string[]
}

/** Abstracted from a typical CRM pricing grid — Free, Starter, Professional, Enterprise. */
export const CRM_PLAN_TIERS: PlanTier[] = [
  {
    name: 'Free',
    price: '£0 a month',
    blurb: 'No card. AI help across the CRM, one view of contacts, companies, automations, and deals.',
    phrases: ['free', 'free plan', 'get started free', 'no credit card'],
  },
  {
    name: 'Starter',
    price: '£7 a month per seat',
    blurb: 'Everything in Free, plus email and in-app chat, and AI that keeps the record up to date.',
    phrases: ['starter', 'starter plan'],
  },
  {
    name: 'Professional',
    price: '£81 a month per seat',
    blurb: 'For teams already running marketing, sales, and service together. A sandbox, and who can see which data.',
    phrases: ['professional', 'pro', 'professional plan'],
  },
  {
    name: 'Enterprise',
    price: '£155 a month per seat',
    blurb: 'The full set for larger teams: marketing email, several workspaces, and tighter control.',
    phrases: ['enterprise', 'enterprise plan'],
  },
]

const TIER_LINE = /^(Free|Starter|Professional|Enterprise|Plus|Business|Team|Growth|Scale|Standard|Pro)(?:\s+plan)?$/i
const PRICE = /([£$€])\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(mo|month|seat|user|yr|year))?/i

function titleCase(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'pro') return 'Professional'
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
}

export function spokenPrice(raw: string): string | null {
  const match = /([£$€])\s*(\d+(?:\.\d+)?)/.exec(raw)
  if (!match) return null
  const amount = `${match[1]}${match[2]}`
  if (/seat|\/\s*user|per user/i.test(raw)) return `${amount} a month per seat`
  if (/\/\s*yr|\/\s*year|\ba year\b/i.test(raw)) return `${amount} a year`
  if (/\/\s*mo|\bmonth\b/i.test(raw)) return `${amount} a month`
  return amount
}

function includeLine(line: string): boolean {
  if (TIER_LINE.test(line) || PRICE.test(line)) return false
  if (/buy now|get started|talk to sales|billed|best value|limited-time|credit card required/i.test(line)) return false
  if (line.length < 12 || line.length > 140) return false
  return /[a-z]/i.test(line)
}

function sayFor(tier: PlanTier): string {
  if (tier.price && tier.blurb) return `${tier.name} is ${tier.price}. ${tier.blurb}`
  if (tier.price) return `${tier.name} is ${tier.price}.`
  return `${tier.name}. ${tier.blurb}`
}

export function planSummary(tiers: PlanTier[]): string {
  const listed = tiers.map((tier) => (tier.price ? `${tier.name} at ${tier.price}` : tier.name))
  if (listed.length === 0) return 'Plans are on the pricing page.'
  const last = listed.pop()
  return `Plans are ${listed.join(', ')}, or ${last}. Which one are you asking about?`
}

export function planChoices(tiers: PlanTier[]): Array<{ title: string; phrases: string[]; say: string }> {
  return tiers.map((tier) => ({
    title: tier.name,
    phrases: tier.phrases,
    say: sayFor(tier),
  }))
}

export function extractPlanTiers(text: string): PlanTier[] {
  const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const marks: Array<{ name: string; index: number }> = []
  lines.forEach((line, index) => {
    const hit = line.match(TIER_LINE)
    if (!hit?.[1]) return
    const name = titleCase(hit[1])
    if (marks.some((mark) => mark.name === name)) return
    marks.push({ name, index })
  })
  if (marks.length < 2) return extractInlineTiers(text)
  const tiers: PlanTier[] = []
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i]!
    const chunk = lines.slice(mark.index, marks[i + 1]?.index ?? Math.min(lines.length, mark.index + 20))
    const price = chunk.map((line) => spokenPrice(line)).find((item): item is string => Boolean(item)) ?? ''
    const includes = chunk.filter(includeLine).slice(0, 4)
    const blurb = includes.slice(0, 3).join('. ')
    if (!price && includes.length === 0) continue
    tiers.push({
      name: mark.name,
      price,
      blurb: blurb || `${mark.name} plan`,
      phrases: [mark.name.toLowerCase(), `${mark.name.toLowerCase()} plan`],
    })
  }
  return preferCanonicalGrid(tiers.length >= 2 ? tiers : extractInlineTiers(text))
}

/** HubSpot-style grids are Free / Starter / Professional / Enterprise. Product-card Business $50 stays off. */
function preferCanonicalGrid(tiers: PlanTier[]): PlanTier[] {
  const canon = new Set(['Free', 'Starter', 'Professional', 'Enterprise'])
  const core = tiers.filter((tier) => canon.has(tier.name))
  return core.length >= 4 ? core : tiers
}

function extractInlineTiers(text: string): PlanTier[] {
  const blob = text.replace(/\s+/g, ' ')
  const tiers: PlanTier[] = []
  const pattern = /\b(Free|Starter|Professional|Enterprise|Plus|Business)\b[^£$€]{0,80}([£$€]\s*\d+(?:\.\d+)?(?:\s*\/\s*(?:mo|month|yr|year|seat|user))*)/gi
  for (const match of blob.matchAll(pattern)) {
    const name = titleCase(match[1] ?? '')
    if (!name || tiers.some((tier) => tier.name === name)) continue
    const price = spokenPrice(match[2] ?? '') ?? ''
    if (!price) continue
    tiers.push({
      name,
      price,
      blurb: `${name} plan`,
      phrases: [name.toLowerCase(), `${name.toLowerCase()} plan`],
    })
  }
  return preferCanonicalGrid(tiers.length >= 2 ? tiers : [])
}
