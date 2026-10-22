import React from 'react'
import {
  LayoutDashboard,
  SlidersHorizontal,
  Route,
  Brain,
  MessageSquare,
  Megaphone,
  BarChart3,
  Settings,
  Plug,
  Database,
  Globe,
  Users,
  FileText,
  Repeat2,
  Server,
  Sparkles,
  Wrench,
  ShieldCheck,
  FlaskConical,
  Rocket,
  Building2,
  type LucideIcon,
} from 'lucide-react'

export interface NavSection {
  id: string
  label: string
  icon: LucideIcon
  path: string
  /** Path prefix that keeps the item highlighted, when it differs from `path`. */
  match?: string
  badge?: string
  /** Host health and server config: only for the people who run the installation. */
  platformOnly?: boolean
  subItems?: Array<{
    id: string
    label: string
    path: string
  }>
}

export interface NavGroup {
  label?: string
  items: NavSection[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard, path: '/overview' },
    ],
  },
  {
    label: 'Build',
    items: [
      { id: 'journey', label: 'Journey', icon: Route, path: '/build/journey' },
      { id: 'business', label: 'Business details', icon: Building2, path: '/build/business' },
      { id: 'workflows', label: 'Workflows', icon: Repeat2, path: '/build/workflows' },
      { id: 'tools', label: 'Tools', icon: Wrench, path: '/build/tools' },
      { id: 'evals', label: 'Evals', icon: FlaskConical, path: '/build/evals' },
      { id: 'releases', label: 'Releases', icon: Rocket, path: '/build/releases' },
      { id: 'bot-settings', label: 'Bot settings', icon: SlidersHorizontal, path: '/build/settings' },
      {
        id: 'knowledge',
        label: 'Knowledge',
        icon: Brain,
        path: '/build/knowledge/sources',
        match: '/build/knowledge',
        subItems: [
          { id: 'kb-sources', label: 'Sources', path: '/build/knowledge/sources' },
          { id: 'kb-documents', label: 'Documents', path: '/build/knowledge/documents' },
          { id: 'kb-search', label: 'Search & Test', path: '/build/knowledge/search' },
        ],
      },
    ],
  },
  {
    items: [
      { id: 'inbox', label: 'Inbox', icon: MessageSquare, path: '/inbox/chats', match: '/inbox' },
    ],
  },
  {
    label: 'Engage',
    items: [
      {
        id: 'campaigns',
        label: 'Campaigns',
        icon: Megaphone,
        path: '/engage/campaigns',
        subItems: [
          { id: 'engage-campaigns', label: 'Campaigns', path: '/engage/campaigns' },
          { id: 'engage-templates', label: 'Templates', path: '/engage/templates' },
        ],
      },
    ],
  },
  {
    label: 'Analytics',
    items: [
      {
        id: 'analytics',
        label: 'Analytics',
        icon: BarChart3,
        path: '/analytics',
        subItems: [
          { id: 'analytics-overview', label: 'Overview', path: '/analytics' },
          { id: 'analytics-dashboards', label: 'Dashboards', path: '/analytics/dashboards' },
          { id: 'analytics-reports', label: 'Reports', path: '/analytics/reports' },
        ],
      },
    ],
  },
  {
    label: 'Configure',
    items: [
      {
        id: 'channels',
        label: 'Channels',
        icon: Globe,
        path: '/configure/channels',
      },
      {
        id: 'optimizations',
        label: 'Optimizations',
        icon: Sparkles,
        path: '/configure/optimizations',
        badge: 'AI',
      },
      {
        id: 'integrations',
        label: 'Integrations',
        icon: Plug,
        path: '/configure/integrations',
      },
      {
        id: 'database',
        label: 'Database',
        icon: Database,
        path: '/configure/database',
      },
      {
        id: 'webhooks',
        label: 'Webhooks',
        icon: Repeat2,
        path: '/configure/webhooks',
      },
      {
        id: 'safety',
        label: 'Safety',
        icon: ShieldCheck,
        path: '/configure/safety',
      },
    ],
  },
  {
    label: 'Admin',
    items: [
      {
        id: 'team',
        label: 'Team',
        icon: Users,
        path: '/admin/team',
      },
      {
        id: 'audit',
        label: 'Audit Log',
        icon: FileText,
        path: '/admin/audit',
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: Settings,
        path: '/settings',
      },
      {
        id: 'system-status',
        label: 'System Status',
        icon: Server,
        path: '/admin/system-status',
        platformOnly: true,
      },
    ],
  },
]

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items)

export function visibleNavGroups(platformAdmin: boolean, groups: NavGroup[] = NAV_GROUPS): NavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => platformAdmin || !item.platformOnly) }))
    .filter((group) => group.items.length > 0)
}
