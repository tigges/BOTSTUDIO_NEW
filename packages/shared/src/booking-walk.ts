/**
 * A booking chapter that qualifies the request, then takes contact details.
 * Colour does not jump to a promotion: it asks what they need, offers a cut with
 * the colour, then a senior (preferred) or junior stylist, a time, a name, and a
 * mobile so the studio can confirm in chat and by text.
 */

import { namedLink } from './chat-links.js'
import { NAME_QUESTION } from './contact-speech.js'
import type { StarterFlow } from './flow-templates.js'

/** Already named the colour work — skip asking which kind. */
export const COLOUR_NEED_ROUTE = {
  handle: 'colour-need',
  phrases: [
    'full head', 'roots', 'in-between', 'in between', 'half head',
    'highlights', 'balayage', 'foiliage', 'illumina', 't-section', 't section',
  ],
}

export const COLOUR_ROUTE = {
  handle: 'colour',
  phrases: [
    'going lighter', 'go lighter', 'lighter', 'box dye', 'henna',
    'a colour', 'a color', 'colour', 'color',
  ],
}

export const CUT_ROUTE = {
  handle: 'cut',
  phrases: ['haircut', 'a cut', 'a trim', 'trim', 'fringe'],
}

export const TREATMENT_ROUTE = {
  handle: 'treatment',
  phrases: ['skin scrub', 'keratin', 'a treatment', 'treatment'],
}

export const CONSULT_ROUTE = {
  handle: 'consult',
  phrases: ['consultation'],
}

export const QUALIFY_COLOUR = 'What colour work are you thinking of — roots, a full head, or highlights?'
export const UPSELL_CUT = 'Would you like a cut with the colour as well?'
export const STYLIST_QUESTION = 'Would you like a senior stylist — that is the usual choice — or a junior stylist?'
export const TIME_QUESTION = 'When would suit you?'
export const MOBILE_QUESTION = 'What mobile number should I send the confirmation to?'

const YES_ROUTE = {
  handle: 'yes',
  phrases: ['yes', 'yeah', 'please', 'ok', 'okay', 'yep', 'both', 'cut and colour', 'cut and color', 'with a cut'],
}
const NO_ROUTE = {
  handle: 'no',
  phrases: ['no', 'nope', 'just colour', 'just color', 'colour only', 'color only'],
}
const SENIOR_ROUTE = {
  handle: 'senior',
  phrases: ['senior', 'senior stylist', 'preferred', 'usual', 'experienced'],
}
const JUNIOR_ROUTE = {
  handle: 'junior',
  phrases: ['junior', 'junior stylist'],
}

function ask(id: string, x: number, y: number, label: string, question: string, variable: string) {
  return { id, type: 'flow-node', position: { x, y }, data: { kind: 'ask_question', label, config: { question, variable } } }
}

function say(id: string, x: number, y: number, label: string, text: string) {
  return { id, type: 'flow-node', position: { x, y }, data: { kind: 'send_message', label, config: { text } } }
}

export function confirmBookingLine(input: {
  booking?: { url: string; label: string } | null
  extra?: string
}): string {
  const extra = input.extra?.trim() ? ` ${input.extra.trim()}` : ''
  const link = input.booking
    ? ` You can also open it on ${namedLink(input.booking.label, input.booking.url)}.`
    : ''
  return `I'll confirm this {{stylist}} booking for {{preferred_time}} in this chat, and I'll text {{mobile}} as well.${extra}${link}`
}

export function bookAppointmentFlow(input: {
  publish: boolean
  tags?: string[]
  description?: string
  booking?: { url: string; label: string } | null
  timeQuestion?: string
  confirmExtra?: string
  salonBranches?: boolean
}): StarterFlow {
  const y = 80
  const timeQuestion = input.timeQuestion ?? TIME_QUESTION
  const confirm = confirmBookingLine({ booking: input.booking, extra: input.confirmExtra })
  const serviceRoutes = input.salonBranches
    ? [COLOUR_NEED_ROUTE, COLOUR_ROUTE, CUT_ROUTE, TREATMENT_ROUTE, CONSULT_ROUTE]
    : [COLOUR_NEED_ROUTE, COLOUR_ROUTE, CUT_ROUTE, TREATMENT_ROUTE]
  const nodes: object[] = [
    { id: 'b-start', type: 'flow-node', position: { x: 40, y }, data: { kind: 'trigger_start', label: 'Book', config: {} } },
    { id: 'b-save', type: 'flow-node', position: { x: 260, y }, data: { kind: 'set_variable', label: 'Keep the request', config: { variable: 'topic', value: '{{_last_user_message}}' } } },
    { id: 'b-route', type: 'flow-node', position: { x: 500, y }, data: { kind: 'route_topic', label: 'What they want', config: { routes: serviceRoutes } } },
    ask('b-want', 740, y + 360, 'Ask what they want', 'What would you like done? A cut, colour, or something else is fine, and not sure is fine too.', 'request'),
    { id: 'b-route2', type: 'flow-node', position: { x: 1000, y: y + 360 }, data: { kind: 'route_topic', label: 'Route the answer', config: { routes: serviceRoutes } } },
    say('b-more', 1260, y + 500, 'Ask again', 'Tell me a little more about what you would like, even if you are not sure.'),
    ask('b-qualify', 740, y - 280, 'Colour need', QUALIFY_COLOUR, 'colour_need'),
    ask('b-upsell', 1000, y - 280, 'Cut as well', UPSELL_CUT, 'cut_with_colour'),
    { id: 'b-upsell-route', type: 'flow-node', position: { x: 1260, y: y - 280 }, data: { kind: 'route_topic', label: 'Cut with colour', config: { routes: [YES_ROUTE, NO_ROUTE] } } },
    ask('b-stylist', 1520, y - 280, 'Stylist', STYLIST_QUESTION, 'stylist'),
    { id: 'b-stylist-route', type: 'flow-node', position: { x: 1760, y: y - 280 }, data: { kind: 'route_topic', label: 'Senior or junior', config: { routes: [SENIOR_ROUTE, JUNIOR_ROUTE] } } },
    { id: 'b-senior', type: 'flow-node', position: { x: 2000, y: y - 360 }, data: { kind: 'set_variable', label: 'Senior', config: { variable: 'stylist', value: 'senior' } } },
    { id: 'b-junior', type: 'flow-node', position: { x: 2000, y: y - 200 }, data: { kind: 'set_variable', label: 'Junior', config: { variable: 'stylist', value: 'junior' } } },
    ask('b-time', 2240, y - 280, 'When', timeQuestion, 'preferred_time'),
    { id: 'b-named', type: 'flow-node', position: { x: 2480, y: y - 280 }, data: { kind: 'condition', label: 'Name known?', config: { conditions: [{ field: 'contact.name', operator: 'equals', value: 'there' }] } } },
    ask('b-name', 2480, y - 440, 'Name', NAME_QUESTION, 'guest_name'),
    ask('b-mobile', 2720, y - 280, 'Mobile', MOBILE_QUESTION, 'mobile'),
    say('b-close', 2960, y - 280, 'Confirm', confirm),
    { id: 'b-ticket', type: 'flow-node', position: { x: 3200, y: y - 280 }, data: { kind: 'create_ticket', label: 'Inbox', config: { subject: 'Booking for {{preferred_time}}', description: '{{topic}} {{colour_need}} {{stylist}} {{mobile}}' } } },
    { id: 'b-end', type: 'flow-node', position: { x: 3440, y: 200 }, data: { kind: 'end_flow', label: 'End', config: {} } },
  ]
  const edges: object[] = [
    { id: 'e-start', source: 'b-start', target: 'b-save' },
    { id: 'e-save', source: 'b-save', target: 'b-route' },
    { id: 'e-colour-need', source: 'b-route', target: 'b-upsell', sourceHandle: 'colour-need' },
    { id: 'e-colour', source: 'b-route', target: 'b-qualify', sourceHandle: 'colour' },
    { id: 'e-other', source: 'b-route', target: 'b-want', sourceHandle: 'other' },
    { id: 'e-want', source: 'b-want', target: 'b-route2' },
    { id: 'e2-colour-need', source: 'b-route2', target: 'b-upsell', sourceHandle: 'colour-need' },
    { id: 'e2-colour', source: 'b-route2', target: 'b-qualify', sourceHandle: 'colour' },
    { id: 'e2-other', source: 'b-route2', target: 'b-more', sourceHandle: 'other' },
    { id: 'e-more', source: 'b-more', target: 'b-end' },
    { id: 'e-qualify', source: 'b-qualify', target: 'b-upsell' },
    { id: 'e-upsell', source: 'b-upsell', target: 'b-upsell-route' },
    { id: 'e-upsell-yes', source: 'b-upsell-route', target: 'b-stylist', sourceHandle: 'yes' },
    { id: 'e-upsell-no', source: 'b-upsell-route', target: 'b-stylist', sourceHandle: 'no' },
    { id: 'e-upsell-other', source: 'b-upsell-route', target: 'b-stylist', sourceHandle: 'other' },
    { id: 'e-stylist', source: 'b-stylist', target: 'b-stylist-route' },
    { id: 'e-senior', source: 'b-stylist-route', target: 'b-senior', sourceHandle: 'senior' },
    { id: 'e-junior', source: 'b-stylist-route', target: 'b-junior', sourceHandle: 'junior' },
    { id: 'e-stylist-other', source: 'b-stylist-route', target: 'b-senior', sourceHandle: 'other' },
    { id: 'e-senior-time', source: 'b-senior', target: 'b-time' },
    { id: 'e-junior-time', source: 'b-junior', target: 'b-time' },
    { id: 'e-time', source: 'b-time', target: 'b-named' },
    { id: 'e-named-yes', source: 'b-named', target: 'b-name', sourceHandle: 'yes' },
    { id: 'e-named-no', source: 'b-named', target: 'b-mobile', sourceHandle: 'no' },
    { id: 'e-name', source: 'b-name', target: 'b-mobile' },
    { id: 'e-mobile', source: 'b-mobile', target: 'b-close' },
    { id: 'e-close', source: 'b-close', target: 'b-ticket' },
    { id: 'e-ticket', source: 'b-ticket', target: 'b-end' },
  ]

  if (input.salonBranches) {
    nodes.push(
      { id: 'b-cut-named', type: 'flow-node', position: { x: 740, y: y + 40 }, data: { kind: 'condition', label: 'Name known?', config: { conditions: [{ field: 'contact.name', operator: 'equals', value: 'there' }] } } },
      ask('b-cut-name', 740, y - 80, 'Name', NAME_QUESTION, 'guest_name'),
      ask('b-been', 1000, y + 40, 'Been before?', 'Have you been to us before?', 'been_before'),
      { id: 'b-been-route', type: 'flow-node', position: { x: 1260, y: y + 40 }, data: { kind: 'route_topic', label: 'New or returning', config: { routes: [
        { handle: 'returning', phrases: ['i have been', "i've been", 'been in before', 'regular', 'returning', 'yes i have'] },
        { handle: 'first', phrases: ['first time', 'first visit', 'never been', 'not been', 'not yet', "haven't", 'have not', 'new here'] },
      ] } } },
      ask('b-return-time', 1520, y + 40, 'Cut time', timeQuestion, 'preferred_time'),
      say('b-return-close', 1760, y + 40, 'Cut close', `I have noted a cut for {{preferred_time}}. The studio will confirm the exact time in this chat.${input.confirmExtra ? ` ${input.confirmExtra}` : ''}`),
      ask('b-cut-hope', 1520, y + 200, 'The cut', 'What are you hoping for with the cut?', 'cut_hope'),
      ask('b-cut-photo', 1760, y + 200, 'Cut photo', 'Can you send a photo of your hair now, and any looks you like? A description is fine too.', 'photo_note'),
      ask('b-cut-time', 2000, y + 200, 'First cut time', `We can start with a free 15-minute chat about the cut. ${timeQuestion}`, 'preferred_time'),
      say('b-cut-close', 2240, y + 200, 'First cut close', `I have noted a cut for {{preferred_time}}. The studio will confirm the exact time in this chat.${input.confirmExtra ? ` ${input.confirmExtra}` : ''}`),
      ask('b-treat-time', 740, y + 480, 'Treatment time', timeQuestion, 'preferred_time'),
      say('b-treat-close', 1000, y + 480, 'Treatment close', `I have noted {{request}} for {{preferred_time}}. The studio will confirm the exact time in this chat.${input.confirmExtra ? ` ${input.confirmExtra}` : ''}`),
      { id: 'b-consult', type: 'flow-node', position: { x: 740, y: y + 640 }, data: { kind: 'execute_flow', label: 'Consultation', config: { flowName: 'Consultation' } } },
    )
    edges.push(
      { id: 'e-cut', source: 'b-route', target: 'b-cut-named', sourceHandle: 'cut' },
      { id: 'e-treatment', source: 'b-route', target: 'b-treat-time', sourceHandle: 'treatment' },
      { id: 'e-consult', source: 'b-route', target: 'b-consult', sourceHandle: 'consult' },
      { id: 'e2-cut', source: 'b-route2', target: 'b-cut-named', sourceHandle: 'cut' },
      { id: 'e2-treatment', source: 'b-route2', target: 'b-treat-time', sourceHandle: 'treatment' },
      { id: 'e2-consult', source: 'b-route2', target: 'b-consult', sourceHandle: 'consult' },
      { id: 'e-cut-named-yes', source: 'b-cut-named', target: 'b-cut-name', sourceHandle: 'yes' },
      { id: 'e-cut-named-no', source: 'b-cut-named', target: 'b-been', sourceHandle: 'no' },
      { id: 'e-cut-name', source: 'b-cut-name', target: 'b-been' },
      { id: 'e-been', source: 'b-been', target: 'b-been-route' },
      { id: 'e-returning', source: 'b-been-route', target: 'b-return-time', sourceHandle: 'returning' },
      { id: 'e-first', source: 'b-been-route', target: 'b-cut-hope', sourceHandle: 'first' },
      { id: 'e-been-other', source: 'b-been-route', target: 'b-cut-hope', sourceHandle: 'other' },
      { id: 'e-return-time', source: 'b-return-time', target: 'b-return-close' },
      { id: 'e-return-close', source: 'b-return-close', target: 'b-ticket' },
      { id: 'e-cut-hope', source: 'b-cut-hope', target: 'b-cut-photo' },
      { id: 'e-cut-photo', source: 'b-cut-photo', target: 'b-cut-time' },
      { id: 'e-cut-time', source: 'b-cut-time', target: 'b-cut-close' },
      { id: 'e-cut-close', source: 'b-cut-close', target: 'b-ticket' },
      { id: 'e-treat-time', source: 'b-treat-time', target: 'b-treat-close' },
      { id: 'e-treat-close', source: 'b-treat-close', target: 'b-ticket' },
    )
  } else {
    edges.push(
      { id: 'e-cut', source: 'b-route', target: 'b-stylist', sourceHandle: 'cut' },
      { id: 'e-treatment', source: 'b-route', target: 'b-stylist', sourceHandle: 'treatment' },
      { id: 'e2-cut', source: 'b-route2', target: 'b-stylist', sourceHandle: 'cut' },
      { id: 'e2-treatment', source: 'b-route2', target: 'b-stylist', sourceHandle: 'treatment' },
    )
  }

  return {
    name: 'Book an appointment',
    description: input.description ?? 'Qualifies a colour or cut, then confirms the booking in chat and by text.',
    tags: input.tags ?? ['salon', 'template', 'booking'],
    publish: input.publish,
    graph: { nodes, edges },
  }
}
