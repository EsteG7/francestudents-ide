"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{_electron}=require("playwright-core");
test("startup offers an available update, supports later, download and explicit restart",{timeout:45000},async()=>{
    const root=path.resolve(__dirname,".."),dir=fs.mkdtempSync(path.join(os.tmpdir(),"frst-update-offer-")),h=path.join(dir,"launch.cjs");
    fs.writeFileSync(h,`require(${JSON.stringify(path.join(root,"src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root,"src/api/agents"))}).listAgents=async()=>({agents:[{id:-1002,name:'Test model'}],source:'local'});const moduleUpdates=require(${JSON.stringify(path.join(root,"desktop/updates"))}),original=moduleUpdates.createUpdateController;const fake=new(require('node:events').EventEmitter)();globalThis.updateDownloads=0;globalThis.updateInstalls=0;fake.checkForUpdates=async()=>{if(fake.autoDownload)throw Error('Unexpected automatic startup download');fake.emit('update-available',{version:'1.1.4'});};fake.downloadUpdate=async()=>{globalThis.updateDownloads++;fake.emit('download-progress',{percent:50});await new Promise(r=>setTimeout(r,250));fake.emit('update-downloaded',{version:'1.1.4'});};fake.quitAndInstall=()=>globalThis.updateInstalls++;moduleUpdates.createUpdateController=options=>original({...options,enabled:true,version:'1.1.3',updater:fake,checkRelease:null});require(${JSON.stringify(path.join(root,"desktop/main.js"))});`);
    const env={...process.env,FS_DATA_DIR:dir,FS_STATE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
    const app=await _electron.launch({executablePath:require("electron"),args:[h,"--user-data-dir="+path.join(dir,"electron")],env,cwd:root});
    try{
        const page=await app.firstWindow();await page.getByRole("button",{name:"Mettre à jour maintenant",exact:true}).waitFor();
        await page.waitForTimeout(1300);assert.equal(await page.locator("#startup-loading").isVisible(),true);
        assert.equal(await app.evaluate(()=>globalThis.updateDownloads),0);
        await page.screenshot({path:path.join(root,"release/startup-update-offer.png")});
        await page.getByRole("button",{name:"Plus tard",exact:true}).click();
        assert.equal(await page.locator("#startup-loading").isVisible(),false);assert.equal(await page.locator("#app").evaluate(el=>el.inert),false);
        await page.locator("#startup-update-open").click();
        await page.getByRole("button",{name:"Mettre à jour maintenant",exact:true}).click();
        await page.getByRole("button",{name:"Redémarrer et installer",exact:true}).waitFor();
        assert.equal(await app.evaluate(()=>globalThis.updateDownloads),1);assert.equal(await app.evaluate(()=>globalThis.updateInstalls),0);
        await page.getByRole("button",{name:"Redémarrer et installer",exact:true}).click();
        assert.equal(await app.evaluate(()=>globalThis.updateInstalls),1);
    }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
