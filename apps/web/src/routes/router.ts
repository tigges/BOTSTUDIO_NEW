import React from 'react'
import {
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
  Outlet,
} from '@tanstack/react-router'
import { AppShell } from '../components/AppShell'
import { useAppStore } from '../store/app'

// ── Page imports ──────────────────────────────────────────────────────────────
import { SignInPage } from '../pages/SignIn'
import { ForgotPasswordPage } from '../pages/ForgotPassword'
import { ResetPasswordPage } from '../pages/ResetPassword'
import { AcceptInvitePage } from '../pages/AcceptInvite'
import { BotSelectorPage } from '../pages/BotSelector'
import { OverviewPage } from '../pages/Overview'
import { FlowsPage } from '../pages/build/Flows'
import { JourneyPage } from '../pages/build/Journey'
import { WorkflowsPage } from '../pages/build/Workflows'
import { ToolsPage } from '../pages/build/Tools'
import { EvalsPage } from '../pages/build/Evals'
import { BusinessPage } from '../pages/build/Business'
import { ReleasesPage } from '../pages/build/Releases'
import { FlowCanvasPage } from '../pages/build/canvas/FlowCanvas'
import { IntentsPage } from '../pages/build/knowledge/Intents'
import { EntitiesPage } from '../pages/build/knowledge/Entities'
import { FaqsPage } from '../pages/build/knowledge/Faqs'
import { SourcesPage } from '../pages/build/knowledge/Sources'
import { DocumentsPage } from '../pages/build/knowledge/Documents'
import { SearchTestPage } from '../pages/build/knowledge/SearchTest'
import { BotSettingsPage } from '../pages/build/BotSettings'
import { ChatsPage } from '../pages/inbox/Chats'
import { TasksPage } from '../pages/inbox/Tasks'
import { ContactsPage } from '../pages/inbox/Contacts'
import { InboxSettingsPage } from '../pages/inbox/Settings'
import { CampaignsPage } from '../pages/engage/Campaigns'
import { TemplatesPage } from '../pages/engage/Templates'
import { AnalyticsOverviewPage } from '../pages/analytics/Overview'
import { DashboardsPage } from '../pages/analytics/Dashboards'
import { ReportsPage } from '../pages/analytics/Reports'
import { readAnalyticsSearch } from '../lib/analytics-filters'
import { ChannelsPage } from '../pages/configure/Channels'
import { OptimizationsPage } from '../pages/configure/Optimizations'
import { IntegrationsPage } from '../pages/configure/Integrations'
import { DatabasePage } from '../pages/configure/Database'
import { WebhooksPage } from '../pages/configure/Webhooks'
import { SafetyPage } from '../pages/configure/Safety'
import { TeamPage } from '../pages/admin/Team'
import { AuditPage } from '../pages/admin/Audit'
import { SystemStatusPage } from '../pages/admin/SystemStatus'
import { SettingsPage } from '../pages/Settings'
import { BotNewPage } from '../pages/BotNew'
import { HelpPage } from '../pages/Help'

// ── Auth guard ────────────────────────────────────────────────────────────────
function requireAuth() {
  const token = useAppStore.getState().token
  if (!token) throw redirect({ to: '/sign-in' })
}

// ── Root ─────────────────────────────────────────────────────────────────────
const rootRoute = createRootRoute({ component: Outlet })

// ── Auth routes ───────────────────────────────────────────────────────────────
const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  component: SignInPage,
})

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordPage,
})

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: ResetPasswordPage,
})

const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accept-invite',
  component: AcceptInvitePage,
})

// ── Bot selector ─────────────────────────────────────────────────────────────
const botSelectorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bots',
  beforeLoad: requireAuth,
  component: BotSelectorPage,
})

const botNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/bots/new',
  component: BotNewPage,
})

// ── App shell wrapper ─────────────────────────────────────────────────────────
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: requireAuth,
  component: AppShell,
})

// ── Index redirect ────────────────────────────────────────────────────────────
const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => { throw redirect({ to: '/overview' }) },
  component: () => null,
})

// ── Dashboard ─────────────────────────────────────────────────────────────────
const overviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/overview',
  component: OverviewPage,
})

// ── Build ─────────────────────────────────────────────────────────────────────
/** Journey filters live in the URL so a shared link opens the same counts. */
interface JourneySearch {
  lens?: 'traffic' | 'health' | 'learn'
  env?: 'production' | 'sandbox'
  tests?: 'hide'
}
const journeyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/build/journey',
  validateSearch: (search: Record<string, unknown>): JourneySearch => ({
    ...(search.lens === 'traffic' || search.lens === 'health' || search.lens === 'learn' ? { lens: search.lens } : {}),
    ...(search.env === 'sandbox' || search.env === 'production' ? { env: search.env } : {}),
    ...(search.tests === 'hide' ? { tests: 'hide' as const } : {}),
  }),
  component: JourneyPage,
})
const flowsRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/flows', component: FlowsPage })
const flowCanvasRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/build/flows/$flowId',
  validateSearch: (search: Record<string, unknown>) => ({
    from: search.from === 'journey' ? 'journey' as const : undefined,
    mark: typeof search.mark === 'string' && search.mark ? search.mark : undefined,
  }),
  component: FlowCanvasPage,
})
const workflowsRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/workflows', component: WorkflowsPage })
const toolsRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/tools', component: ToolsPage })
const evalsRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/evals', component: EvalsPage })
const businessRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/business', component: BusinessPage })
const releasesRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/releases', component: ReleasesPage })
const knowledgeRedirectRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/knowledge', beforeLoad: () => { throw redirect({ to: '/build/knowledge/sources' }) }, component: () => null })
const intentsRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/knowledge/intents', component: IntentsPage })
const entitiesRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/knowledge/entities', component: EntitiesPage })
const faqsRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/knowledge/faqs', component: FaqsPage })
const sourcesRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/knowledge/sources', component: SourcesPage })
const documentsRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/knowledge/documents', validateSearch: (search: Record<string, unknown>): { doc?: string } => (typeof search['doc'] === 'string' && search['doc'] ? { doc: search['doc'] } : {}), component: DocumentsPage })
const searchTestRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/knowledge/search', component: SearchTestPage })
const trainingRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/knowledge/training', beforeLoad: () => { throw redirect({ to: '/build/settings' }) }, component: () => null })
const botSettingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/build/settings', component: BotSettingsPage })

// ── Inbox ─────────────────────────────────────────────────────────────────────
const chatsRoute = createRoute({ getParentRoute: () => appRoute, path: '/inbox/chats', validateSearch: (search: Record<string, unknown>): { chat?: string } => (typeof search['chat'] === 'string' && search['chat'] ? { chat: search['chat'] } : {}), component: ChatsPage })
const tasksRoute = createRoute({ getParentRoute: () => appRoute, path: '/inbox/tasks', component: TasksPage })
const ticketsRoute = createRoute({ getParentRoute: () => appRoute, path: '/inbox/tickets', beforeLoad: () => { throw redirect({ to: '/inbox/tasks' }) }, component: () => null })
const contactsRoute = createRoute({ getParentRoute: () => appRoute, path: '/inbox/contacts', component: ContactsPage })
const inboxSettingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/inbox/settings', component: InboxSettingsPage })
const inboxRoute = createRoute({ getParentRoute: () => appRoute, path: '/inbox', beforeLoad: () => { throw redirect({ to: '/inbox/chats' }) }, component: () => null })

// ── Engage ────────────────────────────────────────────────────────────────────
const campaignsRoute = createRoute({ getParentRoute: () => appRoute, path: '/engage/campaigns', component: CampaignsPage })
const templatesRoute = createRoute({ getParentRoute: () => appRoute, path: '/engage/templates', component: TemplatesPage })
const engageRoute = createRoute({ getParentRoute: () => appRoute, path: '/engage', beforeLoad: () => { throw redirect({ to: '/engage/campaigns' }) }, component: () => null })

// ── Analytics ─────────────────────────────────────────────────────────────────
const analyticsRoute = createRoute({ getParentRoute: () => appRoute, path: '/analytics', validateSearch: readAnalyticsSearch, component: AnalyticsOverviewPage })
const dashboardsRoute = createRoute({ getParentRoute: () => appRoute, path: '/analytics/dashboards', validateSearch: readAnalyticsSearch, component: DashboardsPage })
const reportsRoute = createRoute({ getParentRoute: () => appRoute, path: '/analytics/reports', component: ReportsPage })

// ── Configure ─────────────────────────────────────────────────────────────────
const channelsRoute = createRoute({ getParentRoute: () => appRoute, path: '/configure/channels', component: ChannelsPage })
const optimizationsRoute = createRoute({ getParentRoute: () => appRoute, path: '/configure/optimizations', component: OptimizationsPage })
const integrationsRoute = createRoute({ getParentRoute: () => appRoute, path: '/configure/integrations', component: IntegrationsPage })
const databaseRoute = createRoute({ getParentRoute: () => appRoute, path: '/configure/database', component: DatabasePage })
const webhooksRoute = createRoute({ getParentRoute: () => appRoute, path: '/configure/webhooks', component: WebhooksPage })
const safetyRoute = createRoute({ getParentRoute: () => appRoute, path: '/configure/safety', component: SafetyPage })

// ── Admin ─────────────────────────────────────────────────────────────────────
const teamRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin/team', component: TeamPage })
const auditRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin/audit', component: AuditPage })
const systemStatusRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin/system-status', component: SystemStatusPage })

// ── Settings ─────────────────────────────────────────────────────────────────
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/settings', component: SettingsPage })
const helpRoute = createRoute({ getParentRoute: () => appRoute, path: '/help', component: HelpPage })

// ── Router ────────────────────────────────────────────────────────────────────
const routeTree = rootRoute.addChildren([
  signInRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  acceptInviteRoute,
  botSelectorRoute,
  appRoute.addChildren([
    indexRoute,
    overviewRoute,
    botNewRoute,
    journeyRoute,
    flowsRoute,
    flowCanvasRoute,
    workflowsRoute,
    toolsRoute,
    evalsRoute,
    businessRoute,
    releasesRoute,
    intentsRoute,
    entitiesRoute,
    faqsRoute,
    sourcesRoute,
    trainingRoute,
    botSettingsRoute,
    documentsRoute,
    searchTestRoute,
    knowledgeRedirectRoute,
    inboxRoute,
    chatsRoute,
    tasksRoute,
    ticketsRoute,
    contactsRoute,
    inboxSettingsRoute,
    engageRoute,
    campaignsRoute,
    templatesRoute,
    analyticsRoute,
    dashboardsRoute,
    reportsRoute,
    channelsRoute,
    optimizationsRoute,
    integrationsRoute,
    databaseRoute,
    webhooksRoute,
    safetyRoute,
    teamRoute,
    auditRoute,
    systemStatusRoute,
    settingsRoute,
    helpRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
