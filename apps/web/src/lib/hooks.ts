/**
 * TanStack Query hooks wrapping the typed API client.
 * Demo mode uses the sample catalog. A live session shows the API error
 * instead of that catalog, so a salon bot never looks like the shop sample.
 */
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import React from 'react'
import type { BusinessProfile, GuardrailRule, ReturnOutcome } from '@ybot/shared'
import * as api from './api'
import * as demo from './demo-data'
import { useAppStore } from '../store/app'

/** True when running on GitHub Pages or VITE_DEMO_MODE=true with no API URL */
const isDemoMode = () => import.meta.env.VITE_DEMO_MODE === 'true'

function botId() { return useAppStore.getState().selectedBotId ?? 'demo' }

// ── Helpers ───────────────────────────────────────────────────────────────────
function withDemoFallback<T>(apiFn: () => Promise<T>, demoValue: T): () => Promise<T> {
  return async () => {
    if (isDemoMode()) return demoValue
    return apiFn()
  }
}

// ── Flows ─────────────────────────────────────────────────────────────────────
export function useFlows() {
  const bid = botId()
  return useQuery({
    queryKey: ['flows', bid],
    queryFn: withDemoFallback(() => api.flows.list(bid).then((r) => r.data), demo.DEMO_FLOWS),
    staleTime: 30_000,
  })
}

export function useJourneyTraffic(enabled: boolean, environmentId?: string, includeTestRuns = true) {
  const bid = botId()
  return useQuery({
    queryKey: ['journey-traffic', bid, environmentId ?? '', includeTestRuns],
    enabled: enabled && !!bid && !isDemoMode(),
    queryFn: () => api.flows.traffic(bid, environmentId, includeTestRuns).then((r) => r.data),
  })
}

export function useLearning(environmentId: string) {
  const bid = botId()
  return useQuery({
    queryKey: ['learn', bid, environmentId],
    queryFn: () => api.learn.summary(bid, environmentId).then((r) => r.data),
    enabled: !isDemoMode() && !!environmentId,
  })
}

export function useRemoveStarterPack() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (pack: 'corporate-services' | 'hair-studio') => api.bots.removePack(bid, pack).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flows', bid] })
      qc.invalidateQueries({ queryKey: ['intents', bid] })
      qc.invalidateQueries({ queryKey: ['faqs', bid] })
    },
  })
}

export function useImportStarterPack() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (pack: 'corporate-services' | 'hair-studio') => {
      const call = pack === 'hair-studio' ? api.bots.importHairStudioPack(bid) : api.bots.importCorporatePack(bid)
      return call.then((r) => r.data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flows', bid] })
      qc.invalidateQueries({ queryKey: ['intents', bid] })
      qc.invalidateQueries({ queryKey: ['faqs', bid] })
    },
  })
}

export function useCreateFlow() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (body: { name: string; description?: string; tags?: string[]; graph?: api.FlowGraph }) =>
      api.flows.create(bid, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flows', bid] }),
  })
}

export function useUpdateFlow() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: ({ flowId, ...body }: { flowId: string; name?: string; description?: string }) =>
      api.flows.update(bid, flowId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flows', bid] }),
  })
}

export function useDeleteFlow() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (flowId: string) => api.flows.delete(bid, flowId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flows', bid] }),
  })
}

export function useFlowCanvas(flowId: string, version: number) {
  const bid = botId()
  return useQuery({
    queryKey: ['canvas', bid, flowId, version],
    queryFn: async () => {
      if (isDemoMode()) return null
      return api.flows.getCanvas(bid, flowId, version).then((r) => r.data)
    },
    enabled: !!flowId && version > 0 && !isDemoMode(),
  })
}

export function useSaveCanvas() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: ({ flowId, version, graph }: { flowId: string; version: number; graph: api.FlowGraph }) =>
      api.flows.saveCanvas(bid, flowId, version, graph).then((r) => r.data),
    onSuccess: (saved, v) => {
      void qc.invalidateQueries({ queryKey: ['canvas', bid, v.flowId] })
      // A save over a published version lands in a new draft; the canvas follows it.
      if (saved?.forked) void qc.invalidateQueries({ queryKey: ['flows', bid] })
      void qc.invalidateQueries({ queryKey: ['releases', bid] })
    },
  })
}

// ── Intents ───────────────────────────────────────────────────────────────────
export function useIntents() {
  const bid = botId()
  return useQuery({
    queryKey: ['intents', bid],
    queryFn: withDemoFallback(() => api.knowledge.intents.list(bid).then((r) => r.data), demo.DEMO_INTENTS),
  })
}

export function useCreateIntent() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: (body: Partial<api.Intent>) => api.knowledge.intents.create(bid, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intents', bid] }),
  })
}

export function useUpdateIntent() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<api.Intent> & { id: string }) => api.knowledge.intents.update(bid, id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intents', bid] }),
  })
}

export function useDeleteIntent() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.knowledge.intents.delete(bid, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intents', bid] }),
  })
}

// ── Entities ──────────────────────────────────────────────────────────────────
export function useEntities() {
  const bid = botId()
  return useQuery({
    queryKey: ['entities', bid],
    queryFn: withDemoFallback(() => api.knowledge.entities.list(bid).then((r) => r.data), demo.DEMO_ENTITIES),
  })
}

export function useCreateEntity() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: (body: Partial<api.Entity>) => api.knowledge.entities.create(bid, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entities', bid] }),
  })
}

export function useDeleteEntity() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.knowledge.entities.delete(bid, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entities', bid] }),
  })
}

// ── FAQs ──────────────────────────────────────────────────────────────────────
export function useFaqs() {
  const bid = botId()
  return useQuery({
    queryKey: ['faqs', bid],
    queryFn: withDemoFallback(() => api.knowledge.faqs.list(bid).then((r) => r.data), demo.DEMO_FAQS),
  })
}

export function useCreateFaq() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: (body: Partial<api.Faq>) => api.knowledge.faqs.create(bid, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['faqs', bid] }),
  })
}

export function useDeleteFaq() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.knowledge.faqs.delete(bid, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['faqs', bid] }),
  })
}

export function useUpdateFaq() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; question?: string; answer?: string; tags?: string[] }) =>
      api.knowledge.faqs.update(bid, id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['faqs', bid] }),
  })
}

export function useUpdateEntity() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; kind?: string; values?: object[] }) =>
      api.knowledge.entities.update(bid, id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entities', bid] }),
  })
}

export function usePublishFlow() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: ({ flowId, environmentId, version }: { flowId: string; environmentId: string; version?: number }) =>
      api.flows.publish(bid, flowId, environmentId, version),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['flows', bid] })
      void qc.invalidateQueries({ queryKey: ['releases', bid] })
      void qc.invalidateQueries({ queryKey: ['evals', bid] })
    },
  })
}

// ── Sources ───────────────────────────────────────────────────────────────────
export function useSources() {
  const bid = botId()
  return useQuery({
    queryKey: ['sources', bid],
    queryFn: withDemoFallback(() => api.knowledge.sources.list(bid).then((r) => r.data), demo.DEMO_SOURCES),
  })
}

export function useCreateSource() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: (body: { name: string; kind: string; config: Record<string, unknown> }) =>
      api.knowledge.sources.create(bid, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources', bid] }),
  })
}

export function useUploadSource() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: (file: File) => api.knowledge.sources.upload(bid, file).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources', bid] }),
  })
}

export function useSyncSource() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: (sourceId: string) => api.knowledge.sources.sync(bid, sourceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources', bid] }),
  })
}

export function useDeleteSource() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.knowledge.sources.delete(bid, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources', bid] }),
  })
}

// ── Training config ───────────────────────────────────────────────────────────
export function useTraining() {
  const bid = botId()
  return useQuery({
    queryKey: ['training', bid],
    queryFn: withDemoFallback(() => api.knowledge.training.get(bid).then((r) => r.data), demo.DEMO_TRAINING),
  })
}

export function useSaveTraining() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: (config: Partial<api.LlmConfig>) => api.knowledge.training.update(bid, config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training', bid] }),
  })
}

export function useInboxConfig() {
  const bid = botId()
  return useQuery({
    queryKey: ['inbox-config', bid],
    queryFn: () => api.knowledge.inboxConfig.get(bid).then((r) => r.data),
    enabled: !!bid && bid !== 'demo',
  })
}

export function useSaveInboxConfig() {
  const qc = useQueryClient(); const bid = botId()
  return useMutation({
    mutationFn: (config: Record<string, unknown>) => api.knowledge.inboxConfig.update(bid, config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox-config', bid] }),
  })
}

// ── Conversations ─────────────────────────────────────────────────────────────
export function useBotOverview() {
  const bid = useAppStore((s) => s.selectedBotId)
  return useQuery({
    queryKey: ['bot-overview', bid],
    enabled: !!bid && !isDemoMode(),
    queryFn: () => api.bots.overview(bid!).then((r) => r.data),
    refetchInterval: 30_000,
  })
}

export function useConversations(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['conversations', params],
    queryFn: withDemoFallback(
      () => api.conversations.list(params).then((r) => r.data),
      demo.DEMO_CONVERSATIONS,
    ),
    refetchInterval: isDemoMode() ? false : 10_000,
  })
}

/** The Inbox list with its search and test-run filter, plus how many test-run chats the filter hides. */
export function useInboxChats(params: Record<string, string>) {
  return useQuery<{ chats: api.Conversation[]; testRunChats: number }>({
    queryKey: ['conversations', 'inbox', params],
    queryFn: withDemoFallback(
      () => api.conversations.list(params).then((r) => ({ chats: r.data, testRunChats: r.meta?.testRunChats ?? 0 })),
      { chats: demo.DEMO_CONVERSATIONS, testRunChats: 0 },
    ),
    refetchInterval: isDemoMode() ? false : 10_000,
    placeholderData: keepPreviousData,
  })
}

export function useCreateConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { botId: string; channelId?: string; contactId?: string; environmentId?: string; message?: string }) =>
      api.conversations.create(body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  })
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: ['conversation', id],
    queryFn: withDemoFallback(
      () => api.conversations.get(id).then((r) => r.data),
      demo.DEMO_CONVERSATIONS.find((c) => c.id === id) ?? demo.DEMO_CONVERSATIONS[0]!,
    ),
    enabled: !!id,
  })
}

export function useSendMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ conversationId, text, internal }: { conversationId: string; text: string; internal?: boolean }) =>
      api.conversations.messages.send(conversationId, { text }, 'agent', Boolean(internal)),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['conversation', v.conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

export function useAssignConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, assignedTo }: { id: string; assignedTo: string | null }) =>
      api.conversations.update(id, { assignedTo }),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['conversation', v.id] }),
  })
}

export function useHandBackConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, outcome, note }: { id: string; outcome: ReturnOutcome; note?: string }) =>
      api.conversations.handBack(id, { outcome, ...(note ? { note } : {}) }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['conversation', v.id] })
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

export function useResolveConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.conversations.update(id, { status: 'resolved' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  })
}

// ── Contacts ──────────────────────────────────────────────────────────────────
export function useContacts(search?: string) {
  return useQuery({
    queryKey: ['contacts', search],
    queryFn: withDemoFallback(
      () => api.contacts.list(search ? { search } : undefined).then((r) => r.data),
      search
        ? demo.DEMO_CONTACTS.filter((c) =>
            c.displayName?.toLowerCase().includes(search.toLowerCase()) ||
            c.email?.toLowerCase().includes(search.toLowerCase())
          )
        : demo.DEMO_CONTACTS,
    ),
  })
}

export function useCreateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { displayName: string; email?: string; phone?: string }) =>
      api.contacts.create(body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  })
}

export function useUpdateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; displayName?: string; email?: string; phone?: string }) =>
      api.contacts.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  })
}

export function useDeleteContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.contacts.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  })
}

export function useContactConversations(contactId: string) {
  return useQuery({
    queryKey: ['contact-conversations', contactId],
    queryFn: () => api.conversations.list({ contactId }).then((r) => r.data),
    enabled: !!contactId,
  })
}

// ── Campaigns & Templates ─────────────────────────────────────────────────────
export function useCampaigns() {
  const bid = botId()
  return useQuery({
    queryKey: ['campaigns', bid],
    queryFn: withDemoFallback(() => api.campaigns.list(bid).then((r) => r.data), demo.DEMO_CAMPAIGNS),
  })
}

export function useAudienceCount(params: { hasEmail?: boolean; hasPhone?: boolean; channel?: string; tags?: string[] }) {
  const bid = botId()
  const enabled = bid !== 'demo'
  return useQuery({
    queryKey: ['audience-count', bid, params],
    queryFn: () => api.campaigns.audienceCount(bid, params).then((r) => r.data.count),
    enabled,
    staleTime: 10_000,
  })
}

export function useCreateCampaign() {
  const bid = botId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; channel?: string; status?: 'draft' | 'running'; subject?: string; body?: string; scheduledAt?: string; filters?: { hasEmail?: boolean; hasPhone?: boolean; channel?: string; tags?: string[] } }) =>
      api.campaigns.create(bid, body).then((r) => r.data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['campaigns', bid] }) },
  })
}


export function useLaunchCampaign() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.campaigns.launch(bid, id).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', bid] }),
  })
}

export function usePauseCampaign() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.campaigns.pause(bid, id).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', bid] }),
  })
}

export function useUpdateCampaign() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; channel?: string; status?: string; scheduledAt?: string; filters?: { hasEmail?: boolean; hasPhone?: boolean; channel?: string; tags?: string[] } }) =>
      api.campaigns.update(bid, id, body).then((r) => r.data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['campaigns', bid] }) },
  })
}

export function useDeleteCampaign() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.campaigns.delete(bid, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', bid] }),
  })
}

// ── Channels ──────────────────────────────────────────────────────────────────
export function useChannels() {
  const bid = botId()
  return useQuery({
    queryKey: ['channels', bid],
    queryFn: withDemoFallback(() => api.channels.list(bid).then((r) => r.data), demo.DEMO_CHANNELS),
    staleTime: isDemoMode() ? Infinity : 30_000,
  })
}

export function useCreateChannel() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: async (body: { name: string; kind: string; environmentId: string; config?: Record<string, unknown> }) => {
      if (isDemoMode()) {
        const created: api.Channel = {
          id: `ch_demo_${body.kind}_${Date.now()}`,
          name: body.name,
          kind: body.kind,
          environmentId: body.environmentId,
          config: body.config ?? {},
          isActive: body.kind === 'web',
          botId: bid,
          createdAt: new Date().toISOString(),
        }
        return created
      }
      return api.channels.create(bid, body).then((r) => r.data)
    },
    onSuccess: (created) => {
      qc.setQueryData(['channels', bid], (prev: api.Channel[] | undefined) => [...(prev ?? []), created])
      if (!isDemoMode()) qc.invalidateQueries({ queryKey: ['channels', bid] })
    },
  })
}

export function useDeleteChannel() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: async (id: string) => {
      if (isDemoMode()) return
      return api.channels.delete(bid, id)
    },
    onSuccess: (_data, id) => {
      qc.setQueryData(['channels', bid], (prev: api.Channel[] | undefined) => (prev ?? []).filter((channel) => channel.id !== id))
      if (!isDemoMode()) qc.invalidateQueries({ queryKey: ['channels', bid] })
    },
  })
}

export function useUpdateChannel() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; name?: string; isActive?: boolean; config?: Record<string, unknown> }) => {
      if (isDemoMode()) return { data: { id, ...body } }
      return api.channels.update(bid, id, body)
    },
    onSuccess: (_data, vars) => {
      qc.setQueryData(['channels', bid], (prev: api.Channel[] | undefined) =>
        (prev ?? []).map((channel) => channel.id === vars.id ? { ...channel, ...vars } : channel),
      )
      if (!isDemoMode()) qc.invalidateQueries({ queryKey: ['channels', bid] })
    },
  })
}

export function useTemplates(channel?: string) {
  const bid = botId()
  return useQuery({
    queryKey: ['templates', bid, channel],
    queryFn: withDemoFallback(
      () => api.templates.list(bid, channel ? { channel } : undefined).then((r) => r.data),
      channel ? demo.DEMO_TEMPLATES.filter((t) => t.channel === channel) : demo.DEMO_TEMPLATES,
    ),
  })
}

export function useCreateTemplate() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (body: { name: string; channel: string; content: Record<string, unknown>; variables?: string[]; submitForReview?: boolean }) =>
      api.templates.create(bid, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates', bid] }),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.templates.delete(bid, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates', bid] }),
  })
}

export function useUpdateTemplate() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; channel?: string; content?: Record<string, unknown>; approvalStatus?: string }) =>
      api.templates.update(bid, id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates', bid] }),
  })
}

// ── Webhooks ──────────────────────────────────────────────────────────────────
export function useWebhooks() {
  return useQuery({
    queryKey: ['webhooks'],
    queryFn: withDemoFallback(() => api.webhooks.list().then((r) => r.data), demo.DEMO_WEBHOOKS),
  })
}

export function useCreateWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { url: string; events: string[]; secret?: string }) =>
      api.webhooks.create(body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  })
}

export function useDeleteWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.webhooks.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  })
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: (id: string) => api.webhooks.test(id).then((r) => r.data),
  })
}

// ── Team ──────────────────────────────────────────────────────────────────────
export function useTeamMembers() {
  return useQuery({
    queryKey: ['team'],
    queryFn: withDemoFallback(() => api.team.members().then((r) => r.data), demo.DEMO_TEAM),
  })
}

export function useInviteMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      api.team.invite(email, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  })
}

export function useUpdateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.team.updateRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  })
}

export function useRemoveMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.team.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  })
}

// ── Analytics ─────────────────────────────────────────────────────────────────
export function useAnalyticsOverview() {
  const bid = botId()
  return useQuery({
    queryKey: ['analytics-overview', bid],
    queryFn: withDemoFallback(() => api.analytics.overview(bid).then((r) => r.data), demo.DEMO_ANALYTICS_OVERVIEW),
    staleTime: 60_000,
  })
}

export function useConversationTrends(days = 7) {
  const bid = botId()
  return useQuery({
    queryKey: ['analytics-trends', bid, days],
    queryFn: withDemoFallback(() => api.analytics.conversations({ botId: bid, days: String(days) }).then((r) => r.data), demo.DEMO_CONVERSATION_TRENDS),
    staleTime: 60_000,
  })
}

export function useAnalyticsAgents(days = 30) {
  return useQuery({
    queryKey: ['analytics-agents', days],
    queryFn: () => api.analytics.agents({ days: String(days) }).then((r) => r.data),
    staleTime: 60_000,
  })
}

/** Scheduled test runs for a bot. Admins only; a 403 or 404 means there is nothing to show. */
export function useTestRuns(botId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['test-runs', botId],
    queryFn: () => api.testRuns.list(botId!).then((r) => r.data),
    enabled: Boolean(botId) && enabled,
    staleTime: 60_000,
    retry: (count, err) => !(err instanceof api.ApiError && [403, 404].includes(err.status)) && count < 2,
  })
}

export function useAnalyticsChannels() {
  return useQuery({
    queryKey: ['analytics-channels'],
    queryFn: () => api.analytics.channels().then((r) => r.data),
    staleTime: 60_000,
  })
}

export function useAnalyticsCsatTrend(days = 30) {
  return useQuery({
    queryKey: ['analytics-csat-trend', days],
    queryFn: () => api.analytics.csatTrend(days).then((r) => r.data),
    staleTime: 60_000,
  })
}

export function useAnalyticsResolutionBreakdown() {
  const bid = botId()
  return useQuery({
    queryKey: ['analytics-resolution-breakdown', bid],
    queryFn: () => api.analytics.resolutionBreakdown(bid).then((r) => r.data),
    staleTime: 60_000,
  })
}

export function useAnalyticsResponseTimeByHour() {
  return useQuery({
    queryKey: ['analytics-response-time-by-hour'],
    queryFn: () => api.analytics.responseTimeByHour().then((r) => r.data),
    staleTime: 60_000,
  })
}

export function useTrainingRuns() {
  const bid = botId()
  return useQuery({
    queryKey: ['training-runs', bid],
    queryFn: () => bid ? api.knowledge.training.runs(bid).then((r) => r.data) : Promise.resolve([]),
    staleTime: 30_000,
    enabled: !!bid,
  })
}

export function useCampaignDeliveries(campaignId: string) {
  const bid = botId()
  return useQuery({
    queryKey: ['campaign-deliveries', campaignId],
    queryFn: () => api.campaigns.deliveries(bid, campaignId).then((r) => r.data),
    enabled: !!campaignId,
    refetchInterval: 5000,
  })
}

// ── Audit ─────────────────────────────────────────────────────────────────────
export function useAuditLog(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['audit', params],
    queryFn: withDemoFallback(() => api.audit.list(params).then((r) => r.data), demo.DEMO_AUDIT),
  })
}

// ── System Status ─────────────────────────────────────────────────────────────
export function useSystemStatus(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['system-status'],
    queryFn: withDemoFallback(() => api.system.status().then((r) => r.data), demo.DEMO_SYSTEM_STATUS),
    staleTime: 0,
    refetchInterval: options?.refetchInterval,
  })
}

export function useSystemConfig() {
  return useQuery({
    queryKey: ['system-config'],
    queryFn: withDemoFallback(() => api.system.config().then((r) => r.data), demo.DEMO_SYSTEM_CONFIG),
    staleTime: 60_000,
  })
}

// ── Optimizations ─────────────────────────────────────────────────────────────
export function useOptimizations(botId: string, status?: string) {
  return useQuery({
    queryKey: ['optimizations', botId, status],
    queryFn: () => api.optimizations.list(botId, status).then((r) => r.data),
    enabled: !!botId,
    staleTime: 30_000,
  })
}

export function useApplyOptimization(botId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.optimizations.apply(botId, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['optimizations', botId] })
      void qc.invalidateQueries({ queryKey: ['llm-config', botId] })
    },
  })
}

export function useDismissOptimization(botId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.optimizations.dismiss(botId, id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['optimizations', botId] }) },
  })
}

// ── Inbox WebSocket ───────────────────────────────────────────────────────────

export type WsEvent =
  | { event: 'message.created'; data: api.Message }
  | { event: 'message.chunk'; data: { conversationId: string; chunk: string } }
  | { event: 'conversation.created'; data: { id: string; [key: string]: unknown } }
  | { event: 'conversation.updated'; data: { id: string; [key: string]: unknown } }

/**
 * Opens a single WebSocket connection to /ws for the current tenant.
 * Calls onEvent for every broadcast event. Reconnects automatically on close.
 * Returns a cleanup function.
 */
export function useInboxWS(onEvent: (e: WsEvent) => void, enabled = true) {
  const token = useAppStore((s) => s.token)
  const qc = useQueryClient()

  React.useEffect(() => {
    if (!enabled || !token || isDemoMode()) return
    let ws: WebSocket | null = null
    let dead = false
    let retryMs = 1000

    function connect() {
      if (dead) return
      try {
        ws = new WebSocket(api.buildWsUrl(token!))
        ws.onmessage = (ev) => {
          try {
            const parsed = JSON.parse(ev.data as string) as WsEvent & { type?: string }
            if (parsed.event) {
              onEvent(parsed)
              // Invalidate relevant queries so UI refreshes automatically
              if (parsed.event === 'message.created' || parsed.event === 'message.chunk') {
                const cid = (parsed.data as { conversationId?: string }).conversationId ?? (parsed.data as api.Message).id
                void qc.invalidateQueries({ queryKey: ['conversation', cid] })
              }
              if (parsed.event === 'conversation.created' || parsed.event === 'conversation.updated') {
                void qc.invalidateQueries({ queryKey: ['conversations'] })
              }
            }
          } catch { /* ignore parse errors */ }
        }
        ws.onopen = () => { retryMs = 1000 }
        ws.onclose = () => { if (!dead) { setTimeout(connect, retryMs); retryMs = Math.min(retryMs * 2, 30000) } }
        ws.onerror = () => { ws?.close() }
      } catch { /* ws unavailable in SSR or test env */ }
    }

    connect()
    return () => { dead = true; ws?.close() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, enabled])
}

// ── Tickets ───────────────────────────────────────────────────────────────────

export function useTickets(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['tickets', params],
    queryFn: () => api.tickets.list(params).then((r) => r.data),
  })
}

export function useCreateTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { subject: string; priority: string; description?: string; conversationId?: string; assignedTo?: string }) =>
      api.tickets.create(body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  })
}

export function useUpdateTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; status?: string; priority?: string; assignedTo?: string | null }) =>
      api.tickets.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  })
}

// ── Agent status ──────────────────────────────────────────────────────────────

export function useAgentStatus() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.me.get().then((r) => r.data.status ?? 'offline'),
  })
}

export function useUpdateAgentStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (status: 'online' | 'away' | 'offline') => api.me.update({ status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}

// ── Workflows ─────────────────────────────────────────────────────────────────

export function useWorkflows(status?: string) {
  const bid = botId()
  return useQuery({
    queryKey: ['workflows', bid, status],
    queryFn: () => api.workflows.list(bid, status ? { status } : undefined).then((r) => r.data),
    enabled: !!bid && bid !== 'demo',
  })
}

export function useCreateWorkflow() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (body: { name: string; description?: string; trigger: string; conditions?: string; actions?: string[]; status?: string }) =>
      api.workflows.create(bid, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows', bid] }),
  })
}

export function useUpdateWorkflow() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; description?: string; trigger?: string; conditions?: string; actions?: string[]; status?: string }) =>
      api.workflows.update(bid, id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows', bid] }),
  })
}

export function useToggleWorkflow() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.workflows.toggle(bid, id).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows', bid] }),
  })
}

export function useDeleteWorkflow() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.workflows.delete(bid, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows', bid] }),
  })
}

// ── Safety ──────────────────────────────────────────────────────────────────

export function useSafety() {
  const bid = botId()
  return useQuery({
    queryKey: ['safety', bid],
    queryFn: () => api.safety.get(bid).then((r) => r.data),
    enabled: !!bid && bid !== 'demo',
  })
}

export function useSavePrivacy() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (body: Parameters<typeof api.safety.savePrivacy>[1]) => api.safety.savePrivacy(bid, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['safety', bid] }),
  })
}

export function useSavePolicy() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: { name: string; rules: GuardrailRule[] } }) =>
      (id ? api.safety.savePolicy(bid, id, body) : api.safety.createPolicy(bid, body)).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['safety', bid] }),
  })
}

export function usePolicyAction() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' | 'delete' }) =>
      (action === 'activate' ? api.safety.activate(bid, id) : action === 'deactivate' ? api.safety.deactivate(bid, id) : api.safety.deletePolicy(bid, id)).then(() => undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['safety', bid] }),
  })
}

export function useSafetyTest() {
  const bid = botId()
  return useMutation({
    mutationFn: (body: Parameters<typeof api.safety.test>[1]) => api.safety.test(bid, body).then((r) => r.data),
  })
}

// ── Evals, releases, export/import ──────────────────────────────────────────

export function useEvalSuites() {
  const bid = botId()
  return useQuery({
    queryKey: ['evals', bid],
    queryFn: () => api.evals.list(bid).then((r) => r.data),
    enabled: !!bid && bid !== 'demo',
  })
}

export function useSaveEvalSuite() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Parameters<typeof api.evals.create>[1] }) =>
      (id ? api.evals.save(bid, id, body) : api.evals.create(bid, body)).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['evals', bid] })
      void qc.invalidateQueries({ queryKey: ['releases', bid] })
    },
  })
}

export function useDeleteEvalSuite() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.evals.delete(bid, id).then(() => undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['evals', bid] })
      void qc.invalidateQueries({ queryKey: ['releases', bid] })
    },
  })
}

export function useRunEvalSuite() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.evals.run(bid, id).then((r) => r.data),
    onSuccess: (_run, id) => {
      void qc.invalidateQueries({ queryKey: ['evals', bid] })
      void qc.invalidateQueries({ queryKey: ['eval-runs', bid, id] })
    },
  })
}

export function useEvalRuns(suiteId: string | null) {
  const bid = botId()
  return useQuery({
    queryKey: ['eval-runs', bid, suiteId],
    queryFn: () => api.evals.runs(bid, suiteId!).then((r) => r.data),
    enabled: !!bid && bid !== 'demo' && !!suiteId,
  })
}

export function useReleases() {
  const bid = botId()
  return useQuery({
    queryKey: ['releases', bid],
    queryFn: () => api.releases.list(bid).then((r) => r.data),
    enabled: !!bid && bid !== 'demo',
  })
}

export function usePublishRelease() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (note?: string) => api.releases.publish(bid, note).then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['releases', bid] })
      void qc.invalidateQueries({ queryKey: ['flows', bid] })
      void qc.invalidateQueries({ queryKey: ['evals', bid] })
    },
  })
}

export function useRollback() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.releases.rollback(bid, id).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['releases', bid] }),
  })
}

export function useImportBundle() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (body: Parameters<typeof api.bundle.import>[1]) => api.bundle.import(bid, body).then((r) => r.data),
    onSuccess: (plan) => {
      if (!plan.applied) return
      for (const key of ['flows', 'tools', 'safety', 'evals', 'releases']) void qc.invalidateQueries({ queryKey: [key, bid] })
    },
  })
}

// ── Tools and Auth Profiles ─────────────────────────────────────────────────

export function useTools() {
  const bid = botId()
  return useQuery({
    queryKey: ['tools', bid],
    queryFn: () => api.tools.list(bid).then((r) => r.data),
    enabled: !!bid && bid !== 'demo',
  })
}

export function useSaveTool() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: api.ToolInput }) =>
      (id ? api.tools.update(bid, id, body) : api.tools.create(bid, body)).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', bid] }),
  })
}

export function useDeleteTool() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.tools.delete(bid, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', bid] }),
  })
}

export function useTestTool() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: ({ id, args }: { id: string; args: Record<string, unknown> }) => api.tools.test(bid, id, args).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['tool-runs', bid, vars.id] })
      qc.invalidateQueries({ queryKey: ['tools', bid] })
    },
  })
}

export function useToolRuns(id: string | undefined) {
  const bid = botId()
  return useQuery({
    queryKey: ['tool-runs', bid, id],
    queryFn: () => api.tools.runs(bid, id!).then((r) => r.data),
    enabled: !!bid && bid !== 'demo' && !!id,
  })
}

export function useRefreshTool() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.tools.refresh(bid, id).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', bid] }),
  })
}

export function useMcpDiscover() {
  const bid = botId()
  return useMutation({
    mutationFn: (body: { serverUrl: string; authProfileId?: string | null }) => api.tools.mcpDiscover(bid, body).then((r) => r.data),
  })
}

export function useMcpImport() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (body: { serverUrl: string; authProfileId?: string | null; toolNames: string[]; effect: api.ToolInput['effect'] }) =>
      api.tools.mcpImport(bid, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', bid] }),
  })
}

export function useAuthProfiles() {
  return useQuery({
    queryKey: ['auth-profiles'],
    queryFn: () => api.authProfiles.list().then((r) => r.data),
  })
}

export function useSaveAuthProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: api.AuthProfileInput }) =>
      (id ? api.authProfiles.update(id, body) : api.authProfiles.create(body)).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth-profiles'] }),
  })
}

export function useDeleteAuthProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.authProfiles.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth-profiles'] }),
  })
}

export function useInboxTools(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['inbox-tools', conversationId],
    queryFn: () => api.inboxTools.list(conversationId!).then((r) => r.data),
    enabled: !!conversationId,
  })
}

export function useRunInboxTool() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ conversationId, toolId, args, confirmed }: { conversationId: string; toolId: string; args: Record<string, unknown>; confirmed: boolean }) =>
      api.inboxTools.run(conversationId, toolId, args, confirmed).then((r) => r.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['conversation', v.conversationId] })
    },
  })
}

// ── Dashboards ────────────────────────────────────────────────────────────────

export function useDashboards() {
  const bid = botId()
  return useQuery({
    queryKey: ['dashboards', bid],
    queryFn: () => api.dashboards.list(bid).then((r) => r.data),
    enabled: !!bid && bid !== 'demo',
  })
}

export function useCreateDashboard() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (body: { name: string; layout?: unknown[] }) =>
      api.dashboards.create(bid, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards', bid] }),
  })
}

export function useDeleteDashboard() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.dashboards.delete(bid, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards', bid] }),
  })
}

export function useCannedReplies() {
  return useQuery({
    queryKey: ['canned-replies'],
    queryFn: () => api.cannedReplies.list().then((r) => r.data),
  })
}

export function useCreateCannedReply() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { shortcut: string; title: string; text: string }) => api.cannedReplies.create(body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['canned-replies'] }),
  })
}

export function useDeleteCannedReply() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.cannedReplies.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['canned-replies'] }),
  })
}

export function useLabels() {
  return useQuery({
    queryKey: ['labels'],
    queryFn: () => api.team.labels().then((r) => r.data),
  })
}

export function useCreateLabel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.team.createLabel(name).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['labels'] }),
  })
}

export function useReports() {
  const bid = botId()
  return useQuery({
    queryKey: ['reports', bid],
    queryFn: () => api.reports.list(bid).then((r) => r.data),
    enabled: !!bid && bid !== 'demo',
  })
}

export function useCreateReport() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (body: { name: string; type?: string; format?: string; frequency?: string }) =>
      api.reports.create(bid, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', bid] }),
  })
}

export function useRunReport() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.reports.run(bid, id).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', bid] }),
  })
}

export function useDeleteReport() {
  const qc = useQueryClient()
  const bid = botId()
  return useMutation({
    mutationFn: (id: string) => api.reports.remove(bid, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', bid] }),
  })
}

export function useDataTables() {
  return useQuery({
    queryKey: ['data-tables'],
    queryFn: () => api.database.tables().then((r) => r.data),
  })
}

export function useCreateDataTable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.database.createTable(name).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data-tables'] }),
  })
}

export function useDataRecords(tableId: string) {
  return useQuery({
    queryKey: ['data-records', tableId],
    queryFn: () => api.database.records(tableId).then((r) => r.data),
    enabled: !!tableId,
  })
}

export function useAddDataRecord(tableId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, string>) => api.database.addRecord(tableId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data-records', tableId] })
      qc.invalidateQueries({ queryKey: ['data-tables'] })
    },
  })
}

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.integrations.list().then((r) => r.data),
  })
}

export function useConnectIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ provider, secret, settings }: { provider: string; secret?: string; settings?: Record<string, string> }) =>
      api.integrations.connect(provider, { secret, settings }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['auth-profiles'] })
    },
  })
}

export function useInstallConnectorTools() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (provider: string) => api.integrations.install(provider, botId()).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools'] }),
  })
}

export function useDisconnectIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (provider: string) => api.integrations.disconnect(provider).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['auth-profiles'] })
      qc.invalidateQueries({ queryKey: ['tools'] })
    },
  })
}

// ── Business details ────────────────────────────────────────────────────────

export function useBusiness() {
  const bid = botId()
  return useQuery({
    queryKey: ['business', bid],
    queryFn: () => api.business.get(bid).then((r) => r.data),
    enabled: !!bid && bid !== 'demo',
  })
}

export function useSaveBusiness() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (profile: BusinessProfile) => api.business.save(botId(), profile).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business'] })
      qc.invalidateQueries({ queryKey: ['evals'] })
      qc.invalidateQueries({ queryKey: ['sources'] })
    },
  })
}

export function useRereadBusiness() {
  return useMutation({
    mutationFn: (url?: string) => api.business.reread(botId(), url).then((r) => r.data),
  })
}

export function useAcceptBusiness() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fresh, keys }: { fresh: BusinessProfile; keys: string[] }) => api.business.accept(botId(), fresh, keys).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business'] })
      qc.invalidateQueries({ queryKey: ['evals'] })
      qc.invalidateQueries({ queryKey: ['sources'] })
    },
  })
}

// ── Contact memory ──────────────────────────────────────────────────────────

export function useMemorySettings() {
  const bid = botId()
  return useQuery({
    queryKey: ['memory', bid],
    queryFn: () => api.memory.get(bid).then((r) => r.data),
    enabled: !!bid && bid !== 'demo',
  })
}

export function useSaveMemorySettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: api.MemoryView['settings']) => api.memory.save(botId(), body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memory'] }),
  })
}

export function useContactMemory(contactId: string | null | undefined) {
  return useQuery({
    queryKey: ['contact-memory', contactId],
    queryFn: () => api.memory.contact(contactId!).then((r) => r.data),
    enabled: !!contactId,
  })
}

export function useChatMemory(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: ['chat-memory', conversationId],
    queryFn: () => api.memory.conversation(conversationId!).then((r) => r.data),
    enabled: !!conversationId,
    refetchInterval: 20_000,
  })
}

export function useForgetMemory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ contactId, key }: { contactId: string; key?: string }) =>
      key ? api.memory.forget(contactId, key).then(() => ({ forgotten: 1 })) : api.memory.forgetAll(contactId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-memory'] })
      qc.invalidateQueries({ queryKey: ['chat-memory'] })
      qc.invalidateQueries({ queryKey: ['memory'] })
    },
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (displayName: string) => api.me.update({ displayName }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}
