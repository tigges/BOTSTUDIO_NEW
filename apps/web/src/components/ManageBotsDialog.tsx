import React, { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, Input } from '@botstudio/ui'
import { bots as botsApi } from '../lib/api'
import { useAppStore, type Bot } from '../store/app'

function envRank(kind: string): number {
  if (kind === 'sandbox') return 0
  if (kind === 'production') return 1
  return 2
}

function environmentSummary(bot: Bot): string {
  return [...bot.environments]
    .sort((a, b) => envRank(a.kind) - envRank(b.kind) || a.name.localeCompare(b.name))
    .map((env) => env.name)
    .join(', ')
}

export function ManageBotsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const bots = useAppStore((s) => s.bots)
  const selectedBotId = useAppStore((s) => s.selectedBotId)
  const setBots = useAppStore((s) => s.setBots)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  function closeActions() {
    setRenamingId(null)
    setDeletingId(null)
    setConfirmName('')
    setRowError(null)
  }

  function handleOpenChange(next: boolean) {
    if (!next) closeActions()
    onOpenChange(next)
  }

  async function refresh(): Promise<Bot[]> {
    const next = await botsApi.list()
    setBots(next.data)
    return next.data
  }

  async function saveName(bot: Bot) {
    const name = draft.trim()
    if (!name || name === bot.name) return
    setBusyId(bot.id)
    setRowError(null)
    try {
      await botsApi.update(bot.id, { name })
      await refresh()
      setRenamingId(null)
    } catch (err: unknown) {
      setRowError({ id: bot.id, message: err instanceof Error ? err.message : 'Could not rename this bot.' })
    } finally {
      setBusyId(null)
    }
  }

  async function removeBot(bot: Bot) {
    if (confirmName !== bot.name) return
    setBusyId(bot.id)
    setRowError(null)
    const wasSelected = bot.id === selectedBotId
    try {
      await botsApi.delete(bot.id)
      const next = await refresh()
      await queryClient.invalidateQueries()
      closeActions()
      if (next.length === 0) {
        onOpenChange(false)
        navigate({ to: '/bots/new' })
        return
      }
      if (wasSelected) navigate({ to: '/overview' })
    } catch (err: unknown) {
      setRowError({ id: bot.id, message: err instanceof Error ? err.message : 'Could not delete this bot.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg" aria-describedby="manage-bots-note">
        <DialogHeader>
          <DialogTitle>Manage bots</DialogTitle>
          <p id="manage-bots-note" className="mt-1 text-sm text-[var(--text-muted)]">
            This is the name in the top bar. What guests hear stays in Settings, under Bot Identity.
          </p>
        </DialogHeader>
        <DialogBody className="space-y-0 pt-0">
          {bots.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No bots yet. Use New bot to add one.</p>
          ) : (
            bots.map((bot) => {
              const renaming = renamingId === bot.id
              const deleting = deletingId === bot.id
              const busy = busyId === bot.id
              return (
                <div key={bot.id} className="border-t border-[var(--border)] py-3 first:border-t-0">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-muted)] text-sm font-bold text-[var(--accent)]">
                      {bot.name.trim().charAt(0).toUpperCase() || 'B'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-[var(--text-primary)]">{bot.name}</p>
                      <p className="truncate text-xs text-[var(--text-muted)]">{environmentSummary(bot) || 'No environments'}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setDeletingId(null)
                          setConfirmName('')
                          setRowError(null)
                          setDraft(bot.name)
                          setRenamingId(renaming ? null : bot.id)
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="text-[var(--error)]"
                        onClick={() => {
                          setRenamingId(null)
                          setRowError(null)
                          setConfirmName('')
                          setDeletingId(deleting ? null : bot.id)
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  {renaming && (
                    <form
                      className="mt-3 pl-12"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void saveName(bot)
                      }}
                    >
                      <div className="flex items-end gap-2">
                        <div className="w-56">
                          <Input
                            label="Bot name"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            maxLength={80}
                            autoFocus
                          />
                        </div>
                        <Button type="submit" size="sm" disabled={busy || draft.trim().length === 0 || draft.trim() === bot.name}>
                          {busy ? 'Saving…' : 'Save'}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setRenamingId(null)}>Cancel</Button>
                      </div>
                      <p className="mt-2 text-xs text-[var(--text-muted)]">
                        This renames the bot in the switcher. The persona guests hear is still edited in Settings, under Bot Identity.
                      </p>
                    </form>
                  )}
                  {deleting && (
                    <form
                      className="mt-3 ml-12 rounded-[var(--radius-md)] bg-[var(--error-muted)] p-3"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void removeBot(bot)
                      }}
                    >
                      <p className="text-sm text-[var(--text-primary)]">
                        Type <strong>{bot.name}</strong> to delete this bot. Its flows, chats, and knowledge go with it.
                        {bots.length > 1 ? ' Other bots stay.' : ''}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          value={confirmName}
                          onChange={(event) => setConfirmName(event.target.value)}
                          aria-label={`Type ${bot.name} to confirm`}
                          autoFocus
                          className="h-9 w-44 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)]"
                        />
                        <Button type="submit" variant="destructive" size="sm" disabled={busy || confirmName !== bot.name}>
                          {busy ? 'Deleting…' : `Delete ${bot.name}`}
                        </Button>
                      </div>
                    </form>
                  )}
                  {rowError?.id === bot.id && (
                    <p className="mt-2 pl-12 text-xs text-[var(--error)]">{rowError.message}</p>
                  )}
                </div>
              )
            })
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
