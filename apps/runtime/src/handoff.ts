import type { SessionVariables } from './types.js'

/** Keep the request and the name when a chapter hands off. */
export function copyJumpVariables(previous: SessionVariables, userText: string, contactName: string): SessionVariables {
  const flow = { ...previous.flow }
  const global = { ...previous.global }
  const contact = { ...previous.contact }
  flow['_last_user_message'] = userText
  if (contactName) contact['name'] = contactName
  return { flow, global, contact }
}

export function missingChapterLine(name: string, environmentLabel: string): string {
  const missing = name.trim() || 'The welcome'
  return `${missing} is not on this ${environmentLabel} map.`
}
