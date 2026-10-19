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

/** The line above the map for the Traffic and Health tabs. */
export function journeySummary(total: ChapterOutcome | undefined, environmentLabel: string, days: number): string {
  if (!total || total.chats === 0) {
    return `No ${environmentLabel} chats in the last ${days} days. Chats in "Test this journey" are not counted.`
  }
  const share = Math.round((total.bot / total.chats) * 100)
  const rest = [
    total.person ? `${total.person} handed to the team` : '',
    total.open ? `${total.open} still open` : '',
  ].filter(Boolean)
  return `${chats(total.chats)} on ${environmentLabel} in the last ${days} days: ${total.bot} resolved by the bot (${share}%)${rest.length ? `, ${rest.join(', ')}` : ''}.`
}
