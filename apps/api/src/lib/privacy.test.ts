import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_PRIVACY,
  evaluateGuardrails,
  findPersonalData,
  guardrailIssues,
  holdsReplies,
  maskValue,
  newGuardrailRule,
  parsePrivacySettings,
  privacyIssues,
  readerMode,
  renderPersonalData,
} from '@ybot/shared'
import { PrivacyProvider, setLlmPrivacy, StreamRevealer, type LlmProvider } from '@ybot/llm'
import { changedFields, hideSecrets, auditAction } from '@ybot/db'
import { protectText, renderDeepFor, renderFor, revealText, tokenFor } from './privacy.js'
import { scrubSecrets } from './log-scrub.js'

const kinds = (text: string) => findPersonalData(text).map((span) => `${span.kind}:${span.value}`)

test('finds the built-in kinds of personal data', () => {
  assert.deepEqual(kinds('Mail jane.doe@example.co.uk or call +44 7700 900123'), ['email:jane.doe@example.co.uk', 'phone:+44 7700 900123'])
  assert.deepEqual(kinds('Card 4242 4242 4242 4242 expires soon'), ['card:4242 4242 4242 4242'])
  assert.deepEqual(kinds('IBAN GB82 WEST 1234 5698 7654 32 please'), ['iban:GB82 WEST 1234 5698 7654 32'])
  assert.deepEqual(kinds('NI AB 12 34 56 C and SSN 123-45-6789'), ['national_id:AB 12 34 56 C', 'national_id:123-45-6789'])
  assert.deepEqual(kinds('from 192.168.10.4'), ['ip:192.168.10.4'])
  assert.deepEqual(kinds('call 020 7946 0958 today'), ['phone:020 7946 0958'])
})

test('booking times, dates, prices and order numbers are not personal data', () => {
  assert.deepEqual(kinds('Tuesday 21 October at 14:30, £45.00, booking 2026-10-21'), [])
  assert.deepEqual(kinds('Order 12345678'), [])
  assert.deepEqual(kinds('Card 4242 4242 4242 4241'), [], 'fails the Luhn check')
  assert.deepEqual(kinds('version 1.2.3'), [])
})

test('custom patterns find their own kind', () => {
  const spans = findPersonalData('Ref ORD-55123 please', [{ name: 'Order ref', pattern: 'ORD-\\d{5}' }])
  assert.deepEqual(spans.map((span) => [span.kind, span.value]), [['order_ref', 'ORD-55123']])
})

test('masks keep enough to recognise and no more', () => {
  assert.equal(maskValue('email', 'jane@example.com'), 'j•••@e•••.com')
  assert.equal(maskValue('card', '4242 4242 4242 4242'), '•••• 4242')
  assert.equal(maskValue('phone', '+44 7700 900123'), '•••• ••• 123')
  assert.equal(renderPersonalData('to jane@example.com', 'label'), 'to [email]')
})

test('tokens are stable per tenant and value, and reveal back', () => {
  const a = tokenFor('email', 'Jane@Example.com', 't1')
  assert.match(a, /^\[EMAIL_[0-9A-F]{8}\]$/)
  assert.equal(tokenFor('email', 'jane@example.com', 't1'), a, 'case of an email does not matter')
  assert.notEqual(tokenFor('email', 'jane@example.com', 't2'), a, 'another tenant gets another token')
  const protectedText = protectText('Email jane@example.com and call 07700 900123', [], 't1')
  assert.ok(!protectedText.includes('jane@example.com'))
  assert.ok(!protectedText.includes('07700'))
  assert.match(revealText(`Thanks, I will write to ${a}.`), /^Thanks, I will write to jane@example\.com\.$/i)
  assert.equal(revealText('Unknown [EMAIL_00000000] stays'), 'Unknown [EMAIL_00000000] stays')
})

test('each reader gets its own mode; people only see data as written with the reveal toggle', () => {
  const text = 'Contact jane@example.com'
  assert.equal(renderFor('end_user', text, DEFAULT_PRIVACY), text)
  assert.equal(renderFor('human_agent', text, DEFAULT_PRIVACY), 'Contact j•••@e•••.com')
  assert.equal(renderFor('logs', text, DEFAULT_PRIVACY), 'Contact j•••@e•••.com')
  const saved = parsePrivacySettings({ render: { human_agent: 'original' } })
  assert.equal(saved.render.human_agent, 'mask', 'the reader mode alone never shows the original')
  const revealed = parsePrivacySettings({ revealToAgents: true })
  assert.equal(readerMode(revealed, 'human_agent'), 'original')
  assert.equal(renderFor('human_agent', text, revealed), text)
  assert.deepEqual(renderDeepFor('human_agent', { summary: text, n: 1 }, DEFAULT_PRIVACY), { summary: 'Contact j•••@e•••.com', n: 1 })
})

test('custom patterns are checked before they are saved', () => {
  const issues = privacyIssues(parsePrivacySettings({ custom: [{ name: 'Bad', pattern: '(' }, { name: 'Empty', pattern: 'a*' }] }))
  assert.deepEqual(issues.map((issue) => issue.field), ['custom.0.pattern', 'custom.1.pattern'])
})

test('a token cut across stream chunks is revealed whole', () => {
  const token = tokenFor('email', 'sam@example.org', 't1')
  const revealer = new StreamRevealer(revealText)
  const out = [revealer.push(`Write to ${token.slice(0, 5)}`), revealer.push(token.slice(5)), revealer.push(' today.'), revealer.flush()].join('')
  assert.equal(out, 'Write to sam@example.org today.')
  const plain = new StreamRevealer(revealText)
  assert.equal(plain.push('a [note] here'), 'a [note] here')
})

test('models receive tokens, callers receive what the guest wrote', async () => {
  let sent = ''
  const inner: LlmProvider = {
    async complete(params) {
      sent = [params.systemPrompt, ...params.messages.map((m) => m.content)].join('|')
      const token = params.messages[0]!.content.match(/\[EMAIL_[0-9A-F]{8}\]/)![0]
      return { content: `Noted ${token}`, model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 1 }
    },
    async stream(params) {
      const token = params.messages[0]!.content.match(/\[EMAIL_[0-9A-F]{8}\]/)![0]
      for (const chunk of ['Noted ', token.slice(0, 4), token.slice(4), '.']) params.onChunk(chunk)
      return { content: `Noted ${token}.`, model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 1 }
    },
    async embed(params) {
      sent = params.texts.join('|')
      return { embeddings: [], model: 'e' }
    },
  }
  setLlmPrivacy({ protect: (text) => protectText(text, [], 't1'), reveal: revealText })
  try {
    const provider = new PrivacyProvider(inner)
    const result = await provider.complete({ messages: [{ role: 'user', content: 'I am kim@example.net' }], systemPrompt: 'Owner: boss@example.net' })
    assert.ok(!sent.includes('@example.net'), sent)
    assert.equal(result.content.startsWith('Noted kim@example.net'), true)
    const chunks: string[] = []
    await provider.stream!({ messages: [{ role: 'user', content: 'I am kim@example.net' }], onChunk: (c) => chunks.push(c) })
    assert.equal(chunks.join(''), 'Noted kim@example.net.')
    await provider.embed({ texts: ['kim@example.net'] })
    assert.ok(!sent.includes('@'))
  } finally {
    setLlmPrivacy(null)
  }
})

test('credentials never reach the logs', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjbXVkYmp0aW0wMDA1cGIwMTJwMGViMmFlIn0.k48ArK8iu9uTwhYBn66tkWb-cOaAZEssv_pN3wFkpxA'
  assert.equal(scrubSecrets(`GET /ws?token=${jwt}`), 'GET /ws?token=[secret]')
  assert.equal(scrubSecrets(`Authorization: Bearer ${'a'.repeat(30)}`), 'Authorization: Bearer [secret]')
  assert.equal(scrubSecrets('key sk-ant-api03-abcdefghijklmnopqrstuv'), 'key [secret]')
  assert.equal(scrubSecrets('AIzaSyA1234567890abcdefghijklmnopqrstu'), '[secret]')
  assert.equal(scrubSecrets('postgres://ybot:hunter2@postgres:5432/ybot'), 'postgres://ybot:[secret]@postgres:5432/ybot')
  assert.equal(scrubSecrets('{"password":"hunter2","name":"x"}'), '{"password":"[secret]","name":"x"}')
  assert.equal(scrubSecrets('GET /api/v1/bots?limit=5'), 'GET /api/v1/bots?limit=5')
})

test('audit rows hide secrets and name what changed', () => {
  assert.deepEqual(hideSecrets({ name: 'Shop', secretEnc: 'v1:abc', apiKey: 'k', passwordHash: 'h', nested: { token: 't' }, empty: null }), {
    name: 'Shop', secretEnc: '[hidden]', apiKey: '[hidden]', passwordHash: '[hidden]', nested: { token: '[hidden]' }, empty: null,
  })
  assert.deepEqual(changedFields({ a: 1, b: 2, updatedAt: 'x' }, { a: 1, b: 3, updatedAt: 'y' }), ['b', 'updatedAt'])
  assert.equal(auditAction('GuardrailPolicy', 'create', false), 'guardrail_policy.created')
  assert.equal(auditAction('Bot', 'upsert', true), 'bot.updated')
  assert.equal(auditAction('Tool', 'deleteMany', true), 'tool.deleted')
})

test('guardrails: strongest action wins, redact rewrites, new rules warn, issues name the rule', () => {
  const rules = [
    newGuardrailRule({ id: 'a', name: 'Refund', check: { kind: 'words', words: ['refund'] } }),
    newGuardrailRule({ id: 'b', name: 'Card', check: { kind: 'personal_data', kinds: ['card'] }, action: 'redact' }),
  ]
  assert.equal(rules[0]!.action, 'warn')
  const decision = evaluateGuardrails('refund to 4242 4242 4242 4242', 'input', rules)
  assert.equal(decision.outcome, 'allow')
  assert.equal(decision.text, 'refund to [redacted]')
  assert.deepEqual(decision.hits.map((hit) => hit.action), ['warn', 'redact'])
  assert.equal(evaluateGuardrails('refunded', 'input', rules).hits.length, 0, 'whole words only')
  assert.equal(evaluateGuardrails('refund', 'output', rules).hits.length, 0, 'input rules leave replies alone')
  assert.equal(holdsReplies(rules), false)
  const issues = guardrailIssues([newGuardrailRule({ id: 'x', name: '' }), newGuardrailRule({ id: 'y', name: 'Bad', check: { kind: 'pattern', pattern: '[' } })])
  assert.deepEqual(issues.map((issue) => `${issue.ruleId}.${issue.field}`), ['x.name', 'x.check', 'y.check'])
})
