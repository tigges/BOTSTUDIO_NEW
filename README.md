# Cursor briefs for BotStudio

Where things live:

```
AGENTS.md                                  product rules, always loaded by Cursor (visible file, no dot-folder needed)
.cursor/rules/botstudio-product.mdc        same rules in Cursor's native format; harmless if your upload skipped it
docs/competitive/kore-artemis-teardown.md  the evidence; attach with @ when running a brief, never paste
briefs/00-brief-template.md                the [FIXED] / [FREE] brief shape
briefs/01-hand-to-human-node.md            first feature brief, ready to paste
```

How to run a feature:

1. Open Cursor chat in Agent mode.
2. Type `@` and attach `docs/competitive/kore-artemis-teardown.md`.
3. Paste the whole brief. Wait for the three-part reply (approach, steers wanted, files) before saying "go".
4. When it finishes, read its list of `[FREE]` decisions and its "bent rules" line before reviewing code.

Rules of thumb: keep AGENTS.md under about 120 lines and move feature detail into briefs. If a `[FREE]` decision should apply everywhere, promote it to AGENTS.md. If a brief has more `[FIXED]` than `[FREE]` lines, it is a spec, not a brief.
