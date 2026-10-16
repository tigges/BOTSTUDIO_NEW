export interface VisitorTurn {
  /** Text the journey reads. An opening has no visitor words yet. */
  text: string
  /** An opening greeting has no visitor line in the transcript. */
  showVisitor: boolean
}

/**
 * A typed message is shown and answered.
 * Opening the chat, with no message yet, starts the journey the same way Test Bot does.
 */
export function visitorTurn(input: { message?: string; opening?: boolean }): VisitorTurn | null {
  const message = (input.message ?? '').trim()
  if (message) return { text: message, showVisitor: true }
  if (input.opening) return { text: '', showVisitor: false }
  return null
}
