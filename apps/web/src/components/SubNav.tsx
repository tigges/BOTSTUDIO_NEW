import React from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { cn } from '@botstudio/ui'

interface SubNavItem {
  label: string
  path: string
}

interface SubNavProps {
  items: SubNavItem[]
}

export function SubNav({ items }: SubNavProps) {
  const { pathname } = useLocation()

  return (
    <div className="flex gap-0 border-b border-[var(--border)] px-6">
      {items.map((item) => {
        const isActive = pathname === item.path || pathname.startsWith(item.path + '/')
        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              'relative -mb-px h-10 px-4 text-sm font-medium transition-colors duration-[var(--duration-base)]',
              'border-b-2 inline-flex items-center',
              isActive
                ? 'border-[var(--accent)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
