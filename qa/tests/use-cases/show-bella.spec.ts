import { test, expect } from '@playwright/test'
import { bellaEmail, bellaEmmaConversationId, bellaPassword, expectNoCrash, expectStudioUnchanged, signIn } from '../helpers'

test('show the Bella Hair Studio journey', { tag: '@smoke' }, async ({ page }) => {
  await signIn(page, bellaEmail, bellaPassword)

  await page.goto('/build/journey')
  await expect(page.getByRole('heading', { name: 'Journey' })).toBeVisible()
  await expect(page.locator('[data-chapter="Salon welcome"]')).toBeVisible()
  await expect(page.locator('[data-chapter="Book an appointment"]')).toBeVisible()
  await expect(page.locator('[data-chapter="Services and prices"]')).toBeVisible()
  await expect(page.locator('[data-chapter="Salon hours"]')).toBeVisible()
  // Design chips clip the spoken line, so the name question is not on this map.
  await expect(page.locator('[data-chapter="Salon welcome"]').getByText("Hi, I'm Bella at Bella Hair Studio.")).toBeVisible()
  await expectStudioUnchanged(page)

  await page.locator('[data-chapter="Salon welcome"]').getByRole('button').first().click()
  await expect(page.getByText("Hi, I'm Bella at Bella Hair Studio.").first()).toBeVisible()

  await page.goto('/build/flows')
  await expect(page.getByText('Book an appointment').first()).toBeVisible()
  await expect(page.getByText('Salon welcome').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'New Flow' })).toBeVisible()
  await expectStudioUnchanged(page)

  await page.goto('/build/workflows')
  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible()
  await expect(page.getByText('Note when a customer message arrives').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'New Workflow' })).toBeVisible()
  await expectStudioUnchanged(page)
  await expectNoCrash(page)

  await page.goto('/inbox/chats')
  await expect(page.locator(`[data-convo-id="${bellaEmmaConversationId}"]`)).toBeVisible()
  await page.locator(`[data-convo-id="${bellaEmmaConversationId}"]`).click()
  await expect(page.getByText('Emma Clarke').first()).toBeVisible()
  await expect(page.getByText(/book a haircut/i)).toBeVisible()

  await page.goto('/configure/channels')
  await expect(page.getByText('Website Chat').first()).toBeVisible()
  await expect(page.getByText('WhatsApp').first()).toBeVisible()
})
