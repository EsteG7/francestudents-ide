"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createEffectCraftHost, resolveStatic, MIME } = require("../desktop/effectcraft-host");

function request(url, { method = "GET", headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const req = http.request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method, headers }, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on("error", reject);
        req.end();
    });
}

function makeRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-host-test-"));
    fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>ec</title>");
    fs.writeFileSync(path.join(root, "effectcraft_web_bg.wasm"), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    fs.writeFileSync(path.join(root, "app.js"), "export const ok = 1;");
    fs.writeFileSync(path.join(path.dirname(root), path.basename(root) + "-secret.txt"), "secret");
    return root;
}

test("resolveStatic reste dans la racine et refuse les évasions", () => {
    const root = path.resolve(os.tmpdir(), "ec-root");
    assert.equal(resolveStatic(root, ""), path.join(root, "index.html"));
    assert.equal(resolveStatic(root, "a/b.js"), path.join(root, "a", "b.js"));
    assert.equal(resolveStatic(root, "../x"), null);
    assert.equal(resolveStatic(root, "..%2fx"), null);
    assert.equal(resolveStatic(root, "a\\..\\..\\x"), null);
    assert.equal(resolveStatic(root, "x%00.js"), null);
    assert.equal(resolveStatic(root, "%E0%A4%A"), null);
});

test("le type MIME du WASM est application/wasm", () => {
    assert.equal(MIME[".wasm"], "application/wasm");
});

test("l'hébergeur signale l'absence du build au lieu de démarrer", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ec-host-empty-"));
    const host = createEffectCraftHost({ root: empty });
    assert.equal(host.status().available, false);
    await assert.rejects(() => host.start(), /vendor:effectcraft/);
    fs.rmSync(empty, { recursive: true, force: true });
});

test("l'hébergeur sert le build en lecture seule sur 127.0.0.1 avec préfixe secret", async () => {
    const root = makeRoot();
    const host = createEffectCraftHost({ root });
    try {
        const info = await host.start();
        assert.equal(info.running, true);
        assert.match(info.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{36}\/$/);
        assert.equal((await host.start()).url, info.url);

        const index = await request(info.url);
        assert.equal(index.status, 200);
        assert.match(index.headers["content-type"], /text\/html/);

        const wasm = await request(info.url + "effectcraft_web_bg.wasm");
        assert.equal(wasm.status, 200);
        assert.equal(wasm.headers["content-type"], "application/wasm");
        assert.equal(wasm.body.length, 8);

        const base = new URL(info.url);
        assert.equal((await request(`http://127.0.0.1:${base.port}/index.html`)).status, 404);
        assert.equal((await request(info.url, { method: "POST" })).status, 405);
        assert.equal((await request(info.url, { headers: { Host: "evil.example" } })).status, 403);
        const escape = await request(info.url + "..%2f" + path.basename(root) + "-secret.txt");
        assert.ok([403, 404].includes(escape.status));
        assert.notEqual(escape.body.toString(), "secret");
    } finally {
        const stopped = await host.stop();
        assert.equal(stopped.running, false);
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(path.join(path.dirname(root), path.basename(root) + "-secret.txt"), { force: true });
    }
});