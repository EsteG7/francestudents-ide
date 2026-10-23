"use strict";
/* global send */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { _electron } = require("playwright-core");

test("Codex context resumes with the chosen model in the existing project only after sending", { timeout: 45000 }, async () => {
    const root = path.resolve(__dirname, ".."), dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-import-e2e-"));
    const project = path.join(dir, "project"); fs.mkdirSync(project); fs.writeFileSync(path.join(project, "index.html"), "<h1>Existing project</h1>");
    const harness = path.join(dir, "launch.cjs");
    fs.writeFileSync(harness, `const session=require(${JSON.stringify(path.join(root, "src/core/session"))});session.bootstrap=async()=>({ok:true});globalThis.importCalls=[];session.handleInput=async(text)=>{const s=require(${JSON.stringify(path.join(root, "src/state"))}).state;globalThis.importCalls.push({text,workspace:s.workspace,files:s.pendingFiles});return {completed:true};};require(${JSON.stringify(path.join(root, "src/api/agents"))}).listAgents=async()=>({agents:[{id:-1002,name:'Model One'},{id:-1003,name:'Model Two'}],source:'local'});require(${JSON.stringify(path.join(root, "desktop/main.js"))});`);
    const env = { ...process.env, FS_DATA_DIR: dir, FS_STATE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: require("electron"), args: [harness, "--user-data-dir=" + path.join(dir, "electron")], env, cwd: root });
    try {
        const page = await app.firstWindow();
        await page.locator("#startup-loading").waitFor({ state: "hidden" });
        await page.waitForFunction(async () => (await window.frst.status()).booted);
        await page.evaluate(p => window.frst.openProject(p), project);
        await page.locator("#input").fill("Ma demande complémentaire.");
        await page.locator("#conversation-import").click();
        await page.locator("#conversation-import-text").fill("## User\nAjoute un menu à mon projet.\n## Assistant\nLe menu reste à réaliser.");
        if(process.env.FRST_SURFACE_SCREENSHOT_PREFIX)await page.screenshot({path:process.env.FRST_SURFACE_SCREENSHOT_PREFIX+"-import.png",animations:"disabled"});
        await page.locator("#conversation-import-preview").click();
        await page.locator("#conversation-import-apply").waitFor({ state: "visible" });
        await page.waitForFunction(() => !document.querySelector("#conversation-import-apply").disabled);
        assert.match(await page.locator("#conversation-import-status").innerText(), /2 message/);
        await page.locator("#conversation-import-model").selectOption("-1003");
        await page.locator("#conversation-import-apply").click();
        await page.locator("#conversation-import-dialog").waitFor({ state: "hidden" });
        assert.equal((await app.evaluate(() => globalThis.importCalls)).length, 0);
        assert.match(await page.locator("#input").inputValue(), /Ma demande complémentaire/);
        assert.match(await page.locator("#input").inputValue(), /Continue cette conversation/);
        assert.match(await page.locator(".attachment-chip").innerText(), /conversation-codex.md/);
        assert.equal((await page.evaluate(() => window.frst.models())).current, -1003);
        await page.evaluate(() => send());
        await page.waitForFunction(async () => (await window.frst.status()).busy === false);
        await page.waitForFunction(() => !document.querySelector(".attachment-chip"));
        const calls = await app.evaluate(() => globalThis.importCalls);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].workspace, project);
        assert.match(Buffer.from(calls[0].files[0].dataUrl.split(",")[1], "base64").toString("utf8"), /Ajoute un menu/);
        assert.equal(fs.readFileSync(path.join(project, "index.html"), "utf8"), "<h1>Existing project</h1>");
    } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
