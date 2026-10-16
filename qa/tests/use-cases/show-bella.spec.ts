import { test, expect } from '@playwright/test'
import { bellaEmail, bellaEmmaConversationId, bellaPassword, signIn } from '../helpers'

test('show the Bella demo', { tag: '@smoke' }, async ({ page }) => {
  await signIn(page, bellaEmail, bellaPassword)

  await page.goto('/build/journey')
  await expect(page.getByRole('heading', { name: 'Journey' })).toBeVisible()
  await expect(page.getByText('Salon welcome')).toBeVisible()
  await expect(page.getByText('Book an appointment', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /Salon welcome/ }).click()
  await expect(page.getByText("Hi, I'm Bella at Bella Hair Studio.").first()).toBeVisible()

  await page.goto('/inbox/chats')
  await expect(page.locator(`[data-convo-id="${bellaEmmaConversationId}"]`)).toBeVisible()
  await page.locator(`[data-convo-id="${bellaEmmaConversationId}"]`).click()
  await expect(page.getByText('Emma Clarke').first()).toBeVisible()
  await expect(page.getByText(/book a haircut/i)).toBeVisible()

  await page.goto('/configure/channels')
  await expect(page.getByText('Website Chat').first()).toBeVisible()
  await expect(page.getByText('WhatsApp').first()).toBeVisible()
})
