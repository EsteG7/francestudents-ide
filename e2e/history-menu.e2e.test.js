"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { _electron } = require("playwright-core");

test("history fits the viewport, names models and remembers deletion confirmation", { timeout: 45000 }, async () => {
    const root = path.resolve(__dirname, ".."), dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-history-menu-"));
    const entries = Array.from({ length: 12 }, (_, i) => ({ id: "history-" + i, title: "Conversation de test " + i, model: "-2003", mode: "agent", updatedAt: new Date().toISOString(), messages: [{ role: "user", content: "Bonjour" }] }));
    fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(entries));
    const harness = path.join(dir, "launch.cjs");
    fs.writeFileSync(harness, `require(${JSON.stringify(path.join(root, "src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root, "src/api/agents"))}).listAgents=async()=>({agents:[{id:-2003,name:'Claude Sonnet 5.5'}],source:'local'});require(${JSON.stringify(path.join(root, "desktop/main.js"))});`);
    const env = { ...process.env, FS_DATA_DIR: dir, FS_STATE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: require("electron"), args: [harness, "--user-data-dir=" + path.join(dir, "electron")], env, cwd: root });
    try {
        const page = await app.firstWindow();
        await page.locator("#startup-loading").waitFor({ state: "hidden" });
        await page.waitForFunction(async () => (await window.frst.status()).booted);
        await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setSize(680, 760); });
        await page.locator("#btn-history").click();
        await page.locator(".history-item").first().waitFor();
        const fits = () => page.evaluate(() => { const r = document.querySelector('[data-kind="history"]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
        assert.equal(await fits(), true);
        assert.match(await page.locator(".history-item").first().innerText(), /Claude Sonnet 5.5/);
        assert.doesNotMatch(await page.locator(".history-item").first().innerText(), /-2003/);
        await page.locator(".history-search").fill("Sonnet");
        assert.equal(await page.locator(".history-item").count(), 12);
        const remove = () => page.locator('.history-item').first().getByRole("button", { name: "Supprimer la conversation de l'historique", exact: true });
        await page.locator(".history-item").first().hover(); await remove().click();
        await page.locator('#history-delete-dialog [data-action="cancel"]').click();
        assert.equal((await page.evaluate(() => window.frst.conversationsRecent(30))).length, 12);
        await page.locator("#btn-history").click();
        await page.locator(".history-item").first().hover(); await remove().click();
        await page.locator('#history-delete-dialog input').check();
        await page.locator('#history-delete-dialog [data-action="delete"]').click();
        await page.locator('#history-delete-dialog').waitFor({ state: "detached" });
        await page.waitForFunction(async () => (await window.frst.conversationsRecent(30)).length === 11);
        await page.locator("#btn-history").click();
        assert.equal(await page.locator('.history-confirm-setting input').isChecked(), false);
        await page.locator(".history-item").first().hover(); await remove().click();
        await page.waitForFunction(async () => (await window.frst.conversationsRecent(30)).length === 10);
        assert.equal(await page.locator('#history-delete-dialog').count(), 0);
        await page.locator('.history-confirm-setting input').check();
        await page.locator(".history-item").first().hover(); await remove().click();
        await page.locator('#history-delete-dialog').waitFor();
        await page.keyboard.press("Escape");
        assert.equal((await page.evaluate(() => window.frst.conversationsRecent(30))).length, 10);
        await page.locator("#btn-history").click();
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(520, 500));
        assert.equal(await fits(), true);
    } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
