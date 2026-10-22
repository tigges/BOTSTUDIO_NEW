import { ANALYTICS_METRICS, METRIC_INFO, type AnalyticsMetric } from '@botstudio/shared'

/** Names saved before the aggregate endpoint existed. */
const LEGACY: Record<string, AnalyticsMetric> = {
  totalConversations: 'conversations',
  resolutionRate: 'contained_rate',
  botHandledPct: 'resolved_by_bot_rate',
}

/** The aggregate metric a saved widget shows, or null when it asks for something that is not a chat metric. */
export function widgetMetric(config: Record<string, unknown> | undefined): AnalyticsMetric | null {
  const raw = String(config?.metric ?? '')
  if ((ANALYTICS_METRICS as readonly string[]).includes(raw)) return raw as AnalyticsMetric
  return LEGACY[raw] ?? null
}

export interface DashboardTemplate { id: string; label: string; metrics: AnalyticsMetric[] }

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  { id: 'blank', label: 'Blank dashboard', metrics: [] },
  { id: 'bot', label: 'Bot performance', metrics: ['conversations', 'contained_rate', 'resolved_by_bot_rate', 'first_reply_ms'] },
  { id: 'handover', label: 'Handover to people', metrics: ['conversations', 'escalated_rate', 'abandoned_rate', 'csat_score'] },
  { id: 'cost', label: 'Model cost', metrics: ['conversations', 'llm_cost', 'first_reply_ms'] },
]

export function templateWidgets(templateId: string): Array<{ title: string; metric: AnalyticsMetric }> {
  const template = DASHBOARD_TEMPLATES.find((t) => t.id === templateId)
  return (template?.metrics ?? []).map((metric) => ({ title: METRIC_INFO[metric].label, metric }))
}
