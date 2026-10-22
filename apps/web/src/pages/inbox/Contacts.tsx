import React, { useEffect, useState } from 'react'
import {
  Search, Plus, Filter, Mail, Phone, Globe, MessageSquare,
  MoreHorizontal, ChevronDown, Upload, Download, Star,
  Clock, MessageCircle, CheckCircle2,
} from 'lucide-react'
import { Avatar, Badge, Button, Input, Skeleton } from '@botstudio/ui'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@botstudio/ui'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@botstudio/ui'
import { cn } from '@botstudio/ui'
import { useContacts, useCreateContact, useUpdateContact, useDeleteContact, useContactConversations, useCreateConversation, useCreateTicket, useChannels, useContactMemory } from '../../lib/hooks'
import { RememberedFacts } from '../../components/RememberedFacts'
import { useAppStore } from '../../store/app'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { chatText } from '../../lib/chat-text'
import { claimContact, queueChat } from '../../lib/inbox-nav'
import * as api from '../../lib/api'
import { InboxTabs } from './InboxTabs'

interface Contact {
  id: string
  name: string
  email?: string
  phone?: string
  location?: string
  channel: string
  conversations: number
  lastSeen: string
  status: 'active' | 'inactive'
  tags?: string[]
  company?: string
}

function formatRelativeContact(iso?: string) {
  if (!iso) return 'unknown'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 2) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function ChannelBadge({ ch }: { ch: string }) {
  const map: Record<string, string> = { web: 'info', whatsapp: 'success', sms: 'warning', email: 'muted' }
  return <Badge variant={(map[ch] ?? 'muted') as 'info' | 'success' | 'warning' | 'muted'}>{ch}</Badge>
}

interface ContactDetailProps {
  contact: Contact
  onClose: () => void
  onOpenChat: (id: string) => void
  onStart: () => void
  starting: boolean
}

function ContactDetail({ contact, onClose, onOpenChat, onStart, starting }: ContactDetailProps) {
  const { data: convos = [] } = useContactConversations(contact.id)
  const memory = useContactMemory(contact.id)
  return (
    <DialogContent size="lg">
      <DialogHeader>
        <DialogTitle>Contact profile</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="flex gap-6">
          {/* Left: summary */}
          <div className="flex flex-col items-center gap-3 w-48 shrink-0 pt-2">
            <Avatar name={contact.name} size="xl" />
            <div className="text-center">
              <p className="font-semibold text-[var(--text-primary)]">{contact.name}</p>
              {contact.company && <p className="text-xs text-[var(--text-muted)] mt-0.5">{contact.company}</p>}
            </div>
            <div className="flex flex-wrap gap-1 justify-center">
              <ChannelBadge ch={contact.channel} />
              {contact.tags?.map((t) => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--bg-overlay)] text-[var(--text-muted)] border border-[var(--border)]">{t}</span>
              ))}
            </div>
          </div>

          {/* Right: details */}
          <div className="flex-1 grid grid-cols-2 gap-4">
            {[
              { label: 'Email', value: contact.email, icon: <Mail size={13} /> },
              { label: 'Phone', value: contact.phone, icon: <Phone size={13} /> },
              { label: 'Location', value: contact.location, icon: <Globe size={13} /> },
              { label: 'Company', value: contact.company, icon: <Globe size={13} /> },
              { label: 'Last seen', value: contact.lastSeen, icon: <Clock size={13} /> },
              { label: 'Conversations', value: String(contact.conversations), icon: <MessageCircle size={13} /> },
            ].filter((x) => x.value).map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <span className="mt-0.5 text-[var(--text-muted)]">{item.icon}</span>
                <div>
                  <p className="text-[10px] font-medium uppercase text-[var(--text-muted)]">{item.label}</p>
                  <p className="text-sm text-[var(--text-primary)] mt-0.5">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <RememberedFacts contactId={contact.id} facts={memory.data} loading={memory.isLoading} error={memory.isError} onRetry={() => memory.refetch()} />
        </div>

        {/* Recent conversations */}
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase mb-3">Recent conversations</p>
          <div className="space-y-2">
            {convos.length === 0 && (
              <p className="text-xs text-[var(--text-muted)]">No conversations yet</p>
            )}
            {convos.slice(0, 5).map((c) => {
              const channel = c.channel
              return (
              <div key={c.id} role="button" tabIndex={0} onClick={() => onOpenChat(c.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenChat(c.id) }} className="flex items-center gap-3 p-2.5 rounded-[var(--radius-md)] border border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer">
                <CheckCircle2 size={14} className={c.status === 'resolved' ? 'text-[var(--success)]' : 'text-[var(--accent)]'} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--text-primary)] truncate">
                    {chatText(c.messages?.[0]?.content?.text, contact.name) || 'Conversation'}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] capitalize">{c.status} · {new Date(c.updatedAt).toLocaleDateString()}</p>
                  {channel?.name && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {channel.name}
                      {channel.kind === 'web' && (
                        <>
                          {' · '}
                          <a className="text-[var(--accent)] hover:underline" href={`/api/v1/widget-test/${channel.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Test widget</a>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </div>
              )
            })}
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button className="gap-1.5" disabled={starting} onClick={onStart}><MessageCircle size={13} /> {starting ? 'Starting…' : 'Start conversation'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

export function ContactsPage() {
  const [search, setSearch] = useState('')
  const contactsQuery = useContacts(search || undefined)
  const rawContacts = contactsQuery.data ?? []
  const createContact = useCreateContact()
  const deleteContact = useDeleteContact()
  const [selected, setSelected] = useState<Contact | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [createError, setCreateError] = useState('')
  const [emailOnly, setEmailOnly] = useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const botId = useAppStore((s) => s.selectedBotId)
  const environmentId = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId)?.environments.find((e) => e.kind === s.selectedEnv)?.id)
  const { data: channels = [] } = useChannels()
  const createConversation = useCreateConversation()
  const createTicket = useCreateTicket()

  // Map API contact shape to local Contact shape
  const filtered: Contact[] = rawContacts.map((c) => ({
    id: c.id,
    name: c.displayName ?? c.email ?? 'Unknown',
    email: c.email,
    phone: c.phone,
    company: (c.metadata as Record<string, string> | null)?.company,
    tags: [(c.metadata as Record<string, string> | null)?.vip ? 'vip' : null, (c.metadata as Record<string, string> | null)?.plan].filter(Boolean) as string[],
    status: 'active' as Contact['status'],
    channel: 'web' as Contact['channel'],
    lastSeen: formatRelativeContact((c as { createdAt?: string }).createdAt),
    conversations: (c as { _count?: { conversations: number } })._count?.conversations ?? 0,
  })).filter((c) => !emailOnly || Boolean(c.email))

  function openChat(id: string) {
    queueChat(id)
    setSelected(null)
    void navigate({ to: '/inbox/chats' })
  }

  async function startConversation(contactId: string) {
    if (!botId) return
    const channel = channels.find((item) => item.kind === 'web' && item.environmentId === environmentId && item.isActive)
      ?? channels.find((item) => item.kind === 'web' && item.environmentId === environmentId)
    const convo = await createConversation.mutateAsync({
      botId,
      contactId,
      ...(environmentId ? { environmentId } : {}),
      ...(channel ? { channelId: channel.id } : {}),
    })
    openChat(convo.id)
  }

  useEffect(() => {
    const id = claimContact()
    if (!id) return
    const match = filtered.find((item) => item.id === id)
    if (match) setSelected(match)
  }, [rawContacts])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreateError('')
    try {
      await createContact.mutateAsync({ displayName: newName.trim(), email: newEmail.trim() || undefined, phone: newPhone.trim() || undefined })
      setShowNew(false); setNewName(''); setNewEmail(''); setNewPhone('')
    } catch (e) { setCreateError(e instanceof Error ? e.message : 'Failed') }
  }

  function handleDelete(id: string) {
    deleteContact.mutate(id)
    if (selected?.id === id) setSelected(null)
  }

  return (
    <div className="flex flex-col h-full">
      <InboxTabs />

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
        <Input
          placeholder="Search contacts…"
          aria-label="Search contacts"
          leftIcon={<Search size={13} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEmailOnly((v) => !v)}><Filter size={13} /> {emailOnly ? 'With email' : 'Filter'}</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          void file.text().then(async (text) => {
            const rows = text.split(/\r?\n/).slice(1).flatMap((line) => {
              const [displayName = '', email = '', phone = ''] = line.split(',').map((part) => part.trim().replace(/^"|"$/g, ''))
              if (!displayName) return []
              return [{ displayName, email: email || undefined, phone: phone || undefined }]
            })
            if (rows.length) await api.contacts.importRows(rows)
            void qc.invalidateQueries({ queryKey: ['contacts'] })
          })
          e.target.value = ''
        }} />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}><Upload size={13} /> Import</Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => {
            void api.contacts.exportCsv().then((csv) => {
              const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
              const link = document.createElement('a')
              link.href = url
              link.download = 'contacts.csv'
              link.click()
              URL.revokeObjectURL(url)
            })
          }}><Download size={13} /> Export</Button>
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Plus size={14} /> New contact
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-6 px-6 py-2.5 bg-[var(--bg-overlay)] border-b border-[var(--border)] shrink-0">
        {[
          { label: 'Total', value: filtered.length },
          { label: 'With email', value: filtered.filter((c) => c.email).length },
          { label: 'VIP', value: filtered.filter((c) => c.tags?.includes('vip')).length },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text-primary)]">{s.value}</span>
            <span className="text-xs text-[var(--text-muted)]">{s.label}</span>
          </div>
        ))}
        <span className="ml-auto text-xs text-[var(--text-muted)]">{filtered.length} results</span>
      </div>

      {contactsQuery.isLoading ? (
        <div className="space-y-2 p-6">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : contactsQuery.isError ? (
        <ContactsMessage title="Contacts could not be loaded" body="Check your connection, then try again.">
          <Button size="sm" variant="secondary" onClick={() => void contactsQuery.refetch()}>Retry</Button>
        </ContactsMessage>
      ) : filtered.length === 0 && (search || emailOnly) ? (
        <ContactsMessage title="No contacts match" body={search ? `Nothing for “${search}”.` : 'No contact has an email address yet.'}>
          <Button size="sm" variant="secondary" onClick={() => { setSearch(''); setEmailOnly(false) }}>Show all contacts</Button>
        </ContactsMessage>
      ) : filtered.length === 0 ? (
        <ContactsMessage title="No contacts yet" body="People are added when they chat with the bot. You can also import a CSV (name, email, phone) or add one by hand.">
          <Button size="sm" onClick={() => setShowNew(true)}>New contact</Button>
        </ContactsMessage>
      ) : (
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--bg-surface)] border-b border-[var(--border)] z-10">
            <tr>
              {['Name', 'Email', 'Phone', 'Channel', 'Company', 'Chats', 'Added', ''].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map((c) => (
              <tr
                key={c.id}
                className="hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group"
                onClick={() => setSelected(c)}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={c.name} size="sm" />
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{c.name}</p>
                      {c.tags && c.tags.length > 0 && (
                        <div className="flex gap-1 mt-0.5">
                          {c.tags.map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0 rounded-full bg-[var(--accent-muted)] text-[var(--accent)]">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">{c.email ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">{c.phone ?? '—'}</td>
                <td className="px-4 py-2.5"><ChannelBadge ch={c.channel} /></td>
                <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">{c.company ?? '—'}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className="text-xs font-medium text-[var(--text-primary)]">{c.conversations}</span>
                </td>
                <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] whitespace-nowrap">
                  {c.lastSeen}
                </td>
                <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--bg-overlay)] text-[var(--text-muted)] transition-all">
                        <MoreHorizontal size={14} />
                      </button>
                    </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setSelected(c)}>View profile</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { void startConversation(c.id) }}>Start conversation</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        if (!botId) return
                        void createConversation.mutateAsync({ botId, contactId: c.id }).then((convo) =>
                          createTicket.mutateAsync({ subject: `Follow up with ${c.name}`, priority: 'medium', conversationId: convo.id })
                        )
                      }}>Add a task</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onClick={() => handleDelete(c.id)}>Delete contact</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* Contact detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        {selected && (
          <ContactDetail
            contact={selected}
            onClose={() => setSelected(null)}
            onOpenChat={openChat}
            onStart={() => { void startConversation(selected.id) }}
            starting={createConversation.isPending}
          />
        )}
      </Dialog>

      {/* New contact dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New contact</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Full name *</label>
              <input
                autoFocus
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="e.g. Jane Doe"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Email</label>
              <input
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="jane@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Phone</label>
              <input
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="+1 555 0000"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
            </div>
            {createError && <p className="text-xs text-[var(--danger)]">{createError}</p>}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button disabled={!newName.trim() || createContact.isPending} onClick={() => void handleCreate()}>
              {createContact.isPending ? 'Creating…' : 'Create contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ContactsMessage(props: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium text-[var(--text-primary)]">{props.title}</p>
      <p className="max-w-sm text-xs text-[var(--text-muted)]">{props.body}</p>
      {props.children}
    </div>
  )
}
