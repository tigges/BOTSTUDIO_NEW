import type { TestChatPath, TestChatState, TestToolCall } from './api'
import { routingLine, sourceLine } from './handover-format'

/** What happened to the test chat on this turn, beyond the bot's words. Nothing when only the bot spoke. */
export function testChatNote(before: TestChatState | undefined, after: TestChatState, path: TestChatPath): string | undefined {
  if (path === 'held') return 'A person has this chat now, so the bot stays quiet. Reset the chat to test again.'
  if (path === 'handover' && after.handover) {
    const handover = after.handover
    const parts = [
      `Handed to a person by the ${sourceLine(handover.source).toLowerCase()}`,
      handover.reason,
      handover.priority ? `Priority ${handover.priority}` : undefined,
      routingLine(handover.routing),
    ].filter((part): part is string => Boolean(part && part.trim()))
    return `${parts.join(' · ')}. Live chats go to the Inbox; this test does not.`
  }
  if (after.outcome === before?.outcome) return undefined
  if (after.outcome === 'contained_unresolved') {
    return 'Asked for a person, but nobody is on chat now, so the bot kept the chat. Turn on working hours in Inbox settings to hand over.'
  }
  if (after.outcome === 'contained_resolved') return 'Resolved by the bot.'
  return undefined
}

/** One line per tool the bot ran on this turn. Test chats skip tools that change data. */
export function testToolNote(tools: TestToolCall[] | undefined): string | undefined {
  const lines = (tools ?? []).map((tool) => {
    if (tool.skipped) return `Skipped ${tool.name}: it changes data, so test chats do not run it. Live chats do.`
    if (!tool.ok) return `${tool.name} failed: ${tool.error || 'no reason given'}. The step took its Error line.`
    return `Ran ${tool.name}.`
  })
  return lines.length ? lines.join(' ') : undefined
}

export function joinNotes(...notes: Array<string | undefined>): string | undefined {
  const kept = notes.filter((note): note is string => Boolean(note))
  return kept.length ? kept.join(' ') : undefined
}
