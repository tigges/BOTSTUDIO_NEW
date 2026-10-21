import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bucketsIn, channelLines, endings, shortDay, volumeByTime } from './analytics-charts'

const row = (key: Record<string, string>, value: number | null, denominator = value ?? 0) => ({ key, value, denominator, margin: null })

test('volume pivots outcomes into one point per day', () => {
  const points = volumeByTime([
    row({ time: '2026-10-20', outcome: 'contained_resolved' }, 3),
    row({ time: '2026-10-20', outcome: 'contained_partial' }, 1),
    row({ time: '2026-10-19', outcome: 'escalated' }, 2),
    row({ time: '2026-10-20', outcome: 'open' }, 4),
  ])
  assert.deepEqual(points, [
    { time: '2026-10-19', total: 2, contained: 0, escalated: 2, abandoned: 0, open: 0 },
    { time: '2026-10-20', total: 8, contained: 4, escalated: 0, abandoned: 0, open: 4 },
  ])
})

test('endings are shares of finished chats; with none finished the share is unknown, not zero', () => {
  const result = endings([row({ outcome: 'contained_resolved' }, 3), row({ outcome: 'escalated' }, 1), row({ outcome: 'open' }, 6)])
  assert.equal(result.finished, 4)
  assert.equal(result.open, 6)
  assert.deepEqual(result.parts.map((p) => p.share), [0.75, 0.25, 0])
  assert.deepEqual(endings([row({ outcome: 'open' }, 2)]).parts.map((p) => p.share), [null, null, null])
})

test('channel lines keep the contained rate next to its own denominator', () => {
  const lines = channelLines(
    [row({ channel: 'Web' }, 10), row({ channel: 'WhatsApp' }, 30)],
    [{ key: { channel: 'WhatsApp' }, value: 0.5, denominator: 20, margin: 0.2 }],
  )
  assert.deepEqual(lines, [
    { channel: 'WhatsApp', chats: 30, contained: 0.5, finished: 20 },
    { channel: 'Web', chats: 10, contained: null, finished: 0 },
  ])
  assert.equal(shortDay('2026-10-19'), '19 Oct')
})

test('empty days are filled with zero for counts', () => {
  const buckets = bucketsIn({ from: '2026-10-18T12:00:00.000Z', to: '2026-10-21T12:00:00.000Z' }, 'day')
  assert.deepEqual(buckets, ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'])
  const points = volumeByTime([row({ time: '2026-10-20', outcome: 'escalated' }, 2)], buckets)
  assert.deepEqual(points.map((p) => p.total), [0, 0, 2, 0])
  assert.deepEqual(bucketsIn({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-21T00:00:00.000Z' }, 'week'), ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'])
})
