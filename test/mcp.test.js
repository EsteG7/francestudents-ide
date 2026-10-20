"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createClient } = require("../src/mcp/client");
const { parseConfig, formatToolResult, createManager, MAX_RESULT_CHARS } = require("../src/mcp/manager");
const { validateToolCall } = require("../src/tools/registry");
const { buildAgentPrompt } = require("../src/agent/prompt");

const FIXTURE = path.join(__dirname, "fixtures", "fake-mcp-server.js");

function fakeClient() {
    return createClient({
        name: "fake",
        command: process.execPath,
        args: [FIXTURE],
        env: process.env,
        timeoutMs: 10000
    });
}

async function waitFor(predicate, ms = 3000) {
    const end = Date.now() + ms;
    while (!predicate()) {
        if (Date.now() > end) return false;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    return true;
}

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "fs-mcp-"));
}

test("client MCP : initialize, tools/list paginé, tools/call, close", async () => {
    const client = fakeClient();

    try {
        await client.start();
        assert.equal(client.serverInfo?.name, "fake");

        const tools = await client.listTools();
        assert.deepEqual(tools.map(t => t.name), ["echo", "boom"]);

        const result = await client.callTool("echo", { text: "salut" });
        assert.equal(formatToolResult(result).text, "echo: salut");

        const boom = await client.callTool("boom", {});
        assert.equal(boom.isError, true);

        await assert.rejects(client.callTool("inconnu", {}));
    } finally {
        client.close();
    }

    assert.equal(await waitFor(() => !client.running), true);
});

test("parseConfig : configuration valide", () => {
    const servers = parseConfig(JSON.stringify({
        mcpServers: {
            fs: { command: "npx", args: ["-y", "pkg"], env: { A: 1 } },
            off: { command: "x", disabled: true, timeoutMs: 5000 }
        }
    }));

    assert.equal(servers.length, 2);
    assert.deepEqual(servers[0].args, ["-y", "pkg"]);
    assert.deepEqual(servers[0].env, { A: "1" });
    assert.equal(servers[0].disabled, false);
    assert.equal(servers[1].disabled, true);
    assert.equal(servers[1].timeoutMs, 5000);
    assert.deepEqual(parseConfig("\uFEFF{\"mcpServers\":{}}"), []);
});

test("parseConfig : erreurs", () => {
    assert.throws(() => parseConfig({}), /mcpServers/);
    assert.throws(() => parseConfig({ mcpServers: [] }), /mcpServers/);
    assert.throws(() => parseConfig({ mcpServers: { "mauvais nom": { command: "x" } } }), /invalide/);
    assert.throws(() => parseConfig({ mcpServers: { web: { url: "http://localhost" } } }), /stdio/);
    assert.throws(() => parseConfig({ mcpServers: { a: {} } }), /command/);
    assert.throws(() => parseConfig({ mcpServers: { a: { command: "x", args: "y" } } }), /args/);
    assert.throws(() => parseConfig({ mcpServers: { a: { command: "x", env: [] } } }), /env/);
});

test("formatToolResult : texte, image, troncature, structuredContent", () => {
    const mixed = formatToolResult({
        content: [{ type: "text", text: "a" }, { type: "image", data: "xx", mimeType: "image/png" }]
    });
    assert.equal(mixed.text, "a\n[contenu image non affiché]");
    assert.equal(mixed.truncated, false);
    assert.equal(mixed.isError, false);

    const long = formatToolResult({ content: [{ type: "text", text: "x".repeat(MAX_RESULT_CHARS + 10) }], isError: true });
    assert.equal(long.truncated, true);
    assert.equal(long.isError, true);
    assert.ok(long.text.endsWith("[tronqué]"));

    assert.equal(formatToolResult({ structuredContent: { a: 1 } }).text, "{\"a\":1}");
});

test("manager : démarrage, catalogue, appel, arrêt", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "mcp.json");
    fs.writeFileSync(file, JSON.stringify({
        mcpServers: {
            fake: { command: process.execPath, args: [FIXTURE], timeoutMs: 10000 },
            off: { command: "inexistant", disabled: true }
        }
    }));

    const manager = createManager({ configFile: file });

    try {
        const listed = await manager.ensureStarted();
        const fake = listed.find(s => s.name === "fake");
        const off = listed.find(s => s.name === "off");

        assert.equal(fake.status, "running", fake.error || "");
        assert.deepEqual(fake.tools, ["echo", "boom"]);
        assert.equal(off.status, "disabled");

        const catalog = manager.catalog();
        assert.match(catalog, /server "fake", tool "echo"/);
        assert.doesNotMatch(catalog, /"off"/);

        const result = await manager.call("fake", "echo", { text: "x" });
        assert.equal(result.text, "echo: x");
        assert.equal(result.isError, false);

        assert.throws(() => manager.findTool("fake", "nope"), /Outil MCP inconnu/);
        assert.throws(() => manager.findTool("off", "echo"), /Serveur MCP inconnu ou arrêté/);

        manager.stopAll();
        assert.deepEqual(manager.list(), []);
    } finally {
        manager.stopAll();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("manager : sans mcp.json, aucun serveur", async () => {
    const dir = tmpDir();
    const manager = createManager({ configFile: path.join(dir, "absent.json") });

    try {
        assert.deepEqual(await manager.ensureStarted(), []);
        assert.equal(manager.catalog(), "");
    } finally {
        manager.stopAll();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("validateToolCall : mcp_call", () => {
    validateToolCall({ name: "mcp_call", args: { server: "a", tool: "b" } });
    validateToolCall({ name: "mcp_call", args: { server: "a", tool: "b", arguments: { x: 1 } } });
    assert.throws(() => validateToolCall({ name: "mcp_call", args: { tool: "b" } }));
    assert.throws(() => validateToolCall({ name: "mcp_call", args: { server: "a" } }));
    assert.throws(() => validateToolCall({ name: "mcp_call", args: { server: "a", tool: "b", arguments: [] } }), /objet/);
    assert.throws(() => validateToolCall({ name: "mcp_call", args: { server: "a", tool: "b", arguments: null } }), /objet/);
});

test("buildAgentPrompt : section MCP seulement si un catalogue existe", async () => {
    const base = {
        workspace: ".",
        env: {},
        task: "tâche",
        history: [],
        memorySummary: "",
        observations: [],
        turn: 1,
        maxTurns: 50
    };

    const without = String(await buildAgentPrompt(base));
    assert.doesNotMatch(without, /OUTILS MCP/);

    const withMcp = String(await buildAgentPrompt({ ...base, mcpCatalog: "- server \"fake\", tool \"echo\" : écho" }));
    assert.match(withMcp, /OUTILS MCP/);
    assert.match(withMcp, /mcp_call/);
    assert.match(withMcp, /tool "echo"/);
});
