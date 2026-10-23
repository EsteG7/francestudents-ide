"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{_electron}=require("playwright-core");
test("new version greets once, can be reopened and fits small windows",{timeout:45000},async()=>{
    const root=path.resolve(__dirname,".."),dir=fs.mkdtempSync(path.join(os.tmpdir(),"frst-release-notes-")),harness=path.join(dir,"launch.cjs");
    fs.writeFileSync(harness,`require('electron').app.getVersion=()=>"1.3.3";require(${JSON.stringify(path.join(root,"src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root,"desktop/main.js"))});`);
    const env={...process.env,FS_DATA_DIR:dir,FS_STATE_DIR:dir,FRST_QA_RELEASE_NOTES:"1"};delete env.ELECTRON_RUN_AS_NODE;
    const app=await _electron.launch({executablePath:require("electron"),args:[harness,"--user-data-dir="+path.join(dir,"electron")],cwd:root,env});
    try{
        const page=await app.firstWindow();await page.locator("#startup-loading").waitFor({state:"hidden"});
        if(await page.locator("#guide-close").isVisible())await page.locator("#guide-close").click();
        await page.locator("#release-highlights[open]").waitFor();
        assert.match(await page.title(),/FranceStudent IDE/);
        assert.equal(await page.locator(".release-notes-item").count(),4);
        if(process.env.FRST_QA_SCREENSHOT)await page.screenshot({path:process.env.FRST_QA_SCREENSHOT,animations:"disabled"});
        await page.getByRole("button",{name:"C’est parti !",exact:true}).click();
        await page.waitForFunction(async()=>!(await window.frst.releaseHighlights()).shouldShow);
        await page.reload();await page.locator("#startup-loading").waitFor({state:"hidden"});
        assert.equal(await page.locator("#release-highlights[open]").count(),0);
        await page.locator('[data-view="settings"]').click();await page.locator("#release-highlights-open").click();
        await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setMinimumSize(0,0);win.setSize(520,500);});
        const fits=await page.locator("#release-highlights").evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;});assert.equal(fits,true);
        await page.keyboard.press("Escape");assert.equal(await page.locator("#release-highlights[open]").count(),0);
    }finally{await app.close();}
});
