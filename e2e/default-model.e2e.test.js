"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {_electron}=require("playwright-core");
test("default model saves on selection and survives an actual Electron restart",{timeout:60000},async()=>{
    const root=path.resolve(__dirname,".."),dir=fs.mkdtempSync(path.join(os.tmpdir(),"frst-default-model-"));
    const harness=path.join(dir,"launch.cjs");
    fs.writeFileSync(harness,`require(${JSON.stringify(path.join(root,"src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root,"src/api/agents"))}).listAgents=async()=>({agents:[{id:-1002,name:'Model A'},{id:-1003,name:'Model B'}],source:'local'});require(${JSON.stringify(path.join(root,"desktop/main.js"))});`);
    const env={...process.env,FS_DATA_DIR:dir,FS_STATE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;delete env.FS_AGENT_ID;
    const launch=()=>_electron.launch({executablePath:require("electron"),args:[harness,"--user-data-dir="+path.join(dir,"electron")],env,cwd:root});
    let app;
    try{
        app=await launch();let page=await app.firstWindow();
        await page.locator("#startup-loading").waitFor({state:"hidden"});
        await page.locator('[data-view="settings"]').click();
        await page.locator('#settings-default-model option[value="-1003"]').waitFor({state:"attached"});
        await page.locator("#settings-default-model").selectOption("-1003");
        await page.waitForFunction(()=>!document.getElementById("settings-default-model").disabled);
        assert.equal((await page.evaluate(()=>window.frst.preferences())).defaultModel,-1003);
        await app.close();app=null;
        app=await launch();page=await app.firstWindow();
        await page.waitForFunction(async()=>(await window.frst.status()).booted);
        const actual=await page.evaluate(async()=>(await window.frst.status()).modelId);
        assert.equal(actual,-1003);
        await page.locator("#startup-loading").waitFor({state:"hidden"});
        await page.locator('[data-view="settings"]').click();
        await page.waitForFunction(()=>document.getElementById("settings-default-model").value==="-1003");
    }finally{if(app)await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
