import React from 'react'
import { Badge } from '@botstudio/ui'

export const PLANNED_TEXT = 'This will become a real feature.'

export function PlannedBadge() {
  return (
    <Badge variant="warning" title={PLANNED_TEXT}>
      Planned
    </Badge>
  )
}

export function PlannedNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--warning)]/30 bg-[var(--warning-muted)] px-3 py-2 text-xs text-[var(--text-secondary)]">
      <PlannedBadge />
      <span>{children} {PLANNED_TEXT}</span>
    </div>
  )
}
