import React, { useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Bot } from 'lucide-react'
import { cn } from '@botstudio/ui'
import { visibleNavGroups } from './nav-config'
import { navItemActive } from '../lib/build-nav'
import { shortVersion, fullVersion } from '../lib/version'
import { useBuildInfo, usePlatformAdmin } from '../lib/hooks'

interface NavRailProps {
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** Live counts by nav item id, e.g. chats waiting for a person on the Inbox. */
  badges?: Record<string, string | undefined>
}


export function NavRail({ collapsed = false, onToggleCollapse, badges = {} }: NavRailProps) {
  const { pathname } = useLocation()
  const build = useBuildInfo()
  const groups = visibleNavGroups(usePlatformAdmin())

  return (
    <nav
      className={cn(
        'flex flex-col h-full border-r border-[var(--nav-border)] bg-[var(--nav-bg)]',
        'transition-[width] duration-[var(--duration-slow)] ease-[var(--ease)]',
        collapsed ? 'w-14' : 'w-[var(--nav-width)]'
      )}
    >
      {/* Logo */}
      <div className="flex h-[var(--topbar-height)] items-center border-b border-[var(--nav-border)] px-3 shrink-0">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--accent)]">
            <Bot size={14} className="text-white" />
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold text-[var(--text-primary)] truncate">BotStudio</span>
          )}
        </div>
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
        {groups.map((group, gi) => (
          <div key={gi} className="mt-2">
            {group.label && !collapsed && (
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const isActive = navItemActive(item.id, item.match ?? item.path, pathname)
              const Icon = item.icon
              const live = badges[item.id]
              const badge = live ?? item.badge
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className={cn(
                    'relative flex h-[var(--nav-item-height)] items-center gap-2.5 rounded-[var(--radius)] px-2',
                    'text-sm transition-colors duration-[var(--duration-fast)]',
                    isActive
                      ? 'bg-[var(--bg-selected)] text-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                    collapsed && 'justify-center px-0'
                  )}
                  title={collapsed ? (live ? `${item.label}: ${live} waiting for a person` : item.label) : undefined}
                  aria-label={live ? `${item.label}, ${live} waiting for a person` : undefined}
                >
                  <Icon size={16} className="shrink-0" />
                  {!collapsed && (
                    <span className="truncate font-medium">{item.label}</span>
                  )}
                  {!collapsed && badge && (
                    <span className={cn(
                      'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      live ? 'bg-[var(--accent)] text-white' : 'bg-[var(--accent-muted)] text-[var(--accent)]',
                    )}>
                      {badge}
                    </span>
                  )}
                  {collapsed && live && (
                    <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--accent)]" />
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </div>

      {/* Version + Collapse toggle */}
      <div className="border-t border-[var(--nav-border)] p-2 flex flex-col gap-1">
        {!collapsed && (
          <div
            title={fullVersion(build)}
            className="px-2 py-1 text-[10px] text-[var(--text-muted)] font-mono select-none cursor-default"
          >
            {shortVersion(build)}
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className="flex w-full h-8 items-center justify-center rounded-[var(--radius)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          title={collapsed ? `Expand sidebar (${shortVersion(build)})` : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
    </nav>
  )
}
