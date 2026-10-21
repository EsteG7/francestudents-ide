"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { AutoCompact, isContextOverflow } = require("../src/agent/auto-compact");

test("automatic compaction uses accumulated context and ignores replaced conversations", () => {
    const compact = new AutoCompact();
    compact.record("agent", "one", "instructions", "result", 79000);
    assert.equal(compact.shouldCompact("agent", "one", "x".repeat(6000), 100000), true);
    assert.equal(compact.shouldCompact("agent", "other", "hello", 100000), false);
    assert.equal(compact.shouldCompact("chat", "one", "hello", 100000), false);
});

test("compaction preserves current task and full agent restart instructions", async () => {
    const compact = new AutoCompact();
    compact.record("agent", "one", "Fix login", "Read src/login.js");
    const prepared = await compact.prepare("agent", "one", "tool output", () => "Full task and protocol", async prompt => {
        assert.match(prompt, /Fix login/);
        assert.match(prompt, /src\/login.js/);
        return "Login pending. Next: fix validation.";
    });
    assert.match(prepared, /Login pending/);
    assert.match(prepared, /Full task and protocol/);
    await assert.rejects(compact.prepare("agent", "one", "next", null, async () => ""), /résumé vide/);
    assert.ok(compact.get("agent", "one"));
});

test("compaction memory stays bounded and detects provider context overflow", () => {
    const compact = new AutoCompact();
    for (let i = 0; i < 40; i++) compact.record("chat", "one", "x".repeat(30000), "y".repeat(30000));
    assert.ok(compact.get("chat", "one").history.reduce((n, item) => n + item.content.length, 0) <= 120000);
    assert.equal(isContextOverflow(new Error("context_length_exceeded")), true);
    assert.equal(isContextOverflow(new Error("maximum context length is 128000 tokens")), true);
    assert.equal(isContextOverflow(new Error("HTTP 429 budget exhausted")), false);
});
