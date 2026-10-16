import React, { useState } from 'react'
import {
  Plug, Search, CheckCircle2, Plus, ExternalLink,
  Zap, BarChart2, MessageSquare, Package, FileText,
  AlertCircle, ChevronRight, RefreshCw, Calendar,
} from 'lucide-react'
import { Badge, Button, Input } from '@ybot/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@ybot/ui'
import { SubNav } from '../../components/SubNav'
import { cn } from '@ybot/ui'
import { PlannedBadge } from '../../components/PlannedFeature'
import { useIntegrations, useConnectIntegration, useDisconnectIntegration } from '../../lib/hooks'

const SUBNAV = [
  { label: 'Channels', path: '/configure/channels' },
  { label: 'Integrations', path: '/configure/integrations' },
  { label: 'Database', path: '/configure/database' },
  { label: 'Webhooks', path: '/configure/webhooks' },
]

type IntegrationCategory = 'CRM' | 'Ticketing' | 'Analytics' | 'Messaging' | 'Automation' | 'Commerce' | 'Booking'
type IntegrationStatus = 'connected' | 'available' | 'coming_soon'

interface Integration {
  id: string
  name: string
  description: string
  category: IntegrationCategory
  status: IntegrationStatus
  logo: string
  connectedAt?: string
}

const LOGOS: Record<string, string> = {
  hubspot: '🟠', salesforce: '🔵', zendesk: '🟢', jira: '🔷', slack: '💜', teams: '🟣',
  zapier: '🟡', n8n: '🔴', ga4: '📊', mixpanel: '🎯', shopify: '🛍️', stripe: '💳', phorest: '📒',
}

const INTEGRATIONS: Integration[] = [
  { id: 'hubspot', name: 'HubSpot', description: 'Sync contacts and conversations to HubSpot CRM', category: 'CRM', status: 'available', logo: '🟠' },
  { id: 'salesforce', name: 'Salesforce', description: 'Push leads and cases to Salesforce automatically', category: 'CRM', status: 'available', logo: '🔵' },
  { id: 'zendesk', name: 'Zendesk', description: 'Create and sync Zendesk tickets from conversations', category: 'Ticketing', status: 'available', logo: '🟢' },
  { id: 'jira', name: 'Jira', description: 'Create Jira issues directly from chat escalations', category: 'Ticketing', status: 'available', logo: '🔷' },
  { id: 'slack', name: 'Slack', description: 'Post conversation alerts and reports to Slack channels', category: 'Messaging', status: 'available', logo: '💜' },
  { id: 'teams', name: 'Microsoft Teams', description: 'Send notifications and alerts to Teams channels', category: 'Messaging', status: 'available', logo: '🟣' },
  { id: 'zapier', name: 'Zapier', description: 'Connect BotStudio to 5000+ apps via Zapier workflows', category: 'Automation', status: 'available', logo: '🟡' },
  { id: 'n8n', name: 'n8n', description: 'Self-hosted automation workflows with n8n', category: 'Automation', status: 'available', logo: '🔴' },
  { id: 'ga4', name: 'Google Analytics', description: 'Track bot engagement and conversion events in GA4', category: 'Analytics', status: 'available', logo: '📊' },
  { id: 'mixpanel', name: 'Mixpanel', description: 'Send custom events to Mixpanel for product analytics', category: 'Analytics', status: 'available', logo: '🎯' },
  { id: 'shopify', name: 'Shopify', description: 'Look up orders, products, and customers from Shopify', category: 'Commerce', status: 'available', logo: '🛍️' },
  { id: 'stripe', name: 'Stripe', description: 'Retrieve payment and subscription data from Stripe', category: 'Commerce', status: 'coming_soon', logo: '💳' },
  { id: 'phorest', name: 'Phorest', description: 'Send an already confirmed booking to Phorest. The guest stays in chat until then.', category: 'Booking', status: 'coming_soon', logo: '📒' },
]

const CATEGORY_ICONS: Record<IntegrationCategory, React.ReactNode> = {
  CRM: <Package size={13} />,
  Ticketing: <FileText size={13} />,
  Analytics: <BarChart2 size={13} />,
  Messaging: <MessageSquare size={13} />,
  Automation: <Zap size={13} />,
  Commerce: <Package size={13} />,
  Booking: <Calendar size={13} />,
}

export function IntegrationsPage() {
  const { data: saved = [] } = useIntegrations()
  const integrations: Integration[] = (saved.length ? saved : INTEGRATIONS).map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category as IntegrationCategory,
    status: item.status as IntegrationStatus,
    logo: LOGOS[item.id] ?? '🔌',
    connectedAt: item.connectedAt ? new Date(item.connectedAt).toLocaleString() : undefined,
  }))
  const connect = useConnectIntegration()
  const disconnect = useDisconnectIntegration()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<IntegrationCategory | 'all'>('all')
  const [connectDialog, setConnectDialog] = useState<Integration | null>(null)
  const [apiKey, setApiKey] = useState('')

  const categories = ['all', ...Array.from(new Set(integrations.map((i) => i.category)))] as const

  const filtered = integrations.filter((i) => {
    const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.description.toLowerCase().includes(search.toLowerCase())
    const matchCat = categoryFilter === 'all' || i.category === categoryFilter
    return matchSearch && matchCat
  })

  function connectIntegration(id: string) {
    if (!apiKey.trim()) return
    connect.mutate({ provider: id, apiKey: apiKey.trim() }, { onSuccess: () => { setApiKey(''); setConnectDialog(null) } })
  }

  function disconnectIntegration(id: string) {
    disconnect.mutate(id)
  }

  const connected = filtered.filter((i) => i.status === 'connected')
  const available = filtered.filter((i) => i.status !== 'connected')

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <h1 className="text-base font-semibold text-[var(--text-primary)] pb-3">Configure</h1>
        <SubNav items={SUBNAV} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0 flex-wrap">
        <Input placeholder="Search integrations…" leftIcon={<Search size={13} />} value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <div className="flex gap-1 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat as typeof categoryFilter)}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium capitalize transition-colors border',
                categoryFilter === cat
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
              )}
            >
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-8">
        {connected.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
              <CheckCircle2 size={12} className="text-[var(--success)]" /> Connected ({connected.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {connected.map((int) => (
                <IntegrationCard key={int.id} integration={int} onConnect={() => setConnectDialog(int)} onDisconnect={() => disconnectIntegration(int.id)} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Available ({available.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {available.map((int) => (
              <IntegrationCard key={int.id} integration={int} onConnect={() => setConnectDialog(int)} onDisconnect={() => disconnectIntegration(int.id)} />
            ))}
          </div>
        </section>
      </div>

      {/* Connect dialog */}
      <Dialog open={!!connectDialog} onOpenChange={(o) => { if (!o) setConnectDialog(null) }}>
        {connectDialog && (
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>Connect {connectDialog.name}</DialogTitle>
            </DialogHeader>
            <DialogBody className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)]">
                <span className="text-2xl">{connectDialog.logo}</span>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{connectDialog.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{connectDialog.category}</p>
                </div>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">{connectDialog.description}</p>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">API Key / Token</label>
                <input
                  autoFocus
                  type="password"
                  className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                  placeholder="Paste your API key here…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConnectDialog(null)}>Cancel</Button>
              <Button disabled={!apiKey.trim() || connect.isPending} onClick={() => connectIntegration(connectDialog.id)}>Connect</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}

function IntegrationCard({ integration: int, onConnect, onDisconnect }: {
  integration: Integration; onConnect: () => void; onDisconnect: () => void
}) {
  return (
    <div className={cn(
      'rounded-[var(--radius-md)] border bg-[var(--bg-surface)] p-4 group transition-all',
      int.status === 'connected' ? 'border-[var(--success)]/30' : 'border-[var(--border)] hover:border-[var(--accent)]/30'
    )}>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-xl shrink-0">{int.logo}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{int.name}</p>
            {int.status === 'coming_soon' && <><Badge variant="muted" className="text-[10px]">Soon</Badge><PlannedBadge /></>}
          </div>
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
            {CATEGORY_ICONS[int.category]} {int.category}
          </p>
        </div>
        {int.status === 'connected' && <CheckCircle2 size={16} className="text-[var(--success)] shrink-0" />}
      </div>
      <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">{int.description}</p>
      {int.connectedAt && (
        <p className="text-[11px] text-[var(--text-muted)] mb-2">Connected {int.connectedAt}</p>
      )}
      <div className="flex items-center gap-2">
        {int.status === 'connected' ? (
          <>
            <Button variant="secondary" size="sm" className="flex-1 gap-1.5">
              <RefreshCw size={12} /> Manage
            </Button>
            <Button variant="ghost" size="sm" className="text-[var(--error)] hover:bg-[var(--error-muted)]" onClick={onDisconnect}>
              Disconnect
            </Button>
          </>
        ) : int.status === 'coming_soon' ? (
          <Button variant="ghost" size="sm" disabled className="flex-1">Coming soon</Button>
        ) : (
          <Button size="sm" className="flex-1 gap-1.5" onClick={onConnect}>
            <Plus size={12} /> Connect
          </Button>
        )}
      </div>
    </div>
  )
}
