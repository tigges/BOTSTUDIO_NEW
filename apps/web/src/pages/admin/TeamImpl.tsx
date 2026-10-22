import React, { useState } from 'react'
import {
  Users, Plus, Search, MoreHorizontal, Mail, Shield,
  UserCog, UserMinus, CheckCircle2, Clock, Circle,
  ChevronDown, Crown, Eye, MessageSquare,
} from 'lucide-react'
import { Avatar, Badge, Button, Input } from '@botstudio/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@botstudio/ui'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@botstudio/ui'
import { SubNav } from '../../components/SubNav'
import { cn } from '@botstudio/ui'
import { useTeamMembers, useInviteMember, useUpdateRole, useRemoveMember } from '../../lib/hooks'

const SUBNAV = [
  { label: 'Team', path: '/admin/team' },
  { label: 'Audit Log', path: '/admin/audit' },
]

type Role = 'admin' | 'supervisor' | 'agent'
type MemberStatus = 'online' | 'away' | 'offline' | 'invited'

interface Member {
  id: string
  name: string
  email: string
  role: Role
  status: MemberStatus
  lastActive?: string
  conversations: number
  joinedAt: string
  avatarUrl?: string
}

const ROLE_CFG: Record<Role, { label: string; variant: 'error' | 'warning' | 'info' | 'muted'; icon: React.ReactNode }> = {
  admin:      { label: 'Admin',      variant: 'error',   icon: <Crown size={11} /> },
  supervisor: { label: 'Supervisor', variant: 'warning', icon: <Eye size={11} /> },
  agent:      { label: 'Agent',      variant: 'info',    icon: <MessageSquare size={11} /> },
}

const STATUS_CFG: Record<MemberStatus, { label: string; color: string }> = {
  online:  { label: 'Online',  color: 'bg-[var(--success)]' },
  away:    { label: 'Away',    color: 'bg-[var(--warning,#fbbf24)]' },
  offline: { label: 'Offline', color: 'bg-[var(--text-muted)]' },
  invited: { label: 'Invited', color: 'bg-[var(--accent)]' },
}

const MOCK_MEMBERS: Member[] = [
  { id: '1', name: 'Charles', email: 'charles@acme.com', role: 'admin', status: 'online', lastActive: 'Now', conversations: 0, joinedAt: 'Jan 2026' },
  { id: '2', name: 'Sarah K', email: 'sarah@acme.com', role: 'supervisor', status: 'online', lastActive: 'Now', conversations: 124, joinedAt: 'Feb 2026' },
  { id: '3', name: 'Mike R', email: 'mike@acme.com', role: 'agent', status: 'online', lastActive: 'Now', conversations: 98, joinedAt: 'Mar 2026' },
  { id: '4', name: 'Tom B', email: 'tom@acme.com', role: 'agent', status: 'away', lastActive: '15m ago', conversations: 76, joinedAt: 'Apr 2026' },
  { id: '5', name: 'Anna W', email: 'anna@acme.com', role: 'agent', status: 'online', lastActive: 'Now', conversations: 65, joinedAt: 'May 2026' },
  { id: '6', name: 'James O', email: 'james@acme.com', role: 'agent', status: 'offline', lastActive: '2h ago', conversations: 43, joinedAt: 'Jun 2026' },
  { id: '7', name: 'Lucy P', email: 'lucy@acme.com', role: 'agent', status: 'invited', conversations: 0, joinedAt: '—' },
]

export function TeamPage() {
  const { data: rawMembers = [] } = useTeamMembers()
  const inviteMember = useInviteMember()
  const updateRole = useUpdateRole()
  const removeMember = useRemoveMember()

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('agent')

  const members: Member[] = rawMembers.map((m) => ({
    id: m.id,
    name: m.displayName ?? m.email ?? 'Unknown',
    email: m.email ?? '',
    role: ((m.memberships?.[0]?.role ?? 'AGENT').toLowerCase() as Role),
    status: (m.agentProfile?.status ?? 'offline') as Member['status'],
    avatar: undefined,
    conversations: 0,
    joinedAt: new Date(Date.now()).toLocaleDateString(),
  }))

  const filtered = members.filter((m) => {
    const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || m.role === roleFilter
    return matchSearch && matchRole
  })

  function changeRole(id: string, role: Role) {
    updateRole.mutate({ id, role: role.toUpperCase() })
  }

  function handleRemove(id: string) {
    removeMember.mutate(id)
  }

  function sendInvite() {
    if (!inviteEmail.trim()) return
    inviteMember.mutate({ email: inviteEmail, role: inviteRole.toUpperCase() })
    setInviteEmail('')
    setShowInvite(false)
  }

  const onlineCount = members.filter((m) => m.status === 'online').length
  const awayCount = members.filter((m) => m.status === 'away').length

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 pt-4 pb-0 shrink-0">
        <div className="flex items-center justify-between pb-3">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Admin</h1>
          <Button size="sm" className="gap-1.5" onClick={() => setShowInvite(true)}>
            <Plus size={14} /> Invite Member
          </Button>
        </div>
        <SubNav items={SUBNAV} />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 px-6 py-2.5 bg-[var(--bg-overlay)] border-b border-[var(--border)] shrink-0">
        {[
          { label: 'Total members', value: members.length },
          { label: 'Online now', value: onlineCount },
          { label: 'Away', value: awayCount },
          { label: 'Invited', value: members.filter((m) => m.status === 'invited').length },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text-primary)]">{s.value}</span>
            <span className="text-xs text-[var(--text-muted)]">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
        <Input placeholder="Search members…" leftIcon={<Search size={13} />} value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <div className="flex gap-1">
          {(['all', 'admin', 'supervisor', 'agent'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium capitalize transition-colors border',
                roleFilter === r ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
              )}
            >
              {r === 'all' ? 'All roles' : r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--bg-surface)] border-b border-[var(--border)] z-10">
            <tr>
              {['Member', 'Role', 'Status', 'Conversations', 'Last active', 'Joined', ''].map((h) => (
                <th key={h} className="px-5 py-2.5 text-left text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map((m) => {
              const rc = ROLE_CFG[m.role]
              const sc = STATUS_CFG[m.status]
              return (
                <tr key={m.id} className="hover:bg-[var(--bg-hover)] transition-colors group">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar name={m.name} size="sm" />
                        <span className={cn('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-surface)]', sc.color)} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">{m.name}</p>
                        <p className="text-xs text-[var(--text-muted)]">{m.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="flex items-center gap-1 group/role">
                          <Badge variant={rc.variant} className="gap-1">{rc.icon}{rc.label}</Badge>
                          <ChevronDown size={10} className="text-[var(--text-muted)] opacity-0 group-hover/role:opacity-100 transition-all" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuLabel>Change role</DropdownMenuLabel>
                        {(['admin', 'supervisor', 'agent'] as Role[]).map((r) => (
                          <DropdownMenuItem key={r} onClick={() => changeRole(m.id, r)}>
                            <span className="capitalize">{r}</span>
                            {m.role === r && <CheckCircle2 size={13} className="ml-auto text-[var(--accent)]" />}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn('flex items-center gap-1.5 text-xs font-medium', m.status === 'online' ? 'text-[var(--success)]' : m.status === 'away' ? 'text-[var(--warning,#fbbf24)]' : 'text-[var(--text-muted)]')}>
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', sc.color)} />
                      {sc.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-semibold text-[var(--text-primary)]">{m.conversations > 0 ? m.conversations : '—'}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{m.lastActive ?? '—'}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{m.joinedAt}</td>
                  <td className="px-5 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--bg-overlay)] text-[var(--text-muted)] transition-all">
                          <MoreHorizontal size={14} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem><UserCog size={13} /> Edit profile</DropdownMenuItem>
                        <DropdownMenuItem><Mail size={13} /> Resend invite</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onClick={() => handleRemove(m.id)}><UserMinus size={13} /> Remove from workspace</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Invite dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>Invite team member</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Email address *</label>
              <input
                autoFocus
                type="email"
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendInvite() }}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Role</label>
              <div className="space-y-2">
                {(['agent', 'supervisor', 'admin'] as Role[]).map((r) => {
                  const rc = ROLE_CFG[r]
                  const descriptions: Record<Role, string> = {
                    agent: 'Can handle conversations and tickets',
                    supervisor: 'Can monitor all agents, view reports, manage teams',
                    admin: 'Full access to all settings and configurations',
                  }
                  return (
                    <button
                      key={r}
                      onClick={() => setInviteRole(r)}
                      className={cn(
                        'flex items-center gap-3 w-full p-3 rounded-[var(--radius-md)] border text-left transition-colors',
                        inviteRole === r ? 'border-[var(--accent)] bg-[var(--accent-muted)]' : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
                      )}
                    >
                      <Badge variant={rc.variant} className="gap-1 shrink-0">{rc.icon}{rc.label}</Badge>
                      <p className="text-xs text-[var(--text-muted)]">{descriptions[r]}</p>
                      {inviteRole === r && <CheckCircle2 size={14} className="ml-auto text-[var(--accent)] shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowInvite(false)}>Cancel</Button>
            <Button disabled={!inviteEmail.trim()} onClick={sendInvite} className="gap-1.5"><Mail size={13} /> Send invite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
