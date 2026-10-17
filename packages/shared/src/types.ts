export type Role =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'DEVELOPER'
  | 'INBOX_AGENT'
  | 'INBOX_ADMIN'
  | 'ENGAGEMENT_ADMIN'
  | 'ENGAGEMENT_USER'
  | 'INSIGHTS_ADMIN'
  | 'INSIGHTS_USER'
  | 'DATABASE_VIEWER'

export type DataRegion =
  | 'us'
  | 'eu'
  | 'india'
  | 'mea'
  | 'singapore'
  | 'qatar'
  | 'saudi'
  | 'indonesia'

export type EnvironmentKind = 'sandbox' | 'production'

export type BotStatus = 'active' | 'inactive' | 'draft'

export type AgentStatus = 'online' | 'away' | 'offline'

export type TicketStatus =
  | 'open'
  | 'pending'
  | 'on_hold'
  | 'in_progress'
  | 'resolved'
  | 'closed'

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'

export type MessageDirection = 'inbound' | 'outbound'

export type AuthorKind = 'user' | 'bot' | 'agent' | 'system'

export type ConversationStatus =
  | 'active'
  | 'escalated'
  | 'resolved'
  | 'closed'

export type FlowKind = 'flow' | 'workflow'

export type FlowVersionStatus = 'draft' | 'published'

export type KnowledgeSourceKind = 'website' | 'url' | 'file' | 'integration'

export type DocumentStatus = 'processing' | 'indexed' | 'failed'

export type CampaignDirection = 'outbound' | 'inbound'

export type ChannelKind =
  | 'web'
  | 'whatsapp'
  | 'sms'
  | 'email'
  | 'telegram'
  | 'phone'
  | 'google_chat'
  | 'facebook'
  | 'teams'
  | 'viber'
  | 'alexa'
  | 'twilio_voice'
  | 'rcs'
  | 'apple_business'
  | 'line'

export type TemplateChannel =
  | 'whatsapp'
  | 'sms'
  | 'email'
  | 'viber'
  | 'push'
  | 'line'
  | 'teams'

export type TemplateApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface ApiResponse<T> {
  data: T
  meta?: {
    cursor?: string
    hasMore?: boolean
    total?: number
  }
}

export interface ApiError {
  error: {
    code: string
    message: string
    details?: Record<string, string[]>
  }
}

export const DATA_REGIONS: { value: DataRegion; label: string }[] = [
  { value: 'us', label: 'United States' },
  { value: 'eu', label: 'Europe' },
  { value: 'india', label: 'India' },
  { value: 'mea', label: 'Middle East & Africa' },
  { value: 'singapore', label: 'Singapore' },
  { value: 'qatar', label: 'Qatar' },
  { value: 'saudi', label: 'Saudi Arabia' },
  { value: 'indonesia', label: 'Indonesia' },
]

export const ROLES: { value: Role; label: string; description: string }[] = [
  { value: 'SUPER_ADMIN', label: 'Super Admin', description: 'Full platform access' },
  { value: 'ADMIN', label: 'Admin', description: 'Full tenant access' },
  { value: 'DEVELOPER', label: 'Developer', description: 'Build, train and test bots' },
  { value: 'INBOX_ADMIN', label: 'Inbox Admin', description: 'Manage inbox settings and agents' },
  { value: 'INBOX_AGENT', label: 'Inbox Agent', description: 'Handle chats and tickets' },
  { value: 'ENGAGEMENT_ADMIN', label: 'Engagement Admin', description: 'Manage campaigns and templates' },
  { value: 'ENGAGEMENT_USER', label: 'Engagement User', description: 'View engagement data' },
  { value: 'INSIGHTS_ADMIN', label: 'Insights Admin', description: 'Full analytics access' },
  { value: 'INSIGHTS_USER', label: 'Insights User', description: 'View analytics' },
  { value: 'DATABASE_VIEWER', label: 'Database Viewer', description: 'Read-only database access' },
]
