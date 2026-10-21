import React, { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plus, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@botstudio/ui'
import { useAppStore } from '../store/app'
import { apiFetch, bots as botsApi } from '../lib/api'
import type { Bot as BotType } from '../store/app'

function envRank(kind: string): number {
  if (kind === 'sandbox') return 0
  if (kind === 'production') return 1
  return 2
}

export function BotSelectorPage() {
  const navigate = useNavigate()
  const { bots, setBots, selectBot, user } = useAppStore()
  const [loading, setLoading] = useState(bots.length === 0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  useEffect(() => {
    if (bots.length === 0) {
      apiFetch<{ data: BotType[] }>('/bots')
        .then((r) => { setBots(r.data); setLoading(false) })
        .catch(() => setLoading(false))
    }
  }, [])

  async function refresh() {
    const next = await apiFetch<{ data: BotType[] }>('/bots')
    setBots(next.data)
  }

  function handleSelect(botId: string) {
    selectBot(botId)
    navigate({ to: '/overview' })
  }

  async function saveName(botId: string, environmentId: string) {
    const name = draft.trim()
    if (!name) return
    setBusyId(environmentId)
    setRowError(null)
    try {
      await botsApi.renameEnvironment(botId, environmentId, name)
      await refresh()
      setEditingId(null)
    } catch (err: unknown) {
      setRowError({ id: environmentId, message: err instanceof Error ? err.message : 'Could not rename this environment.' })
    } finally {
      setBusyId(null)
    }
  }

  async function removeEnvironment(botId: string, environmentId: string) {
    setBusyId(environmentId)
    setRowError(null)
    try {
      await botsApi.deleteEnvironment(botId, environmentId)
      await refresh()
      setConfirmId(null)
    } catch (err: unknown) {
      setRowError({ id: environmentId, message: err instanceof Error ? err.message : 'Could not remove this environment.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-base)] p-4">
      <div className="w-full max-w-[560px]">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-[var(--text-primary)]">
            {user?.displayName ? `Welcome back, ${user.displayName}` : 'Choose a bot'}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Select a bot to continue</p>
        </div>

        {loading ? (
          <div className="text-center text-sm text-[var(--text-muted)]">Loading…</div>
        ) : (
          <div className="flex flex-col gap-2">
            {bots.map((bot) => {
              const environments = [...bot.environments].sort((a, b) => envRank(a.kind) - envRank(b.kind) || a.name.localeCompare(b.name))
              return (
                <div
                  key={bot.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden"
                >
                  <button
                    onClick={() => handleSelect(bot.id)}
                    className="flex w-full items-center gap-3 p-4 text-left hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-muted)] text-[var(--accent)] text-lg font-bold">
                      {bot.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[var(--text-primary)]">{bot.name}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {environments.length} environment{environments.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-[var(--text-muted)]" />
                  </button>

                  {environments.length > 0 && (
                    <div className="border-t border-[var(--border)] px-4 py-2 flex flex-col gap-1">
                      {environments.map((env) => {
                        const editing = editingId === env.id
                        const confirming = confirmId === env.id
                        const last = environments.length <= 1
                        return (
                          <div key={env.id} className="flex flex-col gap-1 py-1">
                            {editing ? (
                              <form
                                className="flex items-center gap-2"
                                onSubmit={(event) => { event.preventDefault(); void saveName(bot.id, env.id) }}
                              >
                                <input
                                  value={draft}
                                  onChange={(event) => setDraft(event.target.value)}
                                  maxLength={40}
                                  autoFocus
                                  aria-label={`Name for ${env.name}`}
                                  className="min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-sm text-[var(--text-primary)]"
                                />
                                <Button type="submit" size="sm" disabled={busyId === env.id || draft.trim().length === 0}>Save</Button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                              </form>
                            ) : confirming ? (
                              <div className="flex items-center gap-2 text-sm">
                                <span className="flex-1 text-[var(--text-secondary)]">Remove {env.name}?</span>
                                <Button type="button" variant="ghost" size="sm" onClick={() => { setConfirmId(null); setRowError(null) }}>Cancel</Button>
                                <Button type="button" variant="destructive" size="sm" disabled={busyId === env.id} onClick={() => void removeEnvironment(bot.id, env.id)}>
                                  {busyId === env.id ? 'Removing…' : 'Remove'}
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="flex-1 truncate text-sm text-[var(--text-secondary)]">{env.name}</span>
                                <button
                                  type="button"
                                  aria-label={`Rename ${env.name}`}
                                  className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                                  onClick={() => { setEditingId(env.id); setDraft(env.name); setConfirmId(null); setRowError(null) }}
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Remove ${env.name}`}
                                  title={last ? 'A bot needs at least one environment.' : `Remove ${env.name}`}
                                  disabled={last}
                                  className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--error)] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
                                  onClick={() => { setConfirmId(env.id); setEditingId(null); setRowError(null) }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                            {rowError?.id === env.id && (
                              <p className="text-xs text-[var(--error)]">{rowError.message}</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            <button
              onClick={() => navigate({ to: '/bots/new' })}
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] bg-transparent p-4 text-left hover:border-[var(--accent)]/40 hover:bg-[var(--accent-muted)] transition-all"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-overlay)]">
                <Plus size={18} className="text-[var(--text-muted)]" />
              </div>
              <p className="font-medium text-[var(--text-muted)]">Create new bot</p>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
