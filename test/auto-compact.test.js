"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { AutoCompact, isContextOverflow } = require("../src/agent/auto-compact");

test("automatic compaction uses accumulated context and ignores replaced conversations", () => {
    const compact = new AutoCompact();
    compact.record("agent", "one", "instructions", "result", 79000);
    assert.equal(compact.shouldCompact("agent", "one", "x".repeat(6000), 100000), false);
    compact.record("agent", "one", "next", "result", 93000);
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
    assert.equal(isContextOverflow(new Error("maximum token limit")),true);
    assert.equal(isContextOverflow("MAXIMUM TOKEN LIMIT exceeded"),true);
    assert.equal(isContextOverflow(new Error("maximum tokens limit of 16384")),true);
});

test("reported input replaces estimates and can decrease after server context editing", () => {
    const compact = new AutoCompact();
    compact.record("chat", "one", "x".repeat(40000), "a", { inputTokens: 1000, outputTokens: 50 });
    assert.equal(compact.get("chat", "one").tokens, 1050);
    compact.record("chat", "one", "more", "answer", { inputTokens: 1200, outputTokens: 60 });
    assert.equal(compact.get("chat", "one").tokens, 1260);
    compact.record("chat", "one", "edited", "answer", { inputTokens: 500, outputTokens: 20 });
    assert.equal(compact.get("chat", "one").tokens, 520);
});

test("compaction adapts to large and small windows and unknown models", () => {
    const compact = new AutoCompact();
    compact.record("chat", "one", "requirements", "answer", { inputTokens: 190000, outputTokens: 200 });
    assert.equal(compact.shouldCompact("chat", "one", "next", { contextWindowTokens: 1050000 }), false);
    assert.equal(compact.shouldCompact("chat", "one", "next", { contextWindowTokens: 200000 }), true);
    assert.equal(compact.shouldCompact("chat", "one", "next", { contextWindowTokens: null }), false);
    assert.equal(compact.shouldCompact("chat", "one", "next", { contextWindowTokens: 1050000, overrideTokens: 100000 }), true);
});

test("server occupancy overrides an excessive estimate and is cached per model", async () => {
    const compact = new AutoCompact();
    const policy = { model: "large", contextWindowTokens: 1050000 };
    compact.record("chat", "one", "instructions", "result", 1000000);
    let calls = 0;
    const usage = async () => { calls++; return { contextUsagePercent: 15 }; };
    assert.equal(await compact.check("chat", "one", "next", policy, usage), false);
    assert.equal(await compact.check("chat", "one", "next", policy, usage), false);
    assert.equal(calls, 1);
    assert.equal(await compact.check("chat", "one", "next", { model: "small", contextWindowTokens: 200000 }, async () => ({ contextUsagePercent: 96 })), true);
});

test("unknown windows use server percentage; invalid samples and failures do not break sending", async () => {
    const compact = new AutoCompact();
    compact.record("chat", "one", "requirements", "answer", 900000);
    assert.equal(await compact.check("chat", "one", "next", { model: "unknown" }, async () => ({ contextUsagePercent: 97 })), true);
    assert.equal(await compact.check("chat", "one", "next", { model: "different" }, async () => ({ contextUsagePercent: "97" })), false);
    assert.equal(await compact.check("chat", "one", "next", { model: "offline", contextWindowTokens: 1050000 }, async () => { throw Error("offline"); }), false);
});

test("server context reduction invalidates a cached high occupancy", async () => {
    const compact = new AutoCompact();
    const policy = { model: "large", contextWindowTokens: 1050000 };
    compact.record("chat", "one", "instructions", "result", 1000000);
    assert.equal(await compact.check("chat", "one", "next", policy, async () => ({ contextUsagePercent: 97 })), true);
    compact.record("chat", "one", "next", "answer", { inputTokens: 1000, outputTokens: 200 });
    assert.equal(compact.shouldCompact("chat", "one", "continue", policy), false);
});

test("switching conversations preserves both contexts and can restore a reopened chat",async()=>{
    const compact=new AutoCompact();
    compact.record("agent","code","Keep original code requirement","Tool result");
    compact.record("agent","motion","Animate logo","Created text");
    assert.match(compact.get("agent","code").history[0].content,/original code/);
    compact.restore("agent","reopened",[{role:"user",content:"My original task"},{role:"assistant",content:"Still working"}]);
    assert.equal(await compact.check("agent","reopened","continue",{model:"large",contextWindowTokens:1000000},async()=>({contextUsagePercent:98})),true);
    const text=await compact.prepare("agent","reopened","continue",null,async()=>{throw Error("summary unavailable");});
    assert.match(text,/My original task/);assert.match(text,/Still working/);assert.match(text,/continue/);
});

test("server occupancy is polled during fast tasks even below the provider's advertised window",async()=>{
    const compact=new AutoCompact();
    for(let i=0;i<4;i++)compact.record("agent","one","tool input","result");
    let calls=0;
    assert.equal(await compact.check("agent","one","continue",{model:"flash",contextWindowTokens:1048576},async()=>{calls++;return {contextUsagePercent:96};}),true);
    assert.equal(calls,1);
});

test("long initial prompts retain the task at their end and exact backend overflow wording is recognized",async()=>{
    const compact=new AutoCompact();compact.record("agent","one","Instructions "+"x".repeat(30000)+" ORIGINAL_USER_GOAL","result");
    await compact.prepare("agent","one","continue",null,async prompt=>{assert.match(prompt,/ORIGINAL_USER_GOAL/);return "Goal preserved";});
    assert.equal(isContextOverflow(new Error('Erreur du flux : {"message":"This conversation has reached the maximum token limit of 250000."}')),true);
});
