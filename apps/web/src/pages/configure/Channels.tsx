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
import type { Channel } from '../../lib/api'
import { useAppStore } from '../../store/app'
import { WidgetSetupWizard } from './WidgetSetupWizard'
import { slotsForEnvironment, type ChannelKind, type ChannelStatus } from '../../lib/channel-slots'

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

function getEmbedCode(channelId: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `<!-- BotStudio chat widget -->
<script src="${base}/api/v1/widget.js?id=${channelId}" async></script>

<!-- Optional customisation -->
<script>
  window.YBotTitle = 'Chat with us';
  window.YBotAccentColor = '#6366f1';
</script>`
}

function getTestUrl(channelId: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/api/v1/widget-test/${channelId}`
}

function getDemoUrl(channelId: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/api/v1/public/demo/${channelId}`
}

function statusCopy(status: ChannelStatus, kind: ChannelKind): { label: string; hint: string } {
  if (kind === 'web') return { label: 'Active', hint: 'Always on for this layer' }
  if (status === 'active') return { label: 'Active', hint: 'Accepting conversations' }
  if (status === 'inactive') return { label: 'Inactive', hint: 'Connected — turn on to take chats' }
  return { label: 'Idle', hint: 'Not connected' }
}

export function ChannelsPage() {
  const selectedEnv = useAppStore((s) => s.selectedEnv)
  const environments = useAppStore((s) => s.bots.find((bot) => bot.id === s.selectedBotId)?.environments) ?? []
  const envId = environments.find((env) => env.kind === selectedEnv)?.id
  const { data: channels = [], isLoading } = useChannels()
  const createChannel = useCreateChannel()
  const deleteChannel = useDeleteChannel()
  const updateChannel = useUpdateChannel()
  const slots = useMemo(() => slotsForEnvironment(channels, envId), [channels, envId])
  const connected = slots.filter((slot) => slot.status !== 'idle')
  const recommended = slots.filter((slot) => slot.status === 'idle')

  const [selected, setSelected]     = useState<Channel | null>(null)
  const [editName, setEditName]     = useState('')
  const [editActive, setEditActive] = useState(true)
  const [connecting, setConnecting] = useState<ChannelKind | null>(null)
  const [showEmbed, setShowEmbed]   = useState<Channel | null>(null)
  const [copied, setCopied]         = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [waPhoneNumberId, setWaPhoneNumberId] = useState('')
  const [waAccessToken, setWaAccessToken]     = useState('')
  const [waVerifyToken, setWaVerifyToken]     = useState('')

  function openSettings(ch: Channel) {
    setSelected(ch)
    setEditName(ch.name)
    setEditActive(ch.isActive)
    if (ch.kind === 'whatsapp') {
      setWaPhoneNumberId(String(ch.config['phoneNumberId'] ?? ''))
      setWaAccessToken(String(ch.config['accessToken'] ?? ''))
      setWaVerifyToken(String(ch.config['verifyToken'] ?? ''))
    }
  }

  function openConnect(kind: ChannelKind) {
    setConnecting(kind)
    setWaPhoneNumberId('')
    setWaAccessToken('')
    setWaVerifyToken('')
  }

  async function handleSaveSettings() {
    if (!selected) return
    const patch: Parameters<typeof updateChannel.mutateAsync>[0] = {
      id: selected.id,
      name: editName.trim() || selected.name,
      isActive: selected.kind === 'web' ? true : editActive,
    }
    if (selected.kind === 'whatsapp') {
      patch.config = { phoneNumberId: waPhoneNumberId.trim(), accessToken: waAccessToken.trim(), verifyToken: waVerifyToken.trim() }
    }
    await updateChannel.mutateAsync(patch)
    setSelected(null)
  }

  function copyEmbed(channelId: string) {
    navigator.clipboard?.writeText(getEmbedCode(channelId)).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleConnect() {
    if (!connecting || !envId) return
    const config = connecting === 'whatsapp'
      ? { phoneNumberId: waPhoneNumberId.trim(), accessToken: waAccessToken.trim(), verifyToken: waVerifyToken.trim() }
      : {}
    await createChannel.mutateAsync({
      name: KIND_META[connecting].label,
      kind: connecting,
      environmentId: envId,
      config,
    })
    setConnecting(null)
  }

  async function toggleActive(channel: Channel, next: boolean) {
    if (channel.kind === 'web') return
    await updateChannel.mutateAsync({ id: channel.id, isActive: next })
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
                    onClick={(e) => { e.stopPropagation(); window.open(getTestUrl(channel.id), '_blank') }}
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
                  <DropdownMenuItem onClick={() => openSettings(channel)}><Pencil size={13} /> Settings</DropdownMenuItem>
                  {slot.kind === 'web' && <DropdownMenuItem onClick={() => { setShowWizard(true) }}><Wand2 size={13} /> Setup wizard</DropdownMenuItem>}
                  {slot.kind === 'web' && <DropdownMenuItem onClick={() => window.open(getTestUrl(channel.id), '_blank')}><FlaskConical size={13} /> Test widget</DropdownMenuItem>}
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
              onClick={(event) => { event.stopPropagation(); void toggleActive(channel, !channel.isActive) }}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none',
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
          Website chat is always on. WhatsApp, SMS, Telegram, and phone stay here until you connect them.
        </p>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading channels…
          </div>
        )}

        {!isLoading && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {connected.map((slot) => renderChannelCard(slot))}
            </div>
            {recommended.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Recommended</h2>
                <p className="mb-4 text-xs text-[var(--text-muted)]">Connect a channel when you are ready. It stays idle until you turn it on.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {recommended.map((slot) => renderChannelCard(slot))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        {selected && (() => {
          const kind = (selected.kind in KIND_META ? selected.kind : 'web') as ChannelKind
          const meta = KIND_META[kind]
          return (
            <DialogContent size="md">
              <DialogHeader><DialogTitle>{meta.label} settings</DialogTitle></DialogHeader>
              <DialogBody className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5 block">Channel name</label>
                  <input
                    className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSettings() }}
                  />
                </div>

                {selected.kind === 'web' ? (
                  <div className="flex items-center justify-between p-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)]">
                    <div className="flex items-center gap-3">
                      <span className="p-2 rounded-[var(--radius-md)] bg-[var(--accent-muted)] text-[var(--accent)]">
                        {meta.icon}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">Always on</p>
                        <p className="text-xs text-[var(--text-muted)]">Connected and active on this layer. Guests do not wait on a wizard.</p>
                      </div>
                    </div>
                  </div>
                ) : (
                <div className="flex items-center justify-between p-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)]">
                  <div className="flex items-center gap-3">
                    <span className={cn('p-2 rounded-[var(--radius-md)]', editActive ? 'bg-[var(--accent-muted)] text-[var(--accent)]' : 'bg-[var(--bg-overlay)] text-[var(--text-muted)]')}>
                      {meta.icon}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">Channel active</p>
                      <p className="text-xs text-[var(--text-muted)]">{editActive ? 'Accepting new conversations' : 'Connected, but idle until you turn it on'}</p>
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={editActive}
                    onClick={() => setEditActive((v) => !v)}
                    className={cn(
                      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none',
                      editActive ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                    )}
                  >
                    <span className={cn('pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform', editActive ? 'translate-x-4' : 'translate-x-0')} />
                  </button>
                </div>
                )}

                {selected.kind === 'web' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Embed code</label>
                      <Button variant="ghost" size="sm" className="gap-1.5 h-6 text-xs" onClick={() => { setSelected(null); setShowEmbed(selected) }}>
                        <Code2 size={11} /> View full
                      </Button>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2">
                      <code className="text-[11px] text-[var(--text-muted)] font-mono break-all">…/widget.js?id={selected.id}</code>
                    </div>
                  </div>
                )}

                {selected.kind === 'whatsapp' && (
                  <div className="space-y-3">
                    <p className="text-xs text-[var(--text-muted)]">
                      Credentials from{' '}
                      <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-[var(--text-link)] hover:underline">
                        Meta for Developers
                      </a>
                      {' '}→ WhatsApp → API Setup.
                    </p>
                    {[
                      { label: 'Phone Number ID', value: waPhoneNumberId, set: setWaPhoneNumberId, placeholder: '1234567890', hint: 'Found in the WhatsApp API Setup page' },
                      { label: 'Access Token', value: waAccessToken, set: setWaAccessToken, placeholder: 'EAAxxxxxxx…', hint: 'Permanent token from your Meta System User' },
                      { label: 'Verify Token', value: waVerifyToken, set: setWaVerifyToken, placeholder: 'my-secret-verify-token', hint: 'Any string you choose — enter this in the Meta webhook form too' },
                    ].map(({ label, value, set, placeholder, hint }) => (
                      <div key={label}>
                        <label className="text-xs font-semibold text-[var(--text-muted)] mb-1 block">{label}</label>
                        <input
                          className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 font-mono"
                          placeholder={placeholder}
                          value={value}
                          onChange={(e) => set(e.target.value)}
                        />
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">{hint}</p>
                      </div>
                    ))}
                    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] p-3 space-y-1">
                      <p className="text-xs font-semibold text-[var(--text-secondary)]">Webhook URL for Meta</p>
                      <code className="text-[11px] font-mono text-[var(--text-muted)] break-all select-all">
                        {typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/webhooks/whatsapp
                      </code>
                      <p className="text-[11px] text-[var(--text-muted)]">Subscribe to the <strong>messages</strong> webhook field.</p>
                    </div>
                  </div>
                )}

                {selected.kind === 'web' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Live preview</label>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="gap-1.5 h-6 text-xs" onClick={() => window.open(getDemoUrl(selected.id), '_blank')}>
                          🌐 Demo site
                        </Button>
                        <Button variant="ghost" size="sm" className="gap-1.5 h-6 text-xs" onClick={() => window.open(getTestUrl(selected.id), '_blank')}>
                          <FlaskConical size={11} /> Widget only
                        </Button>
                      </div>
                    </div>
                    <div className="relative rounded-[var(--radius-md)] border border-[var(--border)] overflow-hidden bg-[#f8fafc]" style={{ height: 300 }}>
                      <iframe
                        key={selected.id}
                        src={getTestUrl(selected.id)}
                        title="Widget preview"
                        className="w-full h-full border-0"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-xs text-[var(--text-muted)]">Channel ID: <code className="font-mono bg-[var(--bg-overlay)] px-1 rounded">{selected.id}</code></p>
                </div>
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
                {selected.kind === 'web' && (
                  <Button variant="ghost" className="gap-1.5" onClick={() => { setSelected(null); window.open(getTestUrl(selected.id), '_blank') }}>
                    <FlaskConical size={14} /> Test Widget
                  </Button>
                )}
                <Button onClick={handleSaveSettings} disabled={updateChannel.isPending}>
                  {updateChannel.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </DialogFooter>
            </DialogContent>
          )
        })()}
      </Dialog>

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
                  {getEmbedCode(showEmbed.id)}
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
          <DialogContent size="sm">
            <DialogHeader><DialogTitle>Connect {KIND_META[connecting].label}</DialogTitle></DialogHeader>
            <DialogBody className="space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                This connects {KIND_META[connecting].label} on the {selectedEnv === 'sandbox' ? 'sandbox' : 'production'} layer. It stays inactive until you turn it on.
              </p>
              {connecting === 'whatsapp' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-2.5 rounded-[var(--radius-md)] bg-[var(--bg-overlay)] border border-[var(--border)]">
                    <MessageSquare size={14} className="text-[var(--accent)] shrink-0" />
                    <p className="text-xs text-[var(--text-muted)]">Credentials from <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-[var(--text-link)] underline">Meta for Developers</a>.</p>
                  </div>
                  {[
                    { label: 'Phone Number ID', value: waPhoneNumberId, set: setWaPhoneNumberId, placeholder: '1234567890' },
                    { label: 'Access Token', value: waAccessToken, set: setWaAccessToken, placeholder: 'EAAxxxxxxx…' },
                    { label: 'Verify Token', value: waVerifyToken, set: setWaVerifyToken, placeholder: 'my-secret-verify-token' },
                  ].map(({ label, value, set, placeholder }) => (
                    <div key={label}>
                      <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">{label}</label>
                      <input
                        className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 font-mono"
                        placeholder={placeholder}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConnecting(null)}>Cancel</Button>
              <Button disabled={!envId || createChannel.isPending} onClick={() => { void handleConnect() }}>
                {createChannel.isPending ? 'Connecting…' : 'Connect'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
