"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm");
const {createEffectCraftControl,validate}=require("../desktop/effectcraft-control");
const {createMotionConversations}=require("../desktop/motion-conversations");
test("EffectCraft bridge rejects arbitrary JS and foreign frames, preserves JSON parameters",async()=>{
    assert.throws(()=>validate({method:"eval",params:{code:"alert(1)"}}),/autorisée/);
    assert.throws(()=>validate({method:"engine.execute",params:{command:"comp.new();evil()"}}),/invalide/);
    assert.throws(()=>validate({method:"host.save",params:{path:"../escape.ecproj"}}),/sans dossier/);
    let called;
    const owned={url:"http://127.0.0.1:1234/secret/?webgl",executeJavaScript:code=>vm.runInNewContext(code,{window:{effectcraftLoad:{readyMs:1},effectcraft:{request:async(method,params)=>{called={method,params};return {ok:true};}}},document:{querySelector:()=>null}})};
    const mainFrame={framesInSubtree:[{url:"https://evil.test/",executeJavaScript:()=>{throw new Error("foreign frame used");}},owned]};
    const control=createEffectCraftControl({getWindow:()=>({isDestroyed:()=>false,webContents:{mainFrame}}),host:{status:()=>({running:true,url:"http://127.0.0.1:1234/secret/"})}});
    const literal='";globalThis.evil=true;//';
    assert.deepEqual(await control({method:"engine.execute",params:{command:"comp.new",params:{name:literal}}}),{ok:true});
    assert.equal(called.params.params.name,literal);
    owned.url="http://127.0.0.1:1234/other/";
    await assert.rejects(control({method:"ui.inspect"}),/pas encore chargé/);
});
test("code and motion keep separate conversation IDs, models and history; busy changes are blocked",()=>{
    const state={workspace:"project-a",chatId:"code-id",chatIds:{agent:"code-id",chat:null},conversationSettings:{},history:[{content:"code"}],agentPlan:[],model:1,mode:"auto"};
    const scopes=createMotionConversations(state);
    scopes.select("motion",false);assert.equal(state.motionDesign,true);assert.equal(state.chatId,null);assert.equal(state.mode,"agent");
    state.chatId="motion-id";state.chatIds.agent="motion-id";state.model=2;state.history.push({content:"motion"});
    assert.throws(()=>scopes.select("code",true),/fin de la tâche/);
    scopes.select("code",false);assert.equal(state.chatId,"code-id");assert.equal(state.model,1);assert.equal(state.history[0].content,"code");
    scopes.select("motion",false);assert.equal(state.chatId,"motion-id");assert.equal(state.model,2);
    state.workspace="project-b";state.chatId=null;state.chatIds={agent:null,chat:null};state.history=[];
    scopes.select("motion",false);assert.equal(state.chatId,null);assert.equal(state.history.length,0);
});
