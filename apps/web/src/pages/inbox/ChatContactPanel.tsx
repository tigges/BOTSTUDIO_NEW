import React, { useState } from 'react'
import { ClipboardList, Globe, Mail, MessageCircle, Phone, Star, UserPlus } from 'lucide-react'
import { Avatar, Badge, Button, cn } from '@botstudio/ui'
import { useNavigate } from '@tanstack/react-router'
import { queueContact } from '../../lib/inbox-nav'
import { useChatMemory } from '../../lib/hooks'
import { RememberedFacts } from '../../components/RememberedFacts'
import { ChannelIcon, SlaChip, type Convo } from './chat-model'

type Section = 'info' | 'history' | 'labels'

const STATUS_VARIANT: Record<string, 'info' | 'success' | 'error' | 'warning' | 'muted'> = {
  active: 'info',
  resolved: 'success',
  escalated: 'error',
  pending: 'warning',
  bot: 'muted',
}

export function ChatContactPanel(props: {
  chat: Convo
  others: Convo[]
  onSelect: (id: string) => void
  onTask: () => void
  onLabels: () => void
}) {
  const { chat } = props
  const [section, setSection] = useState<Section>('info')
  const navigate = useNavigate()

  return (
    <div className="w-[260px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-surface)] overflow-y-auto flex flex-col">
      <div className="flex flex-col items-center gap-2 p-4 border-b border-[var(--border)]">
        <Avatar name={chat.name} size="lg" />
        <p className="font-medium text-[var(--text-primary)] text-sm text-center">{chat.name}</p>
        <div className="flex items-center gap-1.5 flex-wrap justify-center">
          <Badge variant={STATUS_VARIANT[chat.status]} dot>{chat.status}</Badge>
          <Badge variant="muted"><ChannelIcon ch={chat.channel} />{chat.channel}</Badge>
        </div>
      </div>

      <div className="flex border-b border-[var(--border)]">
        {(['info', 'history', 'labels'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            className={cn(
              'flex-1 py-2 text-[11px] font-medium capitalize transition-colors',
              section === s ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {section === 'info' && (
        <div className="p-4 space-y-4">
          {chat.sla && (
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 bg-[var(--bg-overlay)]">
              <p className="text-[10px] font-medium uppercase text-[var(--text-muted)] mb-1">Reply time</p>
              <SlaChip sla={chat.sla} />
            </div>
          )}
          <div className="space-y-3">
            {[
              { label: 'Email', value: chat.email, icon: <Mail size={12} /> },
              { label: 'Phone', value: chat.phone, icon: <Phone size={12} /> },
              { label: 'Location', value: chat.location, icon: <Globe size={12} /> },
              { label: 'Channel', value: chat.channelName ?? chat.channel, icon: <MessageCircle size={12} /> },
              { label: 'Assigned to', value: chat.assignee ?? 'Unassigned', icon: <UserPlus size={12} /> },
            ].filter((item) => item.value).map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <span className="mt-0.5 text-[var(--text-muted)]">{item.icon}</span>
                <div>
                  <p className="text-[10px] font-medium uppercase text-[var(--text-muted)]">{item.label}</p>
                  <p className="text-xs text-[var(--text-primary)] mt-0.5">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-[var(--border)]">
            <ChatMemory conversationId={chat.id} />
          </div>
          <div className="pt-2 border-t border-[var(--border)] space-y-2">
            <Button variant="secondary" size="sm" className="w-full gap-1.5" onClick={props.onTask}>
              <ClipboardList size={13} /> Add a task
            </Button>
            {chat.channel === 'web' && chat.channelId && (
              <a
                className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--accent)] hover:bg-[var(--bg-hover)]"
                href={`/api/v1/widget-test/${chat.channelId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open test widget
              </a>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-1.5"
              disabled={!chat.contactId}
              onClick={() => {
                if (!chat.contactId) return
                queueContact(chat.contactId)
                void navigate({ to: '/inbox/contacts' })
              }}
            >
              <Star size={13} /> View contact profile
            </Button>
          </div>
        </div>
      )}

      {section === 'history' && (
        <div className="p-4">
          <p className="text-[11px] text-[var(--text-muted)] mb-3">
            {props.others.length} other chat{props.others.length === 1 ? '' : 's'} with this contact
          </p>
          {props.others.length > 0 ? (
            <div className="space-y-2">
              {props.others.slice(0, 6).map((c) => (
                <button key={c.id} type="button" onClick={() => props.onSelect(c.id)} className="w-full text-left rounded-[var(--radius-md)] border border-[var(--border)] p-2.5 hover:bg-[var(--bg-hover)] transition-colors">
                  <p className="text-xs text-[var(--text-secondary)] truncate">{c.message || 'No message yet'}</p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{c.time}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">No other chats</p>
          )}
        </div>
      )}

      {section === 'labels' && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase">Labels</p>
            <button type="button" onClick={props.onLabels} className="text-[11px] text-[var(--accent)] hover:underline">Edit</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(chat.labels ?? []).length > 0
              ? chat.labels!.map((l) => (
                <span key={l} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--bg-overlay)] text-[var(--text-secondary)] border border-[var(--border)]">{l}</span>
              ))
              : <p className="text-xs text-[var(--text-muted)]">No labels added</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function ChatMemory({ conversationId }: { conversationId: string }) {
  const { data, isLoading, isError, refetch } = useChatMemory(conversationId)
  return <RememberedFacts compact contactId={data?.contactId} facts={data?.facts} loading={isLoading} error={isError} onRetry={() => refetch()} />
}
