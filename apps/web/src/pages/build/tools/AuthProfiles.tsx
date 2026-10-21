import React, { useState } from 'react'
import { KeyRound, Loader2, Plus, Trash2, AlertCircle } from 'lucide-react'
import { Button, Badge, EmptyState, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@botstudio/ui'
import { AUTH_PROFILE_KINDS, AUTH_PROFILE_KIND_LABELS, type AuthProfileKind } from '@botstudio/shared'
import { ApiError, type AuthProfileSummary } from '../../../lib/api'
import { useAuthProfiles, useDeleteAuthProfile, useSaveAuthProfile } from '../../../lib/hooks'
import { Callout, Field, Select, TextInput } from './fields'

const KIND_HINT: Record<AuthProfileKind, string> = {
  api_key: 'Sent in a header (X-API-Key unless you name another) or as a query parameter.',
  bearer: 'Sent as Authorization: Bearer <token>.',
  basic: 'Sent as Authorization: Basic with the username and password.',
  custom_header: 'Sent in the header you name, with an optional prefix.',
}

export function AuthProfilesPanel() {
  const { data: profiles = [], isLoading, isError, refetch } = useAuthProfiles()
  const [editing, setEditing] = useState<AuthProfileSummary | 'new' | null>(null)
  const remove = useDeleteAuthProfile()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  if (isLoading) return <div className="flex items-center justify-center py-16 text-xs text-[var(--text-muted)]"><Loader2 size={16} className="mr-2 animate-spin" /> Loading Auth Profiles…</div>
  if (isError) {
    return (
      <EmptyState icon={<AlertCircle size={20} />} title="Auth Profiles could not be loaded" description="Check your connection and try again."
        action={<Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>} />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-xs text-[var(--text-muted)]">
          Auth Profiles hold the keys, tokens and passwords your tools use. Secrets are encrypted, never shown again after saving, and never reach the bot’s model. A profile can be shared by many tools across all your bots.
        </p>
        <Button size="sm" className="shrink-0 gap-1" onClick={() => setEditing('new')}><Plus size={12} /> New Auth Profile</Button>
      </div>
      {deleteError && <Callout tone="error">{deleteError}</Callout>}
      {profiles.length === 0 ? (
        <EmptyState icon={<KeyRound size={20} />} title="No Auth Profiles yet" description="Add one before you create a tool that calls a service needing a key or token."
          action={<Button size="sm" onClick={() => setEditing('new')}><Plus size={12} className="mr-1" /> New Auth Profile</Button>} />
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
          {profiles.map((profile) => (
            <li key={profile.id} className="flex items-center gap-3 px-4 py-3">
              <KeyRound size={14} className="text-[var(--text-muted)]" />
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(profile)}>
                <p className="text-sm font-medium text-[var(--text-primary)]">{profile.name}</p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {AUTH_PROFILE_KIND_LABELS[profile.kind]}
                  {profile.settings.headerName ? ` · ${profile.settings.headerName}` : ''}
                  {profile.settings.queryParam ? ` · ?${profile.settings.queryParam}=` : ''}
                  {profile.settings.username ? ` · ${profile.settings.username}` : ''}
                  {' · '}<span className="font-mono">{profile.secretHint ?? 'no secret'}</span>
                </p>
              </button>
              <Badge variant="muted">{profile.toolCount} {profile.toolCount === 1 ? 'tool' : 'tools'}</Badge>
              <button aria-label={`Delete ${profile.name}`} className="text-[var(--text-muted)] hover:text-[var(--error)]" onClick={async () => {
                setDeleteError(null)
                try { await remove.mutateAsync(profile.id) } catch (err) { setDeleteError(err instanceof ApiError ? err.message : 'The profile could not be deleted.') }
              }}><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      <ProfileDialog profile={editing === 'new' ? undefined : editing ?? undefined} open={editing !== null} onClose={() => setEditing(null)} />
    </div>
  )
}

function ProfileDialog({ profile, open, onClose }: { profile?: AuthProfileSummary; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="md">
        {open && <ProfileForm key={profile?.id ?? 'new'} profile={profile} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function ProfileForm({ profile, onClose }: { profile?: AuthProfileSummary; onClose: () => void }) {
  const [name, setName] = useState(profile?.name ?? '')
  const [kind, setKind] = useState<AuthProfileKind>(profile?.kind ?? 'bearer')
  const [settings, setSettings] = useState(profile?.settings ?? {})
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = useSaveAuthProfile()

  async function submit() {
    setError(null)
    try {
      await save.mutateAsync({ id: profile?.id, body: { name: name.trim(), kind, settings, ...(secret ? { secret } : {}) } })
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The profile could not be saved.')
    }
  }

  const set = (key: keyof typeof settings, value: string) => setSettings({ ...settings, [key]: value || undefined })
  return (
    <>
      <DialogHeader>
        <DialogTitle>{profile ? `Edit ${profile.name}` : 'New Auth Profile'}</DialogTitle>
        <DialogDescription>Tools reference this profile by name. The secret is encrypted when you save and cannot be read back.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <Field label="Name" htmlFor="profile-name" hint="For example: Shopify Admin API">
          <TextInput id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Type" htmlFor="profile-kind" hint={KIND_HINT[kind]}>
          <Select id="profile-kind" value={kind} onChange={(e) => setKind(e.target.value as AuthProfileKind)}>
            {AUTH_PROFILE_KINDS.map((value) => <option key={value} value={value}>{AUTH_PROFILE_KIND_LABELS[value]}</option>)}
          </Select>
        </Field>
        {kind === 'api_key' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Header name" htmlFor="profile-header" hint="Leave empty for X-API-Key.">
              <TextInput id="profile-header" className="font-mono" value={settings.headerName ?? ''} onChange={(e) => set('headerName', e.target.value)} />
            </Field>
            <Field label="Or query parameter" htmlFor="profile-query" hint="Fill this to send the key in the URL instead.">
              <TextInput id="profile-query" className="font-mono" value={settings.queryParam ?? ''} onChange={(e) => set('queryParam', e.target.value)} />
            </Field>
          </div>
        )}
        {kind === 'custom_header' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Header name" htmlFor="profile-header">
              <TextInput id="profile-header" className="font-mono" value={settings.headerName ?? ''} onChange={(e) => set('headerName', e.target.value)} />
            </Field>
            <Field label="Prefix" htmlFor="profile-prefix" hint='Text before the secret, for example "Token ".'>
              <TextInput id="profile-prefix" className="font-mono" value={settings.prefix ?? ''} onChange={(e) => setSettings({ ...settings, prefix: e.target.value })} />
            </Field>
          </div>
        )}
        {kind === 'basic' && (
          <Field label="Username" htmlFor="profile-username">
            <TextInput id="profile-username" value={settings.username ?? ''} onChange={(e) => set('username', e.target.value)} />
          </Field>
        )}
        <Field
          label={kind === 'basic' ? 'Password' : kind === 'bearer' ? 'Token' : 'Secret'}
          htmlFor="profile-secret"
          hint={profile?.hasSecret ? `Saved secret ends ${profile.secretHint ?? '••••'}. Leave empty to keep it, or paste a new one to replace it.` : 'Paste the value. It is encrypted on save.'}
        >
          <TextInput id="profile-secret" type="password" autoComplete="off" className="font-mono" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </Field>
        {error && <Callout tone="error">{error}</Callout>}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={!name.trim() || (!profile && !secret) || save.isPending} onClick={submit}>
          {save.isPending && <Loader2 size={12} className="mr-1 animate-spin" />}
          {profile ? 'Save' : 'Create profile'}
        </Button>
      </DialogFooter>
    </>
  )
}
