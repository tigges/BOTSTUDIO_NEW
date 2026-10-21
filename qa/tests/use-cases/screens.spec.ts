import { test, expect } from '@playwright/test'
import { expectNoCrash, qaEmail, qaPassword, signIn } from '../helpers'

const screens = [
  '/overview',
  '/build/journey',
  '/build/flows',
  '/build/workflows',
  '/build/knowledge/intents',
  '/build/knowledge/entities',
  '/build/knowledge/faqs',
  '/build/knowledge/sources',
  '/build/knowledge/training',
  '/inbox/chats',
  '/inbox/tasks',
  '/inbox/contacts',
  '/inbox/settings',
  '/engage/campaigns',
  '/engage/templates',
  '/analytics',
  '/analytics/dashboards',
  '/analytics/reports',
  '/configure/channels',
  '/configure/optimizations',
  '/configure/integrations',
  '/configure/database',
  '/configure/webhooks',
  '/admin/team',
  '/admin/audit',
  '/admin/system-status',
  '/settings',
  '/help',
  '/bots',
]

test('every screen opens', { tag: '@smoke' }, async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page, qaEmail, qaPassword)
  for (const path of screens) {
    await page.goto(path)
    await expect(page).toHaveURL(new RegExp(path.replaceAll('/', '\\/')))
    await expectNoCrash(page)
    if (path === '/build/journey') {
      await expect(page.getByRole('heading', { name: 'Journey' })).toBeVisible()
    }
    if (path === '/build/flows') {
      await expect(page.getByText('Flows').first()).toBeVisible()
    }
    if (path === '/build/workflows') {
      await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible()
    }
    if (path === '/help') {
      await expect(page.getByRole('heading', { name: 'Help' })).toBeVisible()
      await expect(page.getByRole('img', { name: 'Flows list' })).toBeVisible()
    }
    if (path === '/configure/integrations') {
      await expect(page.getByText('Planned').first()).toBeVisible()
    }
  }
  await page.goto('/analytics/reports')
  await expect(page.getByRole('button', { name: 'New Report' })).toBeVisible()
  await page.goto('/configure/database')
  await expect(page.getByRole('button', { name: 'Create Table', exact: true })).toBeVisible()
  await page.goto('/configure/integrations')
  await expect(page.getByText('Stripe', { exact: true })).toBeVisible()
  await expect(page.getByText('Soon').first()).toBeVisible()
})
