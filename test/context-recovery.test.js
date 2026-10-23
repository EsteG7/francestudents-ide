"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
process.env.FS_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"frst-context-recovery-"));
const {state}=require("../src/state"),{auth}=require("../src/api/auth"),{requestModel}=require("../src/api/api");
test("Gemini 250000-token SSE failure compacts and continues, remembering the actual backend limit",async()=>{
    const original=global.fetch;auth.accessToken="test";auth.expiresAt=Date.now()+300000;
    state.model=-3002;state.chatIds.agent="old-gemini";state.history=[{role:"user",content:"Preserve my whole animation task"}];
    requestModel.compactor=new (require("../src/agent/auto-compact").AutoCompact)();
    const bodies=[];
    global.fetch=async(url,init)=>{
        if(String(url).endsWith("/usage"))return Response.json({contextUsagePercent:40});
        const body=JSON.parse(init.body);bodies.push(body);
        if(bodies.length===1)return new Response('event: error\ndata: {"message":"This conversation has reached the maximum token limit of 250000."}\n\n',{headers:{"content-type":"text/event-stream"}});
        const summary=bodies.length===2;
        return new Response('event: response.output_text.delta\ndata: '+JSON.stringify({chat_id:summary?"summary":"continued-gemini",delta:summary?"Keep the animation task and existing changes.":"continued"})+'\n\ndata: [DONE]\n\n',{headers:{"content-type":"text/event-stream"}});
    };
    try{
        assert.equal(await requestModel("Continue working",{conversationMode:"agent",freshMessage:()=>"Full task and latest tool results"}),"continued");
        assert.equal(bodies.length,3);assert.equal(bodies[0].chatId,"old-gemini");assert.equal(bodies[2].chatId,null);
        assert.match(bodies[2].initialContent,/Full task and latest tool results/);
        assert.equal(require("../src/api/context-limits").observedLimit(-3002),250000);
        assert.equal(require("../src/api/context-limits").applyLimit(-3002,{contextWindowTokens:1048576}).contextWindowTokens,250000);
    }finally{global.fetch=original;}
});
