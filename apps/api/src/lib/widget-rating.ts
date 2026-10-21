import { renderForChannel } from '@ybot/shared'

/**
 * The widget asks for a rating only after the published flow has finished.
 * `live` tells it a person has the chat, so it checks for their replies.
 * `replies` are the open question's choices, shown as tappable chips.
 */
export function streamDoneEvent(ended: boolean | undefined, live = false, replies: string[] = []): { done: true; ended?: true; live?: true; replies?: string[] } {
  return {
    done: true,
    ...(ended ? { ended: true as const } : {}),
    ...(live ? { live: true as const } : {}),
    ...(replies.length && !ended && !live ? { replies } : {}),
  }
}

/** Choices that fit become chips; more than the widget shows go out as a numbered list after the reply. */
export function webChoices(choices: string[] | undefined): { replies: string[]; extra: string } {
  if (!choices?.length) return { replies: [], extra: '' }
  const [send] = renderForChannel({ type: 'quick_replies', text: '', replies: choices }, 'web').sends
  if (send?.type === 'buttons') return { replies: send.buttons, extra: '' }
  return { replies: [], extra: send ? `\n\n${send.text}` : '' }
}
