import { FALLBACK_ROUTE, guardPasses, type RouterRoute } from '@botstudio/shared'

export interface TopicRoute {
  handle: string
  phrases: string[]
}

const STOP = new Set([
  'a', 'an', 'the', 'to', 'for', 'and', 'or', 'of', 'at', 'in', 'on',
  'my', 'your', 'our', 'is', 'are', 'am', 'do', 'does', 'did', 'you', 'we', 'me',
  'it', 'be', 'if', 'not', 'so', 'with', 'from', 'that', 'this', 'have', 'has',
  'had', 'what', 'when', 'how', 'much', 'would', 'could', 'should', 'please',
  'like', 'want', 'need', 'done', 'they', 'them', 'their', 'can', 'will', 'just',
  'also', 'about',
])

const RELATED: Record<string, string[]> = {
  haircut: ['cut'],
  haircuts: ['cut', 'haircut'],
  colouring: ['colour', 'color'],
  coloring: ['colour', 'color'],
  colours: ['colour', 'color'],
  colors: ['colour', 'color'],
  colour: ['color'],
  color: ['colour'],
  treatments: ['treatment'],
  prices: ['price', 'pricing'],
  price: ['prices'],
  pricing: ['price', 'prices'],
  hours: ['hour', 'opening'],
  opening: ['hours'],
  services: ['service'],
  service: ['services'],
  location: ['address'],
  address: ['location'],
  directions: ['location', 'address'],
  gents: ['gent', 'men', 'man', 'male'],
  gent: ['gents', 'men'],
  ladies: ['lady', 'women', 'woman'],
  lady: ['ladies', 'women'],
  women: ['woman', 'ladies'],
  woman: ['women', 'ladies'],
  kids: ['kid', 'children', 'child'],
  children: ['kids', 'child'],
}

function tokens(text: string): string[] {
  return text.match(/[a-z0-9']+/g) ?? []
}

function relatedTokens(word: string): string[] {
  const related = RELATED[word] ?? []
  if (word.length > 4 && word.endsWith('s')) return [...related, word.slice(0, -1)]
  return related
}

/** Words a chart wrote, plus the useful bits inside them ("a cut" also hears "cut"). */
export function listenables(phrases: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (value: string) => {
    const needle = value.toLowerCase().trim()
    if (!needle || seen.has(needle)) return
    seen.add(needle)
    out.push(needle)
  }
  for (const phrase of phrases) {
    add(phrase)
    for (const token of tokens(phrase.toLowerCase())) {
      if (STOP.has(token)) continue
      if (token.length >= 3) add(token)
      for (const related of relatedTokens(token)) {
        if (!STOP.has(related) && related.length >= 3) add(related)
      }
    }
  }
  return out
}

/** One adjacent swap, or one insert, delete, or substitution. */
function oneEdit(a: string, b: string): 'swap' | 'edit' | null {
  if (a === b || Math.abs(a.length - b.length) > 1) return null
  if (a.length === b.length) {
    const diffs: number[] = []
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diffs.push(i)
      if (diffs.length > 2) return null
    }
    if (diffs.length === 1) return 'edit'
    const first = diffs[0]
    const second = diffs[1]
    if (
      diffs.length === 2 &&
      first !== undefined &&
      second === first + 1 &&
      a[first] === b[second] &&
      a[second] === b[first]
    ) {
      return 'swap'
    }
    return null
  }
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  let i = 0
  let j = 0
  let skipped = false
  while (i < longer.length && j < shorter.length) {
    if (longer[i] === shorter[j]) {
      i++
      j++
    } else if (skipped) {
      return null
    } else {
      skipped = true
      i++
    }
  }
  return 'edit'
}

/**
 * A swapped pair of letters counts from 3 letters ("wnat" / "want", "ctu" / "cut").
 * One extra, missing, or changed letter counts only from 5, so "book" does not become "back".
 */
function closeWord(left: string, right: string): boolean {
  if (left === right) return true
  const kind = oneEdit(left, right)
  if (!kind) return false
  const longer = Math.max(left.length, right.length)
  if (kind === 'swap') return longer >= 3
  return left.length >= 5 && right.length >= 5
}

function spaced(text: string): string {
  return ` ${tokens(text).join(' ')} `
}

function phraseHit(hay: string, needle: string): 'exact' | 'fuzzy' | null {
  if (needle.trim() && spaced(hay).includes(spaced(needle))) return 'exact'
  const wanted = tokens(needle)
  const heard = tokens(hay)
  if (wanted.length === 0 || heard.length < wanted.length) return null
  for (let start = 0; start <= heard.length - wanted.length; start++) {
    let fuzzy = false
    let fits = true
    for (let i = 0; i < wanted.length; i++) {
      const word = wanted[i] ?? ''
      const heardWord = heard[start + i] ?? ''
      if (word === heardWord) continue
      if (closeWord(word, heardWord)) {
        fuzzy = true
        continue
      }
      fits = false
      break
    }
    if (fits) return fuzzy ? 'fuzzy' : 'exact'
  }
  return null
}

/**
 * Longest matching phrase wins, so "cancel my order" beats "order". A one-letter slip still counts.
 * Other single words the route also hears add to it, so "sim only plans" goes to the route that
 * hears "sim" and "only", not the one that hears "plans". A slip on a single word ("there" for
 * "where") counts half. "other" when nothing fits.
 */
export function matchTopic(text: string, routes: TopicRoute[]): string {
  const hay = text.toLowerCase()
  const heardWords = tokens(hay)
  let best: { handle: string; score: number; fit: number } | undefined
  for (const route of routes) {
    let top: { heard: string[]; score: number } | undefined
    const words: Array<{ heard: string; score: number }> = []
    for (const phrase of listenables(route.phrases)) {
      const needle = phrase.toLowerCase().trim()
      if (!needle) continue
      const hit = phraseHit(hay, needle)
      if (!hit) continue
      const parts = tokens(needle)
      const single = parts.length === 1
      const score = hit === 'exact' ? needle.length : single ? needle.length / 2 : needle.length - 0.5
      const heard = single && hit === 'fuzzy' ? [heardWords.find((word) => closeWord(needle, word)) ?? needle] : parts
      if (single) words.push({ heard: heard[0]!, score })
      if (!top || score > top.score) top = { heard, score }
    }
    if (!top) continue
    const counted = new Set(top.heard)
    let extra = 0
    for (const word of words.sort((a, b) => b.score - a.score)) {
      if (counted.has(word.heard)) continue
      counted.add(word.heard)
      extra += word.score
    }
    const score = top.score + extra
    const fit = nameFit(route.phrases[0] ?? '', heardWords)
    if (!best || score > best.score || (score === best.score && fit > best.fit)) best = { handle: route.handle, score, fit }
  }
  return best?.handle ?? 'other'
}

/** How much of a route's first phrase the guest said: "roots" fits Roots fully and In-between roots a third. */
function nameFit(name: string, heard: string[]): number {
  const words = tokens(name.toLowerCase())
  if (words.length === 0) return 0
  return words.filter((word) => heard.includes(word)).length / words.length
}

const CLASSIFY_MS = 6_000

type ClassifyFn = (text: string, params: { categories: string[]; descriptions?: Record<string, string> }) => Promise<{ category: string }>

function classifyFn(llm: unknown): ClassifyFn | null {
  if (!llm || typeof llm !== 'object') return null
  const fn = (llm as { classify?: unknown }).classify
  return typeof fn === 'function' ? (fn as ClassifyFn).bind(llm) : null
}

/**
 * Phrase match first. On a miss, ask the model to pick one of THIS node's handles.
 * Empty llm (tests, canvas walk) stays on "other".
 */
export async function pickTopic(
  text: string,
  routes: TopicRoute[],
  llm?: unknown,
  descriptions?: Record<string, string>,
): Promise<string> {
  const phrase = matchTopic(text, routes)
  if (phrase !== 'other') return phrase
  const classify = classifyFn(llm)
  const handles = [...new Set(routes.map((route) => route.handle).filter(Boolean))]
  if (!classify || handles.length === 0 || !text.trim()) return 'other'
  try {
    const result = await Promise.race([
      classify(text, { categories: [...handles, 'other'], ...(descriptions ? { descriptions } : {}) }),
      new Promise<{ category: string }>((resolve) => {
        setTimeout(() => resolve({ category: 'other' }), CLASSIFY_MS)
      }),
    ])
    return handles.includes(result.category) ? result.category : 'other'
  } catch {
    return 'other'
  }
}

export type RouteDecidedBy = 'rule' | 'words' | 'model' | 'fallback'

/** A route decided by its rule alone: it has a guard and nothing for words or the model. */
function ruleOnly(route: RouterRoute): boolean {
  return Boolean(route.guard) && route.phrases.length === 0 && !route.intent
}

/**
 * The Router, in the author's order. Rules decide first: a rule-only route whose rule passes,
 * then the words of every route whose rule passes. The model picks only when no rule did,
 * reading each open route's intent. Anything left goes to the fallback.
 */
export async function pickRoute(
  heard: { latest: string; withTopic: string },
  routes: RouterRoute[],
  vars: Record<string, unknown>,
  llm?: unknown,
): Promise<{ handle: string; decidedBy: RouteDecidedBy }> {
  const open = routes.filter((route) => guardPasses(route.guard, vars))
  const byRule = open.find(ruleOnly)
  if (byRule) return { handle: byRule.handle, decidedBy: 'rule' }

  const spoken = open.filter((route) => !ruleOnly(route))
  for (const text of [heard.latest, heard.withTopic]) {
    const handle = matchTopic(text, spoken)
    if (handle !== FALLBACK_ROUTE) return { handle, decidedBy: 'words' }
  }

  const descriptions = Object.fromEntries(
    spoken.filter((route) => route.intent || route.label !== route.handle).map((route) => [route.handle, route.intent || route.label]),
  )
  const handle = await pickTopic(heard.latest || heard.withTopic, spoken, llm, Object.keys(descriptions).length ? descriptions : undefined)
  return handle === FALLBACK_ROUTE ? { handle, decidedBy: 'fallback' } : { handle, decidedBy: 'model' }
}
