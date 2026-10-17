# Cursor pack for BotStudio

Drop these into the repo root. Paths matter: Cursor loads `.cursor/rules/*.mdc` automatically.

```
.cursor/rules/botstudio-product.mdc      always-on product rules (the decisions)
docs/competitive/kore-artemis-teardown.md the evidence; referenced on demand, never pasted
briefs/00-brief-template.md               the [FIXED] / [FREE] brief shape
briefs/01-hand-to-human-node.md           first feature brief, ready to paste
```

How to run a feature:

1. Open Cursor chat in Agent mode.
2. Attach `@.cursor/rules/botstudio-product.mdc` (it is already always-on, attaching makes it visible in the thread) and `@docs/competitive/kore-artemis-teardown.md`.
3. Paste the whole brief. Wait for the three-part reply before saying "go".
4. When it finishes, read its list of `[FREE]` decisions and its "bent rules" line before reviewing code.

Rules of thumb: keep the rules file under about 120 lines; move anything feature-specific into a brief. If a `[FREE]` decision turns out to matter across features, promote it to the rules file. If you find yourself writing more `[FIXED]` than `[FREE]` lines, the brief is a spec, not a brief; write the code yourself or split it.
