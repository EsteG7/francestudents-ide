"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { _electron } = require("playwright-core");

test("conversation accepts dropped files, preserves drafts and ignores outside and text drops", { timeout: 45000 }, async () => {
    const root = path.resolve(__dirname, "..");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-drop-"));
    const launcher = path.join(dir, "launch.cjs");
    fs.writeFileSync(launcher, `require(${JSON.stringify(path.join(root, "src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root, "src/api/agents"))}).listAgents=async()=>({agents:[{id:-1002,name:'Test model'}],source:'local'});require(${JSON.stringify(path.join(root, "desktop/main.js"))});`);
    const env = { ...process.env, FS_DATA_DIR: dir, FS_STATE_DIR: dir };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: require("electron"), args: [launcher, "--user-data-dir=" + path.join(dir, "electron")], env, cwd: root });
    try {
        const page = await app.firstWindow();
        await page.locator("#startup-loading").waitFor({ state: "hidden" });
        await page.locator("#input").fill("Analyse ces documents");
        const transfer = await page.evaluateHandle(() => {
            const data = new DataTransfer();
            for (let i = 0; i < 13; i++) data.items.add(new File(["document " + i], `notes-${i}.txt`, { type: "text/plain" }));
            data.items.add(new File(["%PDF-1.4 test"], "document.pdf", { type: "application/pdf" }));
            data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'], "logo.svg", { type: "image/svg+xml" }));
            return data;
        });
        await page.dispatchEvent("#transcript", "dragenter", { dataTransfer: transfer });
        assert.equal(await page.locator(".attachment-drop-hint").isVisible(), true);
        await page.dispatchEvent("#transcript", "dragleave", { relatedTarget: await page.locator("#input").elementHandle() });
        assert.equal(await page.locator(".attachment-drop-hint").isVisible(), true);
        await page.dispatchEvent("#input", "dragover", { dataTransfer: transfer });
        await page.dispatchEvent("#input", "drop", { dataTransfer: transfer });
        await page.waitForFunction(() => document.querySelectorAll(".attachment-chip").length === 15);
        assert.equal(await page.locator(".attachment-drop-hint").isVisible(), false);
        assert.equal(await page.locator("#input").inputValue(), "Analyse ces documents");
        assert.equal(await page.locator("#input").evaluate(el => el === document.activeElement), true);
        // Duplicate drops follow the same deduplication path as file selection.
        await page.dispatchEvent("#transcript", "drop", { dataTransfer: transfer });
        assert.equal(await page.locator(".attachment-chip").count(), 15);
        assert.equal(await page.locator("#attachment-quota-warning").isVisible(), true);
        assert.match(await page.locator("#attachment-quota-warning").innerText(), /15 fichiers joints[\s\S]*énormément de quota/);
        const outside = await page.evaluate(() => {
            const data = new DataTransfer();
            data.items.add(new File(["other"], "outside.txt", { type: "text/plain" }));
            const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data });
            document.body.dispatchEvent(event);
            return event.defaultPrevented;
        });
        assert.equal(outside, true);
        assert.equal(await page.locator(".attachment-chip").count(), 15);
        const textDropPrevented = await page.evaluate(() => {
            const data = new DataTransfer();
            data.setData("text/plain", "ordinary text");
            const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data });
            document.querySelector("#input").dispatchEvent(event);
            return event.defaultPrevented;
        });
        assert.equal(textDropPrevented, false);
        await page.dispatchEvent("#transcript", "dragenter", { dataTransfer: transfer });
        await page.dispatchEvent("#agent", "dragleave", { relatedTarget: null });
        assert.equal(await page.locator(".attachment-drop-hint").isVisible(), false);
        // Warning follows the draft count and disappears below five files.
        for (let i = 0; i < 10; i++) await page.locator(".attachment-remove").first().click();
        assert.match(await page.locator("#attachment-quota-warning").innerText(), /5 fichiers joints/);
        await page.locator(".attachment-remove").first().click();
        assert.equal(await page.locator("#attachment-quota-warning").isVisible(), false);
        assert.equal(await page.locator(".attachment-chip").count(), 4);
        assert.equal(await page.locator("#input").inputValue(), "Analyse ces documents");
        await transfer.dispose();
    } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
