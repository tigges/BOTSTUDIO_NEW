import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractPlanTiers, spokenPrice } from '@ybot/shared'

test('£7/mo/seat is spoken as a month per seat', () => {
  assert.equal(spokenPrice('£7/mo/seat'), '£7 a month per seat')
  assert.equal(spokenPrice('£0/mo'), '£0 a month')
})

test('a HubSpot-style grid becomes four plan tiers', () => {
  const text = `Free
No credit card required
£0/mo
Get AI-powered help across the CRM
Get a unified view of your contacts
Starter
£7/mo/seat
Email and in-app chat support
Keep your CRM up to date with AI
Professional
£81/mo/seat
Organize teams across hubs
Test changes with a sandbox
Enterprise
£155/mo/seat
Set up marketing email`
  const tiers = extractPlanTiers(text)
  assert.deepEqual(tiers.map((tier) => tier.name), ['Free', 'Starter', 'Professional', 'Enterprise'])
  assert.equal(tiers[0]?.price, '£0 a month')
  assert.equal(tiers[1]?.price, '£7 a month per seat')
  assert.equal(tiers[2]?.price, '£81 a month per seat')
  assert.equal(tiers[3]?.price, '£155 a month per seat')
  assert.match(tiers[1]?.blurb ?? '', /in-app chat/i)
})

test('a Free Starter Professional Enterprise grid drops a stray Business product card', () => {
  const text = `Free
£0/mo
Starter
$10/mo
Professional
$100/mo
Enterprise
$175/mo
Business
$50/mo
Business plan`
  const tiers = extractPlanTiers(text)
  assert.deepEqual(tiers.map((tier) => tier.name), ['Free', 'Starter', 'Professional', 'Enterprise'])
  assert.equal(tiers.some((tier) => tier.name === 'Business'), false)
})

test('inline Free £0/mo Starter £7/mo/seat still keeps per seat', () => {
  const tiers = extractPlanTiers('Free £0/mo Starter £7/mo/seat Professional £81/mo/seat Enterprise £155/mo/seat')
  assert.deepEqual(tiers.map((tier) => tier.name), ['Free', 'Starter', 'Professional', 'Enterprise'])
  assert.equal(tiers[1]?.price, '£7 a month per seat')
})
