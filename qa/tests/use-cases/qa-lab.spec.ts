import { test, expect } from '@playwright/test'
import { expectNoCrash, labEmail, labPassword, signIn, useSandbox } from '../helpers'

test('QA Lab saves a contact, a ticket, and a flow', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, labEmail, labPassword)
  await useSandbox(page)

  await page.goto('/inbox/contacts')
  if (await page.getByText('QA Scratch Contact').count() === 0) {
    await page.getByRole('button', { name: 'New Contact' }).click()
    await page.getByPlaceholder('e.g. Jane Doe').fill('QA Scratch Contact')
    await page.getByRole('dialog').getByRole('button', { name: 'Create contact' }).click()
  }
  await page.reload()
  await expect(page.getByText('QA Scratch Contact').first()).toBeVisible()

  await page.goto('/inbox/tickets')
  if (await page.getByText('QA scratch ticket').count() === 0) {
    await page.getByRole('button', { name: 'New Ticket' }).click()
    await page.getByPlaceholder('Describe the issue…').fill('QA scratch ticket')
    await page.getByRole('dialog').getByRole('button', { name: 'Create ticket' }).click()
  }
  await page.reload()
  await expect(page.getByText('QA scratch ticket').first()).toBeVisible()
  await expectNoCrash(page)

  await page.goto('/build/flows')
  const scratch = page.getByText('QA Scratch Flow', { exact: true })
  if (await scratch.count() === 0) {
    await page.getByRole('button', { name: 'New Flow' }).click()
    await page.getByRole('button', { name: 'Guided' }).click()
    await page.getByLabel('Name').fill('QA Scratch Flow')
    await page.getByRole('dialog').getByRole('button', { name: 'Create flow' }).click()
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
    await page.getByRole('button', { name: 'Save' }).click()
  } else {
    await scratch.click()
  }
  await expect(page.getByText('QA Scratch Flow').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('saved', { exact: true })).toBeVisible()
  const flowId = new URL(page.url()).pathname.split('/').pop()
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('ybot-app')
    if (!raw) return ''
    const parsed = JSON.parse(raw) as { state?: { token?: string } }
    return parsed.state?.token ?? ''
  })
  const bots = await page.request.get('/api/v1/bots', { headers: { Authorization: `Bearer ${token}` } })
  const botId = (await bots.json()).data[0].id as string
  const canvas = await page.request.get(`/api/v1/bots/${botId}/flows/${flowId}/versions/1/canvas`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(canvas.ok()).toBeTruthy()
  const nodes = (await canvas.json()).data.graph.nodes as unknown[]
  expect(nodes.length).toBeGreaterThan(0)
})
