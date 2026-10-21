import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DENTAL_BLUEPRINT, hoursMentionedIn, knowledgeConflicts, type KnowledgeText } from '@ybot/shared'

const sample = DENTAL_BLUEPRINT.sample()
const specs = DENTAL_BLUEPRINT.fields

const page = (text: string, extra: Partial<KnowledgeText> = {}): KnowledgeText => ({
  documentId: 'doc-1', title: 'https://harbour.example/contact', source: 'harbour.example', sourceKind: 'website', text, ...extra,
})

test('hours are found in a crawled page that has no line breaks', () => {
  const found = hoursMentionedIn('Visit us Monday - Thursday 8am - 5pm Friday 8:00-16:00 Sunday closed. Money back on Sundays.')
  assert.deepEqual(found.map((item) => item.quote), ['Monday - Thursday 8am - 5pm', 'Friday 8:00-16:00', 'Sunday closed'])
  assert.equal(found[0]!.hours.length, 4)
})

test('a page that agrees with Business details raises nothing', () => {
  const text = 'Opening hours Monday 8am - 6pm Tuesday - Thursday 8am - 5pm Friday 8am-4pm Saturday 8am-1pm Sunday closed. Call us on 0117 496 0123. Check-up £45. New patient exam: £85. Check-up and hygiene together £120.'
  assert.deepEqual(knowledgeConflicts(specs, sample, [page(text)]), [])
})

test('old hours, a different phone number and a changed price are each flagged with both values', () => {
  const text = 'Opening hours Monday 9am - 7pm Saturday closed. Phone 0117 496 0999 for appointments. Hygiene visit only £95.'
  const conflicts = knowledgeConflicts(specs, sample, [page(text)])
  assert.deepEqual(conflicts.map((item) => [item.field, item.says, item.expected]), [
    ['hours', 'Monday 9am - 7pm', 'Monday 8am to 6pm'],
    ['hours', 'Saturday closed', 'Saturday 8am to 1pm'],
    ['phone', '0117 496 0999', '0117 496 0123'],
    ['fees', 'Hygiene visit £95', 'Hygiene visit £85'],
  ])
  assert.match(conflicts[0]!.message, /harbour\.example, "https:\/\/harbour\.example\/contact", says "Monday 9am - 7pm", but Opening hours in Business details says Monday 8am to 6pm\. Answers use Business details\./)
})

test('a shorter item name inside a longer one, an unrelated number and Business details documents are left alone', () => {
  const text = 'Check-up and hygiene together £120. For out-of-hours help ring NHS 111. Our partner lab: 0117 000 1111 (not for patients).'
  assert.deepEqual(knowledgeConflicts(specs, sample, [page(text)]), [])
  const own = page('Monday 9am - 7pm', { sourceKind: 'business', source: 'Business details' })
  assert.deepEqual(knowledgeConflicts(specs, sample, [own]), [])
})

test('a page that also gives the confirmed number is not flagged for a second number', () => {
  const text = 'Call 0117 496 0123 or our emergency line 07700 900123.'
  assert.deepEqual(knowledgeConflicts(specs, sample, [page(text)]).filter((item) => item.field === 'phone'), [])
})
