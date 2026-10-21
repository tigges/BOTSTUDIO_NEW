import type {
  AuthProfileKind, BlueprintFieldSpec, BusinessProfile, EvalScenario, FieldChange, ProfileIssue, EvalScenarioResult, GuardrailDecision, GuardrailHit, GuardrailRule, HandoverContract, PrivacyReader, PrivacySettings,
  ReleaseDiff, ReturnOutcome, ToolEffect, ToolKind, ToolParameter, ToolReturns,
} from '@ybot/shared'
import { messageForStatus } from './api-error'

const BASE = import.meta.env.VITE_API_URL ?? '/api/v1'

function getToken(): string | null {
  try {
    const raw = localStorage.getItem('ybot-app')
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: { token?: string } }
    return parsed?.state?.token ?? null
  } catch {
    return null
  }
}

export class ApiError extends Error {
  constructor(public status: number, public body?: { code?: string; message?: string; [detail: string]: unknown }) {
    super(messageForStatus(status, body))
    this.name = 'ApiError'
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers = new Headers(init?.headers)
  if (typeof init?.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })
  const json = (await res.json().catch(() => ({}))) as T
  if (!res.ok) {
    const error = (json as { error?: { code?: string; message?: string } }).error
    throw new ApiError(res.status, error)
  }
  return json
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const auth = {
  login: (email: string, password: string) =>
    apiFetch<{ data: { token: string; user: { id: string; email: string; displayName: string; tenantId: string } } }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (body: { email: string; password: string; displayName: string; tenantName: string; tenantSlug: string }) =>
    apiFetch<{ data: { token: string; user: unknown } }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  forgotPassword: (email: string) =>
    apiFetch<{ data: { message: string } }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    apiFetch<{ data: { message: string } }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  acceptInvite: (token: string, password: string, displayName?: string) =>
    apiFetch<{ data: { token: string; user: { id: string; email: string; displayName: string; tenantId: string; role: string } } }>('/auth/accept-invite', { method: 'POST', body: JSON.stringify({ token, password, displayName }) }),
}

// ── Me ────────────────────────────────────────────────────────────────────────
export const me = {
  get: () => apiFetch<{ data: { id: string; email: string; displayName: string; status?: string } }>('/me'),
  update: (body: { displayName?: string; email?: string; status?: string }) =>
    apiFetch<{ data: unknown }>('/me', { method: 'PATCH', body: JSON.stringify(body) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ data: unknown }>('/me/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
}

// ── Bots ──────────────────────────────────────────────────────────────────────
export const bots = {
  list: () => apiFetch<{ data: BotSummary[] }>('/bots'),
  get: (id: string) => apiFetch<{ data: BotSummary }>(`/bots/${id}`),
  create: (body: {
    name: string
    description?: string
    personaName?: string
    start: string
    sample?: string
    websiteUrl?: string
    templateId?: string
    channels?: string[]
  }) =>
    apiFetch<{ data: BotSummary }>('/bots', { method: 'POST', body: JSON.stringify(body) }),
  scanWebsite: (body: { url: string; personaName?: string; companyName?: string }) =>
    apiFetch<{ data: WebsiteScanPreview }>('/bots/scan', { method: 'POST', body: JSON.stringify(body) }),
  startCatalog: () =>
    apiFetch<{ data: { clusters: Array<{ id: string; title: string; body: string }>; templates: Array<{ id: string; templateId?: string; clusterId: string; title: string; body: string; tag: string; persona?: string; accent?: string; role?: string; source?: { host: string; note: string } }> } }>('/bots/start-catalog'),
  previewSiteTemplate: (body: { url: string; personaName?: string; companyName?: string; clusterId?: string }) =>
    apiFetch<{ data: LearnedSiteTemplate }>('/bots/start-templates/preview', { method: 'POST', body: JSON.stringify(body) }),
  saveSiteTemplate: (body: { url: string; personaName?: string; companyName?: string; clusterId?: string }) =>
    apiFetch<{ data: LearnedSiteTemplate & { id: string } }>('/bots/start-templates', { method: 'POST', body: JSON.stringify(body) }),
  deleteSiteTemplate: (id: string) =>
    apiFetch<{ data: { id: string } }>(`/bots/start-templates/${id}`, { method: 'DELETE' }),
  update: (id: string, body: Partial<{ name: string; personaName: string | null; description: string | null; avatarUrl: string | null }>) =>
    apiFetch<{ data: BotSummary }>(`/bots/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id: string) => apiFetch<void>(`/bots/${id}`, { method: 'DELETE' }),
  renameEnvironment: (botId: string, environmentId: string, name: string) =>
    apiFetch<{ data: { id: string; name: string; kind: string } }>(`/bots/${botId}/environments/${environmentId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteEnvironment: (botId: string, environmentId: string) =>
    apiFetch<void>(`/bots/${botId}/environments/${environmentId}`, { method: 'DELETE' }),
  importCorporatePack: (botId: string) =>
    apiFetch<{ data: CorporatePackResult }>(`/bots/${botId}/packs/corporate-services`, { method: 'POST', body: '{}' }),
  importHairStudioPack: (botId: string) =>
    apiFetch<{ data: CorporatePackResult }>(`/bots/${botId}/packs/hair-studio`, { method: 'POST', body: '{}' }),
  removePack: (botId: string, pack: 'corporate-services' | 'hair-studio') =>
    apiFetch<{ data: PackRemovalResult }>(`/bots/${botId}/packs/${pack}`, { method: 'DELETE' }),
}

// ── Flows ─────────────────────────────────────────────────────────────────────
export const flows = {
  list: (botId: string) => apiFetch<{ data: Flow[] }>(`/bots/${botId}/flows`),
  get: (botId: string, flowId: string) => apiFetch<{ data: Flow }>(`/bots/${botId}/flows/${flowId}`),
  create: (botId: string, body: { name: string; description?: string; kind?: string; tags?: string[]; graph?: FlowGraph }) =>
    apiFetch<{ data: Flow }>(`/bots/${botId}/flows`, { method: 'POST', body: JSON.stringify(body) }),
  update: (botId: string, flowId: string, body: Partial<{ name: string; description: string; tags: string[] }>) =>
    apiFetch<{ data: unknown }>(`/bots/${botId}/flows/${flowId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (botId: string, flowId: string) =>
    apiFetch<void>(`/bots/${botId}/flows/${flowId}`, { method: 'DELETE' }),
  getCanvas: (botId: string, flowId: string, version: number) =>
    apiFetch<{ data: FlowVersion }>(`/bots/${botId}/flows/${flowId}/versions/${version}/canvas`),
  saveCanvas: (botId: string, flowId: string, version: number, graph: FlowGraph) =>
    apiFetch<{ data: FlowVersion & { forked: boolean } }>(`/bots/${botId}/flows/${flowId}/versions/${version}/canvas`, { method: 'PUT', body: JSON.stringify({ graph }) }),
  publish: (botId: string, flowId: string, environmentId: string, version?: number) =>
    apiFetch<{ data: FlowVersion }>(`/bots/${botId}/flows/${flowId}/publish`, { method: 'POST', body: JSON.stringify({ environmentId, ...(version ? { version } : {}) }) }),
  traffic: (botId: string, environmentId?: string, includeTestRuns = true) => {
    const query = new URLSearchParams({ ...(environmentId ? { environmentId } : {}), ...(includeTestRuns ? {} : { testRuns: 'exclude' }) }).toString()
    return apiFetch<{ data: JourneyTraffic }>(`/bots/${botId}/journey-traffic${query ? `?${query}` : ''}`)
  },
}

export interface ChapterOutcome {
  chats: number
  bot: number
  person: number
  open: number
}

export interface JourneyTraffic {
  days: number
  chats: Record<string, number>
  outcomes?: Record<string, ChapterOutcome>
  total?: ChapterOutcome
  /** Chats that started a chapter, per environment id. */
  byEnvironment?: Record<string, number>
  /** Chats opened in the window that never started a chapter. */
  unstarted?: number
  /** Scheduled test-run chats among the counted chats. */
  testRuns?: number
}

export interface LearnedSiteDoor {
  title: string
  flowName: string
  blurb: string
}

export interface LearnedSiteTemplate {
  id?: string
  clusterId: string
  title: string
  body: string
  welcomeName: string
  packTag: string
  greeting: string
  followUp: string
  menu: string
  topics: Array<{ flowName: string; choice: string; phrases: string[]; question: string; answer: string; blurb: string }>
  sourceUrl: string
  sourceHost: string
}

export interface WebsiteScanPreview {
  url: string
  pages: string[]
  greeting: string
  doors: Array<{ title: string; flowName: string; blurb: string; found: boolean }>
  facts: Array<{ label: string; text: string }>
  note: string
  drafted?: { by: 'model' | 'pages'; why: string }
  catalog?: { facts: Array<{ id: string; kind: string; title: string; phrases: string[]; fact: string; source?: string }> }
  chapters?: Array<{ name: string; graph: FlowGraph }>
}

export interface LearnCard {
  flowId: string
  version: number
  phrase: string
  sentence: string
  fromLabel: string
  keeps: string
  preview: Array<{ role: 'visitor' | 'bot'; text: string }>
}

export interface LearnSnapshot {
  week: { finished: number; helpful: number; notHelpful: number }
  suggestion: LearnCard | null
  note: string | null
}

export const learn = {
  summary: (botId: string, environmentId: string) =>
    apiFetch<{ data: LearnSnapshot }>(`/bots/${botId}/learn?environmentId=${encodeURIComponent(environmentId)}`),
  samples: (botId: string, environmentId: string, text: string) =>
    apiFetch<{ data: LearnSnapshot }>(`/bots/${botId}/learn/samples`, { method: 'POST', body: JSON.stringify({ environmentId, text }) }),
  rated: (botId: string, environmentId: string) =>
    apiFetch<{ data: LearnSnapshot }>(`/bots/${botId}/learn/rated`, { method: 'POST', body: JSON.stringify({ environmentId }) }),
  publish: (botId: string, flowId: string, environmentId: string) =>
    apiFetch<{ data: { welcomeUpdated: boolean } }>(`/bots/${botId}/learn/publish`, { method: 'POST', body: JSON.stringify({ flowId, environmentId }) }),
  dismiss: (botId: string, flowId: string) =>
    apiFetch<void>(`/bots/${botId}/learn/dismiss`, { method: 'POST', body: JSON.stringify({ flowId }) }),
}

// ── Knowledge ─────────────────────────────────────────────────────────────────
export const knowledge = {
  intents: {
    list: (botId: string) => apiFetch<{ data: Intent[] }>(`/bots/${botId}/intents`),
    create: (botId: string, body: Partial<Intent>) => apiFetch<{ data: Intent }>(`/bots/${botId}/intents`, { method: 'POST', body: JSON.stringify(body) }),
    update: (botId: string, id: string, body: Partial<Intent>) => apiFetch<{ data: unknown }>(`/bots/${botId}/intents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (botId: string, id: string) => apiFetch<void>(`/bots/${botId}/intents/${id}`, { method: 'DELETE' }),
  },
  entities: {
    list: (botId: string) => apiFetch<{ data: Entity[] }>(`/bots/${botId}/entities`),
    create: (botId: string, body: Partial<Entity>) => apiFetch<{ data: Entity }>(`/bots/${botId}/entities`, { method: 'POST', body: JSON.stringify(body) }),
    update: (botId: string, id: string, body: Partial<Entity>) => apiFetch<{ data: unknown }>(`/bots/${botId}/entities/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (botId: string, id: string) => apiFetch<void>(`/bots/${botId}/entities/${id}`, { method: 'DELETE' }),
  },
  faqs: {
    list: (botId: string) => apiFetch<{ data: Faq[] }>(`/bots/${botId}/faqs`),
    create: (botId: string, body: Partial<Faq>) => apiFetch<{ data: Faq }>(`/bots/${botId}/faqs`, { method: 'POST', body: JSON.stringify(body) }),
    update: (botId: string, id: string, body: Partial<Faq>) => apiFetch<{ data: unknown }>(`/bots/${botId}/faqs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (botId: string, id: string) => apiFetch<void>(`/bots/${botId}/faqs/${id}`, { method: 'DELETE' }),
  },
  sources: {
    list: (botId: string) => apiFetch<{ data: KnowledgeSource[] }>(`/bots/${botId}/sources`),
    create: (botId: string, body: { name: string; kind: string; config: Record<string, unknown> }) =>
      apiFetch<{ data: KnowledgeSource }>(`/bots/${botId}/sources`, { method: 'POST', body: JSON.stringify(body) }),
    upload: async (botId: string, file: File): Promise<{ data: KnowledgeSource }> => {
      const token = getToken()
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${BASE}/bots/${botId}/sources/upload`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: 'UNKNOWN', message: `HTTP ${res.status}` }))
        throw new ApiError(res.status, body?.error ?? body)
      }
      return res.json()
    },
    sync: (botId: string, id: string) => apiFetch<{ data: { queued: boolean } }>(`/bots/${botId}/sources/${id}/sync`, { method: 'POST' }),
    delete: (botId: string, id: string) => apiFetch<void>(`/bots/${botId}/sources/${id}`, { method: 'DELETE' }),
  },
  training: {
    get: (botId: string) => apiFetch<{ data: LlmConfig }>(`/bots/${botId}/training`),
    update: (botId: string, config: Partial<LlmConfig>) => apiFetch<{ data: LlmConfig }>(`/bots/${botId}/training`, { method: 'PUT', body: JSON.stringify(config) }),
    runs: (botId: string) => apiFetch<{ data: TrainingRun[] }>(`/bots/${botId}/training-runs`),
  },
  inboxConfig: {
    get: (botId: string) => apiFetch<{ data: Record<string, unknown> }>(`/bots/${botId}/inbox-config`),
    update: (botId: string, config: Record<string, unknown>) => apiFetch<{ data: Record<string, unknown> }>(`/bots/${botId}/inbox-config`, { method: 'PATCH', body: JSON.stringify(config) }),
  },
}

// ── Conversations ─────────────────────────────────────────────────────────────
export const conversations = {
  list: (params?: Record<string, string>) => apiFetch<{ data: Conversation[] }>(`/conversations?${new URLSearchParams(params ?? {})}`),
  get: (id: string) => apiFetch<{ data: Conversation }>(`/conversations/${id}`),
  create: (body: { botId: string; channelId?: string; contactId?: string; environmentId?: string; message?: string }) =>
    apiFetch<{ data: Conversation }>('/conversations', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: { status?: string; assignedTo?: string | null }) =>
    apiFetch<{ data: unknown }>(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  handBack: (id: string, body: { outcome: ReturnOutcome; note?: string }) =>
    apiFetch<{ data: { handover: Partial<HandoverContract>; ticketId?: string } }>(`/conversations/${id}/return`, { method: 'POST', body: JSON.stringify(body) }),
  messages: {
    list: (id: string) => apiFetch<{ data: Message[] }>(`/conversations/${id}/messages`),
    send: (id: string, content: { text: string }, authorKind = 'agent', isInternalNote = false) =>
      apiFetch<{ data: Message }>(`/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ content, authorKind, isInternalNote }) }),
  },
  labels: {
    add: (id: string, labelId: string) => apiFetch<{ data: unknown }>(`/conversations/${id}/labels`, { method: 'POST', body: JSON.stringify({ labelId }) }),
    remove: (id: string, labelId: string) => apiFetch<void>(`/conversations/${id}/labels/${labelId}`, { method: 'DELETE' }),
  },
}

// ── Tickets ───────────────────────────────────────────────────────────────────
export const tickets = {
  list: (params?: Record<string, string>) => apiFetch<{ data: Ticket[] }>(`/tickets?${new URLSearchParams(params ?? {})}`),
  create: (body: { conversationId?: string; subject: string; description?: string; priority?: string; assignedTo?: string; tags?: string[] }) =>
    apiFetch<{ data: Ticket }>('/tickets', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<{ status: string; priority: string; assignedTo: string | null; tags: string[] }>) =>
    apiFetch<{ data: unknown }>(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
}

// ── Contacts ──────────────────────────────────────────────────────────────────
export const contacts = {
  list: (params?: Record<string, string>) => apiFetch<{ data: Contact[] }>(`/contacts?${new URLSearchParams(params ?? {})}`),
  create: (body: { displayName: string; email?: string; phone?: string; metadata?: Record<string, unknown> }) =>
    apiFetch<{ data: Contact }>('/contacts', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<Contact>) => apiFetch<{ data: unknown }>(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id: string) => apiFetch<void>(`/contacts/${id}`, { method: 'DELETE' }),
  exportCsv: async () => {
    const token = getToken()
    const res = await fetch(`${BASE}/contacts/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' })
    if (!res.ok) throw new ApiError(res.status, { code: 'EXPORT_FAILED', message: 'Could not export contacts' })
    return res.text()
  },
  importRows: (contacts: Array<{ displayName: string; email?: string; phone?: string }>) =>
    apiFetch<{ data: { created: number } }>('/contacts/import', { method: 'POST', body: JSON.stringify({ contacts }) }),
}

// ── Campaigns + Templates ──────────────────────────────────────────────────────
export const campaigns = {
  list: (botId: string) => apiFetch<{ data: Campaign[] }>(`/bots/${botId}/campaigns`),
  audienceCount: (botId: string, params: { hasEmail?: boolean; hasPhone?: boolean; channel?: string; tags?: string[] }) => {
    const q = new URLSearchParams()
    if (params.hasEmail) q.set('hasEmail', 'true')
    if (params.hasPhone) q.set('hasPhone', 'true')
    if (params.channel) q.set('channel', params.channel)
    if (params.tags?.length) q.set('tags', params.tags.join(','))
    return apiFetch<{ data: { count: number } }>(`/bots/${botId}/campaigns/audience-count?${q}`)
  },
  create: (botId: string, body: { name: string; direction?: string; channel?: string; status?: 'draft' | 'running'; scheduledAt?: string; subject?: string; body?: string; filters?: { hasEmail?: boolean; hasPhone?: boolean; channel?: string; tags?: string[] } }) =>
    apiFetch<{ data: Campaign }>(`/bots/${botId}/campaigns`, { method: 'POST', body: JSON.stringify(body) }),
  launch: (botId: string, id: string) =>
    apiFetch<{ data: { ok: boolean; status: string } }>(`/bots/${botId}/campaigns/${id}/launch`, { method: 'POST' }),
  pause: (botId: string, id: string) =>
    apiFetch<{ data: { ok: boolean; status: string } }>(`/bots/${botId}/campaigns/${id}/pause`, { method: 'POST' }),
  update: (botId: string, id: string, body: Partial<{ name: string; status: string; scheduledAt: string; subject: string; body: string; filters: { hasEmail?: boolean; hasPhone?: boolean; channel?: string; tags?: string[] } }>) =>
    apiFetch<{ data: unknown }>(`/bots/${botId}/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (botId: string, id: string) =>
    apiFetch<void>(`/bots/${botId}/campaigns/${id}`, { method: 'DELETE' }),
  deliveries: (botId: string, id: string) =>
    apiFetch<{ data: CampaignDelivery[] }>(`/bots/${botId}/campaigns/${id}/deliveries`),
}

// ── Channels ─────────────────────────────────────────────────────────────────
export const channels = {
  list: (botId: string) => apiFetch<{ data: Channel[] }>(`/bots/${botId}/channels`),
  create: (botId: string, body: { name: string; kind: string; environmentId: string; config?: Record<string, unknown> }) =>
    apiFetch<{ data: Channel }>(`/bots/${botId}/channels`, { method: 'POST', body: JSON.stringify(body) }),
  update: (botId: string, id: string, body: Partial<{ name: string; config: Record<string, unknown>; isActive: boolean }>) =>
    apiFetch<{ data: unknown }>(`/bots/${botId}/channels/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (botId: string, id: string) =>
    apiFetch<void>(`/bots/${botId}/channels/${id}`, { method: 'DELETE' }),
}
export const templates = {
  list: (botId: string, params?: Record<string, string>) => apiFetch<{ data: Template[] }>(`/bots/${botId}/templates?${new URLSearchParams(params ?? {})}`),
  create: (botId: string, body: { name: string; channel: string; content: Record<string, unknown>; variables?: string[]; submitForReview?: boolean }) =>
    apiFetch<{ data: Template }>(`/bots/${botId}/templates`, { method: 'POST', body: JSON.stringify(body) }),
  update: (botId: string, id: string, body: Partial<{ name: string; channel: string; content: Record<string, unknown>; variables: string[]; approvalStatus: string }>) =>
    apiFetch<{ data: unknown }>(`/bots/${botId}/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (botId: string, id: string) =>
    apiFetch<void>(`/bots/${botId}/templates/${id}`, { method: 'DELETE' }),
}

// ── Config ────────────────────────────────────────────────────────────────────
export const webhooks = {
  list: () => apiFetch<{ data: Webhook[] }>('/webhooks'),
  create: (body: { url: string; events: string[]; secret?: string }) =>
    apiFetch<{ data: Webhook }>('/webhooks', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: { isActive?: boolean; events?: string[]; url?: string }) =>
    apiFetch<{ data: unknown }>(`/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id: string) => apiFetch<void>(`/webhooks/${id}`, { method: 'DELETE' }),
  test: (id: string) => apiFetch<{ data: { delivered: boolean; statusCode: number; durationMs: number; error?: string } }>(`/webhooks/${id}/test`, { method: 'POST' }),
  probe: (url: string) => apiFetch<{ data: { delivered: boolean; statusCode: number; durationMs: number; error?: string } }>('/webhooks/probe', { method: 'POST', body: JSON.stringify({ url }) }),
  deliveries: (id: string) => apiFetch<{ data: WebhookDelivery[] }>(`/webhooks/${id}/deliveries`),
}

export const cannedReplies = {
  list: () => apiFetch<{ data: CannedReply[] }>('/canned-replies'),
  create: (body: { shortcut: string; title: string; text: string }) =>
    apiFetch<{ data: CannedReply }>('/canned-replies', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<{ shortcut: string; title: string; text: string }>) =>
    apiFetch<{ data: unknown }>(`/canned-replies/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id: string) => apiFetch<void>(`/canned-replies/${id}`, { method: 'DELETE' }),
}

export const reports = {
  list: (botId: string) => apiFetch<{ data: SavedReport[] }>(`/bots/${botId}/reports`),
  create: (botId: string, body: { name: string; type?: string; format?: string; frequency?: string; recipients?: string[] }) =>
    apiFetch<{ data: SavedReport }>(`/bots/${botId}/reports`, { method: 'POST', body: JSON.stringify(body) }),
  run: (botId: string, id: string) => apiFetch<{ data: SavedReport }>(`/bots/${botId}/reports/${id}/run`, { method: 'POST' }),
  remove: (botId: string, id: string) => apiFetch<void>(`/bots/${botId}/reports/${id}`, { method: 'DELETE' }),
}

export const database = {
  tables: () => apiFetch<{ data: DataTable[] }>('/database/tables'),
  createTable: (name: string) => apiFetch<{ data: DataTable }>('/database/tables', { method: 'POST', body: JSON.stringify({ name }) }),
  records: (id: string) => apiFetch<{ data: Array<Record<string, string>> }>(`/database/tables/${id}/records`),
  addRecord: (id: string, data: Record<string, string>) =>
    apiFetch<{ data: Record<string, string> }>(`/database/tables/${id}/records`, { method: 'POST', body: JSON.stringify({ data }) }),
  deleteTable: (id: string) => apiFetch<void>(`/database/tables/${id}`, { method: 'DELETE' }),
}

export const integrations = {
  list: () => apiFetch<{ data: IntegrationConnection[] }>('/integrations'),
  connect: (provider: string, body: { secret?: string; settings?: Record<string, string> }) =>
    apiFetch<{ data: { provider: string; status: string; authProfile: { id: string; name: string; secretHint: string | null } } }>(`/integrations/${provider}/connect`, { method: 'POST', body: JSON.stringify(body) }),
  install: (provider: string, botId: string) =>
    apiFetch<{ data: { created: Array<{ id: string; name: string }>; skipped: string[] } }>(`/integrations/${provider}/install`, { method: 'POST', body: JSON.stringify({ botId }) }),
  disconnect: (provider: string) => apiFetch<{ data: { toolsLeft: number } }>(`/integrations/${provider}`, { method: 'DELETE' }),
}

export interface MemoryFact {
  key: string
  value: string
  botId: string | null
  botName: string | null
  conversationId: string | null
  updatedAt: string
  expiresAt: string | null
}

export interface MemoryView {
  settings: { enabled: boolean; keys: string[]; days: number }
  /** Variables the journey asks for or sets. */
  variables: string[]
  /** Facts kept per key for this bot's contacts. */
  kept: Record<string, number>
}

export type BlueprintCard = {
  id: string
  version: number
  name: string
  summary: string
  businessNoun: string
  persona: string
  accent: string
  fields: BlueprintFieldSpec[]
  chapters: string[]
}

export interface BusinessView {
  blueprint: BlueprintCard | null
  profile: BusinessProfile | null
  issues: ProfileIssue[]
  documents: number
}

export interface BusinessRead {
  profile: BusinessProfile
  issues: ProfileIssue[]
}

export const business = {
  blueprints: () => apiFetch<{ data: BlueprintCard[] }>('/bots/blueprints'),
  sample: (blueprintId: string) => apiFetch<{ data: BusinessRead }>(`/bots/blueprints/${blueprintId}/sample`),
  scan: (blueprintId: string, body: { url: string; businessName?: string; personaName?: string }) =>
    apiFetch<{ data: BusinessRead }>(`/bots/blueprints/${blueprintId}/scan`, { method: 'POST', body: JSON.stringify(body) }),
  get: (botId: string) => apiFetch<{ data: BusinessView }>(`/bots/${botId}/business`),
  save: (botId: string, profile: BusinessProfile) =>
    apiFetch<{ data: BusinessRead & { facts: number; documents: number } }>(`/bots/${botId}/business`, { method: 'PUT', body: JSON.stringify({ profile }) }),
  reread: (botId: string, url?: string) =>
    apiFetch<{ data: { changes: FieldChange[]; fresh: BusinessProfile } }>(`/bots/${botId}/business/reread`, { method: 'POST', body: JSON.stringify(url ? { url } : {}) }),
  accept: (botId: string, fresh: BusinessProfile, keys: string[]) =>
    apiFetch<{ data: BusinessRead & { accepted: string[] } }>(`/bots/${botId}/business/accept`, { method: 'POST', body: JSON.stringify({ fresh, keys }) }),
}

export const memory = {
  get: (botId: string) => apiFetch<{ data: MemoryView }>(`/bots/${botId}/memory`),
  save: (botId: string, body: MemoryView['settings']) =>
    apiFetch<{ data: MemoryView['settings'] }>(`/bots/${botId}/memory`, { method: 'PUT', body: JSON.stringify(body) }),
  contact: (contactId: string) => apiFetch<{ data: MemoryFact[] }>(`/contacts/${contactId}/memory`),
  conversation: (conversationId: string) => apiFetch<{ data: { contactId: string | null; facts: MemoryFact[] } }>(`/conversations/${conversationId}/memory`),
  forget: (contactId: string, key: string) => apiFetch<void>(`/contacts/${contactId}/memory/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  forgetAll: (contactId: string) => apiFetch<{ data: { forgotten: number } }>(`/contacts/${contactId}/memory`, { method: 'DELETE' }),
}

export const team = {
  members: () => apiFetch<{ data: TeamMember[] }>('/team/members'),
  invite: (email: string, role: string) => apiFetch<{ data: unknown }>('/team/invites', { method: 'POST', body: JSON.stringify({ email, role }) }),
  updateRole: (id: string, role: string) => apiFetch<{ data: unknown }>(`/team/members/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  remove: (id: string) => apiFetch<void>(`/team/members/${id}`, { method: 'DELETE' }),
  labels: () => apiFetch<{ data: Label[] }>('/team/labels'),
  createLabel: (name: string) => apiFetch<{ data: Label }>('/team/labels', { method: 'POST', body: JSON.stringify({ name }) }),
}

export interface TestRunCheck { name: string; ok: boolean; detail?: string; conversationId?: string; by?: 'runner' | 'server' }
export interface TestRun {
  id: string
  kind: 'traffic' | 'release'
  status: 'running' | 'passed' | 'failed'
  startedAt: string
  finishedAt: string | null
  summary: { chats?: number; handedOver?: number; chatCostUsd?: number; simulatorCostUsd?: number; failed?: number; total?: number }
  checks: TestRunCheck[]
}

export const testRuns = {
  list: (botId: string) => apiFetch<{ data: TestRun[] }>(`/system/test-runs?botId=${encodeURIComponent(botId)}`),
}

export const analytics = {
  overview: (botId?: string) => apiFetch<{ data: AnalyticsOverview }>(`/analytics/overview${botId ? `?botId=${botId}` : ''}`),
  conversations: (params?: Record<string, string>) => apiFetch<{ data: ConversationTrend[] }>(`/analytics/conversations?${new URLSearchParams(params ?? {})}`),
  agents: (params?: Record<string, string>) => apiFetch<{ data: AgentStat[] }>(`/analytics/agents?${new URLSearchParams(params ?? {})}`),
  channels: () => apiFetch<{ data: ChannelStat[] }>('/analytics/channels'),
  csatTrend: (days?: number) => apiFetch<{ data: CsatTrendPoint[] }>(`/analytics/csat-trend?days=${days ?? 30}`),
  resolutionBreakdown: (botId?: string) => apiFetch<{ data: ResolutionBreakdownItem[] }>(`/analytics/resolution-breakdown${botId ? `?botId=${botId}` : ''}`),
  responseTimeByHour: () => apiFetch<{ data: ResponseTimeHourPoint[] }>('/analytics/response-time-by-hour'),
}

export const audit = {
  list: (params?: Record<string, string>) => apiFetch<{ data: AuditEvent[] }>(`/audit?${new URLSearchParams(params ?? {})}`),
}

export const optimizations = {
  list: (botId: string, status?: string) =>
    apiFetch<{ data: TemplateOptimization[] }>(`/bots/${botId}/optimizations${status ? `?status=${status}` : ''}`),
  get: (botId: string, id: string) =>
    apiFetch<{ data: TemplateOptimization }>(`/bots/${botId}/optimizations/${id}`),
  apply: (botId: string, id: string) =>
    apiFetch<{ data: TemplateOptimization }>(`/bots/${botId}/optimizations/${id}/apply`, { method: 'POST' }),
  dismiss: (botId: string, id: string) =>
    apiFetch<{ data: TemplateOptimization }>(`/bots/${botId}/optimizations/${id}/dismiss`, { method: 'POST' }),
}

export const preview = {
  knowledgeStats: (botId: string) =>
    apiFetch<{ data: { chunkCount: number; sourceCount: number } }>(`/bots/${botId}/preview/knowledge-stats`),
  /** No botId while a new bot is still a draft. */
  journey: (botId: string | null | undefined, body: {
    chapters: Array<{ name: string; graph: unknown }>
    startChapter: string
    message: string
    environmentLabel: string
    state?: TestChatState
    catalog?: unknown
  }) =>
    apiFetch<{ data: TestChatTurn }>(botId ? `/bots/${botId}/preview/journey` : '/preview/journey', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Returns the raw fetch Response so the caller can consume the SSE stream. */
  chatStream: (botId: string, body: {
    message: string
    opening?: boolean
    graph?: { nodes: unknown[]; edges: unknown[] }
    flowName?: string
    state?: TestChatState
  }): Promise<Response> => {
    const token = (() => { try { const r = localStorage.getItem('ybot-app'); if (!r) return null; const p = JSON.parse(r) as { state?: { token?: string } }; return p?.state?.token ?? null } catch { return null } })()
    return fetch(`${BASE}/bots/${botId}/preview/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify(body),
    })
  },
}

/** A test chat's memory between turns. The server owns its shape; send it back unchanged. */
export interface TestChatState {
  status: 'active' | 'resolved' | 'escalated'
  outcome: string | null
  handover: Partial<HandoverContract> | null
  [key: string]: unknown
}

export type TestChatPath = 'journey' | 'name' | 'answer' | 'none' | 'held' | 'handover'

export interface TestToolCall {
  toolId: string
  name: string
  ok: boolean
  skipped: boolean
  error?: string
}

export interface TestChatTurn {
  text: string
  path: TestChatPath
  ended: boolean
  chapter: string
  state: TestChatState
  tools?: TestToolCall[]
}

/** Build the WebSocket URL for the tenant real-time channel. */
export function buildWsUrl(token: string): string {
  const apiBase = import.meta.env.VITE_API_URL ?? '/api/v1'
  const isRelative = apiBase.startsWith('/')
  const origin = isRelative ? window.location.origin : new URL(apiBase).origin
  const proto = origin.startsWith('https') ? 'wss' : 'ws'
  const host = origin.replace(/^https?:\/\//, '')
  return `${proto}://${host}/ws?token=${encodeURIComponent(token)}`
}

export const system = {
  status: () => apiFetch<{ data: SystemStatus }>('/system/status'),
  config: () => apiFetch<{ data: SystemConfig }>('/system/config'),
}

export const workflows = {
  list: (botId: string, params?: Record<string, string>) =>
    apiFetch<{ data: AutomationRule[] }>(`/bots/${botId}/workflows?${new URLSearchParams(params ?? {})}`),
  create: (botId: string, body: { name: string; description?: string; trigger: string; conditions?: string; actions?: string[]; status?: string }) =>
    apiFetch<{ data: AutomationRule }>(`/bots/${botId}/workflows`, { method: 'POST', body: JSON.stringify(body) }),
  update: (botId: string, id: string, body: Partial<{ name: string; description: string; trigger: string; conditions: string; actions: string[]; status: string }>) =>
    apiFetch<{ data: unknown }>(`/bots/${botId}/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  toggle: (botId: string, id: string) =>
    apiFetch<{ data: { status: string } }>(`/bots/${botId}/workflows/${id}/toggle`, { method: 'POST' }),
  delete: (botId: string, id: string) =>
    apiFetch<void>(`/bots/${botId}/workflows/${id}`, { method: 'DELETE' }),
}

// ── Tools and Auth Profiles ─────────────────────────────────────────────────
export interface ToolSummary {
  id: string
  botId: string
  name: string
  kind: ToolKind
  description: string
  parameters: ToolParameter[]
  schema: Record<string, unknown>
  returns: ToolReturns
  effect: ToolEffect
  config: Record<string, unknown>
  authProfileId: string | null
  authProfileName: string | null
  createdAt: string
  updatedAt: string
  lastRun?: { ok: boolean; at: string; durationMs: number } | null
}

export interface ToolInput {
  name: string
  kind: ToolKind
  description: string
  parameters: ToolParameter[]
  returns: ToolReturns
  effect: ToolEffect
  config: Record<string, unknown>
  authProfileId: string | null
}

export interface ToolRunResult {
  ok: boolean
  output: unknown
  error?: string
  status?: number
  durationMs: number
  attempts: number
  skipped?: boolean
  runId: string
}

export interface ToolRunRow {
  id: string
  source: string
  ok: boolean
  status: number | null
  durationMs: number
  attempts: number
  input: Record<string, unknown>
  output: unknown
  error: string | null
  createdAt: string
}

export interface McpRemoteTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  parameters: ToolParameter[]
}

export interface AuthProfileSummary {
  id: string
  name: string
  kind: AuthProfileKind
  settings: { headerName?: string; queryParam?: string; username?: string; prefix?: string }
  hasSecret: boolean
  secretHint: string | null
  toolCount: number
  createdAt: string
  updatedAt: string
}

export interface AuthProfileInput {
  name: string
  kind: AuthProfileKind
  settings: { headerName?: string; queryParam?: string; username?: string; prefix?: string }
  secret?: string
}

export interface InboxTool {
  id: string
  name: string
  kind: ToolKind
  description: string
  parameters: ToolParameter[]
  effect: ToolEffect
}

export const tools = {
  list: (botId: string) => apiFetch<{ data: ToolSummary[] }>(`/bots/${botId}/tools`),
  create: (botId: string, body: ToolInput) =>
    apiFetch<{ data: ToolSummary }>(`/bots/${botId}/tools`, { method: 'POST', body: JSON.stringify(body) }),
  update: (botId: string, id: string, body: Partial<ToolInput>) =>
    apiFetch<{ data: ToolSummary }>(`/bots/${botId}/tools/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (botId: string, id: string) => apiFetch<void>(`/bots/${botId}/tools/${id}`, { method: 'DELETE' }),
  test: (botId: string, id: string, args: Record<string, unknown>) =>
    apiFetch<{ data: ToolRunResult }>(`/bots/${botId}/tools/${id}/test`, { method: 'POST', body: JSON.stringify({ args }) }),
  runs: (botId: string, id: string) => apiFetch<{ data: ToolRunRow[] }>(`/bots/${botId}/tools/${id}/runs`),
  mcpDiscover: (botId: string, body: { serverUrl: string; authProfileId?: string | null }) =>
    apiFetch<{ data: { fetchedAt: string; tools: McpRemoteTool[] } }>(`/bots/${botId}/tools/mcp/discover`, { method: 'POST', body: JSON.stringify(body) }),
  mcpImport: (botId: string, body: { serverUrl: string; authProfileId?: string | null; toolNames: string[]; effect: ToolEffect }) =>
    apiFetch<{ data: { created: ToolSummary[]; skipped: string[] } }>(`/bots/${botId}/tools/mcp/import`, { method: 'POST', body: JSON.stringify(body) }),
  refresh: (botId: string, id: string) => apiFetch<{ data: ToolSummary }>(`/bots/${botId}/tools/${id}/refresh`, { method: 'POST' }),
}

export const authProfiles = {
  list: () => apiFetch<{ data: AuthProfileSummary[] }>('/auth-profiles'),
  create: (body: AuthProfileInput) => apiFetch<{ data: AuthProfileSummary }>('/auth-profiles', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<AuthProfileInput>) =>
    apiFetch<{ data: AuthProfileSummary }>(`/auth-profiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id: string) => apiFetch<void>(`/auth-profiles/${id}`, { method: 'DELETE' }),
}

// ── Safety: personal data and guardrails ────────────────────────────────────
export interface GuardrailPolicyRow {
  id: string
  name: string
  active: boolean
  rules: GuardrailRule[]
  updatedAt: string
}

export interface SafetyTestResult {
  found: Array<{ kind: string; start: number; end: number }>
  model: string
  readers: Record<PrivacyReader, string>
  guardrails: GuardrailDecision
}

export const safety = {
  get: (botId: string) => apiFetch<{ data: { privacy: PrivacySettings; policies: GuardrailPolicyRow[] } }>(`/bots/${botId}/safety`),
  savePrivacy: (botId: string, body: PrivacySettings & { confirmReveal?: boolean }) =>
    apiFetch<{ data: PrivacySettings }>(`/bots/${botId}/safety/privacy`, { method: 'PUT', body: JSON.stringify(body) }),
  createPolicy: (botId: string, body: { name: string; rules: GuardrailRule[] }) =>
    apiFetch<{ data: GuardrailPolicyRow }>(`/bots/${botId}/safety/policies`, { method: 'POST', body: JSON.stringify(body) }),
  savePolicy: (botId: string, id: string, body: { name: string; rules: GuardrailRule[] }) =>
    apiFetch<{ data: GuardrailPolicyRow }>(`/bots/${botId}/safety/policies/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  activate: (botId: string, id: string) => apiFetch<{ data: GuardrailPolicyRow[] }>(`/bots/${botId}/safety/policies/${id}/activate`, { method: 'POST' }),
  deactivate: (botId: string, id: string) => apiFetch<{ data: GuardrailPolicyRow }>(`/bots/${botId}/safety/policies/${id}/deactivate`, { method: 'POST' }),
  deletePolicy: (botId: string, id: string) => apiFetch<void>(`/bots/${botId}/safety/policies/${id}`, { method: 'DELETE' }),
  test: (botId: string, body: { text: string; side: 'input' | 'output'; privacy?: PrivacySettings; rules?: GuardrailRule[] }) =>
    apiFetch<{ data: SafetyTestResult }>(`/bots/${botId}/safety/test`, { method: 'POST', body: JSON.stringify(body) }),
}

// ── Control loop: evals, releases, export/import ────────────────────────────
export interface EvalRunRow {
  id: string
  suiteId: string
  trigger: 'manual' | 'publish'
  status: 'passed' | 'failed' | 'error'
  passed: number
  failed: number
  costUsd: number | null
  durationMs: number
  target: { kind?: 'working_copy' | 'release_candidate'; chapters?: Array<{ name: string; version: number }> }
  createdAt: string
  results?: EvalScenarioResult[]
  suiteName?: string
}

export interface EvalSuiteRow {
  id: string
  name: string
  gate: boolean
  scenarios: EvalScenario[]
  updatedAt: string
  latestRun: EvalRunRow | null
}

export interface ReleaseRow {
  id: string
  number: number
  note: string | null
  createdAt: string
  createdBy: string | null
  live: boolean
  chapters: Array<{ name: string; version: number }>
  evalRunIds: string[]
  diff: ReleaseDiff
}

export interface ReleasesView {
  environmentId: string
  liveReleaseId: string | null
  plays: 'release' | 'working_copy'
  releases: ReleaseRow[]
  pending: ReleaseDiff
  gateSuites: number
}

export interface ImportPlanItem {
  kind: 'chapter' | 'tool' | 'guardrail_policy' | 'privacy' | 'eval_suite'
  name: string
  action: 'create' | 'update' | 'unchanged' | 'keep' | 'delete' | 'invalid'
  note?: string
}

export interface ImportPlanView {
  applied: boolean
  from: string
  mode: 'skip' | 'merge' | 'replace'
  items: ImportPlanItem[]
  warnings: string[]
}

export const evals = {
  list: (botId: string) => apiFetch<{ data: { suites: EvalSuiteRow[]; chapters: string[] } }>(`/bots/${botId}/evals`),
  create: (botId: string, body: { name: string; gate: boolean; scenarios: EvalScenario[] }) =>
    apiFetch<{ data: EvalSuiteRow }>(`/bots/${botId}/evals`, { method: 'POST', body: JSON.stringify(body) }),
  save: (botId: string, id: string, body: { name: string; gate: boolean; scenarios: EvalScenario[] }) =>
    apiFetch<{ data: EvalSuiteRow }>(`/bots/${botId}/evals/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (botId: string, id: string) => apiFetch<void>(`/bots/${botId}/evals/${id}`, { method: 'DELETE' }),
  run: (botId: string, id: string) => apiFetch<{ data: EvalRunRow }>(`/bots/${botId}/evals/${id}/run`, { method: 'POST', body: '{}' }),
  runs: (botId: string, id: string) => apiFetch<{ data: EvalRunRow[] }>(`/bots/${botId}/evals/${id}/runs`),
}

export const releases = {
  list: (botId: string) => apiFetch<{ data: ReleasesView }>(`/bots/${botId}/releases`),
  publish: (botId: string, note?: string) =>
    apiFetch<{ data: { releaseId: string; number: number; diff: ReleaseDiff; runs: EvalRunRow[] } }>(`/bots/${botId}/releases`, { method: 'POST', body: JSON.stringify({ note }) }),
  rollback: (botId: string, id: string) => apiFetch<{ data: { releaseId: string; number: number } }>(`/bots/${botId}/releases/${id}/rollback`, { method: 'POST' }),
}

export const bundle = {
  async download(botId: string, format: 'json' | 'yaml'): Promise<{ text: string; fileName: string }> {
    const token = getToken()
    const res = await fetch(`${BASE}/bots/${botId}/bundle?format=${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
      throw new ApiError(res.status, json.error)
    }
    const fileName = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `bot.botstudio.${format}`
    return { text: await res.text(), fileName }
  },
  import: (botId: string, body: { content: string; mode: 'skip' | 'merge' | 'replace'; dryRun: boolean }) =>
    apiFetch<{ data: ImportPlanView }>(`/bots/${botId}/bundle/import`, { method: 'POST', body: JSON.stringify(body) }),
}

export const inboxTools = {
  list: (conversationId: string) => apiFetch<{ data: InboxTool[] }>(`/conversations/${conversationId}/tools`),
  run: (conversationId: string, toolId: string, args: Record<string, unknown>, confirmed = false) =>
    apiFetch<{ data: ToolRunResult & { noteId: string } }>(`/conversations/${conversationId}/tools/${toolId}/run`, { method: 'POST', body: JSON.stringify({ args, confirmed }) }),
}

export const dashboards = {
  list: (botId: string) =>
    apiFetch<{ data: Dashboard[] }>(`/bots/${botId}/dashboards`),
  create: (botId: string, body: { name: string; layout?: unknown[] }) =>
    apiFetch<{ data: Dashboard }>(`/bots/${botId}/dashboards`, { method: 'POST', body: JSON.stringify(body) }),
  update: (botId: string, id: string, body: Partial<{ name: string; layout: unknown[] }>) =>
    apiFetch<{ data: unknown }>(`/bots/${botId}/dashboards/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (botId: string, id: string) =>
    apiFetch<void>(`/bots/${botId}/dashboards/${id}`, { method: 'DELETE' }),
}
// ── Types ─────────────────────────────────────────────────────────────────────
export interface BotSummary { id: string; name: string; description?: string; status: string; environments: Array<{ id: string; kind: string; name: string }> }
export interface Flow { id: string; name: string; description?: string; kind: string; tags: string[]; updatedAt: string; versions: FlowVersion[] }
export interface FlowVersion { id: string; version: number; status: string; graph: FlowGraph; publishedAt?: string; environmentId?: string | null }
export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[] }
export interface FlowNode { id: string; type: string; position: { x: number; y: number }; data: { kind: string; label: string; config: Record<string, unknown> } }
export interface FlowEdge { id: string; source: string; target: string; sourceHandle?: string }
export interface PackRemovalResult {
  flowsRemoved: string[]
  intentsRemoved: number
  faqsRemoved: number
}

export interface CorporatePackResult {
  flowsAdded: string[]
  publishedNames: string[]
  draftNames: string[]
  intentsAdded: number
  faqsAdded: number
  environmentName: string | null
}

export interface Intent { id: string; name: string; description?: string; utterances: string[]; responses: object[] }
export interface Entity { id: string; name: string; kind: string; values: object[] }
export interface Faq { id: string; question: string; answer: string; tags: string[] }
export interface KnowledgeSource { id: string; name: string; kind: string; config: Record<string, unknown>; lastSyncAt?: string; documents: Array<{ id: string; status: string }> }
export interface LlmConfig { model: string; temperature: number; maxTokens: number; systemPrompt: string }
export interface Conversation { id: string; status: string; assignedTo?: string; contact?: Contact; channel?: { id: string; name: string; kind: string }; messages: Message[]; labels: Array<{ label: Label }>; updatedAt: string; sla?: string | null; outcome?: string | null; llm?: ConversationLlmCost | null; handover?: Partial<HandoverContract> | null; /** Set on chats a scheduled test run opened. */ testRunId?: string | null }
/** Model calls made for one chat. costUsd is null when a model had no known price. */
export interface ConversationLlmCost { costUsd: number | null; calls: number }
export interface ToolNote { id: string; name: string; runId?: string; ok: boolean; args?: Record<string, unknown>; output?: unknown; error?: string | null }
/** A knowledge document a bot answer was written from. */
export interface KnowledgeSourceRef { documentId: string; title: string; source: string }
export interface Message { id: string; direction: string; authorKind: string; content: { text: string; internal?: boolean; tool?: ToolNote; guardrails?: GuardrailHit[]; sources?: KnowledgeSourceRef[] }; createdAt: string }
export interface Ticket { id: string; subject: string; description?: string | null; status: string; priority: string; assignedTo?: string; tags: string[]; createdAt: string; conversation?: { contact?: Contact } }
export interface Contact { id: string; displayName?: string; email?: string; phone?: string; metadata: Record<string, unknown>; createdAt: string }
export interface Campaign { id: string; name: string; channel: string; status: string; direction: string; subject?: string; body?: string; scheduledAt?: string; sentAt?: string; sent?: number; delivered?: number }
export interface CampaignDelivery { id: string; contactId: string; email?: string; status: string; sentAt?: string; error?: string }
export interface Template { id: string; name: string; channel: string; approvalStatus: string; content: Record<string, unknown>; variables: string[] }
export interface Channel { id: string; name: string; kind: string; environmentId?: string; config: Record<string, unknown>; isActive: boolean; botId: string; createdAt: string }
export interface Webhook { id: string; url: string; events: string[]; isActive: boolean; createdAt: string; successRate?: number | null; secret?: string | null }
export interface WebhookDelivery { id: string; event: string; statusCode: number; success: boolean; durationMs: number; error?: string | null; createdAt: string }
export interface CannedReply { id: string; shortcut: string; title: string; text: string }
export interface SavedReport { id: string; name: string; type: string; format: string; frequency: string; status: string; recipients: string[]; lastRunAt: string | null; createdAt: string }
export interface DataColumn { name: string; type: string; nullable?: boolean }
export interface DataTable { id: string; name: string; columns: DataColumn[]; rows: number; updatedAt: string }
export interface IntegrationConnection {
  id: string
  name: string
  description: string
  category: string
  status: 'connected' | 'needs_details' | 'available' | 'coming_soon'
  connectedAt?: string | null
  hasKey?: boolean
  gaps?: Array<{ field: string; message: string }>
  settings?: Record<string, unknown>
  authProfile?: { id: string; name: string; secretHint: string | null } | null
  connector?: { fields: Array<{ key: string; label: string; placeholder: string; help: string }>; secretLabel: string; secretHelp: string; hasTools: boolean } | null
}
export interface Label { id: string; name: string; color: string }
export interface TeamMember { id: string; displayName: string; email: string; memberships: Array<{ role: string }>; agentProfile?: { status: string } }
/** Rates and scores are null when there is nothing to measure; show a dash, never zero. */
export interface AnalyticsOverview { totalConversations: number; resolvedConversations: number; resolutionRate: number | null; escalationRate: number | null; totalContacts: number; csatScore: number | null; avgResponseTimeMs: number | null; botHandledPct: number | null; outcomes?: OutcomeSummary; llm?: { days: number; calls: number; costUsd: number | null } | null }
export interface OutcomeSummary {
  finished: number
  open: number
  counts: Record<'contained_resolved' | 'contained_partial' | 'contained_unresolved' | 'escalated' | 'abandoned', number>
  buckets: { contained: number; escalated: number; abandoned: number }
  rates: { contained: number | null; resolvedByBot: number | null; escalated: number | null; abandoned: number | null }
}
export interface ConversationTrend { date: string; conversations: number; resolved: number; escalated: number }
export interface AgentStat { agentId: string; name: string; total: number; resolved: number; escalated: number; resolutionRate: number }
export interface ChannelStat { channelId: string; name: string; total: number }
export interface CsatTrendPoint { date: string; score: number; positive: number; negative: number }
export interface ResolutionBreakdownItem { name: string; value: number }
export interface ResponseTimeHourPoint { hour: string; time: number }
export interface TrainingRun { id: string; createdAt: string; model: string; examples: number; intents: number; faqs: number; sources: number; status: string; durationMs: number }
export interface AuditEvent { id: string; action: string; resource?: string; resourceId?: string; metadata: Record<string, unknown>; createdAt: string; user?: { displayName: string; email: string } }

export interface DockerContainer { id: string; name: string; image: string; state: string; status: string; created?: number }
export interface ServicePing { ok: boolean; latencyMs: number }
export interface RagSourceEntry { id: string; name: string; lastSyncAt?: string; _count: { documents: number } }
export interface SystemStatus {
  services: { database: ServicePing; redis: ServicePing }
  containers: DockerContainer[]
  rag: { sources: number; documents: number; chunks: number; sourceList: RagSourceEntry[] }
  system: { platform: string; uptime: number; nodeVersion: string; cpuCount: number; totalMemMb: number; freeMemMb: number; usedMemPct: number }
  version?: { version: string; buildNumber: string; gitSha: string; buildDate: string }
  ts: string
}

export interface ConfigEntry { set: boolean; label: string; value?: string | null; endpoint?: string | null }
export interface SystemConfig {
  auth: { JWT_SECRET: ConfigEntry }
  database: { DATABASE_URL: ConfigEntry }
  cache: { REDIS_URL: ConfigEntry }
  storage: { S3_ENDPOINT: ConfigEntry; S3_BUCKET: ConfigEntry; S3_REGION: ConfigEntry }
  llm: { LLM_PROVIDER?: ConfigEntry; GEMINI_API_KEY: ConfigEntry; ANTHROPIC_API_KEY: ConfigEntry; OLLAMA_BASE_URL: ConfigEntry; OPENAI_API_KEY: ConfigEntry; GROQ_API_KEY: ConfigEntry }
  app: { NODE_ENV: ConfigEntry; FRONTEND_URL: ConfigEntry }
}

export interface TemplateOptimization {
  id: string
  tenantId: string
  botId: string
  templateId?: string | null
  kind: string
  title: string
  description: string
  currentValue?: string | null
  proposedValue: string
  evidenceCount: number
  avgQualityScore: number
  status: 'pending' | 'applied' | 'dismissed'
  appliedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface AutomationRule {
  id: string
  tenantId: string
  botId: string
  name: string
  description?: string
  trigger: string
  conditions: string
  actions: string[]
  status: 'active' | 'paused' | 'draft'
  runCount: number
  lastRunAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface Dashboard {
  id: string
  tenantId: string
  botId: string
  name: string
  layout: unknown[]
  createdAt: string
  updatedAt: string
  widgets?: Array<{ id: string; kind: string; title: string; config: Record<string, unknown> }>
}
