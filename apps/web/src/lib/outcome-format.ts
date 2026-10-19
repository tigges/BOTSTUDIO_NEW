import type { OutcomeSummary } from './api'

/** A rate with no denominator is a dash, never 0%. */
export function percentOrDash(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${rate.toFixed(1)}%`
}

function chats(count: number): string {
  return `${count} ${count === 1 ? 'chat' : 'chats'}`
}

/** The denominator line under an outcome card. */
export function ofFinished(count: number, summary: OutcomeSummary | undefined): string {
  if (!summary || summary.finished === 0) return 'No finished chats yet'
  return `${count} of ${chats(summary.finished)} finished`
}

/** Why the contained bucket is not all resolved. */
export function containedDetail(summary: OutcomeSummary | undefined): string {
  if (!summary || summary.buckets.contained === 0) return ''
  const { contained_resolved: resolved, contained_partial: partial, contained_unresolved: unresolved } = summary.counts
  return [
    `${resolved} resolved`,
    partial > 0 ? `${partial} left mid-question` : '',
    unresolved > 0 ? `${unresolved} not answered` : '',
  ].filter(Boolean).join(' · ')
}

export function openLine(summary: OutcomeSummary | undefined): string {
  if (!summary || summary.open === 0) return ''
  return `${chats(summary.open)} still open, not counted`
}

/** Model spend. A dash when no model call was recorded; small amounts keep their precision. */
export function formatLlmCost(cost: { costUsd: number | null; calls: number } | null | undefined): string {
  if (!cost || cost.calls === 0 || cost.costUsd === null) return '—'
  if (cost.costUsd === 0) return '$0.00'
  if (cost.costUsd < 0.01) return `$${cost.costUsd.toFixed(4)}`
  return `$${cost.costUsd.toFixed(2)}`
}

export function llmCallsLine(cost: { calls: number } | null | undefined): string {
  if (!cost || cost.calls === 0) return 'No model calls recorded'
  return `${cost.calls} model ${cost.calls === 1 ? 'call' : 'calls'}`
}
