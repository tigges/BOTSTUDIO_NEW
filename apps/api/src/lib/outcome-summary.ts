import { CHAT_OUTCOMES, type ChatOutcome } from './chat-outcome.js'

export interface OutcomeSummary {
  /** Chats with an outcome, including handed-over chats a person still holds. The denominator for every rate. */
  finished: number
  /** Chats still open; they have no outcome yet and sit outside every rate. */
  open: number
  counts: Record<ChatOutcome, number>
  buckets: { contained: number; escalated: number; abandoned: number }
  /** Percent of finished chats, one decimal. Null when nothing has finished. */
  rates: { contained: number | null; resolvedByBot: number | null; escalated: number | null; abandoned: number | null }
}

function rate(count: number, of: number): number | null {
  return of > 0 ? Math.round((count / of) * 1000) / 10 : null
}

/** Each rate comes from its own count. Escalation is never derived from containment. */
export function summariseOutcomes(rows: Array<{ outcome: string | null; count: number }>): OutcomeSummary {
  const counts = Object.fromEntries(CHAT_OUTCOMES.map((key) => [key, 0])) as Record<ChatOutcome, number>
  let open = 0
  for (const row of rows) {
    if (row.outcome && (CHAT_OUTCOMES as readonly string[]).includes(row.outcome)) counts[row.outcome as ChatOutcome] += row.count
    else open += row.count
  }
  const contained = counts.contained_resolved + counts.contained_partial + counts.contained_unresolved
  const finished = contained + counts.escalated + counts.abandoned
  return {
    finished,
    open,
    counts,
    buckets: { contained, escalated: counts.escalated, abandoned: counts.abandoned },
    rates: {
      contained: rate(contained, finished),
      resolvedByBot: rate(counts.contained_resolved, finished),
      escalated: rate(counts.escalated, finished),
      abandoned: rate(counts.abandoned, finished),
    },
  }
}
