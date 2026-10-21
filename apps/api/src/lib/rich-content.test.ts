import assert from 'node:assert/strict'
import { test } from 'node:test'
import { channelLimitRows, CHANNEL_LIMITS, LIMIT_CHANNELS, numberedChoice, renderForChannel, splitText } from '@ybot/shared'

test('splitText keeps every character and breaks at sentences, not mid-word', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} is here.`).join(' ')
  const parts = splitText(text, 200)
  assert.ok(parts.length > 1)
  assert.ok(parts.every((part) => part.length <= 200))
  assert.ok(parts.every((part) => part.endsWith('.')))
  assert.equal(parts.join(' '), text)
})

test('splitText prefers a paragraph break', () => {
  const text = `${'a '.repeat(60).trim()}\n\n${'b '.repeat(60).trim()}`
  assert.deepEqual(splitText(text, 150), ['a '.repeat(60).trim(), 'b '.repeat(60).trim()])
})

test('quick replies are buttons when they fit', () => {
  const out = renderForChannel({ type: 'quick_replies', text: 'Which?', replies: ['Book', 'Prices'] }, 'whatsapp')
  assert.deepEqual(out.sends, [{ type: 'buttons', text: 'Which?', buttons: ['Book', 'Prices'] }])
  assert.deepEqual(out.notes, [])
})

test('WhatsApp falls back from buttons to a menu, then to numbered text, and says why', () => {
  const four = renderForChannel({ type: 'quick_replies', text: 'Which?', replies: ['A', 'B', 'C', 'D'] }, 'whatsapp')
  assert.equal(four.sends[0]?.type, 'list')
  assert.match(four.notes[0] ?? '', /up to 3 buttons and this has 4/)

  const many = Array.from({ length: 11 }, (_, i) => `Option ${i + 1}`)
  const eleven = renderForChannel({ type: 'quick_replies', text: 'Which?', replies: many }, 'whatsapp')
  assert.equal(eleven.sends.length, 1)
  const send = eleven.sends[0]!
  assert.equal(send.type, 'text')
  assert.match(send.text, /^Which\?\n\n1\. Option 1\n/)
  assert.match(send.text, /11\. Option 11\n\nReply with a number or the words\.$/)
  assert.match(eleven.notes[0] ?? '', /numbered list/)
})

test('a button label that is too long is not cut; it falls back', () => {
  const menu = renderForChannel({ type: 'quick_replies', text: 'Pick', replies: ['Book a hygiene appt.', 'Book a check-up visit', 'B'] }, 'whatsapp')
  assert.equal(menu.sends[0]?.type, 'list')
  assert.match(menu.notes[0] ?? '', /hold 20 characters and the longest here has 21/)
  const numbered = renderForChannel({ type: 'quick_replies', text: 'Pick', replies: ['A very long option label here', 'B'] }, 'whatsapp')
  assert.equal(numbered.sends[0]?.type, 'text')
  assert.match(numbered.sends[0]?.text ?? '', /1\. A very long option label here/)
})

test('SMS numbers choices and phone reads them out', () => {
  const sms = renderForChannel({ type: 'quick_replies', text: 'Which?', replies: ['Book', 'Prices'] }, 'sms')
  assert.equal(sms.sends[0]?.text, 'Which?\n\n1. Book\n2. Prices\n\nReply with a number or the words.')
  const phone = renderForChannel({ type: 'quick_replies', text: 'Which?', replies: ['Book', 'Prices', 'Hours'] }, 'phone')
  assert.equal(phone.sends[0]?.text, 'Which?\n\nYou can say Book, Prices or Hours.')
})

test('long SMS text goes out as several messages with a note', () => {
  const text = 'This is one sentence of a long reply. '.repeat(60).trim()
  const out = renderForChannel({ type: 'text', text }, 'sms')
  assert.ok(out.sends.length >= 2)
  assert.ok(out.sends.every((send) => send.text.length <= CHANNEL_LIMITS.sms.textMax))
  assert.equal(out.sends.map((send) => send.text).join(' '), text)
  assert.match(out.notes.at(-1) ?? '', /1,600 characters per message/)
})

test('WhatsApp keeps the buttons on the last part when the question is long', () => {
  const text = 'Context sentence for the question. '.repeat(40).trim()
  const out = renderForChannel({ type: 'quick_replies', text, replies: ['Yes', 'No'] }, 'whatsapp')
  assert.equal(out.sends.at(-1)?.type, 'buttons')
  assert.ok(out.sends.every((send) => send.text.length <= 1024))
})

test('every rich type renders on every channel with no empty sends', () => {
  const samples = [
    { type: 'card', title: 'Clean', text: 'From £60', imageUrl: 'https://x/y.png', buttons: ['Book'] },
    { type: 'carousel', cards: [{ title: 'One' }, { title: 'Two' }] },
    { type: 'list', text: 'Services', items: [{ title: 'Clean' }, { title: 'Whitening', text: 'From £200' }] },
    { type: 'media', kind: 'image', url: 'https://x/y.png', caption: 'Map' },
    { type: 'form', title: 'Your details', fields: [{ label: 'Name' }, { label: 'Phone' }] },
    { type: 'feedback', question: 'Did that help?' },
  ] as const
  for (const kind of LIMIT_CHANNELS) {
    for (const sample of samples) {
      const out = renderForChannel(sample, kind)
      assert.ok(out.sends.length > 0, `${sample.type} on ${kind}`)
      assert.ok(out.sends.every((send) => send.text.trim()), `${sample.type} on ${kind} has text`)
    }
  }
})

test('numberedChoice maps a bare number to the choice', () => {
  const choices = ['Book', 'Prices', 'Hours']
  assert.equal(numberedChoice(choices, '2'), 'Prices')
  assert.equal(numberedChoice(choices, ' 3. '), 'Hours')
  assert.equal(numberedChoice(choices, '4'), undefined)
  assert.equal(numberedChoice(choices, 'book 2'), undefined)
  assert.equal(numberedChoice(undefined, '1'), undefined)
})

test('the limits table has a row for every content type on every channel', () => {
  for (const kind of LIMIT_CHANNELS) {
    const rows = channelLimitRows(kind)
    assert.deepEqual(rows.map((row) => row.content), ['Text', 'Quick replies', 'Card', 'Carousel', 'List', 'Media', 'Form', 'Feedback'])
    assert.ok(rows.every((row) => row.shows && row.fallback))
  }
  assert.match(channelLimitRows('whatsapp')[1]!.fallback, /"Choose" menu of up to 10 rows/)
})
