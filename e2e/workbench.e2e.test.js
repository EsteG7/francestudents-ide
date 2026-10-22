"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), {_electron} = require("playwright-core");

test("workbench categories, global search and narrow layouts keep controls inside the viewport", {timeout:45000}, async () => {
    const root = path.resolve(__dirname, ".."), dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-workbench-"));
    const harness = path.join(dir, "launch.cjs");
    fs.writeFileSync(harness, `require(${JSON.stringify(path.join(root,"src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root,"desktop/main.js"))});`);
    const env = {...process.env, FS_DATA_DIR:dir, FS_STATE_DIR:dir}; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({executablePath:require("electron"), args:[harness,"--user-data-dir="+path.join(dir,"electron")], cwd:root, env});
    try {
        const page = await app.firstWindow(), errors = []; page.on("pageerror", error => errors.push(error.message));
        await page.locator("#startup-loading").waitFor({state:"hidden"});
        await page.locator('[data-view="extensions"]').click();
        const skill = page.locator('[data-library-id="web-quality"]');
        await skill.getByRole("button", {name:"Installer", exact:true}).click();
        await skill.getByRole("button", {name:"Désinstaller", exact:true}).waitFor();
        page.once("dialog", dialog => dialog.dismiss());
        await skill.getByRole("button", {name:"Désinstaller", exact:true}).click();
        assert.equal((await page.evaluate(() => window.frst.extensionAction("list"))).skills.length, 1);
        page.once("dialog", dialog => dialog.accept());
        await skill.getByRole("button", {name:"Désinstaller", exact:true}).click();
        await skill.getByRole("button", {name:"Installer", exact:true}).waitFor();
        assert.equal((await page.evaluate(() => window.frst.extensionAction("list"))).skills.length, 0);
        await page.locator('[data-view="settings"]').click();
        await page.locator('[data-category="general"]').click();
        assert.equal(await page.locator('[aria-labelledby="settings-access-title"]').isVisible(), false);
        await page.locator("#settings-search").fill("autorisations");
        assert.equal(await page.locator('[aria-labelledby="settings-access-title"]').isVisible(), true);
        await page.locator("#settings-search").fill("aucunresultat987654");
        await page.locator("#settings-search-empty").waitFor();
        await page.locator("#settings-search").fill("");
        await page.locator('[data-category="access"]').click();
        assert.equal(await page.locator("#studio-browser-permission").isVisible(), true);
        for (const size of [[1440,960],[1024,768],[800,650]]) {
            await app.evaluate(({BrowserWindow}, dimensions) => BrowserWindow.getAllWindows()[0].setSize(...dimensions), size);
            for (const view of ["settings", "extensions"]) {
                await page.locator(`[data-view="${view}"]`).click();
                const bounds = await page.locator(view === "settings" ? "#settings-view" : "#ext-view").evaluate(node => ({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,width:innerWidth,overflow:node.scrollWidth-node.clientWidth}));
                assert.ok(bounds.left >= 0 && bounds.right <= bounds.width + 1, JSON.stringify(bounds));
                assert.ok(bounds.overflow <= 1, `horizontal overflow ${view}: ${JSON.stringify(bounds)}`);
            }
        }
        await page.locator("#ext-close").click();
        await page.locator("#input").fill("Une demande sans envoi");
        const send = await page.locator("#btn-send").boundingBox();
        assert.ok(send.x >= 0 && send.x + send.width <= await page.evaluate(() => innerWidth));
        assert.deepEqual(errors, []);
    } finally { await app.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
