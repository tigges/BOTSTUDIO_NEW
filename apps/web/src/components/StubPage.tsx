import React from 'react'
import { PageHeader, EmptyState, Button } from '@botstudio/ui'
import { Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface StubPageProps {
  title: string
  description?: string
  icon?: LucideIcon
  action?: string
  children?: React.ReactNode
}

export function StubPage({ title, description, icon: Icon, action, children }: StubPageProps) {
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={title}
        {...(description ? { description } : {})}
        actions={
          action ? (
            <Button size="md">
              <Plus size={14} />
              {action}
            </Button>
          ) : undefined
        }
      />
      <div className="flex-1 flex items-center justify-center p-8">
        {children ?? (
          <EmptyState
            icon={Icon ? <Icon size={20} /> : undefined}
            title={`${title} coming soon`}
            description="This section is being built. Check back shortly."
          />
        )}
      </div>
    </div>
  )
}
