/**
 * Channel-neutral rich content and how each channel shows it. Every channel
 * declares its limits; content that does not fit falls back to a declared
 * shape (a list, numbered text, several messages) and the fallback is noted.
 * Nothing is cut off.
 */

export const LIMIT_CHANNELS = ['web', 'whatsapp', 'telegram', 'sms', 'email', 'phone'] as const
export type LimitChannel = (typeof LIMIT_CHANNELS)[number]

export interface RichCard {
  title: string
  text?: string
  imageUrl?: string
  buttons?: string[]
}

export type RichMessage =
  | { type: 'text'; text: string }
  | { type: 'quick_replies'; text: string; replies: string[] }
  | ({ type: 'card' } & RichCard)
  | { type: 'carousel'; text?: string; cards: RichCard[] }
  | { type: 'list'; text: string; items: Array<{ title: string; text?: string }>; button?: string }
  | { type: 'media'; kind: 'image' | 'video' | 'file'; url: string; caption?: string }
  | { type: 'form'; title: string; fields: Array<{ label: string }> }
  | { type: 'feedback'; question: string }

export type RichType = RichMessage['type']

export interface ChannelLimits {
  label: string
  /** Characters per message; longer text goes out as several messages. */
  textMax: number
  /** Tappable replies under a message. Null: the channel has none. */
  buttons: { max: number; labelMax: number } | null
  /** A menu of rows behind one button. Null: the channel has none. */
  list: { max: number; labelMax: number } | null
  /** Characters of text a message with buttons or a menu may carry; the rest goes in the message before. */
  choiceTextMax?: number
  /** Voice reads choices out instead of numbering them. */
  spoken?: boolean
}

/** What BotStudio sends today on each channel, not what the provider could do in theory. */
export const CHANNEL_LIMITS: Record<LimitChannel, ChannelLimits> = {
  web: { label: 'Website chat', textMax: 10_000, buttons: { max: 10, labelMax: 40 }, list: null },
  whatsapp: { label: 'WhatsApp', textMax: 4096, buttons: { max: 3, labelMax: 20 }, list: { max: 10, labelMax: 24 }, choiceTextMax: 1024 },
  telegram: { label: 'Telegram', textMax: 4096, buttons: { max: 12, labelMax: 64 }, list: null },
  sms: { label: 'SMS', textMax: 1600, buttons: null, list: null },
  email: { label: 'Email', textMax: 50_000, buttons: null, list: null },
  phone: { label: 'Phone', textMax: 4000, buttons: null, list: null, spoken: true },
}

export function isLimitChannel(kind: string): kind is LimitChannel {
  return (LIMIT_CHANNELS as readonly string[]).includes(kind)
}

export type ChannelSend =
  | { type: 'text'; text: string }
  | { type: 'buttons'; text: string; buttons: string[] }
  | { type: 'list'; text: string; button: string; rows: string[] }

export interface ChannelRender {
  sends: ChannelSend[]
  /** One line per fallback, in the words the console shows. */
  notes: string[]
}

const LIST_BUTTON = 'Choose'

/** Splits at paragraph, then sentence, then word boundaries; only a single word longer than the limit is broken. */
export function splitText(text: string, max: number): string[] {
  const clean = text.trim()
  if (clean.length <= max) return clean ? [clean] : []
  const parts: string[] = []
  let rest = clean
  while (rest.length > max) {
    const window = rest.slice(0, max + 1)
    const cut = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), lastSentenceEnd(window), window.lastIndexOf(' ')]
      .find((index) => index > max * 0.3) ?? -1
    const at = cut > 0 ? cut : max
    parts.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

function lastSentenceEnd(text: string): number {
  const match = [...text.matchAll(/[.!?](\s)/g)].at(-1)
  return match?.index !== undefined ? match.index + 1 : -1
}

function numbered(text: string, options: string[], spoken: boolean): string {
  if (spoken) {
    const said = options.length > 1 ? `${options.slice(0, -1).join(', ')} or ${options.at(-1)}` : options[0] ?? ''
    return `${text}\n\nYou can say ${said}.`.trim()
  }
  return `${text}\n\n${options.map((option, index) => `${index + 1}. ${option}`).join('\n')}\n\nReply with a number or the words.`.trim()
}

function longest(options: string[]): number {
  return Math.max(0, ...options.map((option) => option.length))
}

function choose(text: string, options: string[], limits: ChannelLimits, what: string): { send: ChannelSend[]; note?: string } {
  const { buttons, list, label } = limits
  if (buttons && options.length <= buttons.max && longest(options) <= buttons.labelMax) {
    return { send: [{ type: 'buttons', text, buttons: options }] }
  }
  const why = !buttons
    ? `${label} has no buttons`
    : options.length > buttons.max
      ? `${label} shows up to ${buttons.max} buttons and this has ${options.length}`
      : `${label} button labels hold ${buttons.labelMax} characters and the longest here has ${longest(options)}`
  if (list && options.length <= list.max && longest(options) <= list.labelMax) {
    return { send: [{ type: 'list', text, button: LIST_BUTTON, rows: options }], note: `${what}: ${why}, so they open from a "${LIST_BUTTON}" menu.` }
  }
  const shape = limits.spoken ? 'read out after the question' : 'sent as a numbered list the guest answers by number'
  return { send: [{ type: 'text', text: numbered(text, options, Boolean(limits.spoken)) }], note: `${what}: ${why}, so they are ${shape}.` }
}

function cardText(card: RichCard): string {
  return [card.title, card.text, card.imageUrl].filter((line) => line && line.trim()).join('\n')
}

/** How one message goes out on a channel, and every place it had to fall back. */
export function renderForChannel(message: RichMessage, kind: LimitChannel): ChannelRender {
  const limits = CHANNEL_LIMITS[kind]
  const notes: string[] = []
  let sends: ChannelSend[]

  switch (message.type) {
    case 'text':
      sends = [{ type: 'text', text: message.text }]
      break
    case 'quick_replies': {
      const replies = message.replies.map((reply) => reply.trim()).filter(Boolean)
      if (replies.length === 0) { sends = [{ type: 'text', text: message.text }]; break }
      const picked = choose(message.text, replies, limits, 'Quick replies')
      sends = picked.send
      if (picked.note) notes.push(picked.note)
      break
    }
    case 'card': {
      const text = cardText(message)
      if (message.imageUrl) notes.push(`Card image: ${limits.label} gets the image as a link.`)
      if (message.buttons?.length) {
        const picked = choose(text, message.buttons, limits, 'Card buttons')
        sends = picked.send
        if (picked.note) notes.push(picked.note)
      } else sends = [{ type: 'text', text }]
      break
    }
    case 'carousel': {
      const titles = message.cards.map((card) => card.title)
      const intro = message.text ?? ''
      notes.push(`Carousel: ${limits.label} has no carousel, so each card becomes one choice.`)
      const picked = choose(intro || 'Choose one:', titles, limits, 'Carousel cards')
      sends = picked.send
      if (picked.note) notes.push(picked.note)
      break
    }
    case 'list': {
      const rows = message.items.map((item) => item.title)
      const { list } = limits
      if (list && rows.length <= list.max && longest(rows) <= list.labelMax) {
        sends = [{ type: 'list', text: message.text, button: message.button ?? LIST_BUTTON, rows }]
      } else {
        const why = !list ? `${limits.label} has no list menus` : rows.length > list.max ? `${limits.label} lists hold ${list.max} rows and this has ${rows.length}` : `${limits.label} list rows hold ${list.labelMax} characters`
        const lines = message.items.map((item) => (item.text ? `${item.title}: ${item.text}` : item.title))
        sends = [{ type: 'text', text: numbered(message.text, lines, Boolean(limits.spoken)) }]
        notes.push(`List: ${why}, so it is sent as numbered text.`)
      }
      break
    }
    case 'media':
      sends = [{ type: 'text', text: [message.caption, message.url].filter(Boolean).join('\n') }]
      notes.push(`${message.kind === 'image' ? 'Image' : message.kind === 'video' ? 'Video' : 'File'}: ${limits.label} gets it as a link.`)
      break
    case 'form':
      sends = [{ type: 'text', text: numbered(`${message.title}\nPlease reply with:`, message.fields.map((field) => field.label), Boolean(limits.spoken)) }]
      notes.push(`Form: ${limits.label} has no forms, so the fields are asked in one message.`)
      break
    case 'feedback': {
      const picked = choose(message.question, ['Yes', 'No'], limits, 'Feedback')
      sends = picked.send
      if (picked.note) notes.push(picked.note)
      break
    }
  }

  const split: ChannelSend[] = []
  for (const send of sends) {
    const max = send.type === 'text' ? limits.textMax : (limits.choiceTextMax ?? limits.textMax)
    const pieces = splitText(send.text, max)
    if (pieces.length > 1) notes.push(`Long text: ${limits.label} takes ${max.toLocaleString('en-GB')} characters per ${send.type === 'text' ? 'message' : 'message with choices'}, so it goes out as ${pieces.length} messages.`)
    if (pieces.length === 0 && send.type === 'text') continue
    pieces.slice(0, -1).forEach((text) => split.push({ type: 'text', text }))
    split.push({ ...send, text: pieces.at(-1) ?? '' })
  }
  return { sends: split, notes }
}

/** A reply of just "2" picks the second choice; the numbered fallback asks guests to answer that way. */
export function numberedChoice(choices: readonly string[] | undefined, heard: string): string | undefined {
  if (!choices?.length) return undefined
  const match = /^\s*(\d{1,2})\s*[.)]?\s*$/.exec(heard)
  if (!match) return undefined
  return choices[Number(match[1]) - 1]
}

export interface LimitRow {
  content: string
  shows: string
  fallback: string
}

/** The per-channel table the console shows: what fits, and what happens when it does not. */
export function channelLimitRows(kind: LimitChannel): LimitRow[] {
  const limits = CHANNEL_LIMITS[kind]
  const { buttons, list } = limits
  const choiceFallback = limits.spoken ? 'Read out after the question' : 'Numbered list; the guest answers by number or words'
  const count = (n: number) => n.toLocaleString('en-GB')
  return [
    {
      content: 'Text',
      shows: `Up to ${count(limits.textMax)} characters per message${limits.choiceTextMax ? `, ${count(limits.choiceTextMax)} above buttons or a menu` : ''}`,
      fallback: 'Split at paragraphs or sentences into several messages',
    },
    {
      content: 'Quick replies',
      shows: buttons ? `Up to ${buttons.max} buttons, ${buttons.labelMax} characters each` : 'No buttons',
      fallback: list ? `A "${LIST_BUTTON}" menu of up to ${list.max} rows (${list.labelMax} characters), then a numbered list` : choiceFallback,
    },
    { content: 'Card', shows: 'Title and text; the image as a link', fallback: buttons ? 'Buttons follow the quick-reply rule' : choiceFallback },
    { content: 'Carousel', shows: 'No carousel', fallback: 'Each card becomes one choice, then the quick-reply rule' },
    {
      content: 'List',
      shows: list ? `Menu of up to ${list.max} rows, ${list.labelMax} characters each` : 'No list menus',
      fallback: limits.spoken ? 'Read out' : 'Numbered text',
    },
    { content: 'Media', shows: 'Sent as a link', fallback: 'The caption goes with the link' },
    { content: 'Form', shows: 'No forms', fallback: 'The fields are asked in one message' },
    { content: 'Feedback', shows: buttons ? 'Yes / No buttons' : 'No buttons', fallback: buttons ? 'None needed' : choiceFallback },
  ]
}
