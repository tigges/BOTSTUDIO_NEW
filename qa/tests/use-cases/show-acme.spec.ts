import { test, expect } from '@playwright/test'
import { acmeBobConversationId, expectNoCrash, expectStudioUnchanged, qaEmail, qaPassword, signIn } from '../helpers'

const ACME_SEED_GONE = {
  type: 'issue',
  description: 'The seeded Acme bot (Welcome & Routing, Order Status, Bob Smith chat, bulk export ticket) was removed from the live account on 2026-10-17. Remove fixme once the account owner restores it.',
}

test('the Acme studio pages open without changes', { tag: '@smoke' }, async ({ page, request }) => {
  await signIn(page, qaEmail, qaPassword)

  await page.goto('/build/journey')
  await expect(page.getByRole('heading', { name: 'Journey' })).toBeVisible()
  await expectStudioUnchanged(page)

  await page.goto('/build/workflows')
  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New Workflow' })).toBeVisible()
  await expectStudioUnchanged(page)

  await page.goto('/inbox/chats')
  await expectNoCrash(page)
  await page.goto('/inbox/tasks')
  await expectNoCrash(page)

  const login = await request.post('/api/v1/auth/login', {
    data: { email: qaEmail, password: qaPassword },
  })
  expect(login.ok()).toBeTruthy()
  const token = (await login.json()).data.token as string
  const team = await request.get('/api/v1/team/members', {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(team.ok(), `team members HTTP ${team.status()}`).toBeTruthy()
  expect(await team.text()).not.toContain('passwordHash')
})

test.fixme('show the Acme demo journey', { tag: '@smoke', annotation: ACME_SEED_GONE }, async ({ page }) => {
  await signIn(page, qaEmail, qaPassword)

  await page.goto('/build/journey')
  await expect(page.locator('[data-chapter="Welcome & Routing"]')).toBeVisible()
  await expect(page.locator('[data-chapter="Order Status"]')).toBeVisible()

  await page.goto('/build/flows')
  await page.getByText('Order Status', { exact: true }).click()
  await expect(page.getByText('Ask order number')).toBeVisible()
  await expect(page.getByText('Order Status Trigger')).toBeVisible()
  await expect(page.getByText('Welcome Flow')).toHaveCount(0)
  await expectStudioUnchanged(page)

  await page.goto('/inbox/chats')
  await page.locator(`[data-convo-id="${acmeBobConversationId}"]`).click()
  await expect(page.getByText('Bob Smith').first()).toBeVisible()
  await expect(page.getByText(/arrived damaged/i)).toBeVisible()

  await page.goto('/inbox/tasks')
  await expect(page.getByText('Feature request: bulk export')).toBeVisible()
})
