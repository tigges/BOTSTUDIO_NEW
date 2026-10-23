# BotStudio product rules

BotStudio is a hybrid agent workforce platform: AI agents and human agents work the same conversation. A chat starts with the bot, the bot hands over, a human finishes it in the Inbox with every bot turn already in the thread. Nothing in the architecture may make that hard.

## How to use these rules
- These are product decisions, not suggestions. If a task conflicts with one, stop and say so instead of working around it.
- Feature briefs mark items `[FIXED]` (contract, do exactly this) and `[FREE]` (your call; tell me what you chose and why). Anything unmarked in a brief is `[FREE]`.
- Before designing a feature that appears in the capability matrix, read its rows in `docs/competitive/kore-artemis-teardown.md`. The "What Kore has" column is a reference implementation you may depart from; the verdict column says how far (COPY = same contract, ADAPT = same idea, your shape, SKIP = do not build).
- Never build a DSL, a code-first agent language, or a voice/telephony stack. The flow builder is the authoring surface; export is readable JSON/YAML, not a language.

## Flow builder
- Every flow step is either Deterministic or AI. An AI step cannot be saved without a goal, an exit condition and a max-turn limit.
- A Router node cannot be saved without a fallback route. Routes are ordered, each has an intent description and an optional structured guard; the UI shows which part evaluates deterministically and which via the model.
- Business constraints (require / limit / block before an action) and content guardrails (block / warn / redact / escalate / reask) are two different rule types and never share one list.
- The welcome has two fields: greeting and first question. Lint when they say the same thing. Per-channel overrides are optional; the default greeting is required.
- Startup lookups are read-only and non-blocking; a failed lookup never breaks the greeting.
- Conversation rules apply to every bot, whatever its chart (`packages/runtime` basics and `welcomeMiss` in `flow-runner.ts`); charts never model them. The opening is "Hi, I'm {persona} from {company}. What can I help you with today?". At the welcome question a hello, "what can you do?" or "again?" gets the topics ("I can help you with A, B, or C. What would you like?"), never the same question word for word. A welcome miss never hands over and never says "didn't catch that": a real question goes to the knowledge answer steered back to the topics, anything else gets a short apology and the topics. An annoyed guest gets an apology, not a handover. Asking for a person, the always-human list and a chart's own handover step still hand over.
- A project-wide "always route these words to a human" list exists and beats any automatic routing.
- Validation runs continuously; publishing with errors is blocked. Published versions are immutable; rollback is one click; defaults never change under a live flow.

## Hand to human
- Handoff to a human is never modelled as a handoff to another bot.
- One live-support switch per bot (Inbox header and Inbox settings) decides whether a handover reaches a person: off, on around the clock, or on during opening days and hours. When nobody can take the chat the bot keeps it, says so (and when the team is back), and never promises a person.
- The handoff payload always carries: reason, priority (low / medium / high / critical), tags, a summary, named variables, routing (queue, skills, numeric priority) and the return outcome contract (resolved / needs bot / needs follow-up).
- The full transcript travels by default. "Summary only" is an explicit opt-in.
- The conversation is the task: no separate task object for a live conversation. Approvals and data-entry tasks are a secondary Tasks tab, not the primary Inbox.
- The Inbox can run the same tools the bot can run, through the same tool registry.

## Tools
- One Tools registry for HTTP, Functions, MCP, Knowledge and Workflow tools. Same scaffold for all: name, LLM-facing description, typed parameters (rendered as JSON Schema), return type, declared effect (read / write / side effect), Testing tab.
- Credentials live only in Auth Profiles, never on a tool, never in a prompt, never in model context. An AI assistant that configures tools may reference a profile but may not create one that holds a secret.
- HTTP tools expose timeout, retries, circuit breaker and idempotency header, collapsed under Advanced with sane defaults.
- MCP tool definitions are fetched at configuration time and refreshed manually; say so in the UI.
- The model never supplies a transfer destination or an upload URL; those resolve from configuration.

## Knowledge
- The knowledge screen order is: sources → documents (with extraction quality) → chunks → one chunking panel → Search & Test (hybrid / semantic / keyword, top K, per-engine timing, "why this chunk") → citation policy → embedding model (with a "changing this re-embeds everything" warning) → vocabulary/synonyms.
- Every answer from the knowledge base carries its sources; the Inbox shows them.
- No pipeline canvas, knowledge graph, field-intelligence matrix or query-intelligence layer.

## Safety and data
- LLM consumers never receive plaintext PII; it is swapped for a stable token before any model call. Redaction has per-consumer render modes: end user, tool input, tool output, logs, human agent.
- De-tokenising PII before a human handoff is an explicit, warned toggle.
- Credential and secret scrubbing in logs is always on and cannot be disabled.
- One active guardrail policy per project. New rules default to Warn, not Block.
- RBAC is enforced at the API; the UI only hides. Every mutation writes an audit row with before/after.
- A workspace ADMIN is a customer's admin (anyone can register one). Host health, server config and anything that spans workspaces need `requirePlatformAdmin` (`PLATFORM_ADMIN_EMAILS`), not `requireRole('ADMIN')`.

## Analytics
- Outcome is a six-state enum (contained_resolved, contained_partial, contained_unresolved, escalated, abandoned, plus contained as a roll-up) shown as three buckets. Escalation rate is not the inverse of containment; never compute one from the other.
- Every metric card shows its denominator. A dash means no data, never zero. A metric is styled as "moved" only when the change clears the margin of both periods.
- Every LLM call is one ledger row: model, provider, tokens by class (input, cached, completion, reasoning, output), latency, time to first token, cost, source (runtime / retrieval / guardrail / eval / summarisation), conversation id, trace id. Cost per conversation is the sum and is visible in the Inbox header.
- Any LLM-as-judge or analytics pipeline shows its own cost next to its toggle.
- Filters (environment, channel, date) persist in the URL. Test/draft traffic is its own environment and never pollutes production numbers.
- One typed aggregate analytics endpoint (`metric, dimensions[], filters, range, granularity`) backs every dashboard widget; record-list endpoints (sessions, messages, traces, llm_calls) are the raw tier.

## Channels
- Every channel is the same connection object: name, environment binding, status, and Overview / Credentials / Configuration / Deployment tabs with a copyable webhook URL and routing key. Create the connection before registering the webhook, and say so in the UI.
- Rich content is channel-neutral (text, quick replies, card, carousel, list, media, form, feedback) and degrades per channel against a declared limits table; nothing is truncated silently.
- Inbound events are deduplicated on the provider's message id with a replay window.
- Channel help panels map HTTP status codes to the field that is wrong.

## Console
- Inbox is a top-level rail destination. It is never behind a "More" expander.
- Three execution settings are exposed per bot (model, response length, escalate after N seconds of tool wait). Everything else is platform-managed.
- Overview adapts to maturity: empty state with a checklist, building state with counts, live state with sessions, cost, deployments and activity.
- ⌘K opens a command palette over pages, bots, flows and actions.
- Every list has an empty state, a loading state, an error state with retry and a zero-results-after-filter state.

## Writing style for UI copy
- Name things by what the user recognises, not how the system is built. Active voice. Errors say what went wrong and how to fix it, naming the field, node or step.

## Naming
- The product is BotStudio. Do not add YBot, Ybot or YAI to code, copy, images, containers, headers, storage keys or docs.
- Never rename these. They are baked into stored data: the `ybot-secrets:` key salt in `apps/api/src/lib/secrets.ts` (it unseals every Auth Profile secret), the `ybot-pii:` prefix in `apps/api/src/lib/privacy.ts` (stable PII tokens), the Postgres database and user `ybot`, the host data folder `/volume1/docker/ybot`, and the demo login emails seeded on the live host.
- Old names that are still accepted so live customers keep working: widget globals `window.YBot*`, the `X-YBot-*` webhook headers (sent next to `X-BotStudio-*`), the `ybot_token` cookie and the `ybot-app` and `ybot-theme` browser keys (migrated on load). New code writes only the BotStudio names. Remove an alias only in a change that says so.

## Cursor Cloud specific instructions
- Install with `pnpm install --frozen-lockfile` (Node 22, pnpm 10). Build everything with `pnpm exec turbo run build`.
- Workspace packages are scoped `@botstudio/*`: apps in `apps/` (api, web, embed), libraries in `packages/` (shared, llm, db, ui, runtime). Build `packages/shared` and `packages/runtime` after editing them; the API and web consume their `dist`.
- Tests: `pnpm test` in `apps/api` and `apps/web` (or `pnpm exec turbo run test`). Typecheck a package with `pnpm exec tsc --noEmit -p .`.
- Live QA runs Playwright against https://app.botstudio.uk: `pnpm test:live`. Demo logins are in `qa/tests/helpers.ts`; `demo@bella.com` is the read-only check account.
- Every merge to `main` deploys to the Synology host through GHCR and Watchtower. The compose files, `Caddyfile` and `.env.production` on the host are copied there by hand, so a change to them only takes effect after someone follows `docs/deploy-synology.md`. Code must keep working with the host files that are already there.
