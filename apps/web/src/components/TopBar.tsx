import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  ChevronDown,
  Plus,
  Sun,
  Moon,
  LogOut,
  Settings,
  Beaker,
  Rocket,
  Loader2,
  Circle,
  CircleHelp,
  Search,
} from 'lucide-react'
import {
  Avatar,
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  Button,
} from '@botstudio/ui'
import { useAppStore } from '../store/app'
import { apiFetch } from '../lib/api'
import { ManageBotsDialog } from './ManageBotsDialog'
import { useAgentStatus, useUpdateAgentStatus } from '../lib/hooks'
import { workspaceIdentity } from '../lib/workspace-handle'
import { HELP_TOPICS } from '../pages/help-topics'

interface TopBarProps {
  darkMode: boolean
  onToggleDark: () => void
  onOpenPalette: () => void
}

const SHORTCUT_LABEL = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'

function envRank(kind: string): number {
  if (kind === 'sandbox') return 0
  if (kind === 'production') return 1
  return 2
}

function EnvSwitcher() {
  const { bots, selectedBotId, selectedEnv, setEnv } = useAppStore()
  const selectedBot = bots.find((b) => b.id === selectedBotId)
  const environments = [...(selectedBot?.environments ?? [])]
    .filter((env) => env.kind === 'sandbox' || env.kind === 'production')
    .sort((a, b) => envRank(a.kind) - envRank(b.kind))

  React.useEffect(() => {
    if (!selectedBot) return
    const available = selectedBot.environments.filter((env) => env.kind === 'sandbox' || env.kind === 'production')
    if (available.some((env) => env.kind === selectedEnv)) return
    const fallback = [...available].sort((a, b) => envRank(a.kind) - envRank(b.kind))[0]
    if (fallback) setEnv(fallback.kind as 'sandbox' | 'production')
  }, [selectedBot, selectedEnv, setEnv])

  if (environments.length === 0) return null

  return (
    <div className="flex items-center gap-1 rounded-[var(--radius)] bg-[var(--bg-overlay)] p-0.5 border border-[var(--border)]">
      {environments.map((env) => {
        const active = selectedEnv === env.kind
        const sandbox = env.kind === 'sandbox'
        return (
          <button
            key={env.id}
            onClick={() => setEnv(env.kind as 'sandbox' | 'production')}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? sandbox
                  ? 'bg-[var(--warning-muted)] text-[var(--warning)]'
                  : 'bg-[var(--success-muted)] text-[var(--success)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {sandbox ? <Beaker size={12} /> : <Rocket size={12} />}
            {env.name}
          </button>
        )
      })}
    </div>
  )
}

export function TopBar({ darkMode, onToggleDark, onOpenPalette }: TopBarProps) {
  const navigate = useNavigate()
  const { user, bots, botsLoading, botsError, selectedBotId, selectBot, clearAuth } = useAppStore()
  const { data: agentStatus = 'offline' } = useAgentStatus()
  const updateStatus = useUpdateAgentStatus()
  const { data: tenant } = useQuery({
    queryKey: ['tenant-me', user?.tenantId],
    enabled: Boolean(user),
    retry: false,
    queryFn: () => apiFetch<{ data: { name?: string } | null }>('/tenants/me').then((res) => res.data),
  })
  const identity = workspaceIdentity({
    displayName: user?.displayName,
    email: user?.email,
    tenantName: tenant?.name,
  })

  const STATUS_COLOR: Record<string, string> = {
    online: 'var(--success)', away: 'var(--warning)', offline: 'var(--text-muted)',
  }

  const selectedBot = bots.find((b) => b.id === selectedBotId)
  const [manageOpen, setManageOpen] = React.useState(false)

  async function handleLogout() {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => null)
    clearAuth()
    navigate({ to: '/sign-in' })
  }

  return (
    <header
      className="flex h-[var(--topbar-height)] items-center justify-between gap-4 border-b border-[var(--topbar-border)] bg-[var(--topbar-bg)] px-4 shrink-0"
    >
      {/* Left: Bot switcher */}
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-[var(--radius)] px-2 py-1 text-sm hover:bg-[var(--bg-hover)] transition-colors">
              {botsLoading ? (
                <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded bg-[var(--accent-muted)] text-[var(--accent)] text-xs font-bold">
                  {selectedBot?.name?.[0] ?? 'B'}
                </div>
              )}
              <span className="font-medium text-[var(--text-primary)] max-w-[140px] truncate">
                {botsLoading ? 'Loading…' : botsError && !selectedBot ? 'Server unavailable' : (selectedBot?.name ?? 'Select Bot')}
              </span>
              <ChevronDown size={13} className="text-[var(--text-muted)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Switch Bot</DropdownMenuLabel>
            {botsLoading ? (
              <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-[var(--text-muted)]">
                <Loader2 size={13} className="animate-spin" />
                Loading bots…
              </div>
            ) : bots.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-[var(--text-muted)]">No bots yet</div>
            ) : (
              bots.map((bot) => (
                <DropdownMenuItem
                  key={bot.id}
                  onClick={() => selectBot(bot.id)}
                >
                  <div className="flex h-5 w-5 items-center justify-center rounded bg-[var(--accent-muted)] text-[var(--accent)] text-[10px] font-bold">
                    {bot.name[0]}
                  </div>
                  <span>{bot.name}</span>
                  {bot.id === selectedBotId && (
                    <span className="ml-auto text-[var(--accent)] text-xs">✓</span>
                  )}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate({ to: '/bots/new' })}>
              <Plus size={14} />
              New Bot
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setManageOpen(true)}>
              Manage bots
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ManageBotsDialog open={manageOpen} onOpenChange={setManageOpen} />

        <EnvSwitcher />
      </div>

      <button
        onClick={onOpenPalette}
        className="hidden md:flex h-8 w-full max-w-sm items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-base)] px-3 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
        aria-label="Search pages, bots, flows and actions"
      >
        <Search size={14} />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px]">{SHORTCUT_LABEL}</kbd>
      </button>

      {/* Right: theme + user */}
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Help" title="Help">
              <CircleHelp size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Help</DropdownMenuLabel>
            {HELP_TOPICS.map((topic) => (
              <DropdownMenuItem key={topic.id} onSelect={() => navigate({ to: '/help', hash: topic.id })}>
                {topic.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleDark}
          aria-label="Toggle theme"
        >
          {darkMode ? <Sun size={15} /> : <Moon size={15} />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 rounded-[var(--radius)] px-2 py-1 hover:bg-[var(--bg-hover)] transition-colors"
              aria-label={identity.handle ? `Account ${identity.handle}` : 'Account'}
              title={user?.displayName && identity.company ? `${user.displayName} · ${identity.company}` : user?.displayName}
            >
              <div className="relative">
                <Avatar name={identity.avatarName || user?.displayName} src={user?.avatarUrl ?? null} size="sm" />
                <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-[var(--bg-surface)]" style={{ background: STATUS_COLOR[agentStatus] ?? STATUS_COLOR.offline }} />
              </div>
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                {identity.handle}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-sm font-semibold text-[var(--text-primary)]">
              <span className="block">{identity.handle}</span>
              <span className="mt-0.5 block text-xs font-normal text-[var(--text-muted)]">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-[var(--text-muted)] font-normal">Status</DropdownMenuLabel>
            {(['online', 'away', 'offline'] as const).map((s) => (
              <DropdownMenuItem key={s} onClick={() => updateStatus.mutate(s)}>
                <Circle size={8} style={{ fill: STATUS_COLOR[s], color: STATUS_COLOR[s] }} />
                <span className="capitalize">{s}</span>
                {agentStatus === s && <span className="ml-auto text-xs text-[var(--accent)]">✓</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate({ to: '/settings' })}>
              <Settings size={14} /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={handleLogout}>
              <LogOut size={14} /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
