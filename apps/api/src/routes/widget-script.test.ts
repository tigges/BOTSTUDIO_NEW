import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import Fastify from 'fastify'
import { widgetRoutes } from './widget.js'

/** A DOM stand-in that accepts any property, call or assignment. */
function stub(): any {
  const target = function () {}
  return new Proxy(target, {
    get: (t: any, k) => k === Symbol.toPrimitive ? () => '' : (k in t && k !== 'prototype' ? t[k] : (t[k] = stub())),
    apply: () => stub(),
    construct: () => stub(),
    set: (t: any, k, v) => { t[k] = v; return true },
  })
}

async function runWidget(globals: Record<string, string>) {
  const app = Fastify()
  await app.register(widgetRoutes, { prefix: '/api/v1' })
  const res = await app.inject('/api/v1/widget.js')
  await app.close()
  const warnings: string[] = []
  const win: Record<string, any> = {
    ...globals,
    console: { warn: (m: string) => warnings.push(m), log() {}, error() {} },
    document: stub(), localStorage: stub(), sessionStorage: stub(),
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    URL, JSON, Math, Date, Object, fetch: async () => ({ ok: false }),
  }
  win['window'] = win
  vm.runInNewContext(res.body, win)
  return { win, warnings }
}

test('the widget reads BotStudio settings and still honours snippets that set the old YBot names', async () => {
  for (const name of ['BotStudioChannelId', 'YBotChannelId']) {
    const { win, warnings } = await runWidget({ [name]: 'ch-1' })
    assert.deepEqual(warnings, [], `${name} was read`)
    assert.equal(typeof win['BotStudioWidget']?.open, 'function')
    assert.equal(win['YBotWidget'], win['BotStudioWidget'], 'pages that call window.YBotWidget.open() keep working')
  }
  const { warnings } = await runWidget({})
  assert.match(warnings[0] ?? '', /\[BotStudio widget\] No channelId/)
})
