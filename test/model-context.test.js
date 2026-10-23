"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { modelContext, OBSERVED_IDS } = require("../src/api/model-context");
const { normalize } = require("../src/api/agents");

test("all 15 observed service models have verified window and output limits", () => {
    assert.equal(Object.keys(OBSERVED_IDS).length, 15);
    for (const [id, model] of Object.entries(OBSERVED_IDS)) {
        const spec = modelContext({ model });
        assert.ok(spec.contextWindowTokens >= 200000, id);
        assert.ok(spec.maxOutputTokens >= 64000, id);
        assert.match(spec.source, /^https:\/\//);
    }
    assert.equal(modelContext({ model: "gpt-6.1-sol" }).contextWindowTokens, 1050000);
    assert.equal(modelContext({ model: "claude-haiku-4-5" }).contextWindowTokens, 200000);
    assert.equal(modelContext({ model: "claude-haiku-5-5" }).contextWindowTokens, 1000000);
    assert.equal(modelContext({ model: "gemini-pro-agent" }).contextWindowTokens, 1048576);
});

test("service limits override provider specs, unknown models never inherit a guessed capacity", () => {
    const data = normalize({ id: 42, model: "gpt-6-luna", contextWindow: 128000, max_output_tokens: 16384 });
    assert.equal(data.contextWindowTokens, 128000);
    assert.equal(data.maxOutputTokens, 16384);
    assert.equal(data.source, "service");
    assert.equal(modelContext({ model: "new-future-model" }).contextWindowTokens, null);
    assert.equal(modelContext({ model: "gpt-6-luna", contextWindow: -1 }).contextWindowTokens, 1050000);
});
