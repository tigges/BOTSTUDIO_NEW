import React, { useState } from 'react'
import {
  Search, CheckCircle2, Plus, KeyRound, Wrench,
  Zap, BarChart2, MessageSquare, Package, FileText,
  AlertCircle, AlertTriangle, Pencil, Calendar, Loader2,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Badge, Button, Input } from '@botstudio/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@botstudio/ui'
import { SubNav } from '../../components/SubNav'
import { cn } from '@botstudio/ui'
import { PlannedBadge } from '../../components/PlannedFeature'
import type { IntegrationConnection } from '../../lib/api'
import { useIntegrations, useConnectIntegration, useDisconnectIntegration, useInstallConnectorTools } from '../../lib/hooks'
import { useAppStore } from '../../store/app'

const SUBNAV = [
  { label: 'Channels', path: '/configure/channels' },
  { label: 'Integrations', path: '/configure/integrations' },
  { label: 'Database', path: '/configure/database' },
  { label: 'Webhooks', path: '/configure/webhooks' },
]

type IntegrationCategory = 'CRM' | 'Ticketing' | 'Analytics' | 'Messaging' | 'Automation' | 'Commerce' | 'Booking'
type IntegrationStatus = 'connected' | 'needs_details' | 'available' | 'coming_soon'

interface Integration {
  id: string
  name: string
  description: string
  category: IntegrationCategory
  status: IntegrationStatus
  logo: string
  connectedAt?: string
  gaps?: IntegrationConnection['gaps']
  settings?: Record<string, unknown>
  authProfile?: IntegrationConnection['authProfile']
  connector?: IntegrationConnection['connector']
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

const fieldClass = 'w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40'

function errorText(err: unknown): string | null {
  return err instanceof Error ? err.message : null
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
    ...('gaps' in item ? { gaps: item.gaps, settings: item.settings, authProfile: item.authProfile, connector: item.connector } : {}),
  }))
  const connect = useConnectIntegration()
  const disconnect = useDisconnectIntegration()
  const install = useInstallConnectorTools()
  const navigate = useNavigate()
  const bot = useAppStore((s) => s.bots.find((row) => row.id === s.selectedBotId) ?? null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<IntegrationCategory | 'all'>('all')
  const [connectDialog, setConnectDialog] = useState<Integration | null>(null)
  const [secret, setSecret] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [leaving, setLeaving] = useState<Integration | null>(null)
  const [notice, setNotice] = useState<{ provider: string; tone: 'ok' | 'warn'; text: string } | null>(null)

  const categories = ['all', ...Array.from(new Set(integrations.map((i) => i.category)))] as const

  const filtered = integrations.filter((i) => {
    const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.description.toLowerCase().includes(search.toLowerCase())
    const matchCat = categoryFilter === 'all' || i.category === categoryFilter
    return matchSearch && matchCat
  })

  function openConnect(int: Integration) {
    connect.reset()
    setSecret('')
    setFields(Object.fromEntries((int.connector?.fields ?? []).map((field) => [field.key, String(int.settings?.[field.key] ?? '')])))
    setConnectDialog(int)
  }

  function submitConnect(int: Integration) {
    connect.mutate(
      { provider: int.id, secret: secret.trim() || undefined, settings: fields },
      {
        onSuccess: (res) => {
          setSecret('')
          setConnectDialog(null)
          setNotice({ provider: int.id, tone: 'ok', text: `Saved. The key is sealed in the Auth Profile “${res.data.authProfile.name}”.` })
        },
      },
    )
  }

  function addTools(int: Integration) {
    install.mutate(int.id, {
      onSuccess: (res) => {
        const added = res.created.map((tool) => tool.name).join(', ')
        setNotice({
          provider: int.id,
          tone: res.created.length ? 'ok' : 'warn',
          text: res.created.length
            ? `Added to ${bot?.name ?? 'this bot'}: ${added}.${res.skipped.length ? ` Skipped: ${res.skipped.join(' ')}` : ''}`
            : `Nothing added. ${res.skipped.join(' ')}`,
        })
      },
      onError: (err) => setNotice({ provider: int.id, tone: 'warn', text: errorText(err) ?? 'The tools could not be added.' }),
    })
  }

  function confirmDisconnect(int: Integration) {
    disconnect.mutate(int.id, {
      onSuccess: (res) => {
        setLeaving(null)
        setNotice(res.toolsLeft
          ? { provider: int.id, tone: 'warn', text: `Disconnected. ${res.toolsLeft} tool${res.toolsLeft === 1 ? '' : 's'} still point at the Auth Profile, which no longer has a key. Connect again or choose another profile on those tools.` }
          : { provider: int.id, tone: 'ok', text: 'Disconnected. The key and its Auth Profile were removed.' })
      },
    })
  }

  const connected = filtered.filter((i) => i.status === 'connected' || i.status === 'needs_details')
  const available = filtered.filter((i) => i.status !== 'connected' && i.status !== 'needs_details')
  const missing = connectDialog?.connector?.fields.some((field) => !fields[field.key]?.trim()) ?? false
  const needsSecret = !connectDialog?.authProfile
  const issues = (connect.error as { body?: { issues?: Array<{ field: string; message: string }> } } | null)?.body?.issues ?? []

  const card = (int: Integration) => (
    <IntegrationCard
      key={int.id}
      integration={int}
      botName={bot?.name ?? null}
      notice={notice?.provider === int.id ? notice : null}
      installing={install.isPending && install.variables === int.id}
      onConnect={() => openConnect(int)}
      onDisconnect={() => setLeaving(int)}
      onAddTools={() => addTools(int)}
      onOpenTools={() => navigate({ to: '/build/tools' })}
    />
  )

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
        <p className="flex items-start gap-2 text-xs text-[var(--text-muted)] max-w-3xl">
          <KeyRound size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          Keys you paste here are sealed in an Auth Profile and never shown again. HubSpot and Zendesk add ready-made tools to the Tools list, which the bot and people in the Inbox can run.
        </p>
        {filtered.length === 0 && (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--text-muted)]">
            No integrations match “{search}”. <button className="text-[var(--accent)] hover:underline" onClick={() => { setSearch(''); setCategoryFilter('all') }}>Clear the filter</button>
          </div>
        )}
        {connected.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
              <CheckCircle2 size={12} className="text-[var(--success)]" /> Connected ({connected.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{connected.map(card)}</div>
          </section>
        )}

        {available.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Available ({available.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{available.map(card)}</div>
          </section>
        )}
      </div>

      {/* Connect dialog */}
      <Dialog open={!!connectDialog} onOpenChange={(o) => { if (!o) setConnectDialog(null) }}>
        {connectDialog && (
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>{connectDialog.authProfile ? `Edit ${connectDialog.name}` : `Connect ${connectDialog.name}`}</DialogTitle>
            </DialogHeader>
            <DialogBody className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)]">
                <span className="text-2xl">{connectDialog.logo}</span>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{connectDialog.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{connectDialog.description}</p>
                </div>
              </div>
              {connectDialog.connector?.fields.map((field) => {
                const problem = issues.find((issue) => issue.field === field.key)
                return (
                  <div key={field.key}>
                    <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block" htmlFor={`int-${field.key}`}>{field.label}</label>
                    <input
                      id={`int-${field.key}`}
                      className={cn(fieldClass, problem && 'border-[var(--error)]')}
                      placeholder={field.placeholder}
                      value={fields[field.key] ?? ''}
                      onChange={(e) => setFields({ ...fields, [field.key]: e.target.value })}
                    />
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">{field.help}</p>
                  </div>
                )
              })}
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block" htmlFor="int-secret">{connectDialog.connector?.secretLabel ?? 'API key or token'}</label>
                <input
                  id="int-secret"
                  autoFocus={!connectDialog.connector?.fields.length}
                  type="password"
                  autoComplete="off"
                  className={cn(fieldClass, issues.some((issue) => issue.field === 'secret') && 'border-[var(--error)]')}
                  placeholder={connectDialog.authProfile ? `Leave empty to keep ${connectDialog.authProfile.secretHint ?? 'the saved key'}` : 'Paste it here'}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  {connectDialog.connector?.secretHelp ?? 'The key is sealed in an Auth Profile. Nobody can read it back, including you.'}
                </p>
              </div>
              {connect.error && (
                <p className="flex items-start gap-1.5 text-xs text-[var(--error)]"><AlertCircle size={12} className="mt-0.5 shrink-0" /> {errorText(connect.error)}</p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConnectDialog(null)}>Cancel</Button>
              <Button disabled={(needsSecret && !secret.trim()) || missing || connect.isPending} onClick={() => submitConnect(connectDialog)}>
                {connect.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                {connectDialog.authProfile ? 'Save' : 'Connect'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* Disconnect confirmation */}
      <Dialog open={!!leaving} onOpenChange={(o) => { if (!o) setLeaving(null) }}>
        {leaving && (
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>Disconnect {leaving.name}?</DialogTitle>
              <DialogDescription>
                The key is deleted. Tools that use the Auth Profile “{leaving.authProfile?.name ?? leaving.name}” stop working until you connect again.
              </DialogDescription>
            </DialogHeader>
            {disconnect.error && <DialogBody><p className="text-xs text-[var(--error)]">{errorText(disconnect.error)}</p></DialogBody>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setLeaving(null)}>Cancel</Button>
              <Button variant="destructive" disabled={disconnect.isPending} onClick={() => confirmDisconnect(leaving)}>Disconnect</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}

function IntegrationCard({ integration: int, botName, notice, installing, onConnect, onDisconnect, onAddTools, onOpenTools }: {
  integration: Integration
  botName: string | null
  notice: { tone: 'ok' | 'warn'; text: string } | null
  installing: boolean
  onConnect: () => void
  onDisconnect: () => void
  onAddTools: () => void
  onOpenTools: () => void
}) {
  const linked = int.status === 'connected' || int.status === 'needs_details'
  return (
    <div className={cn(
      'rounded-[var(--radius-md)] border bg-[var(--bg-surface)] p-4 group transition-all flex flex-col',
      int.status === 'connected' ? 'border-[var(--success)]/30' : int.status === 'needs_details' ? 'border-[var(--warning)]/40' : 'border-[var(--border)] hover:border-[var(--accent)]/30'
    )}>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-xl shrink-0">{int.logo}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{int.name}</p>
            {int.status === 'coming_soon' && <><Badge variant="muted" className="text-[10px]">Soon</Badge><PlannedBadge /></>}
            {int.connector && int.status !== 'coming_soon' && <Badge variant="muted" className="text-[10px] gap-1"><Wrench size={9} /> Tools</Badge>}
          </div>
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
            {CATEGORY_ICONS[int.category]} {int.category}
          </p>
        </div>
        {int.status === 'connected' && <CheckCircle2 size={16} className="text-[var(--success)] shrink-0" />}
        {int.status === 'needs_details' && <AlertTriangle size={16} className="text-[var(--warning)] shrink-0" />}
      </div>
      <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">{int.description}</p>
      {linked && int.authProfile && (
        <p className="text-[11px] text-[var(--text-muted)] mb-1 flex items-center gap-1">
          <KeyRound size={11} /> Auth Profile: <span className="text-[var(--text-secondary)]">{int.authProfile.name}</span> {int.authProfile.secretHint && <span className="font-mono">{int.authProfile.secretHint}</span>}
        </p>
      )}
      {int.connectedAt && <p className="text-[11px] text-[var(--text-muted)] mb-2">Connected {int.connectedAt}</p>}
      {int.status === 'needs_details' && int.gaps?.[0] && (
        <p className="text-[11px] text-[var(--warning)] mb-2">Finish connecting: {int.gaps[0].message}</p>
      )}
      {notice && (
        <p className={cn('text-[11px] mb-2 leading-relaxed', notice.tone === 'ok' ? 'text-[var(--success)]' : 'text-[var(--warning)]')}>
          {notice.text}
          {notice.tone === 'ok' && notice.text.startsWith('Added') && <> <button className="text-[var(--accent)] hover:underline" onClick={onOpenTools}>Open Tools</button></>}
        </p>
      )}
      <div className="flex items-center gap-2 mt-auto flex-wrap">
        {linked ? (
          <>
            {int.connector?.hasTools && (
              <Button
                size="sm"
                className="flex-1 gap-1.5"
                disabled={int.status !== 'connected' || !botName || installing}
                title={!botName ? 'Choose a bot first.' : int.status !== 'connected' ? 'Finish connecting first.' : undefined}
                onClick={onAddTools}
              >
                {installing ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add tools to {botName ?? 'this bot'}
              </Button>
            )}
            <Button variant="secondary" size="sm" className="gap-1.5" onClick={onConnect}>
              <Pencil size={12} /> Edit
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
