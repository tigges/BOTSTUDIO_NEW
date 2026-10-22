# BotStudio — Architecture, UI & Feature Roadmap

> Auto-generated analysis of the `cursor/phase-7` build.  
> Covers three areas: **Architecture**, **User Interface**, and **Missing B2B Features**.  
> Items are ranked by impact and grouped into short (S), medium (M), and long (L) horizon work.

---

## Part 1 — Architecture

### 1.1 Critical / quick wins

#### A. Singleton `PrismaClient`
Every route file calls `new PrismaClient()`.  This creates a new connection pool per module, exhausting the database at scale.

**Fix:** Create `packages/db/src/client.ts`, export one singleton, import it everywhere.
```ts
// packages/db/src/client.ts
import { PrismaClient } from '@prisma/client'
export const prisma = new PrismaClient()
```
**Impact:** reduces DB connections from ~40+ to 1. Required before any horizontal scale.

#### B. Enforce RBAC on every route
`Membership.role` and the shared `Role` enum exist.  No middleware enforces them.  Every agent can call build/admin routes.

**Fix:** Thin `requireRole(...roles)` Fastify hook. Apply to all route groups.
```ts
const requireRole = (...roles: Role[]) => async (req, reply) => {
  if (!roles.includes(req.user.role)) reply.status(403).send(...)
}
app.addHook('preHandler', requireRole('ADMIN', 'DEVELOPER'))
```
**Impact:** B2B deal-breaker if unaddressed. Agents should not touch Build/Analytics/Admin.

#### C. Separate worker processes
BullMQ workers (`knowledge-sync`, `webhook`, `campaign-send`, `conversation-analysis`) start inside the API process. This means:
- A stuck campaign job blocks API responses
- Cannot scale workers independently
- Workers can't be restarted without an API restart

**Fix:** Separate `apps/worker` entry point (or individual worker scripts) registered in `docker-compose` as separate services with their own health checks.

#### D. WebSocket horizontal scaling
The current WS broadcaster fans out via in-memory `Map<tenantId, Set<WebSocket>>`. This breaks across multiple API replicas.

**Fix:** Replace in-memory fanout with Redis pub/sub (`ioredis` already a dependency). Publish to `ws:${tenantId}`, subscribe in all replicas.

#### E. Fix login tenant scoping
`auth.ts` does `findFirst({ where: { email } })` — not scoped to tenant. Combined with the schema unique being `[tenantId, email]`, two tenants can register the same email; the wrong user can receive the other's JWT.

**Fix:**
```ts
// For self-signup: single-tenant lookup is fine — pass tenantId from body or sub-domain
const user = await prisma.user.findFirst({ where: { email, tenantId } })
```
Alternatively, enforce globally unique email at the schema level if multi-tenant sub-domain routing is not planned.

---

### 1.2 Medium horizon

#### F. Row-level security on Postgres
All tenant isolation is currently application-level (`WHERE tenantId = ?`).  A missed `tenantId` filter leaks data.

**Fix:** Add Postgres RLS policies as a second fence.
```sql
CREATE POLICY tenant_isolation ON conversations
  USING (tenant_id = current_setting('app.tenant_id')::text);
```
This is additive — existing Prisma queries continue to work.

#### G. Align flow runtime with public chat path
`packages/runtime` contains a `SessionMachine` / `FlowSession` graph executor. The public widget chat (`/public/chat/:channelId`) currently executes RAG + LLM **directly**, bypassing the flow graph entirely for conversations assigned to a bot. These two paths should converge so published flows actually drive live customer chats.

**Fix:** `public/chat` should instantiate a `FlowSession` for the active published flow, falling back to bare RAG only when no flow is published.

#### H. Automation rule runner
`AutomationRule` records are created via CRUD but never read by a worker. The architecture slot (BullMQ queue name `automation`) exists but is empty.

**Fix:** Add a rule-check step post-message/conversation-update that evaluates matching rules and fires actions (assign, label, send message, call webhook).

#### I. Token storage
JWTs are stored in `localStorage`.  This exposes them to any XSS on the page.

**Fix:** Move to `HttpOnly` + `Secure` cookies, rotate on each request with sliding expiry, add CSRF token for state-changing requests.

#### J. Rate limiting
`@fastify/rate-limit` is listed as a dependency but not registered.

**Fix:** Register with per-IP limits on auth endpoints (login/register) and per-tenant limits on `/public/chat` to prevent widget abuse.

---

### 1.3 Long horizon

| ID | Item |
|----|------|
| K | Analytics rollup tables (pre-aggregate daily/weekly; raw SQL won't scale past ~1M messages) |
| L | Async knowledge crawl with per-job progress events over WS (current sync is blocking) |
| M | Per-tenant LLM key vault + token usage metering (cost per conversation visible to customer) |
| N | Tenant data residency enforcement (EU/US/APAC Postgres replicas, `dataRegion` field already present) |
| O | Secrets management for channel credentials (currently plain `Channel.config` JSON) |

---

## Part 2 — User Interface

### 2.1 Reliability gaps (screens that look done but aren't)

| Screen | What looks real | What is actually fake |
|--------|----------------|----------------------|
| Analytics Overview | Counts of conversations/tickets | Response time (hardcoded 1,400ms), channel % breakdown (invented from totals) |
| Analytics Reports | Navigation item | 100% `MOCK_REPORTS` data, no API |
| Custom Dashboards | CRUD modal | `Widget` model unused; no chart/KPI builder |
| Integrations | Catalog with icons | Connect/disconnect = local state toggle; no OAuth or config saved |
| Database | CRM-like table UI | Hardcoded columns and rows; no persistence |
| Webhook test | "Test" button | Returns hardcoded success; doesn't fire actual HTTP |
| Training | Run history, accuracy % | Created after save; not real model runs |
| Campaigns (no SendGrid) | Launch flow | Marked "simulated", not actually sent |

**Recommendation:** Replace demo/mock fallbacks with proper empty states + error boundaries. Users deploying to production should not see fabricated metrics.

### 2.2 UX patterns to standardise

#### Consistent empty states
Some pages (Contacts, Tickets) silently fall back to demo data when the API is empty or errors. Replace with:
```
[Icon]
No [items] yet
[Primary CTA button]   [Docs link]
```

#### Error / loading differentiation
Currently a loading spinner and "no data" look the same. Use distinct states: `loading → empty → error → populated`.

#### Role-aware navigation
Agents should not see Build, Analytics, or Admin sections. The left nav needs to gate items by `Membership.role`. This is also a security concern (the nav hides routes but the routes are not protected server-side — fix B above is the real gate).

#### Mobile / responsive
The layout is desktop-only with a fixed 260px sidebar. Consider a collapsible sidebar for smaller screens — relevant when agents handle tickets on mobile.

#### Real-time feedback
- Conversation list should highlight/scroll to new incoming message automatically (currently requires manual refresh on some WS events)
- Knowledge sync progress bar should show per-document status, not just the modal spinner

### 2.3 Missing UI components

| Component | Priority | Notes |
|-----------|----------|-------|
| Custom dashboard widget builder | M | Drag-drop KPI / chart / table onto a dashboard |
| Billing & usage page | H | Plan, seat count, token spend, upgrade flow |
| API keys management page | M | Create/revoke tenant API keys |
| Password change (works end-to-end) | H | UI exists, API route missing |
| Invite email confirmation | H | Invite creates user but sends no email |
| CSAT trend chart | M | Data exists; no historical view |
| Bot version history / rollback | M | `FlowVersion` persists; no UI to diff or rollback |
| WhatsApp template approval status | M | Sent to BSP but no status polling/display |
| Campaign delivery receipt detail | M | Per-contact delivered/failed status |
| Conversation transcript export (CSV/PDF) | M | Compliance + customer request use case |

---

## Part 3 — Missing B2B Features

### P0 — Ship before first paid customer

| # | Feature | What exists today | What's needed |
|---|---------|------------------|---------------|
| 1 | **RBAC enforcement** | Role on JWT; no middleware | Route-level permission hooks |
| 2 | **Password change/reset** | UI shell | `POST /me/password` + email reset flow |
| 3 | **Invite emails** | Invite DB record | SendGrid/Resend transactional email |
| 4 | **Billing & plan gates** | `Tenant.plan = 'free'` | Stripe billing portal, plan limits, upgrade CTA |
| 5 | **Widget domain allowlisting** | None | `Channel.allowedDomains[]`; reject requests from unlisted origins |
| 6 | **Rate limiting on public chat** | `@fastify/rate-limit` installed, unused | Apply per-IP + per-channel limits |

### P1 — Required for competitive B2B positioning

| # | Feature | Detail |
|---|---------|--------|
| 7 | **Real omnichannel connectors** | WhatsApp Cloud API, Twilio SMS/Voice, email IMAP/SMTP. Currently UI-only stubs |
| 8 | **SSO / OIDC / SAML** | Enterprise customers require Google/Azure/Okta login. `OAuthAccount` model exists |
| 9 | **Automation rule runner** | "When CSAT < 3 → create ticket + notify supervisor" — rules stored but never fired |
| 10 | **SLA & business-hours engine** | Define SLAs per team/channel, auto-breach alerts, out-of-hours auto-replies |
| 11 | **Webhook signature verification** | Inbound webhooks (e.g. WhatsApp Cloud) need HMAC verification |
| 12 | **Real integration OAuth** | HubSpot, Salesforce, Intercom — bidirectional contact/ticket sync |
| 13 | **Tenant API key public API** | Documented REST API for tenants to query contacts, send messages, trigger campaigns |

### P2 — Growth & enterprise features

| # | Feature | Detail |
|---|---------|--------|
| 14 | **Custom analytics dashboards** | Widget builder on top of `Dashboard/Widget` models |
| 15 | **Scheduled reports** | Not started: needs a report job and email delivery |
| 16 | **LLM cost metering** | Per-conversation token usage → billing line item |
| 17 | **Flow A/B testing** | Publish two flow variants; route traffic; compare CSAT |
| 18 | **Bot version diff & rollback** | `FlowVersion` history exists; no diff UI |
| 19 | **GDPR tooling** | Contact data export, right-to-erasure, audit log retention policy |
| 20 | **Agent performance dashboard** | FRT, resolution time, CSAT per agent; supervisors only |
| 21 | **Multilingual bot** | Language detection → locale-aware flow branching |
| 22 | **Human handover routing rules** | Round-robin / skill-based / load-balanced assignment |
| 23 | **Sandbox → Production promotion gates** | Approval workflow before publishing a flow to production |

---

## Suggested Phasing

```
Now (P0)
└── RBAC enforcement + password + invites + rate limits + domain allowlisting
    └── Unblock first paid pilots

Phase 8 (already in flight)
└── CSAT, audience segments, automation rules runner, analytics real data

Phase 9
└── Billing (Stripe), WhatsApp Cloud connector, SSO, SLA engine

Phase 10
└── Full omnichannel (SMS, email), HubSpot/Salesforce integration, LLM metering

Phase 11
└── Dashboard widget builder, A/B testing, GDPR tooling, public API
```

---

## Test coverage starting point

Currently **zero tests**. Recommended initial targets:

1. `packages/llm` — unit tests for `complete`, `embed`, `ragComplete` with mocked HTTP
2. `apps/api/src/routes/auth.ts` — login/register happy path + duplicate email + wrong password
3. `apps/api/src/routes/public-chat.ts` — widget chat SSE response shape
4. `apps/api/src/routes/channels.ts` — tenant isolation (tenant A cannot read tenant B channels)
5. `packages/runtime` — flow graph executor smoke tests

Suggested stack: **Vitest** (already installed) + **@fastify/test-helpers** + **MSW** for LLM provider mocking.
