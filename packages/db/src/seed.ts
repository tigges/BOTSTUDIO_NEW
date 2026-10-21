import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// ── Helpers ──────────────────────────────────────────────────────────────────
function nodeGraph(nodes: object[], edges: object[]) {
  return { nodes, edges }
}

async function main() {
  console.log('🌱 Seeding database...')

  // Clean slate
  await prisma.activity.deleteMany()
  await prisma.stepLog.deleteMany()
  await prisma.conversationLabel.deleteMany()
  await prisma.label.deleteMany()
  await prisma.message.deleteMany()
  await prisma.ticket.deleteMany()
  await prisma.conversation.deleteMany()
  await prisma.documentChunk.deleteMany()
  await prisma.document.deleteMany()
  await prisma.knowledgeSource.deleteMany()
  await prisma.faq.deleteMany()
  await prisma.entity.deleteMany()
  await prisma.intent.deleteMany()
  await prisma.template.deleteMany()
  await prisma.campaign.deleteMany()
  await prisma.contact.deleteMany()
  await prisma.webhook.deleteMany()
  await prisma.channel.deleteMany()
  await prisma.flowVersion.deleteMany()
  await prisma.flow.deleteMany()
  await prisma.widget.deleteMany()
  await prisma.dashboard.deleteMany()
  await prisma.report.deleteMany()
  await prisma.agentProfile.deleteMany()
  await prisma.membership.deleteMany()
  await prisma.user.deleteMany()
  await prisma.bot.deleteMany()
  await prisma.tenant.deleteMany()

  // ── Tenant ────────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.create({
    data: { name: 'Acme Corp', slug: 'acme-corp', dataRegion: 'eu', plan: 'pro' },
  })
  console.log(`✅ Tenant: ${tenant.name}`)

  // ── Users ─────────────────────────────────────────────────────────────────
  const hash = (pw: string) => bcrypt.hash(pw, 10)

  const [admin, sarah, mike, tom, anna, james] = await Promise.all([
    prisma.user.create({ data: { tenantId: tenant.id, email: 'charles@acme.com', displayName: 'Charles', passwordHash: await hash('password123') } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'sarah@acme.com', displayName: 'Sarah K', passwordHash: await hash('password123') } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'mike@acme.com', displayName: 'Mike R', passwordHash: await hash('password123') } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'tom@acme.com', displayName: 'Tom B', passwordHash: await hash('password123') } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'anna@acme.com', displayName: 'Anna W', passwordHash: await hash('password123') } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'james@acme.com', displayName: 'James O', passwordHash: await hash('password123') } }),
  ])

  await Promise.all([
    prisma.membership.create({ data: { tenantId: tenant.id, userId: admin.id, role: 'ADMIN' } }),
    prisma.membership.create({ data: { tenantId: tenant.id, userId: sarah.id, role: 'SUPERVISOR' } }),
    prisma.membership.create({ data: { tenantId: tenant.id, userId: mike.id, role: 'AGENT' } }),
    prisma.membership.create({ data: { tenantId: tenant.id, userId: tom.id, role: 'AGENT' } }),
    prisma.membership.create({ data: { tenantId: tenant.id, userId: anna.id, role: 'AGENT' } }),
    prisma.membership.create({ data: { tenantId: tenant.id, userId: james.id, role: 'AGENT' } }),
  ])

  await Promise.all([
    prisma.agentProfile.create({ data: { tenantId: tenant.id, userId: sarah.id, displayName: 'Sarah K', status: 'online' } }),
    prisma.agentProfile.create({ data: { tenantId: tenant.id, userId: mike.id, displayName: 'Mike R', status: 'online' } }),
    prisma.agentProfile.create({ data: { tenantId: tenant.id, userId: tom.id, displayName: 'Tom B', status: 'away' } }),
    prisma.agentProfile.create({ data: { tenantId: tenant.id, userId: anna.id, displayName: 'Anna W', status: 'online' } }),
    prisma.agentProfile.create({ data: { tenantId: tenant.id, userId: james.id, displayName: 'James O', status: 'offline' } }),
  ])
  console.log(`✅ 6 users + agent profiles`)

  // ── Bot + environments ────────────────────────────────────────────────────
  const bot = await prisma.bot.create({
    data: {
      tenantId: tenant.id,
      name: 'Acme Support Bot',
      description: 'AI-powered customer support for Acme Corp',
      status: 'active',
      environments: {
        create: [
          { tenantId: tenant.id, kind: 'sandbox', name: 'Sandbox' },
          { tenantId: tenant.id, kind: 'production', name: 'Production' },
        ],
      },
    },
    include: { environments: true },
  })
  const sandbox = bot.environments.find((e) => e.kind === 'sandbox')!
  const production = bot.environments.find((e) => e.kind === 'production')!
  console.log(`✅ Bot: ${bot.name}`)

  // ── Channels ──────────────────────────────────────────────────────────────
  const [webChannel, waChannel, emailChannel] = await Promise.all([
    prisma.channel.create({ data: {
      tenantId: tenant.id, botId: bot.id, environmentId: production.id,
      name: 'Web Widget', kind: 'web', isActive: true,
      config: { domain: 'acme.com', color: '#6366f1', position: 'bottom-right', greeting: 'Hi! How can I help you today?' },
    }}),
    prisma.channel.create({ data: {
      tenantId: tenant.id, botId: bot.id, environmentId: production.id,
      name: 'WhatsApp Business', kind: 'whatsapp', isActive: false,
      config: { phone: '+44 7700 900000', business_id: 'WA-123456', display_name: 'Acme Support' },
    }}),
    prisma.channel.create({ data: {
      tenantId: tenant.id, botId: bot.id, environmentId: production.id,
      name: 'Email', kind: 'email', isActive: false,
      config: { address: 'support@acme.com', imap_host: 'imap.gmail.com', imap_port: '993' },
    }}),
    prisma.channel.create({ data: {
      tenantId: tenant.id, botId: bot.id, environmentId: production.id,
      name: 'SMS (Twilio)', kind: 'sms', isActive: false,
      config: { phone: '+44 1234 567890', account_sid: 'ACxxx', status: 'error' },
    }}),
  ])
  console.log(`✅ 4 channels`)

  // ── Flows ─────────────────────────────────────────────────────────────────
  const Y = 100
  const welcomeGraph = nodeGraph([
    { id: 'start-1', type: 'flowNode', position: { x: 80, y: Y }, data: { kind: 'trigger_start', label: 'Conversation Start', config: {} } },
    { id: 'send-1', type: 'flowNode', position: { x: 280, y: Y }, data: { kind: 'send_message', label: 'Welcome Message', config: { text: 'Hi {{contact.name}}! 👋 Welcome to Acme Support. How can I help you today?' } } },
    { id: 'ask-1', type: 'flowNode', position: { x: 480, y: Y }, data: { kind: 'ask_question', label: 'Ask for topic', config: { question: 'What do you need help with?', variable: 'topic', choices: ['Order status', 'Returns', 'Billing', 'Technical support', 'Other'] } } },
    { id: 'intent-1', type: 'flowNode', position: { x: 680, y: Y }, data: { kind: 'classify_intent', label: 'Classify intent', config: {} } },
    { id: 'cond-1', type: 'flowNode', position: { x: 880, y: Y }, data: { kind: 'condition', label: 'Route by intent', config: { conditions: [{ field: 'intent', operator: 'equals', value: 'order_status' }, { field: 'intent', operator: 'equals', value: 'return_request' }] } } },
    { id: 'end-1', type: 'flowNode', position: { x: 1080, y: Y }, data: { kind: 'end_flow', label: 'End', config: {} } },
  ], [
    { id: 'e1', source: 'start-1', target: 'send-1' },
    { id: 'e2', source: 'send-1', target: 'ask-1' },
    { id: 'e3', source: 'ask-1', target: 'intent-1' },
    { id: 'e4', source: 'intent-1', target: 'cond-1' },
    { id: 'e5', source: 'cond-1', target: 'end-1' },
  ])

  const orderGraph = nodeGraph([
    { id: 's1', type: 'flowNode', position: { x: 80, y: Y }, data: { kind: 'trigger_start', label: 'Order Status Trigger', config: {} } },
    { id: 's2', type: 'flowNode', position: { x: 280, y: Y }, data: { kind: 'ask_question', label: 'Ask order number', config: { question: 'Please share your order number. The sample order is 1001.', variable: 'order_number' } } },
    { id: 'sample-order', type: 'flowNode', position: { x: 480, y: Y }, data: { kind: 'condition', label: 'Sample order?', config: { conditions: [{ field: 'order_number', operator: 'equals', value: '1001' }] } } },
    { id: 'sample-reply', type: 'flowNode', position: { x: 700, y: Y - 120 }, data: { kind: 'send_message', label: 'Sample order', config: { text: 'Order 1001 is on its way. It shipped this morning.' } } },
    { id: 's3', type: 'flowNode', position: { x: 700, y: Y + 120 }, data: { kind: 'http_request', label: 'Fetch order', config: { method: 'GET', url: 'https://api.acme.com/orders/{{order_number}}', headers: {} } } },
    { id: 's4', type: 'flowNode', position: { x: 920, y: Y + 120 }, data: { kind: 'condition', label: 'Order found?', config: { conditions: [{ field: 'ok', operator: 'equals', value: 'true' }] } } },
    { id: 's5', type: 'flowNode', position: { x: 1140, y: 60 }, data: { kind: 'send_message', label: 'Order details', config: { text: 'Order {{order_number}} came back with status {{status}}.' } } },
    { id: 's6', type: 'flowNode', position: { x: 880, y: 200 }, data: { kind: 'handover', label: 'Escalate to agent', config: { team: 'support', priority: 'medium' } } },
    { id: 's7', type: 'flowNode', position: { x: 1080, y: Y }, data: { kind: 'end_flow', label: 'End', config: {} } },
  ], [
    { id: 'e1', source: 's1', target: 's2' },
    { id: 'e2', source: 's2', target: 'sample-order' },
    { id: 'e-sample-yes', source: 'sample-order', target: 'sample-reply', sourceHandle: 'yes' },
    { id: 'e-sample-no', source: 'sample-order', target: 's3', sourceHandle: 'no' },
    { id: 'e-sample-end', source: 'sample-reply', target: 's7' },
    { id: 'e3', source: 's3', target: 's4' },
    { id: 'e4', source: 's4', sourceHandle: 'yes', target: 's5' },
    { id: 'e5', source: 's4', sourceHandle: 'no', target: 's6' },
    { id: 'e6', source: 's5', target: 's7' },
    { id: 'e7', source: 's6', target: 's7' },
  ])

  const returnGraph = nodeGraph([
    { id: 'r1', type: 'flowNode', position: { x: 80, y: Y }, data: { kind: 'trigger_start', label: 'Return Request', config: {} } },
    { id: 'r2', type: 'flowNode', position: { x: 280, y: Y }, data: { kind: 'send_message', label: 'Policy intro', config: { text: 'I can help with returns! Our return window is 30 days from purchase.' } } },
    { id: 'r3', type: 'flowNode', position: { x: 480, y: Y }, data: { kind: 'ask_question', label: 'Reason for return', config: { question: 'What is the reason for your return?', variable: 'return_reason', choices: ['Defective product', 'Wrong item', 'Changed mind', 'Not as described'] } } },
    { id: 'r4', type: 'flowNode', position: { x: 680, y: Y }, data: { kind: 'set_variable', label: 'Set return type', config: { variable: 'return_type', value: '{{return_reason}}' } } },
    { id: 'r5', type: 'flowNode', position: { x: 880, y: Y }, data: { kind: 'send_message', label: 'Return label', config: { text: 'Great! I\'ll generate a return label for you. You\'ll receive it via email within 5 minutes.' } } },
    { id: 'r6', type: 'flowNode', position: { x: 1080, y: Y }, data: { kind: 'create_ticket', label: 'Create return ticket', config: { subject: 'Return request: {{return_reason}}', priority: 'medium', team: 'returns' } } },
    { id: 'r7', type: 'flowNode', position: { x: 1280, y: Y }, data: { kind: 'end_flow', label: 'End', config: {} } },
  ], [
    { id: 'e1', source: 'r1', target: 'r2' }, { id: 'e2', source: 'r2', target: 'r3' },
    { id: 'e3', source: 'r3', target: 'r4' }, { id: 'e4', source: 'r4', target: 'r5' },
    { id: 'e5', source: 'r5', target: 'r6' }, { id: 'e6', source: 'r6', target: 'r7' },
  ])

  const leadGraph = nodeGraph([
    { id: 'l1', type: 'flowNode', position: { x: 80, y: Y }, data: { kind: 'trigger_start', label: 'Lead Capture Start', config: {} } },
    { id: 'l2', type: 'flowNode', position: { x: 280, y: Y }, data: { kind: 'send_message', label: 'Intro', config: { text: 'Hi! I\'d love to learn more about your needs. Can I ask a few quick questions?' } } },
    { id: 'l3', type: 'flowNode', position: { x: 480, y: Y }, data: { kind: 'ask_question', label: 'Company name', config: { question: 'What company are you from?', variable: 'company' } } },
    { id: 'l4', type: 'flowNode', position: { x: 680, y: Y }, data: { kind: 'ask_question', label: 'Email', config: { question: 'What\'s your work email?', variable: 'email', validate: 'email' } } },
    { id: 'l5', type: 'flowNode', position: { x: 880, y: Y }, data: { kind: 'ask_question', label: 'Team size', config: { question: 'How large is your team?', variable: 'team_size', choices: ['1-10', '11-50', '51-200', '200+'] } } },
    { id: 'l6', type: 'flowNode', position: { x: 1080, y: Y }, data: { kind: 'http_request', label: 'Push to CRM', config: { method: 'POST', url: 'https://api.hubspot.com/contacts/v1/contact', body: { email: '{{email}}', company: '{{company}}', team_size: '{{team_size}}' } } } },
    { id: 'l7', type: 'flowNode', position: { x: 1280, y: Y }, data: { kind: 'send_message', label: 'Confirm', config: { text: 'Thanks {{contact.name}}! One of our team will be in touch within 24 hours.' } } },
    { id: 'l8', type: 'flowNode', position: { x: 1480, y: Y }, data: { kind: 'end_flow', label: 'End', config: {} } },
  ], [
    { id: 'e1', source: 'l1', target: 'l2' }, { id: 'e2', source: 'l2', target: 'l3' },
    { id: 'e3', source: 'l3', target: 'l4' }, { id: 'e4', source: 'l4', target: 'l5' },
    { id: 'e5', source: 'l5', target: 'l6' }, { id: 'e6', source: 'l6', target: 'l7' },
    { id: 'e7', source: 'l7', target: 'l8' },
  ])

  const surveyGraph = nodeGraph([
    { id: 'sv1', type: 'flowNode', position: { x: 80, y: Y }, data: { kind: 'trigger_start', label: 'CSAT Trigger', config: { event: 'conversation.resolved' } } },
    { id: 'sv2', type: 'flowNode', position: { x: 280, y: Y }, data: { kind: 'send_message', label: 'Thank you', config: { text: 'Thanks for reaching out! We\'d love your feedback on this conversation.' } } },
    { id: 'sv3', type: 'flowNode', position: { x: 480, y: Y }, data: { kind: 'ask_question', label: 'CSAT score', config: { question: 'How would you rate your experience? (1-5)', variable: 'csat_score', choices: ['⭐ 1', '⭐⭐ 2', '⭐⭐⭐ 3', '⭐⭐⭐⭐ 4', '⭐⭐⭐⭐⭐ 5'] } } },
    { id: 'sv4', type: 'flowNode', position: { x: 680, y: Y }, data: { kind: 'condition', label: 'Score < 3?', config: { conditions: [{ field: 'csat_score', operator: 'less_than', value: '3' }] } } },
    { id: 'sv5', type: 'flowNode', position: { x: 880, y: 60 }, data: { kind: 'ask_question', label: 'Ask for feedback', config: { question: 'We\'re sorry to hear that. What could we do better?', variable: 'feedback' } } },
    { id: 'sv6', type: 'flowNode', position: { x: 880, y: 200 }, data: { kind: 'send_message', label: 'Positive response', config: { text: 'Wonderful! Thank you for the 5-star rating 🌟' } } },
    { id: 'sv7', type: 'flowNode', position: { x: 1080, y: Y }, data: { kind: 'end_flow', label: 'End', config: {} } },
  ], [
    { id: 'e1', source: 'sv1', target: 'sv2' }, { id: 'e2', source: 'sv2', target: 'sv3' },
    { id: 'e3', source: 'sv3', target: 'sv4' }, { id: 'e4', source: 'sv4', sourceHandle: 'yes', target: 'sv5' },
    { id: 'e5', source: 'sv4', sourceHandle: 'no', target: 'sv6' }, { id: 'e6', source: 'sv5', target: 'sv7' },
    { id: 'e7', source: 'sv6', target: 'sv7' },
  ])

  const [welcomeFlow, orderFlow, returnFlow, leadFlow, surveyFlow] = await Promise.all([
    prisma.flow.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Welcome & Routing', description: 'Greets visitors and routes them to the right flow', kind: 'flow', tags: ['welcome', 'routing'] } }),
    prisma.flow.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Order Status', description: 'Looks up order details via API and presents status', kind: 'flow', tags: ['orders', 'api'] } }),
    prisma.flow.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Return Request', description: 'Handles product return requests and creates tickets', kind: 'flow', tags: ['returns', 'tickets'] } }),
    prisma.flow.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Lead Capture', description: 'Qualifies inbound leads and pushes to HubSpot CRM', kind: 'flow', tags: ['sales', 'crm'] } }),
    prisma.flow.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'CSAT Survey', description: 'Post-conversation satisfaction survey with conditional paths', kind: 'flow', tags: ['csat', 'survey'] } }),
  ])

  await Promise.all([
    prisma.flowVersion.create({ data: { tenantId: tenant.id, flowId: welcomeFlow.id, environmentId: production.id, version: 1, status: 'published', graph: welcomeGraph, publishedAt: new Date() } }),
    prisma.flowVersion.create({ data: { tenantId: tenant.id, flowId: welcomeFlow.id, version: 2, status: 'draft', graph: welcomeGraph } }),
    prisma.flowVersion.create({ data: { tenantId: tenant.id, flowId: orderFlow.id, environmentId: production.id, version: 1, status: 'published', graph: orderGraph, publishedAt: new Date() } }),
    prisma.flowVersion.create({ data: { tenantId: tenant.id, flowId: returnFlow.id, environmentId: production.id, version: 1, status: 'published', graph: returnGraph, publishedAt: new Date() } }),
    prisma.flowVersion.create({ data: { tenantId: tenant.id, flowId: leadFlow.id, version: 1, status: 'draft', graph: leadGraph } }),
    prisma.flowVersion.create({ data: { tenantId: tenant.id, flowId: surveyFlow.id, environmentId: production.id, version: 1, status: 'published', graph: surveyGraph, publishedAt: new Date() } }),
  ])
  console.log(`✅ 5 flows with versions and graphs`)

  // ── Knowledge ─────────────────────────────────────────────────────────────
  await Promise.all([
    prisma.intent.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'greeting', description: 'User is saying hello', utterances: ['hi', 'hello', 'hey there', 'good morning', 'good afternoon', 'howdy', 'sup', "what's up"], responses: [{ text: 'Hello! How can I help you today?' }, { text: 'Hi there! What can I do for you?' }] } }),
    prisma.intent.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'order_status', description: 'User wants to know order status', utterances: ['where is my order', 'track my order', 'order status', 'when will my order arrive', 'track my package', 'order tracking', 'delivery update'], responses: [{ text: "I'll look that up for you! What's your order number?" }] } }),
    prisma.intent.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'return_request', description: 'User wants to return an item', utterances: ['i want to return', 'return my order', 'how do I return', 'refund request', 'send item back', 'return policy', 'initiate return'], responses: [{ text: "I can help with that return! Let me pull up our return policy for you." }] } }),
    prisma.intent.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'billing_query', description: 'Questions about invoices or charges', utterances: ['billing question', 'invoice query', 'why was I charged', 'unexpected charge', 'payment issue', 'subscription billing', 'double charge'], responses: [{ text: "Let me look into your billing details. Can you confirm your account email?" }] } }),
    prisma.intent.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'password_reset', description: 'User needs to reset their password', utterances: ['forgot password', 'reset password', 'cant log in', 'locked out', 'change password', 'password not working', 'lost password'], responses: [{ text: "No problem! I'll send a password reset link to your registered email address." }] } }),
    prisma.intent.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'product_info', description: 'User asking about products', utterances: ['product info', 'tell me about', 'features of', 'pricing', 'how does X work', 'demo request', 'what plans do you offer'], responses: [{ text: "Great question! Let me share the details on that." }] } }),
    prisma.intent.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'cancel_subscription', description: 'User wants to cancel', utterances: ['cancel my subscription', 'cancel account', 'stop service', 'unsubscribe', 'close account', 'dont want to renew'], responses: [{ text: "I'm sorry to hear that. Before we proceed, can I ask what prompted this decision?" }] } }),
    prisma.intent.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'escalate_to_agent', description: 'User wants to speak to a human', utterances: ['speak to a human', 'talk to agent', 'real person', 'live chat', 'customer service', 'get help from human', 'not a bot'], responses: [{ text: "Absolutely! Let me connect you with one of our support agents." }] } }),
  ])

  await Promise.all([
    prisma.entity.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'order_number', kind: 'regex', values: [{ pattern: '^[A-Z]{2}-\\d{6}$', examples: ['AC-123456', 'ORD-789012'] }] } }),
    prisma.entity.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'product_category', kind: 'list', values: [{ value: 'electronics', synonyms: ['gadgets', 'tech', 'devices'] }, { value: 'clothing', synonyms: ['apparel', 'clothes', 'fashion'] }, { value: 'furniture', synonyms: ['home', 'decor'] }] } }),
    prisma.entity.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'return_reason', kind: 'list', values: [{ value: 'defective', synonyms: ['broken', 'faulty', 'damaged', 'not working'] }, { value: 'wrong_item', synonyms: ['incorrect', 'wrong product', 'different item'] }, { value: 'changed_mind', synonyms: ['dont want it', 'no longer need', 'decided not to'] }] } }),
    prisma.entity.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'subscription_plan', kind: 'list', values: [{ value: 'free', synonyms: ['basic', 'starter'] }, { value: 'pro', synonyms: ['professional', 'premium'] }, { value: 'enterprise', synonyms: ['business', 'corporate', 'team'] }] } }),
    prisma.entity.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'date_reference', kind: 'system', values: [{ type: 'date', examples: ['today', 'tomorrow', 'next week', 'last month'] }] } }),
  ])

  await Promise.all([
    prisma.faq.create({ data: { tenantId: tenant.id, botId: bot.id, question: 'What is your return policy?', answer: 'We offer a 30-day hassle-free return policy. Items must be in original condition. Contact us to initiate a return and we\'ll send you a prepaid label.', tags: ['returns', 'policy'] } }),
    prisma.faq.create({ data: { tenantId: tenant.id, botId: bot.id, question: 'How long does shipping take?', answer: 'Standard shipping takes 3-5 business days. Express (1-2 days) and Next-Day options are also available at checkout. International orders take 7-14 days.', tags: ['shipping', 'delivery'] } }),
    prisma.faq.create({ data: { tenantId: tenant.id, botId: bot.id, question: 'How do I track my order?', answer: 'Once shipped, you\'ll receive an email with a tracking number. You can also log into your account and visit "My Orders". Alternatively, just ask me with your order number!', tags: ['orders', 'tracking'] } }),
    prisma.faq.create({ data: { tenantId: tenant.id, botId: bot.id, question: 'Do you offer a free trial?', answer: 'Yes! All plans include a 14-day free trial, no credit card required. You can explore all Pro features and upgrade anytime. Your data is saved when you upgrade.', tags: ['trial', 'pricing', 'subscription'] } }),
    prisma.faq.create({ data: { tenantId: tenant.id, botId: bot.id, question: 'How do I cancel my subscription?', answer: 'You can cancel anytime from Account > Billing > Cancel Plan. Your account stays active until the end of your current billing cycle and you won\'t be charged again.', tags: ['cancel', 'billing', 'subscription'] } }),
    prisma.faq.create({ data: { tenantId: tenant.id, botId: bot.id, question: 'What payment methods do you accept?', answer: 'We accept all major credit/debit cards (Visa, Mastercard, Amex), PayPal, and bank transfer for annual plans over £500. All payments are securely processed via Stripe.', tags: ['payment', 'billing'] } }),
    prisma.faq.create({ data: { tenantId: tenant.id, botId: bot.id, question: 'Can I change my plan?', answer: 'Absolutely! Upgrade or downgrade anytime from Account > Billing. Upgrades are prorated and take effect immediately. Downgrades apply at your next renewal date.', tags: ['plans', 'billing', 'upgrade'] } }),
    prisma.faq.create({ data: { tenantId: tenant.id, botId: bot.id, question: 'Is my data secure?', answer: 'Yes. We are SOC 2 Type II certified, GDPR compliant, and use AES-256 encryption at rest. All traffic is TLS 1.3. Your data is never sold or shared. See our Security page for details.', tags: ['security', 'privacy', 'data'] } }),
    prisma.faq.create({ data: { tenantId: tenant.id, botId: bot.id, question: 'Do you have a mobile app?', answer: 'We have iOS and Android apps for agents to manage conversations on the go. The web widget your customers use is also fully mobile-responsive.', tags: ['mobile', 'app'] } }),
    prisma.faq.create({ data: { tenantId: tenant.id, botId: bot.id, question: 'How do I integrate with my CRM?', answer: 'We offer native integrations with HubSpot, Salesforce, and Zendesk. For others, use our Zapier app or REST API/webhooks. Setup guides are in our docs.', tags: ['integrations', 'crm', 'api'] } }),
  ])

  const [source1, source2] = await Promise.all([
    prisma.knowledgeSource.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'acme.com/help', kind: 'website', config: { url: 'https://acme.com/help', depth: 3, include_patterns: ['/help/*', '/faq/*'] }, lastSyncAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } }),
    prisma.knowledgeSource.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Product Manual v3.pdf', kind: 'file', config: { filename: 'product-manual-v3.pdf', size_bytes: 2_450_000 }, lastSyncAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
  ])
  console.log(`✅ Knowledge: 8 intents, 5 entities, 10 FAQs, 2 sources`)

  // ── Contacts ──────────────────────────────────────────────────────────────
  const contacts = await Promise.all([
    prisma.contact.create({ data: { tenantId: tenant.id, displayName: 'Alice Johnson', email: 'alice@example.com', phone: '+44 7700 100001', metadata: { company: 'Startup Ltd', plan: 'pro', vip: true } } }),
    prisma.contact.create({ data: { tenantId: tenant.id, displayName: 'Bob Smith', email: 'bob@example.com', phone: '+44 7700 100002', metadata: { company: 'Tech Inc', plan: 'free', vip: false } } }),
    prisma.contact.create({ data: { tenantId: tenant.id, displayName: 'Carol White', email: 'carol@example.com', phone: '+44 7700 100003', metadata: { company: 'Enterprise Co', plan: 'enterprise', vip: true } } }),
    prisma.contact.create({ data: { tenantId: tenant.id, displayName: 'David Lee', email: 'david@example.com', metadata: { company: 'SME Ltd', plan: 'free', vip: false } } }),
    prisma.contact.create({ data: { tenantId: tenant.id, displayName: 'Eve Brown', email: 'eve@example.com', phone: '+44 7700 100005', metadata: { company: 'Agency Now', plan: 'pro', vip: false } } }),
    prisma.contact.create({ data: { tenantId: tenant.id, displayName: 'Frank Wilson', email: 'frank@example.com', metadata: { company: 'Retail Co', plan: 'pro', vip: true } } }),
  ])
  console.log(`✅ 6 contacts`)

  // ── Labels ────────────────────────────────────────────────────────────────
  const [l1, l2, l3, l4] = await Promise.all([
    prisma.label.create({ data: { tenantId: tenant.id, name: 'urgent', color: '#ef4444' } }),
    prisma.label.create({ data: { tenantId: tenant.id, name: 'vip', color: '#f59e0b' } }),
    prisma.label.create({ data: { tenantId: tenant.id, name: 'billing', color: '#6366f1' } }),
    prisma.label.create({ data: { tenantId: tenant.id, name: 'technical', color: '#06b6d4' } }),
  ])

  // ── Conversations + Messages ──────────────────────────────────────────────
  type MsgCreate = { direction: 'inbound' | 'outbound'; authorKind: string; content: object }
  async function makeConvo(
    contactIdx: number, channelId: string, status: string, assignedTo: string | null,
    messages: MsgCreate[],
    labelIds: string[] = [],
  ) {
    const contact = contacts[contactIdx]!
    const conv = await prisma.conversation.create({ data: {
      tenantId: tenant.id, botId: bot.id, environmentId: sandbox.id,
      channelId, contactId: contact.id, status,
      assignedTo: assignedTo,
    }})
    for (const m of messages) {
      await prisma.message.create({ data: {
        tenantId: tenant.id, conversationId: conv.id,
        direction: m.direction, authorKind: m.authorKind,
        content: m.content,
      }})
    }
    if (labelIds.length) {
      for (const lid of labelIds) {
        await prisma.conversationLabel.create({ data: { conversationId: conv.id, labelId: lid } })
      }
    }
    return conv
  }

  await makeConvo(0, webChannel.id, 'active', sarah.id, [
    { direction: 'inbound', authorKind: 'user', content: { text: 'Hi, I placed an order last Tuesday but haven\'t received any shipping update.' } },
    { direction: 'outbound', authorKind: 'bot', content: { text: 'Hi Alice! I\'d be happy to look into that. Could you share your order number?' } },
    { direction: 'inbound', authorKind: 'user', content: { text: 'Sure, it\'s AC-483920' } },
    { direction: 'outbound', authorKind: 'bot', content: { text: 'Thanks! Your order AC-483920 is currently with DPD. Estimated delivery is tomorrow between 9am-6pm. Would you like me to send tracking details?' } },
    { direction: 'inbound', authorKind: 'user', content: { text: 'Yes please, that would be great!' } },
    { direction: 'outbound', authorKind: 'agent', content: { text: 'Hi Alice, this is Sarah. I\'ve sent the full tracking link to your email. Let me know if you have any other questions!' } },
  ], [l2.id])

  await makeConvo(1, webChannel.id, 'active', null, [
    { direction: 'inbound', authorKind: 'user', content: { text: 'I want to return a product I received yesterday' } },
    { direction: 'outbound', authorKind: 'bot', content: { text: 'I can help with that return! Could you share your order number and reason for the return?' } },
    { direction: 'inbound', authorKind: 'user', content: { text: 'Order AC-512311 — it arrived damaged' } },
    { direction: 'outbound', authorKind: 'bot', content: { text: 'I\'m sorry to hear that. For damaged items I\'ll escalate to our returns team immediately.' } },
  ], [l1.id, l3.id])

  await makeConvo(2, waChannel.id, 'active', mike.id, [
    { direction: 'inbound', authorKind: 'user', content: { text: 'Hello I have a billing question about my invoice this month' } },
    { direction: 'outbound', authorKind: 'agent', content: { text: 'Hi Carol! Of course, what would you like to know about your invoice?' } },
    { direction: 'inbound', authorKind: 'user', content: { text: 'There\'s an extra £49 charge I don\'t recognise' } },
    { direction: 'outbound', authorKind: 'agent', content: { text: 'I can see that — it\'s the annual seat add-on that was activated on the 1st. Shall I send a detailed breakdown?' } },
  ], [l3.id])

  await makeConvo(3, emailChannel.id, 'resolved', anna.id, [
    { direction: 'inbound', authorKind: 'user', content: { text: 'Hi, I forgot my password and can\'t log in' } },
    { direction: 'outbound', authorKind: 'bot', content: { text: 'No problem! I\'ve sent a password reset link to your registered email address. Check your spam folder if you don\'t see it.' } },
    { direction: 'inbound', authorKind: 'user', content: { text: 'Got it, thank you!' } },
    { direction: 'outbound', authorKind: 'bot', content: { text: 'Great! Is there anything else I can help with today?' } },
  ])

  await makeConvo(4, webChannel.id, 'escalated', null, [
    { direction: 'inbound', authorKind: 'user', content: { text: 'I need to speak to a manager immediately' } },
    { direction: 'outbound', authorKind: 'bot', content: { text: 'I understand. Let me escalate this to our supervisor team right away.' } },
  ], [l1.id])

  console.log(`✅ 5 conversations with messages`)

  // ── Tickets ───────────────────────────────────────────────────────────────
  await Promise.all([
    prisma.ticket.create({ data: { tenantId: tenant.id, conversationId: (await prisma.conversation.findFirst({ where: { tenantId: tenant.id } }))!.id, subject: 'Damaged product return — AC-512311', status: 'open', priority: 'high', assignedTo: mike.id, tags: ['returns', 'urgent'] } }),
    prisma.ticket.create({ data: { tenantId: tenant.id, conversationId: (await prisma.conversation.findFirst({ where: { tenantId: tenant.id } }))!.id, subject: 'Unexpected billing charge investigation', status: 'in_progress', priority: 'medium', assignedTo: sarah.id, tags: ['billing'] } }),
    prisma.ticket.create({ data: { tenantId: tenant.id, conversationId: (await prisma.conversation.findFirst({ where: { tenantId: tenant.id } }))!.id, subject: 'Feature request: bulk export', status: 'pending', priority: 'low', tags: ['feature-request', 'product'] } }),
    prisma.ticket.create({ data: { tenantId: tenant.id, conversationId: (await prisma.conversation.findFirst({ where: { tenantId: tenant.id } }))!.id, subject: 'Password reset email not arriving', status: 'resolved', priority: 'medium', assignedTo: anna.id, resolvedAt: new Date() } }),
  ])
  console.log(`✅ 4 tickets`)

  // ── Templates ─────────────────────────────────────────────────────────────
  await Promise.all([
    prisma.template.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Order Confirmation', channel: 'whatsapp', approvalStatus: 'approved', content: { body: 'Hi {{1}}, your order {{2}} has been confirmed! Expected delivery: {{3}}. Track: https://acme.com/track/{{2}}' }, variables: ['customer_name', 'order_number', 'delivery_date'] } }),
    prisma.template.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Shipping Update', channel: 'whatsapp', approvalStatus: 'approved', content: { body: 'Your order {{1}} is on its way! Courier: {{2}}. Tracking: {{3}}. Estimated delivery: {{4}}.' }, variables: ['order_number', 'courier', 'tracking_url', 'eta'] } }),
    prisma.template.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Return Confirmation', channel: 'whatsapp', approvalStatus: 'pending', content: { body: 'Hi {{1}}, your return for order {{2}} has been received. Refund of {{3}} will appear in 3-5 business days.' }, variables: ['customer_name', 'order_number', 'refund_amount'] } }),
    prisma.template.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Welcome Email', channel: 'email', approvalStatus: 'approved', content: { subject: 'Welcome to Acme!', body: 'Hi {{first_name}},\n\nWelcome aboard! Your account is ready.\n\nGet started at https://app.acme.com\n\nBest, The Acme Team' }, variables: ['first_name'] } }),
    prisma.template.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Cart Abandonment', channel: 'sms', approvalStatus: 'approved', content: { body: 'Hi {{1}}, you left items in your cart! Complete your order: https://acme.com/cart/{{2}} — valid for 24hrs.' }, variables: ['first_name', 'cart_token'] } }),
  ])
  console.log(`✅ 5 message templates`)

  // ── Campaigns ─────────────────────────────────────────────────────────────
  await Promise.all([
    prisma.campaign.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'September Newsletter', direction: 'outbound', status: 'completed', sentAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } }),
    prisma.campaign.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Abandoned Cart Recovery', direction: 'outbound', status: 'running' } }),
    prisma.campaign.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Q4 Product Launch', direction: 'outbound', status: 'scheduled', scheduledAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) } }),
    prisma.campaign.create({ data: { tenantId: tenant.id, botId: bot.id, name: 'Win-back: 90-day inactive', direction: 'outbound', status: 'draft' } }),
  ])
  console.log(`✅ 4 campaigns`)

  // ── Webhooks ──────────────────────────────────────────────────────────────
  await Promise.all([
    prisma.webhook.create({ data: { tenantId: tenant.id, url: 'https://hooks.zapier.com/hooks/catch/12345/abc', events: ['conversation.created', 'message.received', 'conversation.resolved'], isActive: true } }),
    prisma.webhook.create({ data: { tenantId: tenant.id, url: 'https://api.hubspot.com/webhooks/v3/receive', events: ['contact.created', 'conversation.created'], isActive: true } }),
    prisma.webhook.create({ data: { tenantId: tenant.id, url: 'https://n8n.acme.io/webhook/botstudio-tickets', events: ['ticket.created', 'ticket.updated', 'agent.assigned'], isActive: false } }),
  ])
  console.log(`✅ 3 webhooks`)

  // ── Audit activities ──────────────────────────────────────────────────────
  const audits = [
    { userId: admin.id, action: 'bot.published', resource: 'bot', resourceId: bot.id, metadata: { env: 'production' } },
    { userId: sarah.id, action: 'flow.updated', resource: 'flow', resourceId: welcomeFlow.id, metadata: { nodes_changed: 3 } },
    { userId: admin.id, action: 'template.approved', resource: 'template', resourceId: 'tpl-1', metadata: { channel: 'whatsapp' } },
    { userId: admin.id, action: 'user.invited', resource: 'user', resourceId: james.id, metadata: { role: 'AGENT' } },
    { userId: mike.id, action: 'user.login', resource: 'session', metadata: { ip: '10.0.0.55' } },
    { userId: admin.id, action: 'webhook.created', resource: 'webhook', metadata: { url: 'https://hooks.zapier.com/…' } },
    { userId: admin.id, action: 'api_key.created', resource: 'api_key', metadata: { name: 'API key #1', scope: 'read' } },
    { userId: anna.id, action: 'knowledge.synced', resource: 'knowledge_source', resourceId: source1.id, metadata: { pages: 284, chunks: 1204 } },
  ]

  for (const a of audits) {
    await prisma.activity.create({ data: { tenantId: tenant.id, ...a } })
  }
  console.log(`✅ Audit log events`)

  console.log('\n🎉 Seed complete!')
  console.log('\nLogin credentials:')
  console.log('  Admin:      charles@acme.com   / password123')
  console.log('  Supervisor: sarah@acme.com      / password123')
  console.log('  Agent:      mike@acme.com       / password123')
}

main()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
