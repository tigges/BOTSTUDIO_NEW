import React, { useState } from 'react'
import {
  Globe, MessageSquare, Phone, Mail, Facebook,
  Send, CheckCircle2, Circle, Pencil, Trash2, Plus, Code2,
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

const SUBNAV = [
  { label: 'Channels',      path: '/configure/channels' },
  { label: 'Optimizations', path: '/configure/optimizations' },
  { label: 'Integrations',  path: '/configure/integrations' },
  { label: 'Database',      path: '/configure/database' },
  { label: 'Webhooks',      path: '/configure/webhooks' },
]

const KIND_META: Record<string, { label: string; description: string; icon: React.ReactNode; docsUrl?: string }> = {
  web:       { label: 'Web Widget',          description: 'Always-on chat that walks the journey map', icon: <Globe size={22} /> },
  whatsapp:  { label: 'WhatsApp Business',   description: 'Connect via WhatsApp Business API',       icon: <MessageSquare size={22} />, docsUrl: 'https://developers.facebook.com/docs/whatsapp' },
  sms:       { label: 'SMS (Twilio)',        description: 'Send and receive SMS via Twilio',          icon: <Phone size={22} />, docsUrl: 'https://www.twilio.com/docs' },
  email:     { label: 'Email',               description: 'Receive and reply to emails',             icon: <Mail size={22} /> },
  facebook:  { label: 'Facebook Messenger',  description: 'Connect your Facebook Page inbox',       icon: <Facebook size={22} /> },
  telegram:  { label: 'Telegram',            description: 'Deploy a Telegram bot',                  icon: <Send size={22} /> },
}

const ADD_KINDS = ['web', 'whatsapp', 'sms', 'email', 'facebook', 'telegram']

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

function webRole(
  channel: Channel,
  environments: Array<{ id: string; kind: string }>,
): 'test' | 'live' | null {
  if (channel.kind !== 'web') return null
  const env = environments.find((item) => item.id === channel.environmentId)
  return env?.kind === 'sandbox' ? 'test' : 'live'
}

export function ChannelsPage() {
  const selectedBotId = useAppStore((s: { selectedBotId: string | null }) => s.selectedBotId) ?? ''
  const environments = useAppStore((s) => s.bots.find((bot) => bot.id === s.selectedBotId)?.environments) ?? []
  const { data: channels = [], isLoading } = useChannels()
  const createChannel = useCreateChannel()
  const deleteChannel = useDeleteChannel()
  const updateChannel = useUpdateChannel()

  const [selected, setSelected]     = useState<Channel | null>(null)
  const [editName, setEditName]     = useState('')
  const [editActive, setEditActive] = useState(true)
  const [showAdd, setShowAdd]       = useState(false)
  const [showEmbed, setShowEmbed]   = useState<Channel | null>(null)
  const [addKind, setAddKind]       = useState('web')
  const [addName, setAddName]       = useState('')
  const [copied, setCopied]         = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  // WhatsApp credential fields (used in both Add + Settings)
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

  async function handleCreate() {
    if (!addName.trim()) return
    const state = useAppStore.getState() as unknown as { bots: Array<{ id: string; environments: Array<{ id: string }> }>; selectedBotId: string | null }
    const currentBot = state.bots?.find((b) => b.id === (state.selectedBotId ?? selectedBotId))
    const envId = currentBot?.environments?.[0]?.id ?? ''
    if (!envId) return
    const config = addKind === 'whatsapp'
      ? { phoneNumberId: waPhoneNumberId.trim(), accessToken: waAccessToken.trim(), verifyToken: waVerifyToken.trim() }
      : {}
    await createChannel.mutateAsync({ name: addName.trim(), kind: addKind, environmentId: envId, config })
    setShowAdd(false)
    setAddName('')
    setAddKind('web')
    setWaPhoneNumberId(''); setWaAccessToken(''); setWaVerifyToken('')
  }

  function handleAddChannel() {
    setAddKind('web')
    setShowAdd(true)
  }

  return (
    <div className="flex flex-col h-full">
      {showWizard && <WidgetSetupWizard onClose={() => setShowWizard(false)} />}

      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <div className="flex items-center justify-between pb-3">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Configure</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={handleAddChannel}>
              <Plus size={14} /> Add Channel
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setShowWizard(true)}>
              <Wand2 size={14} /> Embed widget
            </Button>
          </div>
        </div>
        <SubNav items={SUBNAV} />
      </div>

      <div className="flex-1 overflow-auto p-6">
        {/* Stats bar */}
        <div className="flex items-center gap-6 mb-6">
          {[
            { label: 'Total channels', value: channels.length },
            { label: 'Active',         value: channels.filter((c) => c.isActive).length },
            { label: 'Web widgets',    value: channels.filter((c) => c.kind === 'web').length },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2">
              <span className="text-lg font-bold text-[var(--text-primary)]">{s.value}</span>
              <span className="text-xs text-[var(--text-muted)]">{s.label}</span>
            </div>
          ))}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading channels…
          </div>
        )}

        {!isLoading && channels.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Globe size={40} className="text-[var(--text-muted)]" />
            <div className="text-center">
              <p className="font-semibold text-[var(--text-primary)] mb-1">Website chat is always on</p>
              <p className="text-sm text-[var(--text-muted)]">Test and live both walk the journey map. Add another channel if you need one.</p>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Button size="sm" className="gap-1.5" onClick={() => setShowWizard(true)}>
                <Wand2 size={14} /> Embed widget
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={handleAddChannel}>
                <Plus size={14} /> Other channel
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {channels.map((ch) => {
            const meta = KIND_META[ch.kind] ?? { label: ch.kind, description: ch.name, icon: <Globe size={22} /> }
            return (
              <div
                key={ch.id}
                className={cn(
                  'rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-5 cursor-pointer hover:border-[var(--accent)]/40 transition-colors group',
                  ch.isActive ? 'border-[var(--border)]' : 'border-[var(--border)] opacity-70',
                )}
                onClick={() => openSettings(ch)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={cn(
                    'p-3 rounded-[var(--radius-md)]',
                    ch.isActive ? 'bg-[var(--accent-muted)] text-[var(--accent)]' : 'bg-[var(--bg-overlay)] text-[var(--text-muted)]'
                  )}>
                    {meta.icon}
                  </div>
                  <div className="flex items-center gap-1">
                    {ch.kind === 'web' && (
                      <>
                        <button
                          title="Test widget in new tab"
                          onClick={(e) => { e.stopPropagation(); window.open(getTestUrl(ch.id), '_blank') }}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-[var(--bg-overlay)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-all"
                        >
                          <FlaskConical size={14} />
                        </button>
                        <button
                          title="View embed code"
                          onClick={(e) => { e.stopPropagation(); setShowEmbed(ch) }}
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
                        <DropdownMenuItem onClick={() => openSettings(ch)}><Pencil size={13} /> Settings</DropdownMenuItem>
                        {ch.kind === 'web' && <DropdownMenuItem onClick={() => { setShowWizard(true) }}><Wand2 size={13} /> Setup wizard</DropdownMenuItem>}
                        {ch.kind === 'web' && <DropdownMenuItem onClick={() => window.open(getTestUrl(ch.id), '_blank')}><FlaskConical size={13} /> Test widget</DropdownMenuItem>}
                        {ch.kind === 'web' && <DropdownMenuItem onClick={() => setShowEmbed(ch)}><Code2 size={13} /> Embed code</DropdownMenuItem>}
                        {ch.kind !== 'web' && <DropdownMenuSeparator />}
                        {ch.kind !== 'web' && <DropdownMenuItem destructive onClick={() => deleteChannel.mutate(ch.id)}><Trash2 size={13} /> Delete</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <h3 className="font-semibold text-[var(--text-primary)] mb-0.5">{ch.name}</h3>
                <p className="text-xs text-[var(--text-muted)] mb-3">
                  {webRole(ch, environments) === 'test'
                    ? 'Test widget — same journey map as live'
                    : webRole(ch, environments) === 'live'
                      ? 'Live embed — walks the journey map'
                      : meta.description}
                </p>

                <div className="flex items-center justify-between">
                  <span className={cn('flex items-center gap-1.5 text-xs font-medium', (ch.kind === 'web' || ch.isActive) ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
                    {ch.kind === 'web' || ch.isActive ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                    {ch.kind === 'web' ? (webRole(ch, environments) === 'test' ? 'Test · always on' : 'Live · always on') : ch.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <Badge variant="muted" className="text-[10px] uppercase tracking-wide">{ch.kind}</Badge>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Channel settings dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        {selected && (() => {
          const meta = KIND_META[selected.kind] ?? { label: selected.kind, description: '', icon: <Globe size={22} /> }
          return (
            <DialogContent size="md">
              <DialogHeader><DialogTitle>{meta.label} settings</DialogTitle></DialogHeader>
              <DialogBody className="space-y-4">

                {/* Editable name */}
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
                        <p className="text-xs text-[var(--text-muted)]">Test and live both walk the journey map. Guests do not wait on a wizard.</p>
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
                      <p className="text-xs text-[var(--text-muted)]">{editActive ? 'Accepting new conversations' : 'Paused — widget hides itself'}</p>
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
                    <p className="text-[11px] text-[var(--text-muted)] mt-1.5">Click the 💬 bubble to start a test conversation — or open the <strong>Demo site</strong> to test from a realistic customer-facing page.</p>
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

      {/* Embed code dialog */}
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
              <p className="text-xs text-[var(--text-muted)] mt-3">
                Channel ID: <code className="font-mono bg-[var(--bg-overlay)] px-1 rounded">{showEmbed.id}</code>
              </p>
            </DialogBody>
            <DialogFooter>
              <Button onClick={() => setShowEmbed(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* Add channel dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>Add a channel</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            {/* Web widget – promote wizard */}
            <button
              onClick={() => { setShowAdd(false); setShowWizard(true) }}
              className="w-full flex items-center gap-3 p-3 rounded-[var(--radius-md)] border-2 border-[var(--accent)] bg-[var(--accent-muted)] text-left hover:bg-[var(--accent)]/15 transition-colors"
            >
              <span className="p-2 rounded-[var(--radius-md)] bg-[var(--accent)] text-white shrink-0"><Globe size={16} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--accent)]">Web Widget</p>
                <p className="text-xs text-[var(--text-muted)]">Guided wizard — customise, get embed code, verify</p>
              </div>
              <Wand2 size={14} className="text-[var(--accent)] shrink-0" />
            </button>

            <div className="relative flex items-center gap-2">
              <div className="flex-1 border-t border-[var(--border)]" />
              <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">Other channels</span>
              <div className="flex-1 border-t border-[var(--border)]" />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Channel type</label>
              <div className="grid grid-cols-2 gap-2">
                {ADD_KINDS.filter((k) => k !== 'web').map((k) => {
                  const m = KIND_META[k]!
                  return (
                    <button
                      key={k}
                      onClick={() => setAddKind(k)}
                      className={cn(
                        'flex items-center gap-2 p-2.5 rounded-[var(--radius-md)] border text-left text-xs transition-colors',
                        addKind === k ? 'border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                      )}
                    >
                      <span className="shrink-0">{m.icon}</span> {m.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Channel name *</label>
              <input
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder={`e.g. ${KIND_META[addKind]?.label ?? 'My channel'}`}
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              />
            </div>
            {addKind === 'whatsapp' && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-2 p-2.5 rounded-[var(--radius-md)] bg-[var(--bg-overlay)] border border-[var(--border)]">
                  <MessageSquare size={14} className="text-[var(--accent)] shrink-0" />
                  <p className="text-xs text-[var(--text-muted)]">Enter your credentials from <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-[var(--text-link)] underline">Meta for Developers</a>.</p>
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
            <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button
              disabled={!addName.trim() || createChannel.isPending}
              onClick={handleCreate}
            >
              {createChannel.isPending ? 'Creating…' : 'Add channel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
