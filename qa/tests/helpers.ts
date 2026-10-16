import { expect, type Page } from '@playwright/test'

export const qaEmail = process.env['QA_EMAIL'] ?? 'qa@acme.com'
export const qaPassword = process.env['QA_PASSWORD'] ?? 'QaDemo1234!'
export const bellaEmail = process.env['BELLA_EMAIL'] ?? 'demo@bella.com'
export const bellaPassword = process.env['BELLA_PASSWORD'] ?? 'Demo1234!'
export const agentEmail = process.env['AGENT_EMAIL'] ?? 'mike@acme.com'
export const agentPassword = process.env['AGENT_PASSWORD'] ?? 'password123'
export const labEmail = process.env['LAB_EMAIL'] ?? 'qa@qalab.com'
export const labPassword = process.env['LAB_PASSWORD'] ?? 'QaDemo1234!'
export const bellaEmmaConversationId = 'enrich-bella-convo-1'

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/overview')
}

export async function expectNoCrash(page: Page) {
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
}

export async function useSandbox(page: Page) {
  const sandbox = page.getByRole('button', { name: 'Sandbox' })
  await expect(sandbox).toBeVisible()
  await sandbox.click()
}
