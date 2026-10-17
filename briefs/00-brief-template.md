# Feature brief: <name>

Paste this whole file into the Cursor chat (Agent mode) with `@.cursor/rules/botstudio-product.mdc` and `@docs/competitive/kore-artemis-teardown.md` attached. Replace the angle-bracket parts. Keep roughly four to six `[FIXED]` lines and more `[FREE]` lines than `[FIXED]`; if everything is fixed, write the code yourself.

---

Build **<feature>** in <app / package>.

**Why it exists.** <one or two sentences on the user outcome, in the user's words>

**Reference.** Read the rows for "<capability names>" in `docs/competitive/kore-artemis-teardown.md` §3 before designing. Treat Kore's version as a reference implementation, not a spec. The verdict for this feature is <COPY / ADAPT>, which means <same contract / same idea, your shape>.

**Contract**
- [FIXED] <data shape, field names, states, invariants that other parts of the product depend on>
- [FIXED] <…>
- [FIXED] <…>
- [FIXED] <where it lives in the navigation and the route>

**Your call**
- [FREE] <layout and interaction of the config UI>
- [FREE] <how a derived value is produced, e.g. the summary>
- [FREE] <component choices within packages/ui>
- [FREE] <migration / storage details inside the existing schema conventions>
- [FREE] <…>

**Not in scope.** <things the agent will be tempted to build; name them so it doesn't>

**Done when.** <two or three observable checks, ideally one end-to-end: "a bot conversation escalates and I finish it as a human agent with the transcript in view">

**Before you write code**, reply with: (1) the trickiest part and your approach, (2) any `[FREE]` item where you want a steer, (3) the files you will touch. Then build. When finished, list every `[FREE]` decision you made in one line each, and any place you had to bend a rule in `botstudio-product.mdc`.
