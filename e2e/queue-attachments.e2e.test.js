"use strict";
/* global addAttachments, send */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{_electron}=require("playwright-core");
test("an image can queue during a task, be edited with another file, and reach only its own run",{timeout:45000},async()=>{
    const root=path.resolve(__dirname,".."),dir=fs.mkdtempSync(path.join(os.tmpdir(),"frst-queue-files-")),h=path.join(dir,"launch.cjs");
    fs.writeFileSync(h,`const session=require(${JSON.stringify(path.join(root,"src/core/session"))});session.bootstrap=async()=>({ok:true});globalThis.queueFileCalls=[];session.handleInput=async(text,options)=>{const state=require(${JSON.stringify(path.join(root,"src/state"))}).state;globalThis.queueFileCalls.push({text,images:state.pendingImages.length,files:state.pendingFiles.map(file=>({name:file.name,dataUrl:file.dataUrl}))});if(globalThis.queueFileCalls.length===1)await new Promise(resolve=>globalThis.releaseQueueFileTask=resolve);if(text==='Steering target'){await new Promise(resolve=>globalThis.releaseSteeringTarget=resolve);const prompts=options.drainSteering();globalThis.steeredFileResult={prompts,images:state.pendingImages.length};}return {completed:true};};require(${JSON.stringify(path.join(root,"src/api/agents"))}).listAgents=async()=>({agents:[{id:-1002,name:'Test model'}],source:'local'});require(${JSON.stringify(path.join(root,"desktop/main.js"))});`);
    const env={...process.env,FS_DATA_DIR:dir,FS_STATE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
    const app=await _electron.launch({executablePath:require("electron"),args:[h,"--user-data-dir="+path.join(dir,"electron")],env,cwd:root});
    try{
        const page=await app.firstWindow();await page.locator("#startup-loading").waitFor({state:"hidden"});await page.waitForFunction(async()=>(await window.frst.status()).booted);
        await page.evaluate(()=>{void window.frst.submit("First task");});await page.waitForFunction(async()=>(await window.frst.status()).busy);
        await page.evaluate(async()=>{const canvas=document.createElement("canvas");canvas.width=200;canvas.height=100;const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));await addAttachments([new File([blob],"design.png",{type:"image/png"})]);});
        await page.locator("#input").fill("Use this design");await page.evaluate(()=>send());
        await page.locator(".pending-attachments").waitFor({state:"visible"});assert.match(await page.locator(".pending-attachments").innerText(),/design.png/);
        await page.waitForFunction(()=>!document.querySelector(".pending-steer").disabled);
        await page.locator(".pending-menu summary").click();await page.getByRole("button",{name:"Modifier",exact:true}).click();
        await page.waitForFunction(()=>document.querySelectorAll(".attachment-chip").length===1);
        await page.evaluate(()=>addAttachments([new File(["notes for this design"],"notes.txt",{type:"text/plain"})]));
        await page.locator("#input").fill("Use design and notes");await page.evaluate(()=>send());
        await page.waitForFunction(()=>document.querySelector(".pending-attachments")?.textContent.includes("notes.txt"));
        assert.equal((await app.evaluate(()=>globalThis.queueFileCalls)).length,1);
        await app.evaluate(()=>globalThis.releaseQueueFileTask());
        await page.waitForFunction(async()=>(await window.frst.taskQueue("list")).tasks.some(t=>t.status==="done"));
        const calls=await app.evaluate(()=>globalThis.queueFileCalls);
        assert.equal(calls.length,2);assert.equal(calls[0].images,0);assert.equal(calls[1].images,1);assert.match(Buffer.from(calls[1].files[0].dataUrl.split(",")[1],"base64").toString("utf8"),/notes for this design/);assert.match(calls[1].text,/Use design and notes/);
        await page.waitForFunction(async()=>!(await window.frst.status()).busy);
        await page.evaluate(()=>{void window.frst.submit("Steering target");});
        await page.waitForFunction(async()=>(await window.frst.status()).busy);
        await page.evaluate(async()=>{const canvas=document.createElement("canvas");canvas.width=100;canvas.height=100;const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));await addAttachments([new File([blob],"direction.png",{type:"image/png"})]);});
        await page.locator("#input").fill("Use this new direction");await page.evaluate(()=>send());
        await page.waitForFunction(()=>!document.querySelector(".pending-steer").disabled);
        await page.locator(".pending-steer").click();
        assert.equal(await app.evaluate(()=>globalThis.steeredFileResult),undefined);
        await app.evaluate(()=>globalThis.releaseSteeringTarget());
        await page.waitForFunction(async()=>(await window.frst.taskQueue("list")).tasks.some(t=>t.status==="steered"));
        const steered=await app.evaluate(()=>globalThis.steeredFileResult);
        assert.equal(steered.images,1);assert.match(steered.prompts.join(" "),/Use this new direction/);assert.match(steered.prompts.join(" "),/direction.png/);
        assert.equal((await app.evaluate(()=>globalThis.queueFileCalls)).length,3);
    }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
