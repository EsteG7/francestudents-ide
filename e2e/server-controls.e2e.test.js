"use strict";
/* global renderEntry */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), net = require("node:net"), { _electron } = require("playwright-core");
test("assistant server buttons start, open and stop the actual local server", { timeout: 45000 }, async () => {
    const root = path.resolve(__dirname, ".."), dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-server-ui-"));
    const probe = net.createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const project = path.join(dir, "f1-vision-site"); fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, "serve.js"), `require('node:http').createServer((req,res)=>res.end('<h1>FRST local server</h1>')).listen(${port},'127.0.0.1');`);
    const harness = path.join(dir, "launch.cjs"); fs.writeFileSync(harness, `require(${JSON.stringify(path.join(root, "src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root, "desktop/main.js"))});`);
    const env = { ...process.env, FS_DATA_DIR: dir, FS_STATE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: require("electron"), args: [harness, "--user-data-dir=" + path.join(dir, "electron")], env, cwd: root });
    try {
        const page = await app.firstWindow(); await page.locator("#startup-loading").waitFor({ state: "hidden" });
        await page.evaluate(p => window.frst.openProject(p), project);
        const text = `Le serveur de test est arrêté. Pour revoir le site, lancez \`node serve.js\` dans \`f1-vision-site\`, puis ouvrez [http://127.0.0.1:${port}/](http://127.0.0.1:${port}/).`;
        await page.evaluate(text => renderEntry({ type: "assistant", text }), text);
        const card = page.locator(".message-server-controls"); await card.waitFor();
        assert.equal((await page.evaluate(() => window.frst.projectStudio("runs"))).length, 0);
        await card.getByRole("button", { name: "Démarrer", exact: true }).click();
        await page.waitForFunction(async () => (await window.frst.projectStudio("runs")).some(run => run.status === "running"));
        let response;
        for (let i = 0; i < 30; i++) { try { response = await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
        assert.match(await response.text(), /FRST local server/);
        await card.getByRole("button", { name: "Ouvrir le site" }).click();
        await page.locator("#local-browser-panel").waitFor({ state: "visible" });
        assert.match(await page.locator("#local-browser-address").inputValue(), new RegExp(String(port)));
        await card.getByRole("button", { name: "Arrêter", exact: true }).click({ timeout: 5000 });
        await page.waitForFunction(async () => (await window.frst.projectStudio("runs")).some(run => run.status === "stopped"));
        let stopped = false;
        for (let i = 0; i < 30; i++) {
            try { const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }); await res.body.cancel(); }
            catch { stopped = true; break; }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(stopped, true);
        await page.waitForFunction(() => [...document.querySelectorAll('.message-server-controls button')].some(button => button.textContent === 'Démarrer' && !button.disabled));
        assert.equal(await card.getByRole("button", { name: "Démarrer", exact: true }).isEnabled(), true);
    } finally {
        const page = await app.firstWindow();
        await page.evaluate(async () => { for (const run of await window.frst.projectStudio("runs")) if (run.status === "running") await window.frst.projectStudio("stop", { id: run.id }); }).catch(() => {});
        await app.close(); fs.rmSync(dir, { recursive: true, force: true });
    }
});
