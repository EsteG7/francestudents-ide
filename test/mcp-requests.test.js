"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { createClient } = require("../src/mcp/client");

const FIXTURE = path.join(__dirname, "fixtures", "fake-mcp-server.js");

async function waitFor(predicate, ms = 3000) {
    const end = Date.now() + ms;
    while (!predicate()) {
        if (Date.now() > end) return false;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    return true;
}

function fakeClient(options = {}) {
    return createClient({
        name: "fake",
        command: process.execPath,
        args: [FIXTURE],
        env: process.env,
        timeoutMs: 10000,
        ...options
    });
}

test("client MCP : répond à ping, roots/list et refuse sampling", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fs-mcp-root-"));
    const client = fakeClient({ getRoot: () => root });

    try {
        await client.start();

        const ping = await client.callTool("ping", {});
        assert.deepEqual(JSON.parse(ping.content[0].text), {});

        const roots = JSON.parse((await client.callTool("roots", {})).content[0].text);
        assert.equal(roots.roots.length, 1);
        assert.equal(roots.roots[0].uri, pathToFileURL(root).href);
        assert.equal(roots.roots[0].name, path.basename(root));

        const sampling = JSON.parse((await client.callTool("sampling", {})).content[0].text);
        assert.equal(sampling.error.code, -32601);
    } finally {
        client.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("client MCP : roots/list vide sans projet", async () => {
    const client = fakeClient({ getRoot: () => null });

    try {
        await client.start();
        const roots = JSON.parse((await client.callTool("roots", {})).content[0].text);
        assert.deepEqual(roots, { roots: [] });
    } finally {
        client.close();
    }
});

test("client MCP : notification tools/list_changed transmise", async () => {
    const notifications = [];
    const client = fakeClient({ onNotification: (method) => notifications.push(method) });

    try {
        await client.start();
        assert.deepEqual((await client.listTools()).map(t => t.name), ["echo", "boom"]);

        await client.callTool("grow", {});
        assert.equal(await waitFor(() => notifications.includes("notifications/tools/list_changed")), true);
        assert.deepEqual((await client.listTools()).map(t => t.name), ["echo", "boom", "extra"]);
    } finally {
        client.close();
    }
});
