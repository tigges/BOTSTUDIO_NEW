# Kore.ai Artemis — full documentation teardown for BotStudio (17 Oct 2026)

Scope: all 203 pages of docs.kore.ai (≈418k words), read in full. This supersedes the 14 Oct teardown inputs (which drew on the older XO 11 docs and third-party reviews); docs.kore.ai now documents only the new **Artemis Agent Platform**. Everything below is from the docs unless marked *(inferred)*.

Full page: https://claude.ai/artifact/XMhsqgrcddNeDL6kCTSjRA

## 1. Headline findings

1. **Artemis is a compile-to-IR agent platform, not a bot builder.** Every agent is an ABL document (`.agent.abl` / `.agent.yaml`, ~34 top-level sections) that compiles to an IR the runtime executes. The visual editor, the Monaco code editor and the Arch AI assistant are three views of the same DSL. The console "is derived from the DSL definition".
2. **The "dual brain" reduces to one primitive worth stealing:** a per-step `REASONING: true | false` toggle inside a FLOW, with `GOAL`, `AVAILABLE_TOOLS`, `EXIT_WHEN` and `MAX_TURNS` on the reasoning steps, plus runtime-enforced `CONSTRAINTS` (business rules) separate from `GUARDRAILS` (content safety).
3. **Tools are one concept.** HTTP, Code, Knowledge Base, Workflow, MCP, WSDL/SOAP, Actions, Inbuilt and Agent Tables all live in one project-level registry with the same scaffold (LLM-facing description, typed params → JSON Schema, return type, Testing tab) and credentials only in shared **Auth Profiles**. The agent side is one `Attach Tool` action regardless of type.
4. **Kore has no human agent desk.** Its "Inbox" is a 600-word page: claim a task, approve, submit a form, watch a countdown. Live human conversations go to Genesys, Salesforce, ServiceNow, Five9 or Kore's own SmartAssist and are monitored read-only in "Transfer Sessions" (30-second polling, the only action is End). Handoff is configured in five different places. **This is BotStudio's wedge.**
5. **Observability is the deepest part of the product**: 200+ trace events per session, a span tree (Session > Turn > LLM call / Tool call / Decision / Handoff), a per-call LLM ledger with `source` (runtime / guardrails / pipelines / evals / arch) and session-level `estimatedCost`, four public analytics APIs, ClickHouse-style SQL dashboards, eleven toggleable analytics pipelines and a DAG editor for custom ones.
6. **Containment is a six-state enum collapsed to three buckets** (Resolved / Contained partial / Escalated), and the docs insist escalation "isn't the inverse of containment". Every metric card carries a denominator and a "dash means no data, not zero" rule.
7. **Testing = chat/voice simulator on the production pipeline + Evals.** No standalone test-case list; batch testing is an eval suite (Scenarios × Personas × Variations, LLM Judge / Code / Trajectory / Human Review evaluators, five adversarial persona types, $/token budgets, schedules, Arch autonomy Advisor/Copilot/Autopilot).
8. **Authoring is developer-grade.** Thirty how-to guides exist because routing, welcome messages, history strategy and classifier thresholds all need code and trace reading. A CX manager could edit copy in a template; they could not safely author a supervisor *(inferred)*.
9. **The platform is moving fast and unevenly**: 36 releases between 21 May and 12 Oct 2026, a large breaking-change set in v1.4.0, defaults flipped twice (history `auto→full`; 1.7.0 voice safeguards turned off again in 1.7.2), and visible doc inconsistencies (3 vs 4 environments, 36 vs 43 functions, `RETURN` vs `EXPECT_RETURN` both called legacy, an internal "Engineering needs to confirm" note left in a page, "coming soon" placeholders on three Insights pages).
10. **Voice is roughly a third of the surface** (pipeline vs realtime S2S, six providers, DTMF/IVR tools, PCI `SECURE_INPUT`, SIP header passthrough, outbound dialing API, recordings API, voice analytics). Out of BotStudio's scope; the only transferable idea is the Runtime-Guarded principle: the model converses, the runtime owns business actions.

## 2. What Artemis is

**Hierarchy:** Organization (optional) → Workspace/Tenant → Project → agents, supervisors, tools, KBs, workflows, forms, prompts, feedback templates. The project is the isolation boundary for deployment, access and analytics; moving assets means export/import (zip with `project.json`, `abl.lock`, layered folders; merge-based import with three-way conflict detection).

**Four planes:** Studio (authoring), Compiler (DSL → IR), Runtime, Operations. Runtime loop per message: authenticate and resolve session → reasoning loop (prompt, LLM, tool, repeat up to 10 iterations) → persist + emit traces → stream. Sessions `s-<uuid>` carry a thread stack (push on handoff, pop on return), a 40-message sliding window, 24 h idle TTL, 90-day history retention; "a session is the billable unit".

**Agent kinds:** every agent reasons by default; adding `FLOW:` makes it step-driven; `SUPERVISOR:` makes a routing-only agent. Reasoning agents get system tools `handoff`, `delegate`, `complete`, `escalate`, `fan_out`.

**Orchestration:** Supervisor evaluates `HANDOFF` rules top-to-bottom, first match wins, with `PRIORITY` override. `WHEN` can be structured (`customer_id IS SET`, evaluated without the model) or quoted natural language (deferred to the model). `HANDOFF` transfers ownership; `DELEGATE` fetches a result and keeps the conversation; `ESCALATE` is human-only. Context never transfers implicitly ("No data is automatically shared between agents"); `CONTEXT {pass, summary, history: full|auto|none|summary_only|last_n, memory_grants}`. Fan-out is a runtime capability (2–5 sub-tasks), not an authored section. Evaluation order per turn: ESCALATE → HANDOFF → DELEGATE → COMPLETE.

**Memory:** session variables (`RESET: per_session|per_activation|per_step|never`) and a persistent fact store with `SCOPE: user|project|execution_tree`, TTL, `SENSITIVE`/mask config; Remember triggers (`WHEN`) and Recall on lifecycle events.

**Workflows** are a separate durable engine ("minutes to days", survives pod restarts): Agent / Tool / Function / Integration / Human task / Condition / Loop / Delay nodes; webhook, cron, intake-form, "after session ends" and "after unsuccessful call" triggers; registered as a tool so agents can call them. The **Human task node** carries assignment (direct/conditional), consensus (first wins / all / N of), timeout + reminders, escalation ladder — and lands in the Inbox.

**Arch AI:** interview → blueprint → build → initial eval → optimize. Generates ABL, proposes diffs per section, reads traces to form root-cause hypotheses, patches as reviewable PRs; "Developers must approve every change" except in Autopilot. Exposed in Studio, via an MCP server (Claude Code, Cursor, Codex, Copilot) and a CLI.

**Release cadence:** v1.0 on 21 May 2026 → v1.8.0 on 12 Oct 2026. Themes by weight: voice (every release), governance/BYOK/SSO/KMS, analytics in three steps (dashboards 1.3.0 → public widget API 1.4.0 → Generations ledger + public analytics APIs 1.5.0 → credential attribution 1.7.0 → JWE 1.7.2 → latency profiles 1.8.0). Human Task node + Forms only arrived in v1.7.0 (27 Sep). Nothing is labelled beta.

## 3. Capability map

### 3.1 Build

| Area | What Kore has | BotStudio verdict |
|---|---|---|
| Project overview | Adapts to maturity: Empty → Building → Live (sessions, tokens, cost, deployments, activity) | **COPY** |
| ⌘K palette | Fuzzy nav over pages, agents, actions | **COPY** (already planned) |
| Agent editor | Form sections Identity / Execution / Tools / Capabilities / Coordination / Lifecycle / Behavior / NLU; `< > ABL` toggle to Monaco with Outline + Diagnostics; agents with FLOW open a canvas | **ADAPT**: keep two-way visual ↔ readable JSON/YAML export with diff; do not build a DSL |
| Per-step REASONING toggle | Deterministic/AI per flow step; AI steps need GOAL, EXIT_WHEN, MAX_TURNS | **COPY** — the single best idea in the docs |
| GATHER (slot filling) | 15 types, infer-from-context with confirm, corrections, digressions, validation REGEX/CODE/LLM, PII masking, per-field voice ASR | **COPY** as a "Collect info" node |
| CONSTRAINTS vs GUARDRAILS | REQUIRE/LIMIT/RESTRICT/WARN with ON_FAIL (message, HANDOFF, ESCALATE, BLOCK) vs content rules | **ADAPT** as two rule-card types |
| Behavior profiles | Priority + WHEN overrides for instructions/tone/tools/flow by channel, sentiment, tier | **ADAPT** as "Tone rules" with auto-escalate on frustration |
| Rich content | Channel-neutral CAROUSEL / QUICK_REPLIES / LIST / TABLE / FORM / FEEDBACK templates bound to tool results, with per-channel fallbacks and limits | **COPY** |
| Multi-intent | primary_queue (default) / sequential / parallel / disambiguate / auto; max 3 intents, 0.6 confidence | **ADAPT**: primary + "you also asked about X" only |
| Prompt library | Templates, Draft/Active, versions with compare, Test & Compare across models with latency/tokens, References tab | **COPY** |
| Forms | Reusable, versioned, pinned per run, themed, intake-form trigger | **ADAPT**, lower priority |
| Workflows engine | Durable, human task node, cron/webhook/intake triggers | **COPY the Human task** (approvals, payouts, RG reviews); schedule/wait node later |
| Arch AI | Interview → blueprint → build → eval → optimize | **ADAPT**: "describe your bot → draft flows + KB" wizard with accept/reject diffs; no self-patching loop |
| Welcome patterns | ON_START with branches, per-channel payloads, read-only startup lookups, "orient + one next step" | **COPY** as UI defaults (greeting + first question fields, per-channel override, lint for duplicate greeting) |
| Routing patterns | Clarify-before-routing, priority gates with resume-original-intent, mandatory fallback, keyword veto | **COPY** as a Router node that cannot be saved without a fallback, plus a "words that always go to a human" list |

### 3.2 Tools, knowledge, integrations

| Area | What Kore has | Verdict |
|---|---|---|
| Unified Tools registry | Nine tool types, one scaffold, `Attach Tool` on the agent; description "used by the LLM while selecting tools"; generated JSON Schema visible | **COPY** — `/build/tools` replaces integrations + webhooks + functions + MCP |
| Auth Profiles | API key / Bearer / Basic / Custom header / OAuth2 (PKCE, JIT, Preflight) / mTLS …; never on the tool; MCP builder refuses to create credential-bearing profiles | **COPY** |
| HTTP tool resilience | cURL import, timeout 30 s (max 120), retries, circuit breaker (5 / 60 s), rate limit, idempotency header, SSRF protection | **COPY** |
| Code tools | JS/Python `main()`, 256 MB, 5 s | **COPY** (BotStudio Functions) |
| MCP tools | SSE / Streamable HTTP, import all, per-server rate limit, manual Refresh ("definitions aren't automatically synced") | **COPY** |
| Actions + Scenario Fixtures | Integration + action + auth profile; canned responses for testing | **COPY fixtures** |
| Inbuilt tools | 11 (transfer, availability, hours, queue, IVR, DTMF, attachments); "the platform owns sensitive values"; model never supplies a destination URL | **ADAPT**: `transfer_to_human`, `check_availability`, `check_hours`, `get_attachment_url`, `route_attachment` |
| Agent Tables | Scoped store Project / End User / Session, Sensitive columns, least-privilege ops, ≤50 rows/read | **ADAPT** (BotStudio Database with Contact scope) |
| Tool execution API | List / Describe / Execute with declared `effect`; sync only | **ADAPT** so the Inbox can run the same tools as the bot |
| Knowledge ingestion | 100 MB/file, 40/batch; crawler (sitemap / guided / direct, depth 5, 1,000 pages, cookie-consent auto-dismiss, scheduled); FAQ CSV with field usage; ~90 connectors, 12 documented, mostly ACL-aware with Proposal → Dry run → Approve | **ADAPT**: Zendesk, Confluence, SharePoint, Drive, web crawl, FAQ CSV, Custom HTTP |
| Retrieval | Three chunking strategies, BGE-M3 default embedding, OpenSearch hybrid, re-rank then permission filter, citations policy (direct / time-limited / click-limited / none), Search & Test with per-engine timings and Resolution Chain Debug | **ADAPT** the KB config screen (sources → documents with quality score → chunks → one chunking panel → Search & Test → citations → embedding picker → vocabulary) |
| Enterprise search extras | Pipeline canvas (API Call / LLM / Custom Script stages), Field Intelligence, Vocabulary, Knowledge Graph ("on request"), Query Intelligence (not used from agents) | **SKIP** |
| Contact-centre integrations | CCAI/SmartAssist, Genesys, Five9, Salesforce MIAW, ServiceNow; routing vocabulary queue / skills / priority 0–10 / post-agent Return or End | **COPY the vocabulary**, resolve internally; external targets later |
| Developer surface | CLI (`agents`, `tools`, `connector`, `export/import`, `git`, `eval run --min-pass-rate`), MCP server for Claude Code/Cursor, 15 model providers, Microsoft Foundry | **SKIP** at launch; MCP server for the bot config later |

### 3.3 Channels and handoff

| Area | What Kore has | Verdict |
|---|---|---|
| Connection object | Same five-field create dialog and Overview / Credentials / Configuration / Deployment tabs for all 27 channels; copyable webhook + routing key; "create the connection before registering the webhook" | **COPY** |
| Channel set | Slack, LINE, Teams/Copilot, WhatsApp (Meta / Infobip / Gupshup), Messenger, Instagram, Twilio SMS, Telegram, Zendesk Sunshine, Genesys ×3, Email, AI for Work, A2A, AG-UI, Agent Assist, HTTP Async webhook, Web/Mobile SDK, five voice channels | **ADAPT**: WhatsApp (Meta first), web widget, email, Telegram, Instagram, Messenger; Slack/Teams internal |
| Per-channel limits and dedupe | Buttons/char caps per channel, replay windows (Messenger 5 min), dedupe on provider IDs, per-channel streaming chunk size | **COPY** into the rich-content normaliser |
| Troubleshooting tables | HTTP status → which field is wrong (401 / 404 / 400) | **COPY** into channel help panels |
| Diagnostics-only activation | Genesys: Testing tab probes, Validation Evidence (P95s), promotion gate | **ADAPT**: "Send test message" + Recent deliveries only |
| HTTP Async webhook channel | `202` + callback with `response`, `outcome`, `trace_context`, `responseProvenance.disclaimerRequired`, echoed `metadata` | **COPY** |
| Web SDK | `pk_` + allowed origins, bootstrap-token exchange, WS ticket, per-message metadata, `richContent` variants, `actions`, 25 MB uploads, theme object, "Show Agent Activity Updates" | **COPY** scenarios 1–2; skip customer JWE |
| ESCALATE contract | triggers (WHEN / REASON / PRIORITY / TAGS), `context_for_human` (variables or templated summary), routing (queue / skills / priority / metadata), `on_human_complete` (resolved / needs_agent / needs_followup) | **COPY field-for-field** as the "Hand to human" node |
| Inbox | Task queue: claim, approve, data entry, countdown | **ADAPT** as a secondary Tasks tab; the primary Inbox is the conversation desk Kore lacks |
| Transfer Sessions | Lifecycle pending → queued → active → post_agent → ended; provider session ID; metadata JSON | **ADAPT** as conversation states + a later "Transfers" view for external CCaaS |
| Agent Assist channel | Bot as copilot inside a third-party desk; history as `aa_uamsgs` | **ADAPT** natively as composer suggestions in the Inbox |
| Voice | Everything | **SKIP** |

### 3.4 Test, evaluate, govern, deploy

| Area | What Kore has | Verdict |
|---|---|---|
| Studio test | Project-level "Test your agents" and per-agent "Chat with Agent"; three-pane debug (sessions / transcript / diagnostics); same pipeline as production incl. guardrails; symptom → trace-event triage table | **COPY** |
| Evals | Suite = Scenarios × Personas × Variations × Evaluators; persona style/knowledge/traits/goals/constraints + five adversarial types; LLM Judge with CoT, Pass/Fail or 1–5, bias mitigation; $/token budget; schedules; Behavior Score / Coverage / Evaluators / Last Run; Overview / Latest run / History; Human Review evaluator | **COPY** the shape; Human Review routes into the Inbox; autonomy Advisor + Copilot only |
| Guardrails | Project + agent policies (one active per project); Input / Output / Both; actions Block / Warn / Redact / Escalate / Fix / Reask / Filter; threshold; fail-open/closed; streaming modes; providers OpenAI Moderation or self-hosted Llama Guard / Qwen3Guard; UI ↔ DSL one-to-one | **ADAPT**: one project policy, Block / Warn / Redact / Escalate / Reask, "start with warn" default |
| PII | Built-ins + custom regex/entity/model patterns; context anchoring; redaction label / mask / random / tokenize; per-consumer render modes Users / Tool input / Tool output / Logs; Live Test; "LLM consumers never receive plaintext PII"; de-tokenize-before-human-transfer as a warned toggle; credential scrubbing always on | **COPY** incl. a Human-agent consumer |
| Deployment | dev → staging → prod, one active deployment per env, Promote / Rollback / Retire, draining, Base + per-env variables with Secret flag, approval slider Strict / Standard / Open, scoped `abl_` platform keys vs public `pk_` SDK keys | **ADAPT** to draft → live (+ optional staging); copy the approval slider |
| Import/export | Layered async API with conflict strategy replace / skip / merge, dry-run preview, lockfile hashes, Git sync | **COPY** the JSON bundle + conflict strategy; skip Git |
| Roles | Workspace Owner / Admin / Operator / Member / Viewer; project Admin / Developer / Tester / Viewer; ~200 `resource:action` permissions; "reveal"-class grants flagged; custom roles with parent inheritance | **COPY** two-level model + add Human Agent / Supervisor roles |
| Audit log | Category, action, actor, target, source, IP, trace, before/after JSON; ≥90 days | **COPY** (already in spec) |
| LLM configuration | Credentials / Model Catalog (tiers Fast / Balanced / Powerful / Voice) / Project Access with per-operation routing and "Why this model?" precedence trail; Model Pricing table (effective-dated) feeding cost | **COPY** pricing table + per-feature model assignment with precedence explanation |
| Alerts | Metric (LLM latency / cost window / error rate, tool errors, sentiment, frustration), aggregation p95/p99, window, cooldown, email/webhook | **ADAPT**: cost budget + error-rate + frustration alerts |
| Feedback templates | NPS / CSAT / thumbs / comment-only; conditional follow-up; Text/Voice preview; Usage tab; public API that rejects (never clamps) out-of-range ratings | **COPY wholesale** |
| SSO / KMS / BYOK | SAML/OIDC, JIT, group mapping; AWS/Azure/GCP KMS with compliance levels | **SKIP** until Enterprise tier |

### 3.5 Analytics

| Area | What Kore has | Verdict |
|---|---|---|
| At a Glance | Conversations, Containment Rate, Quality Score, Avg Sentiment, Period Savings, Escalation Rate — each with a denominator; Outcome Distribution three buckets; "What's driving the metrics" per agent | **COPY** |
| ROI tab | Human cost / conversation, FTE monthly cost, AHT, fallback AI cost; Period Savings, ROI, FTE equivalent, cost / conversation | **ADAPT** with measured human handle time from the Inbox instead of assumptions |
| Quality Monitor / Agent Performance | Faithfulness, Knowledge Coverage, Safety, Context Preservation, Hallucination Rate, Knowledge Gaps; Critical / Warning / Healthy | **ADAPT**: 3–4 judge dimensions as toggles showing cost |
| Customer Insights | Intents, sentiment, Frustration Rate (repeated questions, negative language, escalation requests), sentiment trajectory Improving / Stable / Declining, filters in URL | **COPY** |
| Feedback Insights | Funnel Presented → Scored → Commented → Abandoned; movement only beyond margin; segments by agent / language / version | **COPY** |
| Agent Transfer | Queue wait, abandonment, per-human AHT / resolution / CSAT — gated behind SmartAssist | **ADAPT** natively as Inbox analytics, one timeline with the AI view |
| Analytics Explorer | Sessions / Traces (timeline + waterfall) / Generations ledger (model, source, credential, TTFT, cost) / ad-hoc SQL capped at 1,000 rows | **ADAPT**: waterfall over flow nodes; ledger as `llm_calls` table |
| Custom dashboards | Governed SQL with tenant/project/date tokens, widget editor, import/export, public widget-data API | **ADAPT**: constrained metric × dimension builder that can emit SQL |
| Analytics pipelines | 11 built-ins + DAG editor; Draft → Validate → Test → Activate | **ADAPT**: reuse the flow canvas for evaluation flows |
| Public APIs | sessions / traces / llm-ledger / conversation-history; limit ≤10,000, 1 MiB budget, `dataMode summary|full`, optional JWE; no aggregate endpoint | **ADAPT**: one typed aggregate `POST /analytics/query` first, record lists second |
| Billing & Usage | Session-minute billing units, excluded sessions by policy | **SKIP** |
| Voice analytics | MOS, ASR, E2E latency, barge-in, DTMF fallback | **SKIP** |

## 4. Where Kore is weak (and BotStudio can be strong)

**No human desk.** The platform assumes a CCaaS owns the human side. Handoff config is spread across the agent DSL, Project Settings > Agent Transfer, Operate > Transfer Sessions, Operate > Inbox and channel-level queue settings. The Agent Transfer analytics page is hidden until SmartAssist is connected. Kore's own troubleshooting lists "Human agent lacks context" as the top handoff issue because conversation history is opt-in. BotStudio's answer: the conversation *is* the task, the ESCALATE payload becomes the conversation header, `on_human_complete` becomes Resolve / Send back to bot / Follow up, transcript included by default, Agent-Assist suggestions native in the composer.

**Developer-grade authoring.** Thirty guides teach things a UI should enforce: don't repeat the welcome, every router needs a fallback, quoted `WHEN` text with uppercase AND/OR is misclassified (an admitted bug), unquoted prose produces undefined-variable warnings, button `VALUE` and route `WHEN` literals drift, `AGENTS:` roster looks like routing but isn't, the supervisor can go silent with no catch-all, pipeline config "compiles but does not run" if the project gate is off.

**IA in flux.** Studio vs Agent Studio, Arch vs AI Architect, workspace vs tenant; environment counts differ between pages; env vars live in two places; guardrail policies appear under both AI Configuration and Govern; Arch has Audit Logs and Traces tabs with identical cards; the Inbox sits under a "More" expander. Settings sprawl: Runtime Configuration alone exposes ~20 cards and well over 100 numeric knobs.

**Enterprise gating.** Knowledge Graph, CCAI integration, Agent Tables, analytics pipelines, Decision Models, Agent 365 are "on request", feature-flagged or "when enabled for your deployment"; SSO, KMS and call recording are Enterprise-only; AWS/GCP vaults are listed but not selectable; three Insights pages may show "coming soon".

**Churn risk.** Breaking changes in 1.4.0 (compiler warnings block publishing, `canRespondDirectly` deprecated, routers can't DELEGATE, tools must declare `context_access`, new projects start with no PII built-ins), default flips (history, voice safeguards, idempotency), and docs that contradict each other on canonical syntax. This matches the G2 complaint in the 14 Oct notes that platform updates break live flows.

**Honest metrics are a strength to copy, not a weakness** — but note that quality, sentiment and frustration all run LLM-as-judge pipelines on every conversation, and Kore itself warns these "can account for a large share of total calls". Cost of insight must be visible.

## 5. Revised adoption plan for BotStudio

**Now (ship next)**
- Containment tiles with denominators and the six-state outcome enum on `/overview`; "dash means no data".
- "Hand to human" node exposing the ESCALATE contract (reason, priority, tags, summary template, variables, queue/skills, return outcome); transcript carried by default.
- Router node: ordered routes with intent description + optional structured guard, clarify-once default, mandatory fallback, keyword veto list.
- Per-step Deterministic / AI toggle in the flow builder; AI steps require goal, exit condition, max turns.
- Welcome settings: greeting + first question, per-channel override, duplicate-greeting lint.
- Suggested replies + sources in the Inbox composer; "why did it answer that?" chunk viewer.
- ⌘K palette; adaptive Overview (Empty / Building / Live).

**Next**
- `/build/tools`: one registry (HTTP with cURL import and resilience knobs, Functions, MCP with manual refresh, Knowledge, Workflow), Auth Profiles, Testing tab, Scenario Fixtures, declared `effect`.
- `/build/test`: three-pane debug console on the production pipeline; eval suites (scenarios × personas × evaluators, adversarial personas, LLM judge with CoT, budget, schedule); Human Review evaluator creates Inbox review tasks; block publish on failing gate.
- LLM ledger per call (model, tokens by class, latency, TTFT, cost, source) → cost per conversation in the Inbox header, budget alert, Model Pricing table, per-feature model assignment with "why this model".
- Guardrails + PII card: one project policy, Block / Warn / Redact / Escalate / Reask, built-in + custom patterns with Live Test, per-consumer render modes including Human agent, de-tokenize-on-handoff toggle.
- Collect-info node with infer/confirm/validate/PII mask; rich-content templates with per-channel limits.
- Channel connection object with Setup Instructions, status-code troubleshooting, Recent deliveries; HTTP Async webhook channel; Web SDK bootstrap-token auth.
- Prompt library with Test & Compare; feedback templates (NPS / CSAT / thumbs / comment) with funnel analytics.

**Later**
- Human task node (approvals, data entry, consensus, SLA ladder) and durable wait/schedule nodes, surfaced as Inbox tasks.
- Tone rules (behavior profiles) with auto-escalate on frustration; frustration rate + sentiment trajectory in analytics.
- Trace waterfall over flow nodes with a "Why this route?" panel listing every candidate route and the evaluated values.
- Evaluation flows on the flow canvas (conversation closed → judge → metric); 3–4 quality dimensions with visible judge cost.
- Typed aggregate analytics endpoint + session / message / trace / llm-call list APIs; constrained dashboard builder with CSV and JSON import/export.
- Agent Tables-style Contact / Conversation scoped store with Sensitive columns; Inbox can execute the same tools as the bot.
- Project export/import bundle with merge / replace / skip; approval slider Strict / Standard / Open.
- External transfer targets (Genesys, Zendesk, Salesforce) with a Transfer Sessions-style monitor; A2A exposure; MCP server for the bot config; Enterprise tier (SSO, audit export, BYOK).

## 6. Navigation implications (delta to the rebuild prompt)

- Top-level rail stays; **Inbox must not sit behind a "More"**.
- `Build` tabs → `Flows · Tools · Test · Prompts · Forms` (Tools absorbs Functions, API, Integrations; Events stay under Flows triggers).
- `/build/flows` gains: Router node, Hand-to-human node, Collect-info node, Deterministic/AI step toggle, template gallery, node comments.
- `/overview`: containment outcome strip, cost tile, maturity-adaptive layout.
- `/inbox/chats`: conversation header shows escalation reason / priority / tags / summary / cost; Resolve / Send back to bot / Follow up; composer suggestions; secondary `Tasks` tab.
- `/analytics`: At a Glance, Quality, Customers, Feedback, Inbox (human) — one filter bar with URL state; Explorer (sessions / traces / LLM calls).
- `/settings`: Guardrails & PII card, Models & pricing card, Alerts card, Approval policy slider, Export/Import.

## 7. Numbers worth remembering

Tool iterations per turn 10 · conversation window 40 messages · session idle TTL 24 h · history retention 90 days · HTTP tool timeout 30 s (max 120) · code tool 256 MB / 5 s · KB upload 100 MB/file, 40 files/batch · crawl 1,000 pages, depth 5 · Agent Table read ≤50 rows · multi-intent max 3 @ 0.6 · short-circuit threshold 0.85–0.9 · fan-out 2–5 · handoff depth 10 · eval suite ≤500 scenarios, 10 personas, 12 evaluators · evals = S × P × V conversations · guardrail threshold default 0.7, one active policy per project · invites expire 7 days · audit ≥90 days · analytics API limit 10,000, 1 MiB budget · SQL results 1,000 rows · dashboard widgets 200 columns · Web SDK uploads 25 MB × 10 · Messenger replay window 5 min · 27 channels · 200+ trace events/session · 36 releases in 21 weeks.

## 8. Sources

docs.kore.ai, all 203 pages listed in https://docs.kore.ai/llms.txt (Artemis Agent Platform: overview, concepts, ABL reference ×15, ABL how-to ×30, tools, knowledge, connectors ×12, integrations ×11, channels ×20, voice, escalation, inbox, transfer sessions, SDK ×4, testing, evals, safety, PII, deployment, administration ×12, analytics ×9, API reference ×29, release notes v1.0–v1.8.0). Cluster notes with verbatim quotes are retained in the session workspace.
