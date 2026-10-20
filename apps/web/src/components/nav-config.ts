import React from 'react'
import {
  LayoutDashboard,
  Workflow,
  Route,
  Brain,
  MessageSquare,
  Megaphone,
  BarChart3,
  Settings,
  Settings2,
  Plug,
  Database,
  Globe,
  Users,
  Contact,
  Ticket,
  FileText,
  Repeat2,
  Server,
  Sparkles,
  Wrench,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

export interface NavSection {
  id: string
  label: string
  icon: LucideIcon
  path: string
  badge?: string
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
      { id: 'flows', label: 'Flows', icon: Workflow, path: '/build/flows' },
      { id: 'workflows', label: 'Workflows', icon: Repeat2, path: '/build/workflows' },
      { id: 'tools', label: 'Tools', icon: Wrench, path: '/build/tools' },
      {
        id: 'knowledge',
        label: 'Knowledge',
        icon: Brain,
        path: '/build/knowledge/intents',
        subItems: [
          { id: 'kb-intents', label: 'Intents', path: '/build/knowledge/intents' },
          { id: 'kb-entities', label: 'Entities', path: '/build/knowledge/entities' },
          { id: 'kb-faqs', label: 'FAQs', path: '/build/knowledge/faqs' },
          { id: 'kb-sources', label: 'Sources', path: '/build/knowledge/sources' },
          { id: 'kb-training', label: 'Training', path: '/build/knowledge/training' },
        ],
      },
    ],
  },
  {
    label: 'Inbox',
    items: [
      { id: 'inbox', label: 'Inbox', icon: MessageSquare, path: '/inbox/chats' },
      { id: 'inbox-tickets', label: 'Tickets', icon: Ticket, path: '/inbox/tickets' },
      { id: 'inbox-contacts', label: 'Contacts', icon: Contact, path: '/inbox/contacts' },
      { id: 'inbox-settings', label: 'Inbox Settings', icon: Settings2, path: '/inbox/settings' },
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
      },
    ],
  },
]

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items)
