// These rules match packages/shared/src/contact-speech.ts.
// This file stays inside the runtime package on purpose. The production image
// loads the flow runner from @botstudio/runtime, and that directory has no
// node_modules, so `import … from '@botstudio/shared'` crashes the API on startup.

const PLACEHOLDER = /^(visitor|guest|there|unknown|user)$/i
const GREETING = /^(hi|hello|hey|hiya|yo|good morning|good afternoon|good evening)[!?.\s]*$/i
const NAME = /^[\p{L}][\p{L}'’.\-]*(?: [\p{L}][\p{L}'’.\-]*){0,2}$/u
const NAME_VARIABLE = /^(?:contact|user|visitor|customer)\.name$/i
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

const NEUTRAL_NAME = 'there'

export function isNameVariable(path: string): boolean {
  return NAME_VARIABLE.test(path.trim())
}

export function usableContactName(raw: string | null | undefined): string | undefined {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!name || name.length > 40 || PLACEHOLDER.test(name) || GREETING.test(name)) return undefined
  if (name.includes('{{') || name.includes('}}')) return undefined
  if (!NAME.test(name)) return undefined
  const words = name.split(' ')
  if (words.some((word) => word.length < 2 || NOT_A_NAME.has(word.toLowerCase()))) return undefined
  return name
}

function spokenFirstName(raw: string | null | undefined): string | undefined {
  const name = usableContactName(raw)
  return name ? name.split(' ')[0] : undefined
}

export function nameForSpeech(raw: unknown): string {
  if (typeof raw !== 'string') return NEUTRAL_NAME
  return spokenFirstName(raw) ?? NEUTRAL_NAME
}

export function fillNameTokens(template: string, rawName: unknown): string {
  const spoken = nameForSpeech(rawName)
  return template.replace(/\{\{\s*(?:contact|user|visitor|customer)\.name\s*\}\}/gi, spoken)
}
