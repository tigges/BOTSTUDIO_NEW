import type { ChapterOutcome } from './api'

export interface ChapterHealthLine {
  label: string
  detail: string
}

function chats(n: number): string {
  return `${n} ${n === 1 ? 'chat' : 'chats'}`
}

/** "8 of 10 resolved by the bot", with the rest named. A dash means no chats, never zero. */
export function outcomeLine(outcome: ChapterOutcome | undefined): ChapterHealthLine {
  if (!outcome || outcome.chats === 0) return { label: '—', detail: 'No chats yet' }
  const rest = [
    outcome.person ? `${outcome.person} handed to the team` : '',
    outcome.open ? `${outcome.open} still open` : '',
  ].filter(Boolean).join(' · ')
  return { label: `${outcome.bot} of ${chats(outcome.chats)} resolved by the bot`, detail: rest }
}

/** The line above the map for the Traffic and Health tabs, with what it leaves out so it adds up to the Inbox. */
export function journeySummary(
  total: ChapterOutcome | undefined,
  environmentLabel: string,
  days: number,
  more: { unstarted?: number; testRuns?: number } = {},
): string {
  const counted = Boolean(total && total.chats > 0)
  const notes = [
    more.unstarted ? `${more.unstarted}${counted ? ' more' : ''} ${more.unstarted === 1 ? 'chat' : 'chats'} never started a chapter (greeting only, or sent straight to a person).` : '',
    more.testRuns ? `Includes ${chats(more.testRuns)} from scheduled test runs.` : '',
  ].filter(Boolean)
  if (!total || !counted) {
    return [`No ${environmentLabel} chats started a chapter in the last ${days} days. Chats in "Test this journey" are not counted.`, ...notes].join(' ')
  }
  const share = Math.round((total.bot / total.chats) * 100)
  const rest = [
    total.person ? `${total.person} handed to the team` : '',
    total.open ? `${total.open} still open` : '',
  ].filter(Boolean)
  return [`${chats(total.chats)} on ${environmentLabel} in the last ${days} days: ${total.bot} resolved by the bot (${share}%)${rest.length ? `, ${rest.join(', ')}` : ''}.`, ...notes].join(' ')
}

/** When the chosen environment has no chapter traffic, the environment that does. */
export function busierEnvironment(
  byEnvironment: Record<string, number> | undefined,
  environments: Array<{ id: string; kind: string; name: string }>,
  currentId: string,
): { kind: string; name: string; chats: number } | undefined {
  if (!byEnvironment || (byEnvironment[currentId] ?? 0) > 0) return undefined
  const best = environments
    .filter((env) => env.id !== currentId && (byEnvironment[env.id] ?? 0) > 0)
    .sort((a, b) => (byEnvironment[b.id] ?? 0) - (byEnvironment[a.id] ?? 0))[0]
  return best ? { kind: best.kind, name: best.name, chats: byEnvironment[best.id]! } : undefined
}
