import { test, expect } from '@playwright/test'
import { bellaEmail, bellaPassword, signIn } from '../helpers'

/** One probe of the published journey. Demo inbox volume comes from the traffic run, not from here. */

const sessionId = `qa-probe-bella-${Date.now()}`
const line = 'QA check from the website widget'

test('the Bella widget still walks the published journey', { tag: '@smoke' }, async ({ page, request }) => {
  let token = ''
  for (let attempt = 0; attempt < 3 && !token; attempt++) {
    const login = await request.post('/api/v1/auth/login', {
      data: { email: bellaEmail, password: bellaPassword },
    })
    if (login.ok()) token = (await login.json()).data.token as string
    else if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  expect(token).toBeTruthy()

  const chat = await request.post('/api/v1/public/chat/bella-web', {
    data: {
      message: line,
      sessionId,
    },
    timeout: 45_000,
  })
  expect(chat.ok()).toBeTruthy()
  const body = await chat.text()
  expect(body).not.toContain('outside our working hours')
  expect(body).toMatch(/Hi, I'm Bella at Bella Hair Studio/)
  expect(body).toContain("What's your name?")
  const conversationId = body.match(/"conversationId":"([^"]+)"/)?.[1]
  expect(conversationId).toBeTruthy()

  await signIn(page, bellaEmail, bellaPassword)

  await page.goto('/inbox/chats')
  await page.locator(`[data-convo-id="${conversationId}"]`).click()
  await expect(page.getByText(line).first()).toBeVisible()
  await expect(page.getByText("Hi, I'm Bella at Bella Hair Studio.").first()).toBeVisible()

  await page.goto('/overview')
  await expect(page.getByRole('heading', { name: 'Latest chats' })).toBeVisible()
  await expect(page.getByText("Hi, I'm Bella at Bella Hair Studio.").first()).toBeVisible()
})
