import type { RunReport } from './runner.js'

const money = (value: unknown) => (typeof value === 'number' ? `$${value.toFixed(4)}` : '—')
const count = (value: unknown) => (typeof value === 'number' ? String(value) : '—')
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

/** The scorecard for one run, as Markdown for the job summary. */
export function scorecard(report: RunReport): string {
  const s = report.summary
  const failed = report.checks.filter((check) => !check.ok)
  const outcomes = s['outcomes'] && typeof s['outcomes'] === 'object'
    ? Object.entries(s['outcomes'] as Record<string, number>).map(([key, value]) => `${key} ${value}`).join(', ')
    : '—'
  const lines = [
    `## ${report.status === 'passed' ? 'Passed' : 'Failed'}: ${report.botName} (${report.kind})`,
    '',
    `Run \`${report.runId}\` against ${report.baseUrl}. ${report.checks.length - failed.length} of ${report.checks.length} checks passed.`,
    '',
    '| Chats | Handed over | Outcomes | Model calls | Chat cost | Simulator calls | Simulator cost | Pruned |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    `| ${count(s['chats'])} | ${count(s['handedOver'])} | ${cell(outcomes)} | ${count(s['modelCalls'])} | ${money(s['chatCostUsd'])} | ${count(s['simulatorCalls'])} | ${money(s['simulatorCostUsd'])} | ${count(s['pruned'])} |`,
    '',
  ]
  if (failed.length) {
    lines.push('### Failed checks', '', '| Check | Detail | Chat |', '| --- | --- | --- |')
    for (const check of failed) lines.push(`| ${cell(check.name)} | ${cell(check.detail ?? '')} | ${check.conversationId ?? ''} |`)
    lines.push('')
  }
  lines.push('<details><summary>All checks</summary>', '', '| | Check | Detail |', '| --- | --- | --- |')
  for (const check of report.checks) lines.push(`| ${check.ok ? 'pass' : 'FAIL'} | ${cell(check.name)} | ${cell(check.detail ?? '')} |`)
  lines.push('', '</details>', '')
  return lines.join('\n')
}
