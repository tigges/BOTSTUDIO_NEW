const PLACEHOLDER = /^(visitor|guest|there|unknown|user)$/i
const GREETING = /^(hi|hello|hey|hiya|yo|good morning|good afternoon|good evening)[!?.\s]*$/i
const NAME = /^[\p{L}][\p{L}'’.\-]*(?: [\p{L}][\p{L}'’.\-]*){0,2}$/u
const NAME_VARIABLE = /^(?:contact|user|visitor|customer)\.name$/i
/** Words a visitor says when they want something, not when they introduce themselves. */
const NOT_A_NAME = new Set([
  'a', 'an', 'the', 'to', 'for', 'and', 'or',
  'hi', 'hello', 'hey', 'hiya', 'yo',
  'help', 'feature', 'features', 'inbox', 'plan', 'start', 'free',
  'book', 'booking', 'colour', 'color', 'price', 'prices', 'hours',
  'yes', 'no', 'ok', 'okay', 'thanks', 'thank', 'please',
  'want', 'need', 'appointment', 'haircut', 'cut', 'trim', 'fringe',
  'services', 'service', 'catalog', 'salon',
  'what', 'how', 'when', 'where', 'today', 'can', 'could',
])

/** A word we can say when the greeting needs one and we still do not know who this is. */
export const NEUTRAL_NAME = 'there'

/** Asked once, after a neutral greeting, until the visitor gives a real name. */
export const NAME_QUESTION = "What's your name?"

/** Sales follow-up on CRM and software maps. One question, then a person from sales. */
export const EMAIL_QUESTION = "What's a good email address for the team to follow up with?"

/** A name we can say out loud. Greetings, placeholders, and sentences are not names. */
export function usableContactName(raw: string | null | undefined): string | undefined {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!name || name.length > 40 || PLACEHOLDER.test(name) || GREETING.test(name)) return undefined
  if (name.includes('{{') || name.includes('}}')) return undefined
  if (!NAME.test(name)) return undefined
  const words = name.split(' ')
  if (words.some((word) => word.length < 2 || NOT_A_NAME.has(word.toLowerCase()))) return undefined
  return name
}

/** First name for a greeting, when the full name is one we can say. */
export function spokenFirstName(raw: string | null | undefined): string | undefined {
  const name = usableContactName(raw)
  return name ? name.split(' ')[0] : undefined
}

export function isNameVariable(path: string): boolean {
  return NAME_VARIABLE.test(path.trim())
}

/** The name to speak, or the neutral word when we do not have one. */
export function nameForSpeech(raw: unknown): string {
  if (typeof raw !== 'string') return NEUTRAL_NAME
  return spokenFirstName(raw) ?? NEUTRAL_NAME
}

/**
 * Put a real name into every name token.
 * An empty, placeholder, or still-unfilled token becomes "there", never the raw braces.
 */
export function fillNameTokens(template: string, rawName: unknown): string {
  const spoken = nameForSpeech(rawName)
  return template.replace(/\{\{\s*(?:contact|user|visitor|customer)\.name\s*\}\}/gi, spoken)
}
