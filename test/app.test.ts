import assert from "node:assert/strict";
import { test } from "node:test";
import { createGreeting, escapeHtml, normalizeName } from "../src/app.js";

test("normalizeName falls back to 'world' for empty input", () => {
  assert.equal(normalizeName(""), "world");
  assert.equal(normalizeName("   "), "world");
  assert.equal(normalizeName(null), "world");
  assert.equal(normalizeName(undefined), "world");
});

test("normalizeName trims and caps length", () => {
  assert.equal(normalizeName("  Ada  "), "Ada");
  assert.equal(normalizeName("a".repeat(100)).length, 64);
});

test("createGreeting builds a message with ISO timestamp", () => {
  const fixed = new Date("2024-01-01T00:00:00.000Z");
  const result = createGreeting("Grace", fixed);
  assert.equal(result.message, "Hello, Grace!");
  assert.equal(result.name, "Grace");
  assert.equal(result.timestamp, "2024-01-01T00:00:00.000Z");
});

test("escapeHtml neutralizes markup", () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
  );
});
