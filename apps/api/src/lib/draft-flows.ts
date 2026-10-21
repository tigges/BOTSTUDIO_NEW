import { prisma } from '@botstudio/db'

export interface DraftRecipe {
  name: string
  phrases: string[]
  min: number
  description: string
  graph: { nodes: object[]; edges: object[] }
}

const y = 120

function line(id: string, x: number, kind: string, label: string, config: Record<string, unknown>) {
  return { id, type: 'flow-node', position: { x, y }, data: { kind, label, config } }
}

export const DRAFT_RECIPES: DraftRecipe[] = [
  {
    name: 'Password Reset',
    phrases: ['password', 'forgot password', "can't sign in", 'cannot sign in', 'cant sign in', 'reset my password', 'account reset'],
    min: 3,
    description: 'Suggested from chats about account resets. Publish it and the welcome flow will hand off next time.',
    graph: {
      nodes: [
        line('start', 80, 'trigger_start', 'Password reset', {}),
        line('send', 280, 'send_message', 'Offer help', { text: 'I can help you reset your account.' }),
        line('ask', 480, 'ask_question', 'Ask email', { question: 'What email is on the account?', variable: 'email' }),
        line('done', 680, 'send_message', 'Link sent', { text: 'A reset link is on its way to {{email}}.' }),
        line('end', 880, 'end_flow', 'End', {}),
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'send' },
        { id: 'e2', source: 'send', target: 'ask' },
        { id: 'e3', source: 'ask', target: 'done' },
        { id: 'e4', source: 'done', target: 'end' },
      ],
    },
  },
  {
    name: 'WhatsApp channel',
    phrases: ['whatsapp'],
    min: 3,
    description: 'Suggested from landing chats about WhatsApp. Publish it when you want the product bot to answer this way.',
    graph: {
      nodes: [
        line('start', 80, 'trigger_start', 'WhatsApp question', {}),
        line('send', 280, 'send_message', 'Answer', { text: 'WhatsApp is on the roadmap. The website widget is the live channel today, and the same chat appears in your inbox.' }),
        line('end', 480, 'end_flow', 'End', {}),
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'send' },
        { id: 'e2', source: 'send', target: 'end' },
      ],
    },
  },
  {
    name: 'Single sign-on',
    phrases: ['single sign-on', 'sso', 'okta', 'saml'],
    min: 3,
    description: 'Suggested from landing chats about company login. Publish it when you want the product bot to answer this way.',
    graph: {
      nodes: [
        line('start', 80, 'trigger_start', 'SSO question', {}),
        line('send', 280, 'send_message', 'Answer', { text: 'Single sign-on is planned. Today each company signs in with email and a password.' }),
        line('end', 480, 'end_flow', 'End', {}),
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'send' },
        { id: 'e2', source: 'send', target: 'end' },
      ],
    },
  },
]

export function messageText(content: unknown): string {
  if (content && typeof content === 'object' && 'text' in content && typeof (content as { text?: unknown }).text === 'string') {
    return (content as { text: string }).text
  }
  return ''
}

/** Recipe names that have enough matching chats and no flow yet. */
export function recipesToPropose(messages: string[], recipes: DraftRecipe[], existingNames: string[]): string[] {
  const have = new Set(existingNames)
  return recipes.filter((recipe) => {
    if (have.has(recipe.name)) return false
    const count = messages.filter((message) => {
      const hay = message.toLowerCase()
      return recipe.phrases.some((phrase) => hay.includes(phrase))
    }).length
    return count >= recipe.min
  }).map((recipe) => recipe.name)
}

export function textMightStartDraft(text: string): boolean {
  const hay = text.toLowerCase()
  return DRAFT_RECIPES.some((recipe) => recipe.phrases.some((phrase) => hay.includes(phrase)))
}

export async function proposeDraftFlows(botId: string): Promise<string[]> {
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { id: true, tenantId: true } })
  if (!bot) return []
  const flows = await prisma.flow.findMany({ where: { botId }, select: { name: true } })
  const pending = DRAFT_RECIPES.filter((recipe) => !flows.some((flow) => flow.name === recipe.name))
  if (pending.length === 0) return []

  const rows = await prisma.message.findMany({
    where: { authorKind: 'user', conversation: { botId } },
    select: { content: true },
    orderBy: { createdAt: 'desc' },
    take: 800,
  })
  const messages = rows.map((row) => messageText(row.content))
  const names = recipesToPropose(messages, pending, flows.map((flow) => flow.name))
  const created: string[] = []
  for (const name of names) {
    const recipe = DRAFT_RECIPES.find((item) => item.name === name)
    if (!recipe) continue
    const already = await prisma.flow.findFirst({ where: { botId, name: recipe.name } })
    if (already) continue
    const flow = await prisma.flow.create({
      data: {
        tenantId: bot.tenantId,
        botId,
        name: recipe.name,
        description: recipe.description,
        kind: 'flow',
        tags: ['proposed'],
      },
    })
    await prisma.flowVersion.create({
      data: {
        tenantId: bot.tenantId,
        flowId: flow.id,
        version: 1,
        status: 'draft',
        graph: recipe.graph,
      },
    })
    created.push(recipe.name)
  }
  return created
}
