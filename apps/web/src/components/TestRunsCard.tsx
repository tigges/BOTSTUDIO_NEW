import { Loader2 } from 'lucide-react'
import { Badge, Button, Card, CardHeader, CardTitle } from '@ybot/ui'
import * as api from '../lib/api'
import { useTestRuns } from '../lib/hooks'

const STATUS: Record<api.TestRun['status'], { label: string; variant: 'success' | 'error' | 'info' }> = {
  passed: { label: 'Passed', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
  running: { label: 'Running', variant: 'info' },
}

function cost(run: api.TestRun): string {
  const { chatCostUsd, simulatorCostUsd } = run.summary
  if (chatCostUsd == null && simulatorCostUsd == null) return '—'
  return `$${((chatCostUsd ?? 0) + (simulatorCostUsd ?? 0)).toFixed(3)}`
}

function when(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Scheduled end-to-end runs for this bot. Hidden for bots that have never had one, and for non-admins. */
export function TestRunsCard({ botId, isAdmin }: { botId: string | null; isAdmin: boolean }) {
  const { data: runs, isLoading, error, refetch, isFetching } = useTestRuns(botId, isAdmin)
  if (!isAdmin || !botId) return null
  if (error instanceof api.ApiError && [403, 404].includes(error.status)) return null
  if (!isLoading && !error && (!runs || runs.length === 0)) return null

  const latest = runs?.[0]
  const failedChecks = latest?.status === 'failed' ? latest.checks.filter((check) => !check.ok) : []
  const finished = (runs ?? []).filter((run) => run.status !== 'running')
  const passed = finished.filter((run) => run.status === 'passed').length

  return (
    <Card padding="none" data-testid="test-runs-card">
      <CardHeader className="px-4 pt-4">
        <CardTitle>Test runs</CardTitle>
        {isLoading
          ? <Loader2 size={13} className="animate-spin text-[var(--text-muted)]" />
          : finished.length > 0 && <Badge variant="muted">{passed} of {finished.length} passed</Badge>}
      </CardHeader>
      <p className="px-4 text-xs text-[var(--text-muted)]">
        Scheduled visitors through the website chat, a person in the Inbox and a weekly release check. Their chats count in this bot's numbers and are removed after 14 days.
      </p>
      {isLoading && (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((i) => <div key={i} className="h-6 rounded animate-pulse bg-[var(--bg-overlay)]" />)}
        </div>
      )}
      {error && !isLoading && (
        <div className="flex items-center justify-between gap-3 px-4 py-4 text-sm text-[var(--text-muted)]">
          <span>Could not load test runs: {error instanceof Error ? error.message : 'unknown error'}</span>
          <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>Retry</Button>
        </div>
      )}
      {failedChecks.length > 0 && (
        <div className="mx-4 mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--error-muted)] px-3 py-2 text-xs text-[var(--error)]">
          <p className="font-medium">The last run failed {failedChecks.length} {failedChecks.length === 1 ? 'check' : 'checks'}:</p>
          <ul className="mt-1 list-disc pl-4">
            {failedChecks.slice(0, 3).map((check, i) => <li key={i}>{check.name}{check.detail ? ` (${check.detail.slice(0, 120)})` : ''}</li>)}
          </ul>
          {failedChecks.length > 3 && <p className="mt-1">and {failedChecks.length - 3} more.</p>}
        </div>
      )}
      {runs && runs.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--text-muted)]">
              <th className="px-4 py-1 font-medium">Started</th>
              <th className="px-2 py-1 font-medium">Run</th>
              <th className="px-2 py-1 font-medium">Result</th>
              <th className="px-2 py-1 font-medium text-right">Checks</th>
              <th className="px-2 py-1 font-medium text-right">Chats</th>
              <th className="px-4 py-1 font-medium text-right">Model cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {runs.slice(0, 6).map((run) => (
              <tr key={run.id}>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{when(run.startedAt)}</td>
                <td className="px-2 py-2 text-[var(--text-secondary)]">{run.kind === 'release' ? 'Release check' : 'Traffic'}</td>
                <td className="px-2 py-2"><Badge variant={STATUS[run.status].variant}>{STATUS[run.status].label}</Badge></td>
                <td className="px-2 py-2 text-right text-[var(--text-secondary)]">
                  {run.summary.total != null ? `${run.summary.total - (run.summary.failed ?? 0)} / ${run.summary.total}` : '—'}
                </td>
                <td className="px-2 py-2 text-right text-[var(--text-secondary)]">{run.summary.chats ?? '—'}</td>
                <td className="px-4 py-2 text-right text-[var(--text-secondary)]">{cost(run)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="h-3" />
    </Card>
  )
}
