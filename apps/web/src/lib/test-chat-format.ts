import type { TestChatPath, TestChatState, TestToolCall } from './api'
import { routingLine, sourceLine } from './handover-format'

/** What happened to the test chat on this turn, beyond the bot's words. Nothing when only the bot spoke. */
export function testChatNote(before: TestChatState | undefined, after: TestChatState, path: TestChatPath): string | undefined {
  if (path === 'held') {
    return after.inboxChatId
      ? 'The team has this chat in the Inbox, so the bot stays quiet. Your lines go to them and their replies show here.'
      : 'A person has this chat now, so the bot stays quiet. Reset the chat to test again.'
  }
  if (path === 'handover' && after.handover) {
    const handover = after.handover
    const parts = [
      `Handed to a person by the ${sourceLine(handover.source).toLowerCase()}`,
      handover.reason,
      handover.priority ? `Priority ${handover.priority}` : undefined,
      routingLine(handover.routing),
    ].filter((part): part is string => Boolean(part && part.trim()))
    const where = after.inboxChatId
      ? 'It is waiting in the Inbox under Chats as a Sandbox chat; replies from the team show here.'
      : 'Live chats go to the Inbox; this one could not, because the bot is not saved with a Sandbox yet.'
    return `${parts.join(' · ')}. ${where}`
  }
  if (after.outcome === before?.outcome) return undefined
  if (after.outcome === 'contained_unresolved') {
    return 'Asked for a person, but live support is off or the team is outside opening hours, so the bot kept the chat. Turn live support on at the top of the Inbox to hand over.'
  }
  if (after.outcome === 'contained_resolved') return 'Resolved by the bot.'
  return undefined
}

/** The line shown when the team lets go of a test chat in the Inbox. */
export function teamReturnNote(status: string): string {
  return status === 'resolved'
    ? 'The team resolved this chat in the Inbox. Reset the chat to test again.'
    : 'The team handed the chat back to the bot. Your next message goes to the bot.'
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
