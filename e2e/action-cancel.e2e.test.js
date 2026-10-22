"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { _electron } = require("playwright-core");
test("Full access runs without prompts and canceling its command lets the agent continue", { timeout: 45000 }, async () => {
    const root = path.resolve(__dirname, ".."), dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-action-ui-")), project = path.join(dir, "project"); fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, "long.js"), "require('node:fs').writeFileSync('started.txt','started');console.log('STARTED');setTimeout(()=>console.log('SHOULD_NOT_FINISH'),30000);");
    const harness = path.join(dir, "launch.cjs");
    fs.writeFileSync(harness, `const session=require(${JSON.stringify(path.join(root, "src/core/session"))});session.bootstrap=async()=>({ok:true});globalThis.actionPrompts=[];const api=require(${JSON.stringify(path.join(root, "src/api/api"))});api.requestModel=async(message,options={})=>{if(options.conversationMode!=='agent'||options.fresh)return 'Project summary';globalThis.actionPrompts.push(message);return globalThis.actionPrompts.length===1?JSON.stringify({type:'tool',name:'run_command',args:{command:'node long.js'},reason:'Test cancellation'}):JSON.stringify({type:'final',message:'The agent continued after cancellation.',completed:true});};session.handleInput=async text=>require(${JSON.stringify(path.join(root, "src/agent/agent"))}).runAgent(text);require(${JSON.stringify(path.join(root, "desktop/main.js"))});`);
    const env = { ...process.env, FS_DATA_DIR: dir, FS_STATE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: require("electron"), args: [harness, "--user-data-dir=" + path.join(dir, "electron")], env, cwd: root });
    try {
        const page = await app.firstWindow(); await page.locator("#startup-loading").waitFor({ state: "hidden" });
        await page.evaluate(p => window.frst.openProject(p), project);
        await page.evaluate(() => window.frst.setAutoApprove("access-full-session"));
        await page.evaluate(() => { void window.frst.submit("Run the long command"); });
        const row = page.locator('[data-action-name="run_command"]'); await row.waitFor({ timeout: 10000 }).catch(async error => { console.log(await page.locator("#transcript").innerText(), await page.evaluate(() => window.frst.status())); throw error; });
        for (let i = 0; i < 100 && !fs.existsSync(path.join(project, "started.txt")); i++) await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(fs.existsSync(path.join(project, "started.txt")), true);
        assert.equal(await page.locator(".prompt-card").count(), 0);
        await row.getByRole("button", { name: "Annuler l’action" }).click();
        await page.waitForFunction(() => !document.querySelector("#statusbar").classList.contains("busy"));
        const prompts = await app.evaluate(() => globalThis.actionPrompts);
        assert.equal(prompts.length, 2); assert.match(prompts[1], /annulée par l’utilisateur/);
        assert.doesNotMatch(await page.locator("#output").innerText(), /SHOULD_NOT_FINISH/);
        assert.match(await page.locator("#transcript").innerText(), /agent continued/);
    } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
