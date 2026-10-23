"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{_electron}=require("playwright-core");
test("reopening shows full local actions across compaction and fetches old API messages",{timeout:90000},async()=>{
    const root=path.resolve(__dirname,".."),dir=fs.mkdtempSync(path.join(os.tmpdir(),"frst-replay-e2e-"));
    const store=require("../desktop/conversation-transcript").createTranscriptStore(path.join(dir,"conversation-transcripts"));
    await store.begin("before-compaction",{mode:"agent",model:-3002});
    for(let i=0;i<40;i++){await store.capture("before-compaction",{type:"user",text:"Original request "+i});await store.capture("before-compaction",{type:"tool",name:"write_file",arg:"file-"+i+".js"});await store.capture("before-compaction",{type:"assistant",text:"Completed step "+i});}
    await store.capture("after-compaction",{type:"error",text:'Erreur du flux : {"message":"This conversation has reached the maximum token limit of 250000."}'});await store.finish("after-compaction");
    fs.writeFileSync(path.join(dir,"history.json"),JSON.stringify([{id:"before-compaction",title:"Full local history",model:-3002,mode:"agent",messages:40},{id:"server-only",title:"Older API history",model:-3002,mode:"agent",messages:40}]));
    const harness=path.join(dir,"launch.cjs");
    fs.writeFileSync(harness,`require(${JSON.stringify(path.join(root,"src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root,"src/api/agents"))}).listAgents=async()=>({agents:[{id:-3002,name:'Gemini Flash'}],source:'local'});require(${JSON.stringify(path.join(root,"src/api/account"))}).getJson=async()=>({chatMessages:Array.from({length:40},(_,i)=>[{role:'user',content:'Old server request '+i},{role:'assistant',content:'Old server response '+i}]).flat()});require(${JSON.stringify(path.join(root,"desktop/main.js"))});`);
    const env={...process.env,FS_DATA_DIR:dir,FS_STATE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
    const app=await _electron.launch({executablePath:require("electron"),args:[harness,"--user-data-dir="+path.join(dir,"electron")],cwd:root,env});
    try{
        const page=await app.firstWindow();await page.locator("#startup-loading").waitFor({state:"hidden"});if(await page.locator("#guide-close").isVisible())await page.locator("#guide-close").click();
        await page.locator("#btn-history").click();await page.locator(".history-open").filter({hasText:"Full local history"}).click();
        await page.waitForFunction(()=>document.querySelector("#transcript").textContent.includes("Completed step 39"));
        assert.equal(await page.locator("#transcript .entry.user").count(),40);assert.equal(await page.locator("#transcript .entry.assistant").count(),40);assert.equal(await page.locator("#transcript .entry.tool").count(),40);
        assert.match(await page.locator("#transcript").innerText(),/Original request 0/);await page.locator(".context-limit-notice").waitFor();
        assert.match(await page.locator(".context-limit-notice").innerText(),/Limite de contexte atteinte/);
        if(process.env.FRST_QA_SCREENSHOT)await page.screenshot({path:process.env.FRST_QA_SCREENSHOT});
        await page.locator("#btn-history").click();await page.locator(".history-open").filter({hasText:"Older API history"}).click();
        await page.waitForFunction(()=>document.querySelector("#transcript").textContent.includes("Old server response 39"));
        assert.match(await page.locator("#transcript").innerText(),/Old server request 0/);assert.equal(await page.locator("#transcript .entry.assistant").count(),40);
        const resumed=await page.evaluate(()=>window.frst.conversationsOpen("before-compaction"));assert.equal(resumed.id,"after-compaction");
        await page.evaluate(()=>window.frst.motionConversation("motion"));
        await assert.rejects(page.evaluate(()=>window.frst.conversationsOpen("before-compaction")),/autre espace/);
        await page.evaluate(()=>window.frst.motionConversation("code"));
        await page.locator("#btn-new").click();
        await page.waitForFunction(()=>document.querySelector("#transcript").children.length===0);
        assert.equal(await page.locator("#agent-starter").isVisible(),true);
        // Starting over clears the display, but the saved conversation remains reopenable.
        await page.evaluate(()=>window.frst.conversationsOpen("before-compaction"));
        await page.waitForFunction(()=>document.querySelector("#transcript").textContent.includes("Completed step 39"));
        await page.evaluate(()=>window.frst.motionConversation("motion"));
        await page.evaluate(()=>window.frst.submit("/new"));
        await page.waitForFunction(()=>document.querySelector("#transcript").children.length===0);
    }finally{await app.close();}
});
