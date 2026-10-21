/**
 * Centralised demo/mock data used when the backend is not reachable.
 * These mirror the seed.ts data so the GitHub Pages demo looks realistic.
 */

import type {
  Flow, FlowVersion, Intent, Entity, Faq, KnowledgeSource,
  Conversation, Message, Contact, Campaign, Template,
  Webhook, TeamMember, AnalyticsOverview, ConversationTrend, AuditEvent,
  BotSettingsView, SystemStatus, SystemConfig, Channel,
} from './api'

// ── Flows ─────────────────────────────────────────────────────────────────────
const Y = 200
const mkNode = (id: string, x: number, kind: string, label: string, config: Record<string, unknown> = {}) =>
  ({ id, type: 'flow-node', position: { x, y: Y }, data: { kind, label, config } })
const mkEdge = (id: string, source: string, target: string, label?: string) =>
  ({ id, source, target, label, sourceHandle: label, type: 'default' })

const WELCOME_GRAPH = {
  nodes: [
    mkNode('n1',   80, 'trigger',      'Start',          { event: 'conversation.started' }),
    mkNode('n2',  320, 'send_message', 'Greeting',       { text: 'Sandbox greeting. This is the rehearsal copy.' }),
    mkNode('n3',  580, 'ask_question', 'Route',          { question: 'Choose an option:', options: ['Order / Delivery', 'Returns & Refunds', 'Billing', 'Speak to an agent'], variable: 'route' }),
    mkNode('n4',  840, 'route_topic',  'Route check',    { routes: [
      { handle: 'order', phrases: ['order', 'delivery'] },
      { handle: 'return', phrases: ['return', 'refund'] },
      { handle: 'agent', phrases: ['agent', 'speak to an agent', 'person'] },
    ] }),
    mkNode('n5', 1100, 'handover',     'Agent handover', { team: 'support' }),
    mkNode('n6', 1360, 'execute_flow', 'Order Status',   { flowName: 'Order Status' }),
    mkNode('n7', 1620, 'execute_flow', 'Return Request', { flowName: 'Return Request' }),
  ],
  edges: [
    mkEdge('e1', 'n1', 'n2'),
    mkEdge('e2', 'n2', 'n3'),
    mkEdge('e3', 'n3', 'n4'),
    mkEdge('e4', 'n4', 'n5', 'agent'),
    mkEdge('e5', 'n4', 'n6', 'order'),
    mkEdge('e6', 'n4', 'n7', 'return'),
  ],
}

const ORDER_GRAPH = {
  nodes: [
    mkNode('n1',  80,  'trigger',      'Start',           { event: 'intent.order_status' }),
    mkNode('n2',  320, 'ask_question', 'Order number',    { question: 'What\'s your order number? (e.g. AC-483920)', variable: 'order_number', validate: 'regex' }),
    mkNode('n3',  580, 'http_request', 'Lookup order',    { method: 'GET', url: 'https://api.acme.com/orders/{{order_number}}', headers: {}, resultVariable: 'order' }),
    mkNode('n4',  840, 'send_message', 'Status reply',    { text: 'Order {{order.id}} is currently **{{order.status}}**. Estimated delivery: {{order.estimatedDelivery}}.' }),
    mkNode('n5', 1100, 'send_message', 'Closing',         { text: 'Is there anything else I can help you with?' }),
  ],
  edges: [mkEdge('e1','n1','n2'), mkEdge('e2','n2','n3'), mkEdge('e3','n3','n4'), mkEdge('e4','n4','n5')],
}

const RETURN_GRAPH = {
  nodes: [
    mkNode('n1',  80,  'trigger',      'Start',           { event: 'intent.return_request' }),
    mkNode('n2',  320, 'ask_question', 'Order number',    { question: 'Please share your order number:', variable: 'order_number' }),
    mkNode('n3',  580, 'ask_question', 'Return reason',   { question: 'What\'s the reason for return?', options: ['Damaged / defective', 'Wrong item', 'Changed my mind', 'Other'], variable: 'reason' }),
    mkNode('n4',  840, 'send_message', 'Confirm return',  { text: 'Got it! I\'ll raise a return for order {{order_number}}. You\'ll receive a prepaid label by email within 2 hours.' }),
    mkNode('n5', 1100, 'set_variable', 'Tag conversation',{ variable: 'tags', value: 'return,pending-label' }),
    mkNode('n6', 1360, 'handover',     'Notify team',     { team: 'returns', silent: true }),
  ],
  edges: [mkEdge('e1','n1','n2'), mkEdge('e2','n2','n3'), mkEdge('e3','n3','n4'), mkEdge('e4','n4','n5'), mkEdge('e5','n5','n6')],
}

const WELCOME_PRODUCTION = {
  nodes: WELCOME_GRAPH.nodes.map((node) => node.id === 'n2'
    ? { ...node, data: { ...node.data, config: { text: 'Production greeting. This is the live widget copy.' } } }
    : node),
  edges: WELCOME_GRAPH.edges,
}

export const DEMO_FLOWS: Flow[] = [
  { id: 'f1', name: 'Welcome & Routing',  description: 'Greets visitors and routes to the right flow', kind: 'flow', tags: ['welcome', 'routing'], updatedAt: '2026-09-18T10:00:00Z',
    versions: [
      { id: 'fv1s', version: 2, status: 'published', environmentId: 'demo-env-sandbox', graph: WELCOME_GRAPH, publishedAt: '2026-09-18T10:00:00Z' },
      { id: 'fv1p', version: 1, status: 'published', environmentId: 'demo-env-prod', graph: WELCOME_PRODUCTION, publishedAt: '2026-09-11T10:00:00Z' },
    ] },
  { id: 'f2', name: 'Order Status',       description: 'Looks up order details via API',                kind: 'flow', tags: ['orders', 'api'],     updatedAt: '2026-09-17T14:00:00Z',
    versions: [
      { id: 'fv2s', version: 2, status: 'published', environmentId: 'demo-env-sandbox', graph: ORDER_GRAPH, publishedAt: '2026-09-17T14:00:00Z' },
      { id: 'fv2p', version: 1, status: 'published', environmentId: 'demo-env-prod', graph: ORDER_GRAPH, publishedAt: '2026-09-10T09:00:00Z' },
    ] },
  { id: 'f3', name: 'Return Request',     description: 'Handles returns and creates tickets',            kind: 'flow', tags: ['returns', 'tickets'], updatedAt: '2026-09-15T08:00:00Z',
    versions: [{ id: 'fv3', version: 1, status: 'published', environmentId: 'demo-env-sandbox', graph: RETURN_GRAPH, publishedAt: '2026-09-12T11:00:00Z' }] },
  { id: 'f4', name: 'Lead Capture',       description: 'Qualifies inbound leads and pushes to CRM',     kind: 'flow', tags: ['sales', 'crm'],       updatedAt: '2026-09-14T16:00:00Z',
    versions: [{ id: 'fv4', version: 1, status: 'draft', graph: { nodes: [mkNode('n1',80,'trigger','Start',{event:'conversation.started'})], edges: [] } }] },
  { id: 'f5', name: 'CSAT Survey',        description: 'Post-conversation satisfaction survey',          kind: 'flow', tags: ['csat', 'survey'],     updatedAt: '2026-09-13T12:00:00Z',
    versions: [{ id: 'fv5', version: 1, status: 'published', environmentId: 'demo-env-prod', graph: { nodes: [], edges: [] }, publishedAt: '2026-09-08T10:00:00Z' }] },
]

// ── Knowledge ─────────────────────────────────────────────────────────────────
export const DEMO_INTENTS: Intent[] = [
  { id: 'i1', name: 'greeting', description: 'User says hello', utterances: ['hi', 'hello', 'hey there', 'good morning', 'howdy'], responses: [{ text: 'Hello! How can I help?' }] },
  { id: 'i2', name: 'order_status', description: 'Order tracking request', utterances: ['where is my order', 'track my order', 'order status', 'when will my order arrive'], responses: [{ text: "I'll look that up! What's your order number?" }] },
  { id: 'i3', name: 'return_request', description: 'Return or refund request', utterances: ['i want to return', 'return my order', 'refund request', 'send item back'], responses: [{ text: 'I can help with that return!' }] },
  { id: 'i4', name: 'billing_query', description: 'Invoice or payment question', utterances: ['billing question', 'invoice query', 'why was I charged', 'payment issue'], responses: [{ text: 'Let me check your billing details.' }] },
  { id: 'i5', name: 'password_reset', description: 'Login / access issue', utterances: ['forgot password', 'reset password', 'cant log in', 'locked out'], responses: [{ text: "I'll send a password reset link right away." }] },
  { id: 'i6', name: 'escalate_to_agent', description: 'Human handover request', utterances: ['speak to a human', 'talk to agent', 'real person', 'live chat'], responses: [{ text: "Connecting you with an agent now." }] },
  { id: 'i7', name: 'product_info', description: 'Product / pricing questions', utterances: ['product info', 'pricing', 'how does X work', 'demo request'], responses: [{ text: 'Happy to share more details!' }] },
  { id: 'i8', name: 'cancel_subscription', description: 'Cancellation intent', utterances: ['cancel my subscription', 'cancel account', 'stop service', 'unsubscribe'], responses: [{ text: "I'm sorry to hear that. May I ask what prompted this?" }] },
]

export const DEMO_ENTITIES: Entity[] = [
  { id: 'e1', name: 'order_number', kind: 'regex', values: [{ pattern: '^[A-Z]{2}-\\d{6}$', examples: ['AC-123456'] }] },
  { id: 'e2', name: 'product_category', kind: 'list', values: [{ value: 'electronics', synonyms: ['gadgets', 'tech'] }, { value: 'clothing', synonyms: ['apparel', 'fashion'] }] },
  { id: 'e3', name: 'return_reason', kind: 'list', values: [{ value: 'defective', synonyms: ['broken', 'faulty'] }, { value: 'wrong_item', synonyms: ['incorrect'] }, { value: 'changed_mind', synonyms: ['no longer need'] }] },
  { id: 'e4', name: 'subscription_plan', kind: 'list', values: [{ value: 'free' }, { value: 'pro', synonyms: ['premium'] }, { value: 'enterprise', synonyms: ['business'] }] },
  { id: 'e5', name: 'date_reference', kind: 'system', values: [{ type: 'date', examples: ['today', 'tomorrow', 'next week'] }] },
]

export const DEMO_FAQS: Faq[] = [
  { id: 'q1', question: 'What is your return policy?', answer: 'We offer a 30-day hassle-free return policy. Items must be in original condition.', tags: ['returns', 'policy'] },
  { id: 'q2', question: 'How long does shipping take?', answer: 'Standard shipping takes 3-5 business days. Express (1-2 days) available at checkout.', tags: ['shipping', 'delivery'] },
  { id: 'q3', question: 'How do I track my order?', answer: 'Once shipped you\'ll receive a tracking number by email. You can also check My Orders in your account.', tags: ['orders', 'tracking'] },
  { id: 'q4', question: 'Do you offer a free trial?', answer: 'Yes! All plans include a 14-day free trial, no credit card required.', tags: ['trial', 'pricing'] },
  { id: 'q5', question: 'How do I cancel my subscription?', answer: 'Cancel anytime from Account > Billing > Cancel Plan. Active until end of billing cycle.', tags: ['cancel', 'billing'] },
  { id: 'q6', question: 'What payment methods do you accept?', answer: 'Visa, Mastercard, Amex, PayPal, and bank transfer for annual plans.', tags: ['payment', 'billing'] },
  { id: 'q7', question: 'Is my data secure?', answer: 'Yes — SOC 2 Type II certified, GDPR compliant, AES-256 encryption at rest.', tags: ['security', 'privacy'] },
  { id: 'q8', question: 'Do you have a mobile app?', answer: 'iOS and Android apps available for agents. The web widget is fully mobile-responsive.', tags: ['mobile', 'app'] },
]

export const DEMO_SOURCES: KnowledgeSource[] = [
  { id: 's1', name: 'acme.com/help', kind: 'website', config: { url: 'https://acme.com/help', depth: 3 }, lastSyncAt: new Date(Date.now() - 2 * 3600_000).toISOString(), documents: [{ id: 'd1', status: 'indexed' }, { id: 'd2', status: 'indexed' }, { id: 'd3', status: 'indexed' }] },
  { id: 's2', name: 'Product Manual v3.pdf', kind: 'file', config: { filename: 'product-manual-v3.pdf', size_bytes: 2_450_000 }, lastSyncAt: new Date(Date.now() - 24 * 3600_000).toISOString(), documents: [{ id: 'd4', status: 'indexed' }] },
]

export const DEMO_CHANNELS: Channel[] = [
  { id: 'ch_demo_web_test', name: 'Website chat', kind: 'web', environmentId: 'demo-env-sandbox', config: { accentColor: '#6366f1', title: 'Chat with us' }, isActive: true, botId: 'demo', createdAt: new Date(Date.now() - 7 * 86400_000).toISOString() },
  { id: 'ch_demo_web', name: 'Website chat', kind: 'web', environmentId: 'demo-env-prod', config: { accentColor: '#6366f1', title: 'Chat with us' }, isActive: true, botId: 'demo', createdAt: new Date(Date.now() - 7 * 86400_000).toISOString() },
  { id: 'ch_demo_wa', name: 'WhatsApp', kind: 'whatsapp', environmentId: 'demo-env-sandbox', config: { phoneNumberId: '15550001234', verifyToken: 'demo-verify' }, secretsSet: ['accessToken'], isActive: true, botId: 'demo', createdAt: new Date(Date.now() - 14 * 86400_000).toISOString() },
  { id: 'ch_demo_email', name: 'Email', kind: 'email', environmentId: 'demo-env-sandbox', config: { fromAddress: 'support@acme.com' }, secretsSet: ['inboundSecret'], isActive: false, botId: 'demo', createdAt: new Date(Date.now() - 30 * 86400_000).toISOString() },
]

export const DEMO_BOT_SETTINGS: BotSettingsView = {
  settings: { model: 'gemini-flash-latest', responseLength: 'medium', toolWaitEscalateSeconds: 20 },
  connected: { GEMINI_API_KEY: true },
}

// ── Conversations ─────────────────────────────────────────────────────────────
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()

export const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: 'c0', status: 'active', assignedTo: undefined,
    contact: { id: 'ct0', displayName: 'hi', metadata: {}, createdAt: ago(30) },
    channel: { id: 'ch1', name: 'Web Widget', kind: 'web' },
    // Stored the way an older welcome saved it. The inbox must say "there", never the braces.
    messages: [
      { id: 'm0a', direction: 'inbound', authorKind: 'user', content: { text: 'hi' }, createdAt: ago(4) },
      { id: 'm0b', direction: 'outbound', authorKind: 'bot', content: { text: 'Hi {{contact.name}}! 👋 Welcome to Bella Hair Studio. How can I help you today? What do you need help with?' }, createdAt: ago(4) },
      { id: 'm0c', direction: 'outbound', authorKind: 'bot', content: { text: "What's your name?" }, createdAt: ago(3) },
    ],
    labels: [],
    updatedAt: ago(4),
  },
  {
    id: 'c1', status: 'active', assignedTo: 'sarah',
    contact: { id: 'ct1', displayName: 'Alice Johnson', email: 'alice@example.com', phone: '+44 7700 100001', metadata: { company: 'Startup Ltd', vip: true }, createdAt: ago(120) },
    channel: { id: 'ch1', name: 'Web Widget', kind: 'web' },
    messages: [
      { id: 'm1', direction: 'inbound', authorKind: 'user', content: { text: "Hi, I placed an order last Tuesday but haven't received any shipping update." }, createdAt: ago(12) },
      { id: 'm2', direction: 'outbound', authorKind: 'bot', content: { text: "Hi Alice! I'd be happy to look into that. Could you share your order number?" }, createdAt: ago(11) },
      { id: 'm3', direction: 'inbound', authorKind: 'user', content: { text: 'Sure, it\'s AC-483920' }, createdAt: ago(10) },
      { id: 'm4', direction: 'outbound', authorKind: 'bot', content: { text: 'Thanks! Your order AC-483920 is with DPD — estimated delivery tomorrow 9am–6pm.' }, createdAt: ago(10) },
      { id: 'm5', direction: 'inbound', authorKind: 'user', content: { text: 'Yes please, that would be great!' }, createdAt: ago(8) },
      { id: 'm6', direction: 'outbound', authorKind: 'agent', content: { text: "Hi Alice, this is Sarah. I've sent the full tracking link to your email. Let me know if you need anything else!" }, createdAt: ago(5) },
    ],
    labels: [{ label: { id: 'l2', name: 'vip', color: '#f59e0b' } }],
    updatedAt: ago(5),
  },
  {
    id: 'c2', status: 'active', assignedTo: undefined,
    contact: { id: 'ct2', displayName: 'Bob Smith', email: 'bob@example.com', metadata: { company: 'Tech Inc' }, createdAt: ago(200) },
    channel: { id: 'ch1', name: 'Web Widget', kind: 'web' },
    messages: [
      { id: 'm7', direction: 'inbound', authorKind: 'user', content: { text: 'I want to return a product I received yesterday' }, createdAt: ago(8) },
      { id: 'm8', direction: 'outbound', authorKind: 'bot', content: { text: 'I can help! Could you share your order number and reason for the return?' }, createdAt: ago(7) },
      { id: 'm9', direction: 'inbound', authorKind: 'user', content: { text: 'Order AC-512311 — it arrived damaged' }, createdAt: ago(6) },
    ],
    labels: [{ label: { id: 'l1', name: 'urgent', color: '#ef4444' } }],
    updatedAt: ago(6),
  },
  {
    id: 'c3', status: 'active', assignedTo: 'mike',
    contact: { id: 'ct3', displayName: 'Carol White', email: 'carol@example.com', phone: '+44 7700 100003', metadata: { company: 'Enterprise Co', vip: true }, createdAt: ago(300) },
    channel: { id: 'ch2', name: 'WhatsApp Business', kind: 'whatsapp' },
    messages: [
      { id: 'm10', direction: 'inbound', authorKind: 'user', content: { text: 'Hello I have a billing question about my invoice this month' }, createdAt: ago(24) },
      { id: 'm11', direction: 'outbound', authorKind: 'agent', content: { text: 'Hi Carol! What would you like to know?' }, createdAt: ago(23) },
      { id: 'm12', direction: 'inbound', authorKind: 'user', content: { text: "There's an extra £49 charge I don't recognise" }, createdAt: ago(22) },
    ],
    labels: [{ label: { id: 'l3', name: 'billing', color: '#6366f1' } }],
    updatedAt: ago(22),
  },
  {
    id: 'c4', status: 'resolved', assignedTo: 'anna',
    contact: { id: 'ct4', displayName: 'David Lee', email: 'david@example.com', metadata: {}, createdAt: ago(400) },
    channel: { id: 'ch3', name: 'Email', kind: 'email' },
    messages: [
      { id: 'm13', direction: 'inbound', authorKind: 'user', content: { text: "Hi, I forgot my password and can't log in" }, createdAt: ago(60) },
      { id: 'm14', direction: 'outbound', authorKind: 'bot', content: { text: "No problem! I've sent a reset link to your email." }, createdAt: ago(59) },
      { id: 'm15', direction: 'inbound', authorKind: 'user', content: { text: 'Got it, thank you!' }, createdAt: ago(55) },
    ],
    labels: [],
    updatedAt: ago(55),
  },
  {
    id: 'c5', status: 'escalated', assignedTo: undefined,
    contact: { id: 'ct5', displayName: 'Eve Brown', email: 'eve@example.com', metadata: {}, createdAt: ago(500) },
    channel: { id: 'ch1', name: 'Web Widget', kind: 'web' },
    messages: [
      { id: 'm16', direction: 'inbound', authorKind: 'user', content: { text: 'I need to speak to a manager immediately' }, createdAt: ago(74) },
      { id: 'm17', direction: 'outbound', authorKind: 'bot', content: { text: 'I understand. Escalating to our supervisor team right away.' }, createdAt: ago(73) },
    ],
    labels: [{ label: { id: 'l1', name: 'urgent', color: '#ef4444' } }],
    updatedAt: ago(73),
  },
]

// ── Contacts ──────────────────────────────────────────────────────────────────
export const DEMO_CONTACTS: Contact[] = [
  { id: 'ct1', displayName: 'Alice Johnson', email: 'alice@example.com', phone: '+44 7700 100001', metadata: { company: 'Startup Ltd', plan: 'pro', vip: true }, createdAt: ago(120 * 60) },
  { id: 'ct2', displayName: 'Bob Smith', email: 'bob@example.com', phone: '+44 7700 100002', metadata: { company: 'Tech Inc', plan: 'free' }, createdAt: ago(200 * 60) },
  { id: 'ct3', displayName: 'Carol White', email: 'carol@example.com', phone: '+44 7700 100003', metadata: { company: 'Enterprise Co', plan: 'enterprise', vip: true }, createdAt: ago(300 * 60) },
  { id: 'ct4', displayName: 'David Lee', email: 'david@example.com', metadata: { company: 'SME Ltd', plan: 'free' }, createdAt: ago(400 * 60) },
  { id: 'ct5', displayName: 'Eve Brown', email: 'eve@example.com', phone: '+44 7700 100005', metadata: { company: 'Agency Now', plan: 'pro' }, createdAt: ago(500 * 60) },
  { id: 'ct6', displayName: 'Frank Wilson', email: 'frank@example.com', metadata: { company: 'Retail Co', plan: 'pro', vip: true }, createdAt: ago(600 * 60) },
]

// ── Campaigns ─────────────────────────────────────────────────────────────────
// Extra fields (channel, audience, etc.) satisfy the Campaigns page's local interface.
export const DEMO_CAMPAIGNS = [
  { id: 'camp1', name: 'September Newsletter', status: 'completed', direction: 'outbound',
    channel: 'email', audience: 8400, sent: 8400, opened: 4620, clicked: 980,
    template: 'Monthly Newsletter', createdAt: '5d ago',
    sentAt: new Date(Date.now() - 3 * 86400_000).toISOString() },
  { id: 'camp2', name: 'Abandoned Cart Recovery', status: 'running', direction: 'outbound',
    channel: 'email', audience: 3200, sent: 1842, opened: 1220, clicked: 345,
    template: 'Cart Recovery', createdAt: '1d ago' },
  { id: 'camp3', name: 'Q4 Product Launch', status: 'scheduled', direction: 'outbound',
    channel: 'whatsapp', audience: 12450, template: 'Product Launch', createdAt: '2d ago',
    scheduledAt: new Date(Date.now() + 10 * 86400_000).toISOString() },
  { id: 'camp4', name: 'Win-back: 90-day inactive', status: 'draft', direction: 'outbound',
    channel: 'sms', audience: 0, createdAt: '3h ago' },
] as unknown as Campaign[]

// ── Templates ─────────────────────────────────────────────────────────────────
// All fields match the Templates page's local Template interface
// (status, body, category, language, usedIn, createdAt, updatedAt).
export const DEMO_TEMPLATES = [
  { id: 't1', name: 'Order Confirmation', channel: 'whatsapp',
    status: 'approved', category: 'transactional', language: 'en',
    body: 'Hi {{1}}! Your order #{{2}} is confirmed and will be delivered by {{3}}. Track here: {{4}}',
    usedIn: 8, createdAt: '1m ago', updatedAt: '1w ago',
    approvalStatus: 'approved', content: { body: '' }, variables: ['customer_name', 'order_number', 'delivery_date', 'tracking_url'] },
  { id: 't2', name: 'Shipping Update', channel: 'whatsapp',
    status: 'approved', category: 'transactional', language: 'en',
    body: 'Order #{{1}} is on its way! Tracking: {{2}}. ETA: {{3}}.',
    usedIn: 5, createdAt: '1m ago', updatedAt: '1w ago',
    approvalStatus: 'approved', content: { body: '' }, variables: ['order_number', 'tracking_url', 'eta'] },
  { id: 't3', name: 'Return Confirmation', channel: 'whatsapp',
    status: 'pending', category: 'transactional', language: 'en',
    body: 'Hi {{1}}, return for order #{{2}} received. Refund of {{3}} in 3–5 days.',
    usedIn: 2, createdAt: '3w ago', updatedAt: '2d ago',
    approvalStatus: 'pending', content: { body: '' }, variables: ['customer_name', 'order_number', 'refund_amount'] },
  { id: 't4', name: 'Welcome Email', channel: 'email',
    status: 'approved', category: 'transactional', language: 'en',
    body: 'Hi {{first_name}}, welcome aboard! Your account is ready. Get started here: {{link}}',
    usedIn: 14, createdAt: '2m ago', updatedAt: '2m ago',
    approvalStatus: 'approved', content: { body: '' }, variables: ['first_name', 'link'] },
  { id: 't5', name: 'Cart Abandonment', channel: 'email',
    status: 'approved', category: 'marketing', language: 'en',
    body: 'Hey {{1}}, you left something behind! Complete your purchase and save 10% with code COMEBACK.',
    usedIn: 3, createdAt: '3w ago', updatedAt: '5d ago',
    approvalStatus: 'approved', content: { body: '' }, variables: ['first_name'] },
  { id: 't6', name: 'OTP Verification', channel: 'sms',
    status: 'approved', category: 'utility', language: 'en',
    body: 'Your BotStudio verification code is {{1}}. Valid for 10 minutes. Do not share this code.',
    usedIn: 12, createdAt: '2m ago', updatedAt: '2m ago',
    approvalStatus: 'approved', content: { body: '' }, variables: ['otp_code'] },
  { id: 't7', name: 'CSAT Survey', channel: 'whatsapp',
    status: 'approved', category: 'support', language: 'en',
    body: 'Hi {{1}}, how did we do? Rate your experience 1–5 ⭐. Your feedback helps us improve!',
    usedIn: 6, createdAt: '1m ago', updatedAt: '3d ago',
    approvalStatus: 'approved', content: { body: '' }, variables: ['customer_name'] },
  { id: 't8', name: 'Support Ticket Created', channel: 'email',
    status: 'approved', category: 'support', language: 'en',
    body: 'Hi {{1}}, your support ticket #{{2}} has been created. We\'ll respond within 24h. View: {{3}}',
    usedIn: 4, createdAt: '2m ago', updatedAt: '2m ago',
    approvalStatus: 'approved', content: { body: '' }, variables: ['first_name', 'ticket_id', 'ticket_url'] },
  { id: 't9', name: 'Appointment Reminder', channel: 'sms',
    status: 'approved', category: 'utility', language: 'en',
    body: 'Reminder: your appointment is on {{1}} at {{2}}. Reply CANCEL to cancel.',
    usedIn: 3, createdAt: '1m ago', updatedAt: '4d ago',
    approvalStatus: 'approved', content: { body: '' }, variables: ['date', 'time'] },
  { id: 't10', name: 'Black Friday Sale', channel: 'email',
    status: 'approved', category: 'marketing', language: 'en',
    body: '🛍️ Our biggest sale of the year is here! Up to 60% off everything. Use code BLACKFRIDAY.',
    usedIn: 1, createdAt: '2w ago', updatedAt: '3d ago',
    approvalStatus: 'approved', content: { body: '' }, variables: [] },
  { id: 't11', name: 'Re-engagement Nudge', channel: 'whatsapp',
    status: 'draft', category: 'marketing', language: 'en',
    body: 'Hi {{1}}! We miss you 👋 It\'s been a while. Here\'s 15% off your next order: {{2}}',
    usedIn: 0, createdAt: '1w ago', updatedAt: '1d ago',
    approvalStatus: 'draft', content: { body: '' }, variables: ['customer_name', 'discount_code'] },
  { id: 't12', name: 'Delivery Failed', channel: 'sms',
    status: 'approved', category: 'transactional', language: 'en',
    body: 'We couldn\'t deliver order #{{1}}. Schedule redelivery: {{2}} or collect from: {{3}}',
    usedIn: 2, createdAt: '3w ago', updatedAt: '1w ago',
    approvalStatus: 'approved', content: { body: '' }, variables: ['order_number', 'redeliver_url', 'pickup_address'] },
] as unknown as Template[]

// ── Webhooks ──────────────────────────────────────────────────────────────────
// Extra fields (status, successRate, lastTriggered) satisfy the Webhooks page's local interface.
export const DEMO_WEBHOOKS = [
  { id: 'wh1', url: 'https://hooks.zapier.com/hooks/catch/12345/abc',
    events: ['conversation.created', 'message.received', 'conversation.resolved'],
    isActive: true, status: 'active', successRate: 98.2, lastTriggered: '2m ago',
    createdAt: '3 months ago' },
  { id: 'wh2', url: 'https://api.hubspot.com/webhooks/v3/receive',
    events: ['contact.created', 'conversation.created'],
    isActive: true, status: 'active', successRate: 100, lastTriggered: '45m ago',
    createdAt: '2 months ago' },
  { id: 'wh3', url: 'https://n8n.acme.io/webhook/botstudio-tickets',
    events: ['ticket.created', 'ticket.updated'],
    isActive: false, status: 'error', successRate: 54, lastTriggered: '3h ago',
    createdAt: '1 month ago' },
] as unknown as Webhook[]

// ── Team ──────────────────────────────────────────────────────────────────────
export const DEMO_TEAM: TeamMember[] = [
  { id: 'u1', displayName: 'Charles', email: 'charles@acme.com', memberships: [{ role: 'ADMIN' }], agentProfile: { status: 'online' } },
  { id: 'u2', displayName: 'Sarah K', email: 'sarah@acme.com', memberships: [{ role: 'SUPERVISOR' }], agentProfile: { status: 'online' } },
  { id: 'u3', displayName: 'Mike R', email: 'mike@acme.com', memberships: [{ role: 'AGENT' }], agentProfile: { status: 'online' } },
  { id: 'u4', displayName: 'Tom B', email: 'tom@acme.com', memberships: [{ role: 'AGENT' }], agentProfile: { status: 'away' } },
  { id: 'u5', displayName: 'Anna W', email: 'anna@acme.com', memberships: [{ role: 'AGENT' }], agentProfile: { status: 'online' } },
  { id: 'u6', displayName: 'James O', email: 'james@acme.com', memberships: [{ role: 'AGENT' }], agentProfile: { status: 'offline' } },
]

// ── Analytics ─────────────────────────────────────────────────────────────────
export const DEMO_ANALYTICS_OVERVIEW: AnalyticsOverview = {
  totalConversations: 851, resolvedConversations: 777, resolutionRate: 91.4,
  escalationRate: 9.1, totalContacts: 1247, csatScore: 84.5,
  avgResponseTimeMs: 1400, botHandledPct: 64,
}

export const DEMO_CONVERSATION_TRENDS: ConversationTrend[] = [
  { date: 'Sep 14', conversations: 120, resolved: 98, escalated: 22 },
  { date: 'Sep 15', conversations: 145, resolved: 118, escalated: 27 },
  { date: 'Sep 16', conversations: 98, resolved: 82, escalated: 16 },
  { date: 'Sep 17', conversations: 160, resolved: 140, escalated: 20 },
  { date: 'Sep 18', conversations: 175, resolved: 155, escalated: 20 },
  { date: 'Sep 19', conversations: 88, resolved: 76, escalated: 12 },
  { date: 'Sep 20', conversations: 65, resolved: 58, escalated: 7 },
]

export const DEMO_AUDIT: AuditEvent[] = [
  { id: 'a1', action: 'bot.published', resource: 'bot', metadata: { env: 'production' }, createdAt: ago(10), user: { displayName: 'Charles', email: 'charles@acme.com' } },
  { id: 'a2', action: 'flow.updated', resource: 'flow', metadata: { nodes_changed: 3 }, createdAt: ago(30), user: { displayName: 'Sarah K', email: 'sarah@acme.com' } },
  { id: 'a3', action: 'template.approved', resource: 'template', metadata: { channel: 'whatsapp' }, createdAt: ago(60), user: { displayName: 'Charles', email: 'charles@acme.com' } },
  { id: 'a4', action: 'user.invited', resource: 'user', metadata: { role: 'AGENT' }, createdAt: ago(90), user: { displayName: 'Charles', email: 'charles@acme.com' } },
  { id: 'a5', action: 'user.login', resource: 'session', metadata: { ip: '10.0.0.55' }, createdAt: ago(120), user: { displayName: 'Mike R', email: 'mike@acme.com' } },
  { id: 'a6', action: 'webhook.created', resource: 'webhook', metadata: { url: 'https://hooks.zapier.com/…' }, createdAt: ago(240), user: { displayName: 'Charles', email: 'charles@acme.com' } },
  { id: 'a7', action: 'api_key.created', resource: 'api_key', metadata: { name: 'API key #1' }, createdAt: ago(360), user: { displayName: 'Charles', email: 'charles@acme.com' } },
  { id: 'a8', action: 'knowledge.synced', resource: 'knowledge_source', metadata: { pages: 284, chunks: 1204 }, createdAt: ago(480), user: { displayName: 'Anna W', email: 'anna@acme.com' } },
]

// ── System Status ─────────────────────────────────────────────────────────────
export const DEMO_SYSTEM_STATUS: SystemStatus = {
  services: {
    database: { ok: true, latencyMs: 4 },
    redis: { ok: true, latencyMs: 1 },
  },
  containers: [
    { id: 'a1b2c3d4e5f6', name: 'botstudio-api', image: 'ghcr.io/tigges/botstudio-api:latest', state: 'running', status: 'Up 3 hours (healthy)' },
    { id: 'b2c3d4e5f6a1', name: 'botstudio-web', image: 'ghcr.io/tigges/botstudio-web:latest', state: 'running', status: 'Up 3 hours' },
    { id: 'c3d4e5f6a1b2', name: 'botstudio-caddy', image: 'caddy:2-alpine', state: 'running', status: 'Up 3 hours' },
    { id: 'd4e5f6a1b2c3', name: 'botstudio-postgres', image: 'pgvector/pgvector:pg16', state: 'running', status: 'Up 3 hours (healthy)' },
    { id: 'e5f6a1b2c3d4', name: 'botstudio-valkey', image: 'valkey/valkey:7-alpine', state: 'running', status: 'Up 3 hours (healthy)' },
    { id: 'f6a1b2c3d4e5', name: 'botstudio-minio', image: 'quay.io/minio/minio:latest', state: 'running', status: 'Up 3 hours (healthy)' },
  ],
  rag: {
    sources: 3,
    documents: 284,
    chunks: 1204,
    sourceList: [
      { id: 'ks1', name: 'Help Center', lastSyncAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), _count: { documents: 148 } },
      { id: 'ks2', name: 'Product FAQ', lastSyncAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), _count: { documents: 89 } },
      { id: 'ks3', name: 'Policy Documents', lastSyncAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), _count: { documents: 47 } },
    ],
  },
  system: {
    platform: 'linux',
    uptime: 11520,
    nodeVersion: 'v22.0.0',
    cpuCount: 4,
    totalMemMb: 8192,
    freeMemMb: 3276,
    usedMemPct: 60,
  },
  ts: new Date().toISOString(),
}

// ── System Config ─────────────────────────────────────────────────────────────
export const DEMO_SYSTEM_CONFIG: SystemConfig = {
  auth: {
    JWT_SECRET: { set: true, label: 'JWT Secret' },
  },
  database: {
    DATABASE_URL: { set: true, label: 'PostgreSQL', endpoint: 'postgresql://postgres:5432' },
  },
  cache: {
    REDIS_URL: { set: true, label: 'Redis / Valkey', endpoint: 'redis://valkey:6379' },
  },
  storage: {
    S3_ENDPOINT: { set: true, label: 'S3 / MinIO endpoint', endpoint: 'http://minio:9000' },
    S3_BUCKET:   { set: true, label: 'S3 Bucket', value: 'ybot-uploads' },
    S3_REGION:   { set: true, label: 'S3 Region', value: 'us-east-1' },
  },
  llm: {
    LLM_PROVIDER:      { set: true, label: 'Tried in order: Ollama (llama3.2)', value: null },
    GEMINI_API_KEY:    { set: false, label: 'Gemini API Key' },
    ANTHROPIC_API_KEY: { set: false, label: 'Claude (Anthropic) API Key' },
    OLLAMA_BASE_URL:   { set: true, label: 'Ollama Base URL', endpoint: 'http://host.docker.internal:11434' },
    OPENAI_API_KEY:    { set: false, label: 'OpenAI API Key' },
    GROQ_API_KEY:      { set: false, label: 'Groq API Key' },
  },
  app: {
    NODE_ENV:     { set: true, label: 'Environment', value: 'production' },
    FRONTEND_URL: { set: true, label: 'Frontend URL', value: 'http://192.168.0.11:7080' },
  },
}
