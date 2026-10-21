export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'
export type TaskStatus = 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed'

export const TASK_PRIORITIES: Array<{ id: TaskPriority; label: string }> = [
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
]

/** Older rows still carry the pre-handoff names (normal, urgent). */
export function taskPriority(raw: string): TaskPriority {
  if (raw === 'urgent') return 'critical'
  if (raw === 'normal') return 'medium'
  return (['low', 'medium', 'high', 'critical'] as const).includes(raw as TaskPriority) ? raw as TaskPriority : 'medium'
}

export interface TaskFilter {
  search: string
  priority: TaskPriority | 'all'
}

export function matchesTask(task: { subject: string; contact: string; priority: TaskPriority }, filter: TaskFilter): boolean {
  const needle = filter.search.trim().toLowerCase()
  if (filter.priority !== 'all' && task.priority !== filter.priority) return false
  return !needle || task.subject.toLowerCase().includes(needle) || task.contact.toLowerCase().includes(needle)
}
