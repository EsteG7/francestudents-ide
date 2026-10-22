"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { _electron } = require("playwright-core");
test("eco activation explains limits, can be canceled, persists and can be disabled", { timeout: 45000 }, async () => {
    const root = path.resolve(__dirname, ".."), dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-eco-ui-"));
    const harness = path.join(dir, "launch.cjs");
    fs.writeFileSync(harness, `require(${JSON.stringify(path.join(root, "src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root, "desktop/main.js"))});`);
    const env = { ...process.env, FS_DATA_DIR: dir, FS_STATE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: require("electron"), args: [harness, "--user-data-dir=" + path.join(dir, "electron")], env, cwd: root });
    try {
        const page = await app.firstWindow(); await page.locator("#startup-loading").waitFor({ state: "hidden" });
        await page.locator("#eco-mode-toggle").click();
        assert.match(await page.locator("#eco-mode-dialog").innerText(), /4 tours[\s\S]*incomplètes/);
        await page.locator("#eco-mode-cancel").click();
        assert.equal((await page.evaluate(() => window.frst.status())).ecoMode, false);
        await page.locator("#eco-mode-toggle").click(); await page.locator("#eco-mode-enable").click();
        await page.locator("#eco-mode-dialog").waitFor({ state: "hidden" });
        assert.equal((await page.evaluate(() => window.frst.status())).ecoMode, true);
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "settings.json"))).ecoMode, true);
        await page.reload(); await page.locator('#eco-mode-toggle[aria-pressed="true"]').waitFor();
        await page.locator("#eco-mode-toggle").click();
        await page.waitForFunction(async () => !(await window.frst.status()).ecoMode);
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "settings.json"))).ecoMode, false);
    } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
