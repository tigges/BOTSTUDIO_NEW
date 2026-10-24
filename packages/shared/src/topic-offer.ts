/**
 * How the bot names the topics it can take a guest into. The runtime offer and an authored
 * "what would you like?" line both come from here, so the two never say different things.
 */

const CORE_DOORS = ['Services and prices', 'Salon hours', 'Book an appointment', 'Location']

export function isWelcomeName(name: string): boolean {
  return /welcome/i.test(name.trim())
}

/** A chapter that only hands the chat to a person. The bot offers its own topics; asking for a person always works. */
export function isPersonDoor(name: string): boolean {
  return /\b(talk|speak|chat) (to|with)\b|\b(a person|human|someone|an agent|the team|reception(ist)?|staff)\b/i.test(name)
}

/** What the guest hears for a chapter: "Book a visit" is "a booking", "Dental pain or emergency" is "an urgent problem". */
export function topicName(chapter: string): string {
  const trimmed = chapter.replace(/^salon\s+/i, '').trim()
  if (/book/i.test(trimmed)) return 'a booking'
  if (/price|service/i.test(trimmed)) return 'prices'
  if (/emergenc|\bpain\b|urgent/i.test(trimmed)) return 'an urgent problem'
  if (/hour/i.test(trimmed)) return 'hours'
  if (/location|where|address/i.test(trimmed)) return 'where we are'
  return trimmed.toLowerCase()
}

/** Up to three topics from chapter names, booking first, then in the given order. */
export function topicsFromChapters(chapters: string[], current?: string): string[] {
  const names = chapters.filter((name) => !isWelcomeName(name) && name !== current && !isPersonDoor(name))
  const ranked = [
    ...names.filter((name) => /book/i.test(name)),
    ...CORE_DOORS.filter((name) => names.includes(name) && !/book/i.test(name)),
    ...names.filter((name) => !CORE_DOORS.includes(name) && !/book/i.test(name)),
  ]
  return [...new Set(ranked.slice(0, 3).map(topicName))]
}

export function topicList(shown: string[]): string {
  if (shown.length === 1) return shown[0]!
  const rest = [...shown]
  const last = rest.pop()
  return `${rest.join(', ')}, or ${last}`
}

/** "I can help you with a booking, an urgent problem, or prices. What would you like?" */
export function topicOffer(shown: string[]): string {
  if (shown.length === 0) return 'Tell me a little more about what you need.'
  return `I can help you with ${topicList(shown)}. What would you like?`
}
