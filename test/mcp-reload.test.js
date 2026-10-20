"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createManager } = require("../src/mcp/manager");

const FIXTURE = path.join(__dirname, "fixtures", "fake-mcp-server.js");

function serverDef(extra = {}) {
    return { command: process.execPath, args: [FIXTURE], timeoutMs: 10000, ...extra };
}

function writeConfig(file, servers) {
    fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }, null, 2), "utf8");
}

function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-mcp-reload-"));
    const file = path.join(dir, "mcp.json");
    const manager = createManager({ configFile: file });
    return { dir, file, manager };
}

test("gestionnaire MCP : mcp.json modifié => serveurs redémarrés", async () => {
    const { dir, file, manager } = setup();

    try {
        writeConfig(file, { fake: serverDef() });

        let servers = await manager.ensureStarted();
        assert.deepEqual(servers.map(s => [s.name, s.status]), [["fake", "running"]]);
        assert.equal(manager.reloadCount(), 0);

        // Sans changement : pas de rechargement.
        await manager.ensureStarted();
        assert.equal(manager.reloadCount(), 0);

        writeConfig(file, { fake: serverDef(), fake2: serverDef() });
        servers = await manager.ensureStarted();
        assert.equal(manager.reloadCount(), 1);
        assert.deepEqual(servers.map(s => s.name).sort(), ["fake", "fake2"]);
        assert.ok(servers.every(s => s.status === "running"));

        // Un appel de plus sans changement ne recharge pas.
        await manager.ensureStarted();
        assert.equal(manager.reloadCount(), 1);
    } finally {
        manager.stopAll();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("gestionnaire MCP : mcp.json créé après coup => chargé", async () => {
    const { dir, file, manager } = setup();

    try {
        assert.deepEqual(await manager.ensureStarted(), []);

        writeConfig(file, { fake: serverDef() });
        const servers = await manager.ensureStarted();
        assert.equal(manager.reloadCount(), 1);
        assert.deepEqual(servers.map(s => [s.name, s.status]), [["fake", "running"]]);
    } finally {
        manager.stopAll();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("gestionnaire MCP : toolDetails décrit outils et arguments", async () => {
    const { dir, file, manager } = setup();

    try {
        writeConfig(file, { fake: serverDef(), off: serverDef({ disabled: true }) });
        await manager.ensureStarted();

        const tools = manager.toolDetails("fake");
        assert.deepEqual(tools.map(t => t.name), ["echo", "boom"]);

        const echo = tools.find(t => t.name === "echo");
        assert.equal(echo.description, "Renvoie le texte reçu");
        assert.deepEqual(echo.arguments, [{ name: "text", type: "string", required: true, description: "" }]);
        assert.deepEqual(tools.find(t => t.name === "boom").arguments, []);

        assert.throws(() => manager.toolDetails("nope"), /Serveur MCP inconnu : nope.*fake/);
        assert.throws(() => manager.toolDetails("off"), /non actif \(disabled\)/);
    } finally {
        manager.stopAll();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
