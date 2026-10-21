import React, { useMemo, useState } from 'react'
import {
  Globe, MessageSquare, Phone, Mail, Smartphone,
  Send, CheckCircle2, Circle, Pencil, Trash2, Code2,
  Copy, Loader2, FlaskConical, Wand2,
} from 'lucide-react'
import { Badge, Button } from '@ybot/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@ybot/ui'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@ybot/ui'
import { SubNav } from '../../components/SubNav'
import { cn } from '@ybot/ui'
import { useChannels, useCreateChannel, useDeleteChannel, useUpdateChannel } from '../../lib/hooks'
import { ApiError, type Channel } from '../../lib/api'
import { useAppStore } from '../../store/app'
import { WidgetSetupWizard } from './WidgetSetupWizard'
import { ChannelConnectionDialog, embedCode, widgetTestUrl } from './ChannelConnectionDialog'
import { apiErrorField, type ConnectionTab } from '../../lib/channel-connection'
import { slotsForEnvironment, type ChannelKind, type ChannelStatus } from '../../lib/channel-slots'
import {
  CHANNEL_FIELDS,
  channelConfigReady,
  isOptionalChannelKind,
} from '@ybot/shared'

const SUBNAV = [
  { label: 'Channels',      path: '/configure/channels' },
  { label: 'Optimizations', path: '/configure/optimizations' },
  { label: 'Integrations',  path: '/configure/integrations' },
  { label: 'Database',      path: '/configure/database' },
  { label: 'Webhooks',      path: '/configure/webhooks' },
]

const KIND_META: Record<ChannelKind, { label: string; description: string; icon: React.ReactNode }> = {
  web:       { label: 'Website chat',  description: 'Always on. Walks the journey map.',                 icon: <Globe size={22} /> },
  whatsapp:  { label: 'WhatsApp',      description: 'Connect a WhatsApp Business number.',               icon: <MessageSquare size={22} /> },
  sms:       { label: 'SMS',           description: 'Send and receive texts.',                           icon: <Smartphone size={22} /> },
  telegram:  { label: 'Telegram',      description: 'A Telegram bot.',                                   icon: <Send size={22} /> },
  phone:     { label: 'Phone',         description: 'A voice number for calls.',                         icon: <Phone size={22} /> },
  email:     { label: 'Email',         description: 'Receive and reply to mail.',                        icon: <Mail size={22} /> },
}

function fieldsFor(kind: string) {
  return isOptionalChannelKind(kind) ? CHANNEL_FIELDS[kind] : []
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Could not connect that channel.'
}

function statusCopy(status: ChannelStatus, kind: ChannelKind): { label: string; hint: string } {
  if (kind === 'web') return { label: 'Active', hint: 'Always on' }
  if (status === 'active') return { label: 'Active', hint: 'Accepting conversations' }
  if (status === 'inactive') return { label: 'Inactive', hint: 'Connected — turn on to take chats' }
  return { label: 'Idle', hint: 'Not connected' }
}

export function ChannelsPage() {
  const selectedEnv = useAppStore((s) => s.selectedEnv)
  const environments = useAppStore((s) => s.bots.find((bot) => bot.id === s.selectedBotId)?.environments) ?? []
  const envId = environments.find((env) => env.kind === selectedEnv)?.id
  const { data: channels = [], isLoading, isError, refetch, isRefetching } = useChannels()
  const createChannel = useCreateChannel()
  const deleteChannel = useDeleteChannel()
  const updateChannel = useUpdateChannel()
  const slots = useMemo(() => slotsForEnvironment(channels, envId), [channels, envId])
  const connected = slots.filter((slot) => slot.status !== 'idle')
  const recommended = slots.filter((slot) => slot.status === 'idle')

  const [selected, setSelected]     = useState<Channel | null>(null)
  const [selectedTab, setSelectedTab] = useState<ConnectionTab>('overview')
  const [connecting, setConnecting] = useState<ChannelKind | null>(null)
  const [showEmbed, setShowEmbed]   = useState<Channel | null>(null)
  const [copied, setCopied]         = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [formConfig, setFormConfig] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [formField, setFormField] = useState<string | null>(null)
  const [pageError, setPageError] = useState('')

  function setField(key: string, value: string) {
    setFormConfig((current) => ({ ...current, [key]: value }))
  }

  function openSettings(ch: Channel, tab: ConnectionTab = 'overview') {
    setSelectedTab(tab)
    setSelected(ch)
  }

  function openConnect(kind: ChannelKind) {
    setConnecting(kind)
    setFormConfig({})
    setFormError('')
    setFormField(null)
  }

  function copyEmbed(channelId: string) {
    navigator.clipboard?.writeText(embedCode(channelId)).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleConnect() {
    if (!connecting || !envId) return
    if (!channelConfigReady(connecting, formConfig)) {
      setFormError('Fill every field for this channel.')
      return
    }
    setFormError('')
    try {
      const existing = slots.find((slot) => slot.kind === connecting)?.channel
      const saved = existing
        ? (await updateChannel.mutateAsync({ id: existing.id, config: { ...formConfig }, isActive: false })).data
        : await createChannel.mutateAsync({
          name: KIND_META[connecting].label,
          kind: connecting,
          environmentId: envId,
          config: { ...formConfig },
        })
      setConnecting(null)
      if (saved) openSettings(saved, 'deployment')
    } catch (err) {
      setFormError(errorMessage(err))
      setFormField(err instanceof ApiError ? apiErrorField(err.body) : null)
    }
  }

  async function toggleActive(channel: Channel, next: boolean) {
    if (channel.kind === 'web') return
    try {
      setPageError('')
      await updateChannel.mutateAsync({ id: channel.id, isActive: next })
    } catch (err) {
      setPageError(`${channel.name}: ${errorMessage(err)}`)
    }
  }

  function renderChannelCard(slot: (typeof slots)[number]) {
    const meta = KIND_META[slot.kind]
    const channel = slot.channel
    const copy = statusCopy(slot.status, slot.kind)
    const on = slot.status === 'active'
    return (
      <div
        key={slot.kind}
        className={cn(
          'rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-5 transition-colors group',
          slot.status === 'idle' ? 'border-[var(--border)] opacity-80' : 'border-[var(--border)] hover:border-[var(--accent)]/40',
          channel ? 'cursor-pointer' : '',
        )}
        onClick={() => { if (channel) openSettings(channel) }}
      >
        <div className="flex items-start justify-between mb-4">
          <div className={cn(
            'p-3 rounded-[var(--radius-md)]',
            on ? 'bg-[var(--accent-muted)] text-[var(--accent)]' : 'bg-[var(--bg-overlay)] text-[var(--text-muted)]'
          )}>
            {meta.icon}
          </div>
          {channel && (
            <div className="flex items-center gap-1">
              {slot.kind === 'web' && (
                <>
                  <button
                    title="Test widget in new tab"
                    onClick={(e) => { e.stopPropagation(); window.open(widgetTestUrl(channel.id), '_blank') }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-[var(--bg-overlay)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-all"
                  >
                    <FlaskConical size={14} />
                  </button>
                  <button
                    title="View embed code"
                    onClick={(e) => { e.stopPropagation(); setShowEmbed(channel) }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-[var(--bg-overlay)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-all"
                  >
                    <Code2 size={14} />
                  </button>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-[var(--bg-overlay)] text-[var(--text-muted)] transition-all"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openSettings(channel)}><Pencil size={13} /> Open connection</DropdownMenuItem>
                  {slot.kind !== 'web' && <DropdownMenuItem onClick={() => openSettings(channel, 'deployment')}><Send size={13} /> Webhook and routing</DropdownMenuItem>}
                  {slot.kind === 'web' && <DropdownMenuItem onClick={() => { setShowWizard(true) }}><Wand2 size={13} /> Setup wizard</DropdownMenuItem>}
                  {slot.kind === 'web' && <DropdownMenuItem onClick={() => window.open(widgetTestUrl(channel.id), '_blank')}><FlaskConical size={13} /> Test widget</DropdownMenuItem>}
                  {slot.kind === 'web' && <DropdownMenuItem onClick={() => setShowEmbed(channel)}><Code2 size={13} /> Embed code</DropdownMenuItem>}
                  {slot.kind !== 'web' && <DropdownMenuSeparator />}
                  {slot.kind !== 'web' && (
                    <DropdownMenuItem destructive onClick={() => deleteChannel.mutate(channel.id)}>
                      <Trash2 size={13} /> Disconnect
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        <h3 className="font-semibold text-[var(--text-primary)] mb-0.5">{meta.label}</h3>
        <p className="text-xs text-[var(--text-muted)] mb-3">{meta.description}</p>

        <div className="flex items-center justify-between gap-2">
          <span className={cn('flex items-center gap-1.5 text-xs font-medium', on ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
            {on ? <CheckCircle2 size={12} /> : <Circle size={12} />}
            {copy.label}
          </span>
          {slot.kind === 'web' ? (
            <Badge variant="muted" className="text-[10px] uppercase tracking-wide">Always on</Badge>
          ) : slot.status === 'idle' ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-7"
              disabled={!envId || createChannel.isPending}
              onClick={(event) => { event.stopPropagation(); openConnect(slot.kind) }}
            >
              Connect
            </Button>
          ) : channel ? (
            <button
              role="switch"
              aria-checked={channel.isActive}
              aria-label={channel.isActive ? 'Turn off' : 'Turn on'}
              disabled={updateChannel.isPending}
              onClick={(event) => { event.stopPropagation(); void toggleActive(channel, !channel.isActive) }}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50',
                channel.isActive ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
              )}
            >
              <span className={cn('pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform', channel.isActive ? 'translate-x-4' : 'translate-x-0')} />
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">{copy.hint}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {showWizard && <WidgetSetupWizard onClose={() => setShowWizard(false)} />}

      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <div className="flex items-center justify-between pb-3">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Configure</h1>
          <Button size="sm" className="gap-1.5" onClick={() => setShowWizard(true)}>
            <Wand2 size={14} /> Embed widget
          </Button>
        </div>
        <SubNav items={SUBNAV} />
      </div>

      <div className="flex-1 overflow-auto p-6">
        <p className="mb-6 text-sm text-[var(--text-muted)]">
          Website chat is always on. Connect WhatsApp, SMS, Telegram, phone, or email with real credentials, then turn the channel on to take conversations.
        </p>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading channels…
          </div>
        )}

        {pageError && <p className="mb-4 text-xs text-[var(--error)]" role="alert">{pageError}</p>}

        {!isLoading && isError && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="text-sm text-[var(--text-secondary)]">Channels did not load. Check your connection and try again.</p>
            <Button size="sm" variant="secondary" disabled={isRefetching} onClick={() => { void refetch() }}>
              {isRefetching ? 'Retrying…' : 'Retry'}
            </Button>
          </div>
        )}

        {!isLoading && !isError && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {connected.map((slot) => renderChannelCard(slot))}
            </div>
            {recommended.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Recommended</h2>
                <p className="mb-4 text-xs text-[var(--text-muted)]">Connect with credentials. It stays off until you turn it on.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {recommended.map((slot) => renderChannelCard(slot))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {selected && (
        <ChannelConnectionDialog
          key={selected.id}
          channel={channels.find((row) => row.id === selected.id) ?? selected}
          kindLabel={KIND_META[(selected.kind in KIND_META ? selected.kind : 'web') as ChannelKind].label}
          environmentName={environments.find((env) => env.id === selected.environmentId)?.name ?? selectedEnv}
          initialTab={selectedTab}
          onClose={() => setSelected(null)}
          onShowEmbed={() => { const channel = selected; setSelected(null); setShowEmbed(channel) }}
        />
      )}

      <Dialog open={!!showEmbed} onOpenChange={(o) => { if (!o) setShowEmbed(null) }}>
        {showEmbed && (
          <DialogContent size="md">
            <DialogHeader><DialogTitle>Web widget embed code</DialogTitle></DialogHeader>
            <DialogBody>
              <p className="text-sm text-[var(--text-secondary)] mb-3">
                Paste this snippet just before the <code className="font-mono text-xs bg-[var(--bg-overlay)] px-1 rounded">&lt;/body&gt;</code> tag of your website.
              </p>
              <div className="relative">
                <pre className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] p-4 text-xs text-[var(--text-secondary)] font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  {embedCode(showEmbed.id)}
                </pre>
                <button
                  onClick={() => copyEmbed(showEmbed.id)}
                  className="absolute top-2 right-2 px-2 py-1 rounded text-xs bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1"
                >
                  {copied ? <CheckCircle2 size={11} className="text-[var(--success)]" /> : <Copy size={11} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button onClick={() => setShowEmbed(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!connecting} onOpenChange={(open) => { if (!open) setConnecting(null) }}>
        {connecting && (
          <DialogContent size="md">
            <DialogHeader><DialogTitle>Connect {KIND_META[connecting].label}</DialogTitle></DialogHeader>
            <DialogBody className="space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Create the connection first: BotStudio checks these credentials and saves them, and the channel stays off until you turn it on. Then register the webhook with {KIND_META[connecting].label}; the Deployment tab opens with the URL and routing key.
              </p>
              {fieldsFor(connecting).map((field) => (
                <div key={field.key}>
                  <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">{field.label}</label>
                  <input
                    className={cn('w-full rounded-[var(--radius-md)] border bg-[var(--bg-overlay)] px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 font-mono', formField === field.key ? 'border-[var(--error)] ring-2 ring-[var(--error)]/30' : 'border-[var(--border)]')}
                    aria-invalid={formField === field.key}
                    placeholder={field.placeholder}
                    type={field.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={formConfig[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                  />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">{field.hint}</p>
                </div>
              ))}
              {formError && <p className="text-xs text-[var(--error)]">{formError}</p>}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConnecting(null)}>Cancel</Button>
              <Button
                disabled={!envId || createChannel.isPending || !channelConfigReady(connecting, formConfig)}
                onClick={() => { void handleConnect() }}
              >
                {createChannel.isPending ? 'Connecting…' : 'Connect'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
