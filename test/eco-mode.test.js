"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-eco-tests-"));
process.env.FS_DATA_DIR = dir; process.env.FS_STATE_DIR = dir;
const { state, resetConversation } = require("../src/state");
const api = require("../src/api/api");
const { runAgent } = require("../src/agent/agent");
const chat = require("../src/core/chat");
const projectContext = require("../src/project/project-context");
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

async function ecoRun(answer) {
    resetConversation(); state.ecoMode = true; state.workspace = dir;
    const original = api.requestModel, log = console.log; let calls = 0;
    api.requestModel = async () => { calls++; return answer(calls); };
    console.log = () => {};
    try { return { result: await runAgent("Lis les fichiers nécessaires", { readOnly: true }), calls }; }
    finally { api.requestModel = original; console.log = log; state.ecoMode = false; state.workspace = null; resetConversation(); }
}

test("eco agent stops after four turns and reports incomplete work", async () => {
    for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(dir, `file${i}.txt`), "test");
    const { result, calls } = await ecoRun(i => JSON.stringify({ type: "tool", name: "read_file", args: { path: `file${i}.txt` }, reason: "Lire" }));
    assert.equal(calls, 4); assert.equal(result.completed, false); assert.match(result.message, /Limite du mode Éco/);
});
test("eco does not retry invalid tool responses or call a fallback model", async () => {
    const { result, calls } = await ecoRun(() => "invalid tool response");
    assert.equal(calls, 1); assert.equal(result.completed, false); assert.match(result.message, /sans nouvelle tentative/);
});
test("eco prevents subagent execution", async () => {
    const { result, calls } = await ecoRun(() => JSON.stringify({ type: "tool", name: "task", args: { prompt: "Explore", description: "Explorer" }, reason: "Explorer" }));
    assert.equal(calls, 1); assert.match(result.message, /ne lance pas de sous-agents/);
});
test("eco chat requests only 20000 characters of automatic project context", async () => {
    const original = projectContext.promptContext, request = api.requestModel;
    resetConversation(); state.ecoMode = true; state.workspace = dir;
    let limit;
    projectContext.promptContext = size => { limit = size; return "context"; };
    api.requestModel = async () => "réponse";
    try { await chat.send("Bonjour"); assert.equal(limit, 20000); }
    finally { projectContext.promptContext = original; api.requestModel = request; state.ecoMode = false; state.workspace = null; resetConversation(); }
});
