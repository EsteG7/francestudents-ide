"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const browseTool = require("../src/tools/browse");

function fakeBrowser({ text = "Bonjour\n\n\n\nMonde", status = 200, consoleErrors = [], consoleUrl = "", network = [] } = {}) {
    const calls = { closed: false, screenshot: null, viewport: null };
    const browser = {
        async newContext(options) {
            calls.viewport = options.viewport;
            return {
                async newPage() {
                    const handlers = {};
                    return {
                        on(event, handler) { handlers[event] = handler; },
                        async goto(url) {
                            for (const msg of consoleErrors) {
                                handlers.console?.({ type: () => "error", text: () => msg, location: () => ({ url: consoleUrl, lineNumber: 3 }) });
                            }
                            for (const entry of network) {
                                const request = { url: () => entry.url, method: () => "GET", resourceType: () => "stylesheet", failure: () => ({ errorText: entry.error }) };
                                if (entry.error) handlers.requestfailed?.(request);
                                else handlers.response?.({ url: () => entry.url, status: () => entry.status, request: () => request });
                            }
                            this._url = url;
                            return { status: () => status };
                        },
                        async waitForLoadState() {},
                        async waitForTimeout() {},
                        async screenshot(options) {
                            calls.screenshot = options;
                            await fs.writeFile(options.path, "PNG");
                        },
                        async title() { return "Titre test"; },
                        async evaluate() { return text; },
                        url() { return this._url; }
                    };
                }
            };
        },
        async close() { calls.closed = true; }
    };
    return { browser, calls };
}

test("browse.check valide les arguments", () => {
    assert.doesNotThrow(() => browseTool.check({ url: "http://localhost:3000" }));
    assert.doesNotThrow(() => browseTool.check({ url: "https://example.com", full_page: true, width: 800 }));
    assert.throws(() => browseTool.check({}), /url/);
    assert.throws(() => browseTool.check({ url: "file:///etc/passwd" }), /http/);
    assert.throws(() => browseTool.check({ url: "https://a:b@example.com" }), /identifiants/);
    assert.throws(() => browseTool.check({ url: "https://example.com", full_page: "oui" }), /full_page/);
});

test("browse.describe", () => {
    assert.equal(browseTool.describe({ url: "https://example.com" }), "https://example.com");
    assert.equal(browseTool.describe({ url: "https://example.com", full_page: true }), "https://example.com (page entière)");
});

test("screenshotName est horodaté et sans caractères interdits", () => {
    const name = browseTool.screenshotName(new URL("http://localhost:5173/x"), new Date("2026-10-21T14:03:05Z"));
    assert.equal(name, "2026-10-21_14-03-05-localhost.png");
});

test("browse refusé par l'utilisateur : aucun navigateur lancé", async () => {
    let launched = false;
    const result = await browseTool.browse({ url: "https://example.com" }, {
        workspace: os.tmpdir(),
        confirm: async () => false,
        launch: async () => { launched = true; }
    });
    assert.equal(result.denied, true);
    assert.equal(launched, false);
});

test("browse enregistre la capture et renvoie le texte", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "browse-"));
    const { browser, calls } = fakeBrowser({ consoleErrors: ["boom"] });

    try {
        const result = await browseTool.browse(
            { url: "http://localhost:5173", full_page: true, width: 1024, height: 700 },
            { workspace, confirm: async () => true, launch: async () => browser }
        );

        assert.equal(result.status, 200);
        assert.equal(result.title, "Titre test");
        assert.equal(result.content, "Bonjour\n\nMonde");
        assert.equal(result.full_page, true);
        assert.deepEqual(calls.viewport, { width: 1024, height: 700 });
        assert.deepEqual(result.console, ["[error] boom"]);
        assert.match(result.screenshot, /^\.frst\/screenshots\/.+-localhost-[a-f0-9]{8}\.png$/);
        assert.equal(calls.screenshot.fullPage, true);
        assert.equal(calls.closed, true);
        await fs.access(path.join(workspace, result.screenshot));
        const secondBrowser=fakeBrowser().browser;
        const second=await browseTool.browse({url:"http://localhost:5173"},{workspace,confirm:async()=>true,launch:async()=>secondBrowser});
        assert.notEqual(second.screenshot,result.screenshot,"deux captures ne doivent pas écraser le même fichier");
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
});

test("browse tronque le texte à max_chars", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "browse-"));
    const { browser } = fakeBrowser({ text: "x".repeat(1000) });

    try {
        const result = await browseTool.browse(
            { url: "https://example.com", max_chars: 300 },
            { workspace, confirm: async () => true, launch: async () => browser }
        );
        assert.equal(result.content.length, 300);
        assert.equal(result.truncated, true);
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
});

test("launchBrowser essaie les navigateurs puis donne une erreur claire", async () => {
    const tried = [];
    const chromium = {
        async launch(options) {
            tried.push(options.channel);
            if (options.channel === "msedge") return {ok: true };
            throw new Error("introuvable\ndétails");
        }
    };
    assert.deepEqual(await browseTool.launchBrowser(chromium, {}), { ok: true });
    assert.deepEqual(tried, ["chrome", "msedge"]);

    const none = { async launch() { throw new Error("absent"); } };
    await assert.rejects(() => browseTool.launchBrowser(none, {}), /FS_BROWSER_PATH/);
});

test("browse identifies failing resource URLs instead of guessing favicon", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "browse-network-"));
    const { browser } = fakeBrowser({
        consoleErrors: ["Failed to load resource: 404"], consoleUrl: "http://localhost:5173/style.css",
        network: [{ url: "http://localhost:5173/style.css", status: 404 },
            { url: "http://localhost:5173/working.js", status: 200 },
            { url: "http://localhost:5173/api", error: "net::ERR_CONNECTION_RESET" }]
    });
    try {
        const result = await browseTool.browse({ url: "http://localhost:5173" }, { workspace, confirm: async () => true, launch: async () => browser });
        assert.match(result.console[0], /style\.css:4/);
        assert.deepEqual(result.network_errors, [
            { url: "http://localhost:5173/style.css", status: 404, method: "GET", resource_type: "stylesheet" },
            { url: "http://localhost:5173/api", method: "GET", resource_type: "stylesheet", error: "net::ERR_CONNECTION_RESET" }
        ]);
        assert.equal(result.network_errors_truncated, false);
    } finally { await fs.rm(workspace, { recursive: true, force: true }); }
});
