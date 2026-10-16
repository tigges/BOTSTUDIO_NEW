import { chatPlain, fillNameTokens } from '@ybot/shared'

/** Fill name tokens and keep markdown links so the bubble can render Phorest as a named link. */
export function chatMarkup(text: string | undefined, displayName?: string | null): string {
  return fillNameTokens(text ?? '', displayName)
}

/** A list preview. A missing name is "there", never the raw braces. Booking URLs become the host name. */
export function chatText(text: string | undefined, displayName?: string | null): string {
  return chatPlain(chatMarkup(text, displayName))
}
