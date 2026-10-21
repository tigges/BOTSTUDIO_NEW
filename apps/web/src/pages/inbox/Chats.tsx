import React, { useEffect, useMemo, useState } from 'react'
import type { ReturnOutcome } from '@botstudio/shared'
import {
  useAssignConversation, useCannedReplies, useConversation, useCreateConversation, useHandBackConversation,
  useInboxChats, useResolveConversation, useSendMessage, useTeamMembers,
} from '../../lib/hooks'
import { useConversationWS, useTenantWS } from '../../lib/ws'
import { useAppStore } from '../../store/app'
import { claimChat } from '../../lib/inbox-nav'
import { DEFAULT_INBOX_FILTERS, inboxParams, orderBySla, type InboxFilters } from '../../lib/inbox-list'
import { InboxTabs } from './InboxTabs'
import { ChatList } from './ChatList'
import { ChatHandover, ChatHeader, ChatLabels, ChatMessages } from './ChatThread'
import { ChatComposer } from './ChatComposer'
import { ChatContactPanel } from './ChatContactPanel'
import { LabelsDialog, NewChatDialog, TaskDialog, TransferDialog } from './ChatDialogs'
import { toConvo, toLines, type Convo } from './chat-model'

type Dialog = 'transfer' | 'task' | 'labels' | 'new' | null

function inView(chat: Convo, filters: InboxFilters, userId: string | undefined): boolean {
  if (filters.view === 'mine') return chat.assigneeId === userId
  if (filters.view === 'unassigned') return !chat.assigneeId
  if (filters.view === 'escalated') return chat.status === 'escalated'
  return true
}

export function ChatsPage() {
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_INBOX_FILTERS)
  const inbox = useInboxChats(inboxParams(filters))
  const { data: members = [] } = useTeamMembers()
  const { data: canned = [] } = useCannedReplies()
  const currentUserId = useAppStore((s) => s.user?.id)
  const selectedBotId = useAppStore((s) => s.selectedBotId)
  const environmentId = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId)?.environments.find((e) => e.kind === s.selectedEnv)?.id)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [sendError, setSendError] = useState<string | undefined>()
  const [handBackError, setHandBackError] = useState<string | undefined>()

  const sendMessage = useSendMessage()
  const assign = useAssignConversation()
  const resolve = useResolveConversation()
  const handBack = useHandBackConversation()
  const createConversation = useCreateConversation()

  useTenantWS()

  const loaded = useMemo(() => (inbox.data?.chats ?? []).map((c) => toConvo(c, members)), [inbox.data, members])
  const shown = useMemo(() => {
    const visible = loaded.filter((chat) => inView(chat, filters, currentUserId))
    return filters.sort === 'sla' ? orderBySla(visible) : visible
  }, [loaded, filters, currentUserId])

  useEffect(() => {
    const pending = claimChat()
    if (pending) { setSelectedId(pending); return }
    if (!selectedId && shown.length) setSelectedId(shown[0]!.id)
  }, [shown, selectedId])

  useEffect(() => { setSendError(undefined); setHandBackError(undefined) }, [selectedId])

  const { data: detail, refetch: refetchDetail } = useConversation(selectedId ?? '')
  const { newMessage, streamingText } = useConversationWS(selectedId)
  useEffect(() => { if (newMessage) void refetchDetail() }, [newMessage, refetchDetail])

  const selected = loaded.find((c) => c.id === selectedId)
    ?? (detail && detail.id === selectedId ? toConvo(detail, members) : undefined)
  const lines = useMemo(() => toLines(detail), [detail])

  async function send(text: string, internal: boolean): Promise<boolean> {
    if (!selectedId) return false
    setSendError(undefined)
    try {
      await sendMessage.mutateAsync({ conversationId: selectedId, text, internal })
      return true
    } catch (err) {
      setSendError(err instanceof Error ? `Not sent: ${err.message}` : 'Not sent. Try again.')
      return false
    }
  }

  async function assignTo(agentId: string | null) {
    if (!selectedId) return
    try { await assign.mutateAsync({ id: selectedId, assignedTo: agentId }) } catch { /* the list refetch shows the real owner */ }
    setDialog(null)
  }

  async function handBackChat(outcome: ReturnOutcome, note: string) {
    if (!selectedId) return
    setHandBackError(undefined)
    try {
      await handBack.mutateAsync({ id: selectedId, outcome, note })
      await refetchDetail()
    } catch (err) {
      setHandBackError(err instanceof Error ? `The chat was not handed back: ${err.message}` : 'The chat was not handed back. Try again.')
    }
  }

  async function createChat(message: string) {
    if (!selectedBotId) return
    const convo = await createConversation.mutateAsync({
      botId: selectedBotId,
      ...(environmentId ? { environmentId } : {}),
      ...(message ? { message } : {}),
    })
    setDialog(null)
    if (convo?.id) setSelectedId(convo.id)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <InboxTabs />
      <div className="flex flex-1 overflow-hidden">
        <ChatList
          chats={shown}
          total={loaded.length}
          testRunChats={inbox.data?.testRunChats ?? 0}
          filters={filters}
          onFilters={setFilters}
          loading={inbox.isLoading}
          error={inbox.isError && !inbox.data}
          onRetry={() => void inbox.refetch()}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNew={() => setDialog('new')}
        />

        {selected ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <ChatHeader
              chat={selected}
              detail={detail}
              members={members}
              onAssign={(id) => void assignTo(id)}
              onResolve={() => { if (selectedId) resolve.mutate(selectedId) }}
              onTransfer={() => setDialog('transfer')}
              onTask={() => setDialog('task')}
              onLabels={() => setDialog('labels')}
            />
            <ChatHandover chat={selected} detail={detail} members={members} busy={handBack.isPending} error={handBackError} onHandBack={(o, n) => void handBackChat(o, n)} />
            <ChatLabels chat={selected} />
            <ChatMessages lines={lines} streamingText={streamingText} chatId={selected.id} />
            <ChatComposer chatId={selected.id} canned={canned} sending={sendMessage.isPending} error={sendError} onSend={send} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-[var(--text-muted)]">{inbox.isLoading ? 'Loading chats…' : 'Pick a chat on the left to read it here.'}</p>
          </div>
        )}

        {selected && (
          <ChatContactPanel
            chat={selected}
            others={loaded.filter((c) => c.contactId && c.contactId === selected.contactId && c.id !== selected.id)}
            onSelect={setSelectedId}
            onTask={() => setDialog('task')}
            onLabels={() => setDialog('labels')}
          />
        )}
      </div>

      <TransferDialog open={dialog === 'transfer'} onOpenChange={(open) => setDialog(open ? 'transfer' : null)} members={members} onPick={(id) => void assignTo(id)} />
      <TaskDialog open={dialog === 'task'} onOpenChange={(open) => setDialog(open ? 'task' : null)} chatId={selectedId} members={members} />
      <LabelsDialog open={dialog === 'labels'} onOpenChange={(open) => setDialog(open ? 'labels' : null)} chatId={selectedId} active={selected?.labels ?? []} />
      <NewChatDialog open={dialog === 'new'} onOpenChange={(open) => setDialog(open ? 'new' : null)} botId={selectedBotId} pending={createConversation.isPending} onCreate={createChat} />
    </div>
  )
}
