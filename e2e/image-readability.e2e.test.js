"use strict";
/* global addAttachments, send, imageReadabilityPending */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{_electron}=require("playwright-core");
test("readability warning precedes sending and cancellation keeps the draft and attachment",{timeout:45000},async()=>{
    const root=path.resolve(__dirname,".."),dir=fs.mkdtempSync(path.join(os.tmpdir(),"frst-readability-")),h=path.join(dir,"launch.cjs");
    fs.writeFileSync(h,`require(${JSON.stringify(path.join(root,"src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root,"src/api/agents"))}).listAgents=async()=>({agents:[{id:-1002,name:'Test model'}],source:'local'});require(${JSON.stringify(path.join(root,"desktop/main.js"))});`);
    const env={...process.env,FS_DATA_DIR:dir,FS_STATE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
    const app=await _electron.launch({executablePath:require("electron"),args:[h,"--user-data-dir="+path.join(dir,"electron")],env,cwd:root});
    try{
        const page=await app.firstWindow();await page.locator("#startup-loading").waitFor({state:"hidden"});
        await app.evaluate(({ipcMain})=>{globalThis.imageTestSubmissions=0;ipcMain.removeHandler("frst:submit");ipcMain.handle("frst:submit",()=>{globalThis.imageTestSubmissions++;return {ok:true,value:{ok:true}};});});
        const attach=height=>page.evaluate(async height=>{const canvas=document.createElement("canvas");canvas.width=1280;canvas.height=height;canvas.getContext("2d").fillRect(0,0,1280,height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));await addAttachments([new File([blob],"capture-"+height+".png",{type:"image/png"})]);},height);
        await attach(10993);await page.locator("#input").fill("Analyse cette capture");
        assert.equal(await page.locator(".attachment-readability-warning").count(),1);
        await page.evaluate(()=>{void send();});await page.locator("#image-readability-dialog").waitFor({state:"visible"});
        assert.equal(await app.evaluate(()=>globalThis.imageTestSubmissions),0);
        await page.locator('#image-readability-dialog button[value="cancel"]').click();
        await page.waitForFunction(()=>!imageReadabilityPending);
        assert.equal(await page.locator("#input").inputValue(),"Analyse cette capture");assert.equal(await page.locator(".attachment-chip").count(),1);
        await page.evaluate(()=>{void send();});await page.locator('#image-readability-dialog button[value="send"]').click();
        await page.waitForFunction(()=>document.querySelectorAll(".attachment-chip").length===0);
        assert.equal(await app.evaluate(()=>globalThis.imageTestSubmissions),1);
        await attach(600);await page.locator("#input").fill("Normal image");await page.evaluate(()=>send());
        assert.equal(await app.evaluate(()=>globalThis.imageTestSubmissions),2);
        assert.equal(await page.locator("#image-readability-dialog").isVisible(),false);
    }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
