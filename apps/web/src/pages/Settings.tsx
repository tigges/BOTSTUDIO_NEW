import React, { useState } from 'react'
import { Card, Button, Input, Badge, Avatar } from '@botstudio/ui'
import { useAppStore } from '../store/app'
import { useSystemConfig, useSystemStatus } from '../lib/hooks'
import type { ConfigEntry } from '../lib/api'
import { bots as botsApi } from '../lib/api'
import {
  CheckCircle2, XCircle, Key, Database, Radio,
  Cpu, Globe, Settings2, User, Lock,
  RefreshCw, ChevronRight, Copy, ExternalLink,
  Bot, Zap, Sparkles,
} from 'lucide-react'
import { cn } from '@botstudio/ui'
import { useUpdateProfile } from '../lib/hooks'

// ── helpers ───────────────────────────────────────────────────────────────────

function copyToClipboard(text: string) {
  void navigator.clipboard?.writeText(text)
}

// ── sub-components ────────────────────────────────────────────────────────────

function SecretRow({ entry, envKey }: { entry: ConfigEntry; envKey: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopyKey() {
    copyToClipboard(envKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex items-center gap-3 py-3 px-4 hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border)] last:border-0">
      <div className={cn('flex h-7 w-7 items-center justify-center rounded-full shrink-0',
        entry.set ? 'bg-[var(--success)]/15' : 'bg-[var(--danger)]/10',
      )}>
        {entry.set
          ? <CheckCircle2 size={14} className="text-[var(--success)]" />
          : <XCircle size={14} className="text-[var(--danger)]" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono font-medium text-[var(--text-primary)] truncate">{envKey}</p>
        <p className="text-[11px] text-[var(--text-muted)]">{entry.label}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {(entry.value ?? entry.endpoint) && (
          <span className="text-[11px] font-mono text-[var(--text-secondary)] max-w-[160px] truncate">
            {entry.value ?? entry.endpoint}
          </span>
        )}
        <Badge variant={entry.set ? 'success' : 'error'} className="shrink-0">
          {entry.set ? 'Set' : 'Missing'}
        </Badge>
        <button
          onClick={handleCopyKey}
          title="Copy env key name"
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)] transition-colors"
        >
          {copied ? <CheckCircle2 size={12} className="text-[var(--success)]" /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  )
}

function SectionCard({ title, icon: Icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
        <Icon size={13} className="text-[var(--accent)]" />
        <span className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">{title}</span>
      </div>
      {children}
    </div>
  )
}

// ── Secrets tab ───────────────────────────────────────────────────────────────

function SecretsTab() {
  const { data: cfg, isLoading, isFetching, refetch } = useSystemConfig()
  const { data: status } = useSystemStatus()

  const allEntries = cfg ? [
    ...Object.entries(cfg.auth).map(([k, v]) => ({ group: 'auth', key: k, entry: v as ConfigEntry })),
    ...Object.entries(cfg.database).map(([k, v]) => ({ group: 'database', key: k, entry: v as ConfigEntry })),
    ...Object.entries(cfg.cache).map(([k, v]) => ({ group: 'cache', key: k, entry: v as ConfigEntry })),
    ...Object.entries(cfg.llm).map(([k, v]) => ({ group: 'llm', key: k, entry: v as ConfigEntry })),
    ...Object.entries(cfg.app).map(([k, v]) => ({ group: 'app', key: k, entry: v as ConfigEntry })),
  ] : []

  const missingCount = allEntries.filter((e) => !e.entry.set).length
  const setCount = allEntries.filter((e) => e.entry.set).length

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--success)]/10 border border-[var(--success)]/20">
          <CheckCircle2 size={13} className="text-[var(--success)]" />
          <span className="text-xs font-medium text-[var(--text-primary)]">{setCount} configured</span>
        </div>
        {missingCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger)]/10 border border-[var(--danger)]/20">
            <XCircle size={13} className="text-[var(--danger)]" />
            <span className="text-xs font-medium text-[var(--text-primary)]">{missingCount} missing</span>
          </div>
        )}
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--border)] text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors ml-auto"
        >
          <RefreshCw size={11} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={18} className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : cfg ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* Auth */}
          <SectionCard title="Authentication" icon={Key}>
            {Object.entries(cfg.auth).map(([k, v]) => <SecretRow key={k} envKey={k} entry={v as ConfigEntry} />)}
          </SectionCard>

          {/* Database */}
          <SectionCard title="Database" icon={Database}>
            {Object.entries(cfg.database).map(([k, v]) => <SecretRow key={k} envKey={k} entry={v as ConfigEntry} />)}
            {status?.services.database && (
              <div className={cn('flex items-center gap-2 px-4 py-2.5 text-xs border-t border-[var(--border)]',
                status.services.database.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]',
              )}>
                {status.services.database.ok
                  ? <><CheckCircle2 size={12} /> Connected · {status.services.database.latencyMs}ms</>
                  : <><XCircle size={12} /> Not reachable</>}
              </div>
            )}
          </SectionCard>

          {/* Cache */}
          <SectionCard title="Cache (Redis / Valkey)" icon={Radio}>
            {Object.entries(cfg.cache).map(([k, v]) => <SecretRow key={k} envKey={k} entry={v as ConfigEntry} />)}
            {status?.services.redis && (
              <div className={cn('flex items-center gap-2 px-4 py-2.5 text-xs border-t border-[var(--border)]',
                status.services.redis.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]',
              )}>
                {status.services.redis.ok
                  ? <><CheckCircle2 size={12} /> Connected · {status.services.redis.latencyMs}ms</>
                  : <><XCircle size={12} /> Not reachable</>}
              </div>
            )}
          </SectionCard>

          {/* LLM */}
          <SectionCard title="LLM / AI Keys" icon={Zap}>
            {Object.entries(cfg.llm).map(([k, v]) => <SecretRow key={k} envKey={k} entry={v as ConfigEntry} />)}
            <div className="px-4 py-2.5 border-t border-[var(--border)]">
              <p className="text-[11px] text-[var(--text-muted)]">
                At least one LLM key is required for AI features.
                Set in <code className="font-mono bg-[var(--bg-overlay)] px-1 rounded">.env.production</code> on AVIORI.
              </p>
            </div>
          </SectionCard>

          {/* App */}
          <SectionCard title="Application" icon={Globe}>
            {Object.entries(cfg.app).map(([k, v]) => <SecretRow key={k} envKey={k} entry={v as ConfigEntry} />)}
          </SectionCard>
        </div>
      ) : null}

      {/* How-to card */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-overlay)] p-4 space-y-2">
        <p className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
          <Settings2 size={13} className="text-[var(--accent)]" />
          How to update a secret on AVIORI
        </p>
        <ol className="space-y-1.5 text-xs text-[var(--text-secondary)] list-decimal list-inside">
          <li>SSH into AVIORI: <code className="font-mono bg-[var(--bg-surface)] px-1 rounded">ssh ct@192.168.0.11</code></li>
          <li>Edit the env file: <code className="font-mono bg-[var(--bg-surface)] px-1 rounded">nano /volume1/docker/ybot/.env.production</code></li>
          <li>Restart the API: <code className="font-mono bg-[var(--bg-surface)] px-1 rounded">docker compose -f docker-compose.yml up -d api</code></li>
        </ol>
        <div className="pt-1 flex gap-2">
          <button
            onClick={() => copyToClipboard('docker compose -f docker-compose.yml pull && docker compose -f docker-compose.yml up -d')}
            className="flex items-center gap-1.5 text-[11px] text-[var(--accent)] hover:underline"
          >
            <Copy size={11} /> Copy full restart command
          </button>
          <span className="text-[var(--border)]">·</span>
          <a
            href="/admin/system-status"
            className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
          >
            System Status <ChevronRight size={11} />
          </a>
        </div>
      </div>
    </div>
  )
}

// ── Bot Identity tab ─────────────────────────────────────────────────────────

function BotIdentityTab() {
  const { bots, selectedBotId, setBots } = useAppStore()
  const selectedBot = bots.find((b) => b.id === selectedBotId) ?? null
  const [personaName, setPersonaName] = useState(selectedBot?.personaName ?? '')
  const [agentAlias, setAgentAlias] = useState(useAppStore.getState().user?.displayName ?? '')
  const updateProfile = useUpdateProfile()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!selectedBot) return
    setSaving(true)
    try {
      const updated = await botsApi.update(selectedBot.id, {
        personaName: personaName.trim() || null,
      })
      // Sync updated bot into store
      setBots(bots.map((b) => (b.id === selectedBot.id ? { ...b, ...updated.data } : b)))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  if (!selectedBot) {
    return (
      <div className="max-w-lg">
        <p className="text-sm text-[var(--text-muted)]">Select a bot from the top bar first.</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg space-y-6">
      {/* Bot persona */}
      <Card>
        <div className="flex items-start gap-3 mb-5">
          <div className="w-8 h-8 rounded-full bg-[var(--accent)]/15 flex items-center justify-center shrink-0 mt-0.5">
            <Bot size={14} className="text-[var(--accent)]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Bot persona</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              The friendly first name customers see in the chat widget.
              Your internal bot label (<strong>{selectedBot.name}</strong>) stays unchanged.
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <Input
            label="Persona name (customer-facing)"
            placeholder="e.g. Bella, Luna, Max"
            value={personaName}
            onChange={(e) => setPersonaName(e.target.value)}
            hint={'Widget greeting: "Hi, I\'m ' + (personaName.trim() || 'Bella') + '! What\'s your name?"'}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="md" onClick={handleSave} disabled={saving}>
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Card>

      {/* Agent alias guidance */}
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-[var(--success)]/15 flex items-center justify-center shrink-0 mt-0.5">
            <User size={14} className="text-[var(--success)]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Human agent aliases</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Each agent's <strong>display name</strong> in their profile is shown to customers when they handle a conversation.
              Use culturally relevant first names — e.g. <em>Sofia</em> for Spanish-speaking markets,
              <em> Amara</em> for West Africa, <em>Yuki</em> for Japan — instead of real names.
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <Input
            label="Your agent alias (preview)"
            placeholder="e.g. Sofia"
            value={agentAlias}
            onChange={(e) => setAgentAlias(e.target.value)}
            hint="Customers see this name when you reply."
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={updateProfile.isPending || !agentAlias.trim()} onClick={() => {
              const name = agentAlias.trim()
              updateProfile.mutate(name, {
                onSuccess: () => {
                  const current = useAppStore.getState().user
                  if (current) useAppStore.getState().setAuth({ ...current, displayName: name }, useAppStore.getState().token ?? '')
                },
              })
            }}>Save alias</Button>
          </div>
        </div>
        <div className="mt-3 rounded-[var(--radius)] bg-[var(--bg-overlay)] p-3 text-[11px] text-[var(--text-muted)] space-y-1">
          <p className="font-medium text-[var(--text-secondary)]">Recommended naming convention</p>
          <p>• Pick a friendly first name that fits the territory and language</p>
          <p>• Keep it consistent — don't change it mid-conversation</p>
          <p>• Never use the agent's real surname</p>
          <p>• One alias per territory is fine; agents can share a persona</p>
        </div>
      </Card>
    </div>
  )
}

// ── PasswordTab ───────────────────────────────────────────────────────────────

function PasswordTab() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (next !== confirm) { setError('New passwords do not match'); return }
    if (next.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      const { me: meApi } = await import('../lib/api')
      await meApi.changePassword(current, next)
      setSuccess(true)
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-lg">
      <Card>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Change Password</h3>
        {success && (
          <div className="mb-4 rounded-[var(--radius)] bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
            Password updated successfully.
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input label="Current password" type="password" placeholder="••••••••" value={current} onChange={(e) => { setCurrent(e.target.value); setSuccess(false) }} required />
          <Input label="New password" type="password" placeholder="••••••••" value={next} onChange={(e) => setNext(e.target.value)} required />
          <Input label="Confirm new password" type="password" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          {error && <p className="text-xs text-[var(--error)] rounded bg-[var(--error-muted)] px-3 py-2">{error}</p>}
          <div className="mt-4 flex justify-end">
            <Button type="submit" size="md" variant="secondary" disabled={loading}>
              {loading ? 'Updating…' : 'Update password'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

type Tab = 'profile' | 'password' | 'secrets' | 'bot-identity'

export function SettingsPage() {
  const { user } = useAppStore()
  const [tab, setTab] = useState<Tab>('profile')
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [saved, setSaved] = useState(false)
  const updateProfile = useUpdateProfile()

  function handleSave() {
    const name = displayName.trim()
    if (!name || !user) return
    updateProfile.mutate(name, {
      onSuccess: () => {
        useAppStore.getState().setAuth({ ...user, displayName: name }, useAppStore.getState().token ?? '')
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      },
    })
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'profile',      label: 'Profile',              icon: User },
    { id: 'bot-identity', label: 'Bot Identity',         icon: Sparkles },
    { id: 'password',     label: 'Password',             icon: Lock },
    { id: 'secrets',      label: 'Secrets & Connections', icon: Key },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header + tabs */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <h1 className="text-base font-semibold text-[var(--text-primary)] mb-3">Settings</h1>
        <div className="flex gap-0">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors',
                  tab === t.id
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                )}
              >
                <Icon size={13} />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tab === 'profile' && (
          <div className="max-w-lg space-y-6">
            <Card>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Profile</h3>
              <div className="flex items-center gap-4 mb-4">
                <Avatar name={user?.displayName} size="lg" />
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{user?.displayName}</p>
                  <p className="text-xs text-[var(--text-muted)]">{user?.email}</p>
                  <Badge variant="muted" className="mt-1">{user?.role}</Badge>
                </div>
              </div>
              <div className="space-y-3">
                <Input label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                <Input label="Email" value={user?.email ?? ''} disabled />
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button size="md" onClick={handleSave} disabled={updateProfile.isPending}>{saved ? 'Saved!' : 'Save changes'}</Button>
              </div>
            </Card>
          </div>
        )}

        {tab === 'password' && <PasswordTab />}

        {tab === 'secrets' && <SecretsTab />}
        {tab === 'bot-identity' && <BotIdentityTab />}
      </div>
    </div>
  )
}
