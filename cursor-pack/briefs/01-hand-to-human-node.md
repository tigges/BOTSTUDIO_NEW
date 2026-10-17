# Feature brief: Hand to human node

Build the **Hand to human** node for the flow builder, its runtime executor, and the Inbox-side rendering of what it carries, in `apps/web`, `apps/runtime` and `packages/shared`.

**Why it exists.** When the bot can't finish, a person picks the conversation up in the Inbox and already knows why it arrived, how urgent it is, what the customer wanted and what was collected. Today the Live chat node only creates a ticket; this node replaces it.

**Reference.** Read the rows "Escalate contract", "Kore Inbox", "Transfer Sessions", "Agent Assist channel" and "Inbuilt tools" in `docs/competitive/kore-artemis-teardown.md` §3.3, and the "No human desk" card in §4. Kore's ESCALATE block is the reference contract (verdict COPY); their Inbox and Transfer Sessions pages are what we are deliberately not copying (verdict ADAPT): the conversation is the task, there is no separate transfer monitor for internal handoffs.

**Contract**
- [FIXED] Node type `handoff.human`, registered like every other node in `packages/shared/nodes/` (one file: type, category `handoff`, icon, defaultData, Zod schema, ports, Config, execute). Adding it touches no other file.
- [FIXED] Payload schema (Zod, exported as `HumanHandoff`):
  - `reason: string` (required, variable interpolation allowed)
  - `priority: 'low' | 'medium' | 'high' | 'critical'`
  - `tags: string[]`
  - `summary: { mode: 'auto' | 'template', template?: string }` — rendered to a string at execution time
  - `variables: string[]` — names of flow/global variables to attach, resolved to `{ name, value }[]` at execution
  - `routing: { groupId?: string, skills: string[], priority: number (0–10, 0 highest), postAgentAction: 'return_to_bot' | 'end' }`
  - `transcript: 'full' | 'summary_only'` — default `'full'`
  - `onComplete: { resolved: NodePortRef, needsBot: NodePortRef, needsFollowUp: NodePortRef }` — three out ports, all optional to wire
- [FIXED] Execution: create or update the `Ticket` for the conversation, set `status: open`, `priority`, `tags`, `groupId`, store the rendered payload on the ticket as `handoff: Json`, mark the conversation `escalated`, suspend the `SessionMachine` at this node, queue the ticket. When the human resolves with one of the three outcomes, resume the machine on the matching port; `return_to_bot` with no port wired completes the flow.
- [FIXED] Lifecycle states exposed on the conversation: `pending → queued → active → post_agent → ended`. Emit a `FlowStep` for the handoff and a trace event for each state change.
- [FIXED] PII: variables flagged sensitive stay tokenised in the payload unless the tenant setting "Reveal PII to human agents" is on; that setting shows a warning when enabled.
- [FIXED] Inbox › Chats thread header shows reason, priority pill, tags, summary, the attached variables, and the cost of the bot portion of the conversation. The three resolution actions are labelled `Resolve`, `Send back to bot`, `Needs follow-up`.

**Your call**
- [FREE] Layout of the node config slide-over (ordering, grouping, whether routing is collapsed by default).
- [FREE] How `summary.mode = 'auto'` is produced (LLM call via `packages/llm` on the last N turns, or a deterministic template over intent + collected variables). Record its cost in the ledger either way.
- [FREE] Whether `skills` are free-text chips or a picker over `AgentProfile.skills`; whether `groupId` defaults from the bot's settings.
- [FREE] How variable selection works in the config (multi-select of declared variables, or "all collected in this flow" with exclusions).
- [FREE] The shape of the header card in the Inbox within `packages/ui` conventions, and whether variables render as a grid or a collapsible list.
- [FREE] Where suspend/resume state lives (on `Conversation`, on `Ticket`, or a new `HandoffState` model), as long as a redelivered message does not advance the session twice.
- [FREE] Migration strategy for existing flows that use the old `Live chat` node (auto-migrate or deprecate with a banner).

**Not in scope.** External transfer targets (Genesys, Zendesk, Salesforce), voice/SIP transfer, agent assist suggestions in the composer, SLA timers, a separate transfer-monitoring page.

**Done when.** The seeded fallback flow escalates through this node; in the Inbox I see reason, priority, tags, summary, variables and cost in the header with the full bot transcript below; clicking `Send back to bot` resumes the flow on the `needsBot` port and the bot says the next line; the flow-engine test harness has a case for each of the three outcomes; a message delivered twice during suspension does not create two tickets.

**Before you write code**, reply with: (1) the trickiest part and your approach, (2) any `[FREE]` item where you want a steer, (3) the files you will touch. Then build. When finished, list every `[FREE]` decision you made in one line each, and any place you had to bend a rule in `botstudio-product.mdc`.
