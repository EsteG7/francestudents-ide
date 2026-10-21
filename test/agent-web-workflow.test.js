"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-agent-web-"));
process.env.FS_DATA_DIR = path.join(dir, "data");
const { state, resetConversation } = require("../src/state");
const { setUiBackend, UI_METHODS } = require("../src/ui-bridge");
const { TOOLS } = require("../src/tools/tools");
const api = require("../src/api/api");
const { runAgent, parseAgentResponse } = require("../src/agent/agent");

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
test("boucle agent : recherche, lecture de source, compte rendu et blocage explicite", async () => {
    const original = { request: api.requestModel, search: TOOLS.web_search.run, fetch: TOOLS.web_fetch.run };
    const ui = Object.fromEntries(UI_METHODS.map(name => [name, () => {}]));
    ui.spinner = () => ({ stop() {} });
    setUiBackend(ui);
    state.workspace = dir;
    state.automaticWeb = true;
    resetConversation();
    const visited = [];
    const prompts = [];
    TOOLS.web_search.run = async args => {
        visited.push(["search", args.query]);
        return { results: [{ title: "Documentation", url: "https://example.org/docs", snippet: "Source" }], message: "1 résultat" };
    };
    TOOLS.web_fetch.run = async args => {
        visited.push(["fetch", args.url]);
        return { status: 200, content: "VERSION_VERIFIED_123", final_url: args.url, message: "Source lue" };
    };
    const answers = [
        { type: "tool", name: "web_search", args: { query: "documentation actuelle" }, reason: "Trouver la documentation" },
        { type: "tool", name: "web_fetch", args: { url: "https://example.org/docs" }, reason: "Vérifier la source" },
        { type: "final", message: "Source vérifiée : https://example.org/docs", completed: true }
    ];
    api.requestModel = async prompt => {
        prompts.push(prompt);
        state.chatIds.agent = "web-test";
        return JSON.stringify(answers.shift());
    };
    try {
        const result = await runAgent("Trouve la documentation actuelle");
        assert.equal(result.completed, true);
        assert.deepEqual(visited, [["search", "documentation actuelle"], ["fetch", "https://example.org/docs"]]);
        assert.match(prompts[0], /web_search/);
        assert.match(prompts[1], /https:\/\/example.org\/docs/);
        assert.match(prompts[2], /VERSION_VERIFIED_123/);
        assert.equal(parseAgentResponse('{"type":"final","message":"Question indispensable","completed":false}').completed, false);
        assert.throws(() => parseAgentResponse('{"type":"final","message":"x","completed":"false"}'));
        let steeringRequests = 0;
        let waitingSteering = [];
        const steeringPrompts = [];
        api.requestModel = async prompt => {
            steeringRequests++;
            steeringPrompts.push(prompt);
            if (steeringRequests === 1) waitingSteering.push("STEERING_MARKER_456");
            return JSON.stringify({ type: "final", message: "Terminé", completed: true });
        };
        const steered = await runAgent("Tâche à orienter", { drainSteering: () => { const items = waitingSteering; waitingSteering = []; return items; } });
        assert.equal(steered.completed, true);
        assert.equal(steeringRequests, 2, "une consigne arrivée pendant la réponse finale doit être traitée");
        assert.match(steeringPrompts[1], /STEERING_MARKER_456/);
        let requests = 0;
        api.requestModel = async () => { requests++; return JSON.stringify({ type: "final", message: "Ne doit pas être appelé" }); };
        const stopped = await runAgent("Tâche interrompue", { shouldStop: () => true });
        assert.equal(stopped.completed, false);
        assert.equal(requests, 0);
    } finally {
        api.requestModel = original.request;
        TOOLS.web_search.run = original.search;
        TOOLS.web_fetch.run = original.fetch;
        setUiBackend(null);
        state.workspace = null;
        resetConversation();
    }
});
