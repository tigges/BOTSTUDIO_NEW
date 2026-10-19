import { test, expect } from '@playwright/test'
import { acmeBobConversationId, agentEmail, agentPassword, expectNoCrash, signIn } from '../helpers'

const ACME_SEED_GONE = {
  type: 'issue',
  description: 'The seeded Acme bot and its demo chats were removed from the live account on 2026-10-17. Remove fixme once the account owner restores them.',
}

test('an agent can open the inbox and cannot edit flows', { tag: '@smoke' }, async ({ page, request }) => {
  const login = await request.post('/api/v1/auth/login', {
    data: { email: agentEmail, password: agentPassword },
  })
  expect(login.ok()).toBeTruthy()
  const token = (await login.json()).data.token as string
  const bots = await request.get('/api/v1/bots', {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(bots.ok()).toBeTruthy()
  const botId = (await bots.json()).data[0].id as string
  const flows = await request.get(`/api/v1/bots/${botId}/flows`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(flows.status()).toBe(403)

  await signIn(page, agentEmail, agentPassword)
  await page.goto('/inbox/chats')
  await expectNoCrash(page)
})

test.fixme('an agent sees the seeded Bob Smith chat', { tag: '@smoke', annotation: ACME_SEED_GONE }, async ({ page }) => {
  await signIn(page, agentEmail, agentPassword)
  await page.goto('/inbox/chats')
  await expect(page.locator(`[data-convo-id="${acmeBobConversationId}"]`)).toBeVisible()
  await expect(page.getByText('Bob Smith').first()).toBeVisible()
})
