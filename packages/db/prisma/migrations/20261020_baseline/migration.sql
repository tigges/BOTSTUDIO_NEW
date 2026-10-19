-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "dataRegion" TEXT NOT NULL DEFAULT 'us',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "start_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceHost" TEXT,
    "spec" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "start_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "passwordHash" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'DEVELOPER',

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personaName" TEXT,
    "description" TEXT,
    "avatarUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "maxTokens" INTEGER NOT NULL DEFAULT 2048,
    "systemPrompt" TEXT NOT NULL DEFAULT 'You are a helpful assistant.',
    "inboxConfig" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'sandbox',
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'flow',
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "environmentId" TEXT,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "graph" JSONB NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "utterances" TEXT[],
    "responses" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'list',
    "values" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "knowledgeSourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "channelId" TEXT,
    "contactId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "assignedTo" TEXT,
    "teamId" TEXT,
    "subject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "firstResponseDueAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "afterHoursNotifiedAt" TIMESTAMP(3),
    "slaBreachedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "handover" JSONB,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL DEFAULT 'user',
    "authorId" TEXT,
    "content" JSONB NOT NULL,
    "channelMsgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeKind" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_calls" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "botId" TEXT,
    "conversationId" TEXT,
    "traceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "environment" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "ttftMs" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "assignedTo" TEXT,
    "teamId" TEXT,
    "tags" TEXT[],
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#94a3b8',

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_labels" (
    "conversationId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "conversation_labels_pkey" PRIMARY KEY ("conversationId","labelId")
);

-- CreateTable
CREATE TABLE "agent_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "teamId" TEXT,

    CONSTRAINT "agent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "botId" TEXT,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT,
    "channelId" TEXT,
    "displayName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "channel" TEXT NOT NULL DEFAULT 'email',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "subject" TEXT,
    "body" TEXT,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "content" JSONB NOT NULL,
    "variables" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "widgets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "position" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "schedule" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canned_replies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canned_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_tables" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiKey" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "resourceId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "csat_responses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "csat_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sampleConversationId" TEXT,
    "clusterKeywords" TEXT[],
    "avgQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_optimizations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "templateId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "currentValue" TEXT,
    "proposedValue" TEXT NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 1,
    "avgQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_optimizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "conditions" TEXT NOT NULL DEFAULT '',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,
    "currentNodeId" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{"flow":{},"global":{},"contact":{}}',
    "status" TEXT NOT NULL DEFAULT 'running',
    "waitingFor" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "secretEnc" TEXT,
    "secretHint" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tools" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '[]',
    "returns" JSONB NOT NULL DEFAULT '{}',
    "effect" TEXT NOT NULL DEFAULT 'read',
    "config" JSONB NOT NULL DEFAULT '{}',
    "authProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "conversationId" TEXT,
    "source" TEXT NOT NULL,
    "actorId" TEXT,
    "ok" BOOLEAN NOT NULL,
    "status" INTEGER,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_providerId_key" ON "oauth_accounts"("provider", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_key" ON "user_sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenantId_userId_key" ON "memberships"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "bot_configs_botId_key" ON "bot_configs"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "environments_botId_kind_key" ON "environments"("botId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "flow_versions_flowId_version_key" ON "flow_versions"("flowId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "intents_botId_name_key" ON "intents"("botId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "entities_botId_name_key" ON "entities"("botId", "name");

-- CreateIndex
CREATE INDEX "llm_calls_tenantId_createdAt_idx" ON "llm_calls"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "llm_calls_conversationId_idx" ON "llm_calls"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "labels_tenantId_name_key" ON "labels"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "agent_profiles_userId_key" ON "agent_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_deliveries_campaignId_contactId_key" ON "campaign_deliveries"("campaignId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "templates_botId_name_channel_key" ON "templates"("botId", "name", "channel");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhookId_createdAt_idx" ON "webhook_deliveries"("webhookId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "canned_replies_tenantId_shortcut_key" ON "canned_replies"("tenantId", "shortcut");

-- CreateIndex
CREATE UNIQUE INDEX "data_tables_tenantId_name_key" ON "data_tables"("tenantId", "name");

-- CreateIndex
CREATE INDEX "data_records_tableId_idx" ON "data_records"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_tenantId_provider_key" ON "integration_connections"("tenantId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "flow_sessions_conversationId_key" ON "flow_sessions"("conversationId");

-- CreateIndex
CREATE INDEX "flow_sessions_tenantId_idx" ON "flow_sessions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_profiles_tenantId_name_key" ON "auth_profiles"("tenantId", "name");

-- CreateIndex
CREATE INDEX "tools_tenantId_idx" ON "tools"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tools_botId_name_key" ON "tools"("botId", "name");

-- CreateIndex
CREATE INDEX "tool_runs_toolId_createdAt_idx" ON "tool_runs"("toolId", "createdAt");

-- CreateIndex
CREATE INDEX "tool_runs_conversationId_idx" ON "tool_runs"("conversationId");

-- AddForeignKey
ALTER TABLE "start_templates" ADD CONSTRAINT "start_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bots" ADD CONSTRAINT "bots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_configs" ADD CONSTRAINT "bot_configs_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "environments_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flows" ADD CONSTRAINT "flows_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intents" ADD CONSTRAINT "intents_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_knowledgeSourceId_fkey" FOREIGN KEY ("knowledgeSourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_logs" ADD CONSTRAINT "step_logs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_logs" ADD CONSTRAINT "step_logs_flowVersionId_fkey" FOREIGN KEY ("flowVersionId") REFERENCES "flow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_labels" ADD CONSTRAINT "conversation_labels_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_labels" ADD CONSTRAINT "conversation_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_deliveries" ADD CONSTRAINT "campaign_deliveries_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canned_replies" ADD CONSTRAINT "canned_replies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_tables" ADD CONSTRAINT "data_tables_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_records" ADD CONSTRAINT "data_records_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "data_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csat_responses" ADD CONSTRAINT "csat_responses_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_templates" ADD CONSTRAINT "conversation_templates_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_optimizations" ADD CONSTRAINT "template_optimizations_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_optimizations" ADD CONSTRAINT "template_optimizations_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "conversation_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_profiles" ADD CONSTRAINT "auth_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tools" ADD CONSTRAINT "tools_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tools" ADD CONSTRAINT "tools_authProfileId_fkey" FOREIGN KEY ("authProfileId") REFERENCES "auth_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_runs" ADD CONSTRAINT "tool_runs_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

