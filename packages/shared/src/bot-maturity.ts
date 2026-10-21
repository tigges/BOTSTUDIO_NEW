/** What the Overview needs to know about a bot to pick its layout. */
export interface BotFootprint {
  businessFields: number
  knowledgeItems: number
  flows: number
  tools: number
  /** Active channels bound to Production. */
  productionChannels: number
  /** Real (not test-run) chats ever held in Sandbox. */
  sandboxChats: number
  /** Real chats in Production over the last 7 days. */
  productionChats7d: number
  /** The release number live in Production, if any. */
  liveRelease: number | null
}

/** empty: nothing built yet. building: something built, nothing live. live: a release runs in Production. */
export type BotStage = 'empty' | 'building' | 'live'

export function botStage(f: BotFootprint): BotStage {
  if (f.liveRelease != null) return 'live'
  const built = f.businessFields + f.knowledgeItems + f.flows + f.tools
  return built > 0 ? 'building' : 'empty'
}

/** Business detail fields with a value, read from the stored profile JSON without its blueprint. */
export function filledBusinessFields(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0
  const fields = (raw as { fields?: unknown }).fields
  if (!fields || typeof fields !== 'object') return 0
  let filled = 0
  for (const field of Object.values(fields as Record<string, unknown>)) {
    const value = field && typeof field === 'object' ? (field as { value?: unknown }).value : undefined
    if (value == null) continue
    if (typeof value === 'string' && !value.trim()) continue
    if (Array.isArray(value) && value.length === 0) continue
    filled += 1
  }
  return filled
}

export interface ChecklistItem {
  id: 'business' | 'knowledge' | 'journey' | 'sandbox' | 'channel' | 'publish'
  label: string
  hint: string
  path: string
  done: boolean
}

export function setupChecklist(f: BotFootprint): ChecklistItem[] {
  return [
    { id: 'business', label: 'Add your business details', hint: 'Opening hours, prices and contact details the bot quotes word for word.', path: '/build/business', done: f.businessFields > 0 },
    { id: 'knowledge', label: 'Add what the bot should know', hint: 'Pages, documents or FAQs it answers from, with sources.', path: '/build/knowledge/sources', done: f.knowledgeItems > 0 },
    { id: 'journey', label: 'Build the first journey', hint: 'The welcome, the routes and when to hand over to a person.', path: '/build/journey', done: f.flows > 0 },
    { id: 'sandbox', label: 'Try it in Sandbox', hint: 'Chat with the bot yourself before anyone else does.', path: '/build/journey', done: f.sandboxChats > 0 },
    { id: 'channel', label: 'Connect a channel', hint: 'Website chat, WhatsApp or another channel bound to Production.', path: '/configure/channels', done: f.productionChannels > 0 },
    { id: 'publish', label: 'Publish to Production', hint: 'Releases are frozen; rolling back is one click.', path: '/build/releases', done: f.liveRelease != null },
  ]
}
