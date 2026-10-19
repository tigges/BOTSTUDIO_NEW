/**
 * The widget asks for a rating only after the published flow has finished.
 * `live` tells it a person has the chat, so it checks for their replies.
 */
export function streamDoneEvent(ended: boolean | undefined, live = false): { done: true; ended?: true; live?: true } {
  return {
    done: true,
    ...(ended ? { ended: true as const } : {}),
    ...(live ? { live: true as const } : {}),
  }
}
