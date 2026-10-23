"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{_electron}=require("playwright-core");
test("EffectCraft real engine is controlled through the specialized agent chat",{timeout:90000},async()=>{
    const root=path.resolve(__dirname,".."),dir=fs.mkdtempSync(path.join(os.tmpdir(),"frst-effectcraft-")),project=path.join(dir,"project");fs.mkdirSync(project);
    const harness=path.join(dir,"launch.cjs");
    fs.writeFileSync(harness,`require(${JSON.stringify(path.join(root,"src/core/session"))}).bootstrap=async()=>({ok:true});require(${JSON.stringify(path.join(root,"src/state"))}).state.fullAccess=true;let turn=0;require(${JSON.stringify(path.join(root,"src/api/api"))}).requestModel=async(prompt,options={})=>{if(options.fresh || options.conversationMode!=='agent')return 'Project summary';globalThis.motionPrompts=(globalThis.motionPrompts||[]).concat(prompt);return ++turn===1?JSON.stringify({type:'tool',name:'effectcraft',args:{method:'engine.execute',params:{command:'comp.new',params:{}}},reason:'Create a composition in EffectCraft'}):JSON.stringify({type:'final',message:'Composition created in EffectCraft.',completed:true});};require(${JSON.stringify(path.join(root,"desktop/main.js"))});`);
    const env={...process.env,FS_DATA_DIR:dir,FS_STATE_DIR:dir,FS_SKILLS_DIR:path.join(dir,"skills")};delete env.ELECTRON_RUN_AS_NODE;
    const app=await _electron.launch({executablePath:process.env.FRST_PACKAGED_EXE || require("electron"),args:process.env.FRST_PACKAGED_EXE?["--user-data-dir="+path.join(dir,"electron")]:[harness,"--user-data-dir="+path.join(dir,"electron")],cwd:root,env});
    try{
        const page=await app.firstWindow(),errors=[];page.on("pageerror",e=>errors.push(e.message));
        await page.locator("#startup-loading").waitFor({state:"hidden"});
        if(await page.locator("#guide-close").isVisible())await page.locator("#guide-close").click();
        await page.evaluate(p=>window.frst.openProject(p),project);
        if(process.env.FRST_PACKAGED_EXE){
            assert.equal(await app.evaluate(({app})=>app.getVersion()),require("../package.json").version);
            assert.equal(await page.evaluate(()=>window.frst.ptyAvailable()),true);
            const output=await page.evaluate(async()=>{
                let text="",id=null;
                const off=window.frst.onEvent((channel,data)=>{if(channel==="ptyData" && data.id===id)text+=data.data;});
                try{
                    id=(await window.frst.ptyCreate(".",100,30)).id;
                    await window.frst.ptyWrite(id,"Write-Output ('FRST_'+(40+2)+'_PACKAGED')\r");
                    const start=Date.now();while(!text.includes("FRST_42_PACKAGED") && Date.now()-start<15000)await new Promise(resolve=>setTimeout(resolve,100));
                    return text;
                }finally{if(id!==null)await window.frst.ptyKill(id);off();}
            });
            assert.match(output,/FRST_42_PACKAGED/);
        }
        await page.locator("#input").fill("Code draft stays here");
        await page.locator("#btn-motion").click();await page.locator("#motion-consent-ok").click();
        await page.locator(".motion-engine-iframe").waitFor();
        const frame=await (await page.locator(".motion-engine-iframe").elementHandle()).contentFrame();
        await frame.waitForFunction(()=>window.effectcraftLoad?.readyMs || window.effectcraftLoad?.error,null,{timeout:45000});
        await page.waitForFunction(()=>/prêt/i.test(document.querySelector("#motion-engine-status").textContent),null,{timeout:20000});
        const info=await page.evaluate(()=>window.frst.effectCraftControl({method:"host.info",params:{}}));
        assert.equal(info.integration.theme,"francestudent-v1");
        const tools=await page.evaluate(()=>window.frst.effectCraftControl({method:"ui.elements",params:{prefix:"tools."}}));
        assert.equal(tools.length,4);
        assert.equal(await page.locator("#motion-simple").getAttribute("aria-pressed"),"true");
        const summary=await page.evaluate(()=>window.frst.effectCraftControl({method:"engine.execute",params:{command:"project.summary",params:{}}}));
        assert.ok(Array.isArray(summary.items));
        assert.equal(await page.locator("#mg-studio").count(),0);
        if(!process.env.FRST_PACKAGED_EXE){
            await page.locator("#input").fill("Create a new composition in EffectCraft.");await page.locator("#btn-send").click();
            await page.waitForFunction(()=>document.querySelector("#transcript").textContent.includes("Composition created in EffectCraft."),null,{timeout:20000});
            const prompts=await app.evaluate(()=>globalThis.motionPrompts);assert.match(prompts[0],/AGENT MOTION DESIGN/);assert.match(prompts[1],/comp.new/);
        }else await page.evaluate(()=>window.frst.effectCraftControl({method:"engine.execute",params:{command:"comp.new",params:{}}}));
        await page.waitForFunction(()=>!document.querySelector("#statusbar").classList.contains("busy"));
        await page.evaluate(()=>window.frst.effectCraftControl({method:"engine.execute",params:{command:"layer.newText",params:{text:"FranceStudent",name:"Verified title",position:[960,540],size:128,fill:"#86b7ff"}}}));
        const rendered=await page.evaluate(()=>window.frst.effectCraftControl({method:"render.frame",params:{base64:true,max_side:640}}));
        assert.ok(Buffer.from(rendered.png,"base64").length>100);
        await page.locator("#motion-local-save").click();
        await page.waitForFunction(()=>document.querySelector("#motion-engine-status").textContent.includes("action effectuée"));
        await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,960));
        if(process.env.FRST_QA_SCREENSHOT)await page.screenshot({path:process.env.FRST_QA_SCREENSHOT+"-effectcraft.png"});
        await page.locator("#motion-advanced").click();
        await page.waitForFunction(()=>document.querySelector("#motion-advanced").getAttribute("aria-pressed")==="true");
        const advancedTools=await page.evaluate(()=>window.frst.effectCraftControl({method:"ui.elements",params:{prefix:"tools."}}));
        assert.ok(advancedTools.length>tools.length);
        if(process.env.FRST_QA_SCREENSHOT)await page.screenshot({path:process.env.FRST_QA_SCREENSHOT+"-effectcraft-advanced.png"});
        await page.locator("#motion-simple").click();
        await page.waitForFunction(()=>document.querySelector("#motion-simple").getAttribute("aria-pressed")==="true");
        await page.locator("#input").fill("Keep my motion draft");
        await page.locator("#motion-tutorial-open").click();
        if(process.env.FRST_QA_SCREENSHOT)await page.screenshot({path:process.env.FRST_QA_SCREENSHOT+"-effectcraft-tutorial.png"});
        await page.getByRole("button",{name:"Préparer la demande",exact:true}).click();
        assert.match(await page.locator("#input").inputValue(),/^Keep my motion draft/);
        assert.match(await page.locator("#input").inputValue(),/Mon premier projet/);
        if(!process.env.FRST_PACKAGED_EXE)assert.equal((await app.evaluate(()=>globalThis.motionPrompts)).length,2);
        await page.locator("#motion-close").click();
        await page.waitForFunction(()=>!document.querySelector("#app").classList.contains("view-motion"));
        assert.equal(await page.locator("#input").inputValue(),"Code draft stays here");
        assert.doesNotMatch(await page.locator("#transcript").innerText(),/Composition created in EffectCraft/);
        await page.locator("#btn-motion").click();
        const restored=await page.evaluate(()=>window.frst.effectCraftControl({method:"engine.execute",params:{command:"project.summary",params:{}}}));
        assert.equal(restored.activeComp,rendered.comp);
        await page.locator("#motion-skills").click();
        await page.locator("#motion-marketplace").waitFor({state:"visible"});
        assert.equal(await page.locator("#motion-marketplace-list .center-card").count(),8);
        assert.equal(await page.locator('[data-motion-collection="effectcraft"]').getAttribute("aria-pressed"),"true");
        const skillCard=page.locator('[data-motion-skill-id="motion-titles"]');
        await skillCard.getByRole("button",{name:"Installer",exact:true}).click();
        await skillCard.getByRole("button",{name:"Installé",exact:true}).waitFor();
        assert.match(fs.readFileSync(path.join(dir,"skills/motion-titles/SKILL.md"),"utf8"),/application: effectcraft/);
        assert.deepEqual(errors,[]);
    }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
