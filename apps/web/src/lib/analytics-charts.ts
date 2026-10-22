import { timeBucket, type AggregateRow, type AnalyticsGranularity } from '@botstudio/shared'

export interface VolumePoint { time: string; total: number; contained: number; escalated: number; abandoned: number; open: number }

function bucketOf(outcome: string | undefined): keyof Omit<VolumePoint, 'time' | 'total'> {
  if (!outcome || outcome === 'open') return 'open'
  if (outcome.startsWith('contained')) return 'contained'
  if (outcome === 'escalated') return 'escalated'
  if (outcome === 'abandoned') return 'abandoned'
  return 'open'
}

/** Every bucket in the range, so a day without chats is a measured zero instead of a gap. */
export function bucketsIn(range: { from: string; to: string }, granularity: AnalyticsGranularity): string[] {
  const out: string[] = []
  const step = granularity === 'week' ? 7 : 1
  const end = new Date(range.to)
  for (let at = new Date(range.from); at < end; at = new Date(at.getTime() + step * 86_400_000)) {
    const bucket = timeBucket(at, granularity)
    if (out[out.length - 1] !== bucket) out.push(bucket)
  }
  const last = timeBucket(new Date(end.getTime() - 1), granularity)
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/** conversations by [time, outcome] → one point per time bucket; pass `buckets` to fill empty ones with zero. */
export function volumeByTime(rows: AggregateRow[], buckets: string[] = []): VolumePoint[] {
  const points = new Map<string, VolumePoint>(buckets.map((time) => [time, { time, total: 0, contained: 0, escalated: 0, abandoned: 0, open: 0 }]))
  for (const row of rows) {
    const time = row.key.time ?? ''
    const point = points.get(time) ?? { time, total: 0, contained: 0, escalated: 0, abandoned: 0, open: 0 }
    const count = row.value ?? 0
    point.total += count
    point[bucketOf(row.key.outcome)] += count
    points.set(time, point)
  }
  return [...points.values()].sort((a, b) => a.time.localeCompare(b.time))
}

export interface Endings { finished: number; open: number; parts: Array<{ name: string; count: number; share: number | null }> }

/** conversations by [outcome] → how finished chats ended. Open chats sit outside the shares. */
export function endings(rows: AggregateRow[]): Endings {
  const totals = { contained: 0, escalated: 0, abandoned: 0, open: 0 }
  for (const row of rows) totals[bucketOf(row.key.outcome)] += row.value ?? 0
  const finished = totals.contained + totals.escalated + totals.abandoned
  const share = (n: number) => (finished > 0 ? n / finished : null)
  return {
    finished,
    open: totals.open,
    parts: [
      { name: 'Contained', count: totals.contained, share: share(totals.contained) },
      { name: 'Escalated', count: totals.escalated, share: share(totals.escalated) },
      { name: 'Abandoned', count: totals.abandoned, share: share(totals.abandoned) },
    ],
  }
}

export interface ChannelLine { channel: string; chats: number; contained: number | null; finished: number }

export function channelLines(counts: AggregateRow[], contained: AggregateRow[]): ChannelLine[] {
  const rates = new Map(contained.map((r) => [r.key.channel ?? '', r]))
  return counts
    .map((row) => {
      const rate = rates.get(row.key.channel ?? '')
      return { channel: row.key.channel ?? 'No channel', chats: row.value ?? 0, contained: rate?.value ?? null, finished: rate?.denominator ?? 0 }
    })
    .sort((a, b) => b.chats - a.chats)
}

/** "2026-10-19" → "19 Oct". */
export function shortDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
