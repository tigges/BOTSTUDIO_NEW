import React, { useEffect, useState } from 'react'
import { CheckCircle2, Circle, Code2, Copy, FlaskConical, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import { Badge, Button, cn } from '@botstudio/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@botstudio/ui'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@botstudio/ui'
import {
  CHANNEL_FIELDS,
  CHANNEL_STATUS_HELP,
  CHANNEL_WEBHOOK_HINT,
  channelFieldLabel,
  channelLimitRows,
  channelRoutingKey,
  channelWebhookPath,
  isLimitChannel,
  isOptionalChannelKind,
} from '@botstudio/shared'
import { ApiError, type Channel, type ChannelCheck } from '../../lib/api'
import { useCheckChannel, useUpdateChannel } from '../../lib/hooks'
import {
  CONNECTION_TABS,
  apiErrorField,
  credentialForm,
  credentialPatch,
  missingCredential,
  type ConnectionTab,
} from '../../lib/channel-connection'

function origin(): string {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

export function embedCode(channelId: string): string {
  return `<!-- BotStudio chat widget -->
<script src="${origin()}/api/v1/widget.js?id=${channelId}" async></script>

<!-- Optional customisation -->
<script>
  window.BotStudioTitle = 'Chat with us';
  window.BotStudioAccentColor = '#6366f1';
</script>`
}

export function widgetTestUrl(channelId: string): string {
  return `${origin()}/api/v1/widget-test/${channelId}`
}

function demoUrl(channelId: string): string {
  return `${origin()}/api/v1/public/demo/${channelId}`
}

function CopyField({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] p-3 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--text-secondary)]">{label}</p>
        {value && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(value).catch(() => {})
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label={`Copy ${label}`}
          >
            {copied ? <CheckCircle2 size={11} className="text-[var(--success)]" /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <code className="block text-[11px] font-mono text-[var(--text-primary)] break-all select-all">{value ?? 'Hidden. Never shown after saving.'}</code>
      {hint && <p className="text-[11px] text-[var(--text-muted)]">{hint}</p>}
    </div>
  )
}

function Step({ done, title, children }: { done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className={cn('mt-0.5 shrink-0', done ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
        {done ? <CheckCircle2 size={14} /> : <Circle size={14} />}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
        {children}
      </div>
    </li>
  )
}

const label = 'text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5 block'
const input = 'w-full rounded-[var(--radius-md)] border bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40'

export function ChannelConnectionDialog({
  channel,
  kindLabel,
  environmentName,
  initialTab = 'overview',
  onClose,
  onShowEmbed,
}: {
  channel: Channel
  kindLabel: string
  environmentName: string
  initialTab?: ConnectionTab
  onClose: () => void
  onShowEmbed: () => void
}) {
  const updateChannel = useUpdateChannel()
  const checkChannel = useCheckChannel()
  const [tab, setTab] = useState<ConnectionTab>(initialTab)
  const [name, setName] = useState(channel.name)
  const [active, setActive] = useState(channel.isActive)
  const [form, setForm] = useState(() => credentialForm(channel.kind, channel.config))
  const [error, setError] = useState('')
  const [badField, setBadField] = useState<string | null>(null)
  const [check, setCheck] = useState<ChannelCheck | null>(null)

  useEffect(() => { setTab(initialTab) }, [initialTab, channel.id])

  const kind = channel.kind
  const optional = isOptionalChannelKind(kind)
  const secretsSet = channel.secretsSet ?? []
  const routing = channelRoutingKey(kind, channel.config, channel.id)
  const limits = isLimitChannel(kind) ? channelLimitRows(kind) : []

  async function save() {
    setError('')
    setBadField(null)
    const missing = missingCredential(kind, form, secretsSet)
    if (missing) {
      setTab('credentials')
      setBadField(missing)
      setError(`Fill ${channelFieldLabel(kind, missing)}.`)
      return
    }
    const config = credentialPatch(kind, form, channel.config)
    try {
      await updateChannel.mutateAsync({
        id: channel.id,
        name: name.trim() || channel.name,
        isActive: kind === 'web' ? true : active,
        ...(config ? { config } : {}),
      })
      onClose()
    } catch (err) {
      const field = err instanceof ApiError ? apiErrorField(err.body) : null
      if (field) { setBadField(field); setTab('credentials') }
      setError(err instanceof Error ? err.message : 'Could not save this connection.')
    }
  }

  async function runCheck() {
    setCheck(null)
    setBadField(null)
    try {
      const result = await checkChannel.mutateAsync(channel.id)
      setCheck(result)
      if (result.field) setBadField(result.field)
    } catch (err) {
      setCheck({ ok: false, message: err instanceof Error ? err.message : 'Could not reach the provider.' })
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              {channel.name}
              <Badge variant={channel.isActive ? 'success' : 'muted'} className="text-[10px]">{channel.isActive ? 'On' : 'Off'}</Badge>
            </span>
          </DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(value) => setTab(value as ConnectionTab)}>
          <TabsList>
            {CONNECTION_TABS.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
          </TabsList>
          <DialogBody className="max-h-[60vh] overflow-y-auto pt-5">
            <TabsContent value="overview" className="space-y-4">
              <div>
                <label className={label} htmlFor="channel-name">Name</label>
                <input id="channel-name" className={cn(input, 'border-[var(--border)]')} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                <dt className="text-[var(--text-muted)]">Type</dt><dd className="text-[var(--text-primary)]">{kindLabel}</dd>
                <dt className="text-[var(--text-muted)]">Environment</dt><dd className="text-[var(--text-primary)]">{environmentName}</dd>
                <dt className="text-[var(--text-muted)]">Channel ID</dt><dd><code className="font-mono text-xs bg-[var(--bg-overlay)] px-1 rounded">{channel.id}</code></dd>
              </dl>
              <div className="flex items-center justify-between p-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)]">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{kind === 'web' ? 'Always on' : 'Take conversations'}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {kind === 'web' ? 'Website chat stays on so guests can walk the journey.' : active ? 'New messages start conversations.' : 'Connected, but messages are ignored until you turn it on.'}
                  </p>
                </div>
                {kind !== 'web' && (
                  <button
                    role="switch"
                    aria-checked={active}
                    aria-label="Take conversations"
                    onClick={() => setActive((v) => !v)}
                    className={cn('relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors', active ? 'bg-[var(--accent)]' : 'bg-[var(--border)]')}
                  >
                    <span className={cn('pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', active ? 'translate-x-4' : 'translate-x-0')} />
                  </button>
                )}
              </div>
            </TabsContent>

            <TabsContent value="credentials" className="space-y-3">
              {!optional ? (
                <p className="text-sm text-[var(--text-muted)]">Website chat has no provider credentials. Visitors reach it through the embed code on the Deployment tab.</p>
              ) : (
                <>
                  {CHANNEL_FIELDS[kind].map((field) => {
                    const saved = field.secret && secretsSet.includes(field.key)
                    const wrong = badField === field.key
                    return (
                      <div key={field.key}>
                        <label className="text-xs font-semibold text-[var(--text-muted)] mb-1 block" htmlFor={`cred-${field.key}`}>{field.label}</label>
                        <input
                          id={`cred-${field.key}`}
                          className={cn(input, 'font-mono', wrong ? 'border-[var(--error)] ring-2 ring-[var(--error)]/30' : 'border-[var(--border)]')}
                          placeholder={saved ? 'Saved · leave blank to keep' : field.placeholder}
                          type={field.secret ? 'password' : 'text'}
                          autoComplete="off"
                          aria-invalid={wrong}
                          value={form[field.key] ?? ''}
                          onChange={(e) => setForm((current) => ({ ...current, [field.key]: e.target.value }))}
                        />
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">{field.hint}{saved ? ' · Saved secrets are never shown again.' : ''}</p>
                      </div>
                    )
                  })}
                  <div className="flex items-center gap-3 pt-1">
                    <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => { void runCheck() }} disabled={checkChannel.isPending}>
                      {checkChannel.isPending ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                      Check saved credentials
                    </Button>
                    {check && (
                      <p className={cn('flex items-start gap-1.5 text-xs', check.ok ? 'text-[var(--success)]' : 'text-[var(--error)]')} role="status">
                        {check.ok ? <CheckCircle2 size={13} className="mt-px shrink-0" /> : <XCircle size={13} className="mt-px shrink-0" />}
                        {check.message}
                      </p>
                    )}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="configuration" className="space-y-4">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">How replies look on {kindLabel}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">The bot writes one reply. Where {kindLabel} cannot show something, BotStudio sends the fallback instead. Nothing is cut off.</p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="py-1.5 pr-3 font-medium">Reply contains</th>
                    <th className="py-1.5 pr-3 font-medium">{kindLabel} shows</th>
                    <th className="py-1.5 font-medium">When it does not fit</th>
                  </tr>
                </thead>
                <tbody>
                  {limits.map((row) => (
                    <tr key={row.content} className="border-b border-[var(--border)] last:border-0 align-top">
                      <td className="py-2 pr-3 text-[var(--text-primary)]">{row.content}</td>
                      <td className="py-2 pr-3 text-[var(--text-secondary)]">{row.shows}</td>
                      <td className="py-2 text-[var(--text-secondary)]">{row.fallback}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {kind !== 'web' && (
                <p className="text-xs text-[var(--text-muted)]">
                  Repeated deliveries of the same message within 24 hours are ignored, so a provider retry never starts a second reply.
                </p>
              )}
            </TabsContent>

            <TabsContent value="deployment" className="space-y-4">
              {kind === 'web' ? (
                <ol className="space-y-4">
                  <Step done title="Connection created">
                    <p className="text-xs text-[var(--text-muted)]">Website chat exists for every environment.</p>
                  </Step>
                  <Step done={false} title="Paste the embed code before </body> on your site">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" className="gap-1.5" onClick={onShowEmbed}><Code2 size={13} /> Embed code</Button>
                      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => window.open(widgetTestUrl(channel.id), '_blank')}><FlaskConical size={13} /> Test widget</Button>
                      <Button variant="ghost" size="sm" onClick={() => window.open(demoUrl(channel.id), '_blank')}>Demo site</Button>
                    </div>
                  </Step>
                </ol>
              ) : (
                <ol className="space-y-4">
                  <Step done title="Connection created">
                    <p className="text-xs text-[var(--text-muted)]">BotStudio checked the credentials when you connected. The webhook only works once this connection exists.</p>
                  </Step>
                  <Step done={kind === 'telegram'} title={kind === 'telegram' ? 'Webhook registered by BotStudio' : `Register the webhook with ${kindLabel}`}>
                    <CopyField label="Webhook URL" value={`${origin()}${channelWebhookPath(kind)}`} hint={optional ? CHANNEL_WEBHOOK_HINT[kind] : undefined} />
                    <CopyField label={`Routing key · ${routing.label}`} value={routing.value} hint={routing.how} />
                  </Step>
                  <Step done={channel.isActive} title="Turn it on">
                    <p className="text-xs text-[var(--text-muted)]">{channel.isActive ? 'On. New messages start conversations.' : 'Off. Turn it on from Overview when the webhook is registered.'}</p>
                  </Step>
                </ol>
              )}
              {optional && (
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)] mb-1">If {kindLabel} returns an error</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                        <th className="py-1.5 pr-3 font-medium">Code</th>
                        <th className="py-1.5 pr-3 font-medium">When</th>
                        <th className="py-1.5 pr-3 font-medium">Field to fix</th>
                        <th className="py-1.5 font-medium">What to do</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CHANNEL_STATUS_HELP[kind].map((row) => (
                        <tr key={`${row.where}-${row.status}`} className="border-b border-[var(--border)] last:border-0 align-top">
                          <td className="py-2 pr-3 font-mono text-[var(--text-primary)]">{row.status}</td>
                          <td className="py-2 pr-3 text-[var(--text-secondary)]">{row.where === 'provider' ? 'Connect or Check' : `${kindLabel} calls the webhook`}</td>
                          <td className="py-2 pr-3">
                            {row.field
                              ? <button type="button" className="text-[var(--accent)] hover:underline" onClick={() => { setBadField(row.field); setTab('credentials') }}>{channelFieldLabel(kind, row.field)}</button>
                              : <span className="text-[var(--text-muted)]">—</span>}
                          </td>
                          <td className="py-2 text-[var(--text-secondary)]">{row.fix}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
            {error && <p className="mt-3 text-xs text-[var(--error)]" role="alert">{error}</p>}
          </DialogBody>
        </Tabs>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { void save() }} disabled={updateChannel.isPending}>
            {updateChannel.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
