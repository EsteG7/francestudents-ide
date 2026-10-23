"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
process.env.FS_DATA_DIR=require("node:fs").mkdtempSync(path.join(os.tmpdir(),"frst-motion-isolation-"));process.env.FS_STATE_DIR=process.env.FS_DATA_DIR;
const {state}=require("../src/state"),{setUiBackend}=require("../src/ui-bridge");
test("motion blocks code tools in full access and keeps render files outside the code folder",async()=>{
    const code=await fs.mkdtemp(path.join(os.tmpdir(),"frst-code-isolation-"));
    const old={workspace:state.workspace,motionDesign:state.motionDesign,fullAccess:state.fullAccess,pendingImages:state.pendingImages};
    try{
        state.workspace=code;state.motionDesign=true;state.fullAccess=true;state.pendingImages=[];
        const {TOOLS,validateToolCall}=require("../src/tools/registry");
        for(const name of ["list_directory","read_file","search_files","write_file","run_command","mcp_call","task","github","semantic_search","diagnostics"]){
            assert.throws(()=>validateToolCall({name,args:{path:"."}}),/espace code/);
            assert.throws(()=>TOOLS[name].run({path:"."}),/espace code/);
        }
        const png=await require("sharp")({create:{width:32,height:32,channels:4,background:"blue"}}).png().toBuffer();
        setUiBackend({effectCraftControl:async()=>({png:png.toString("base64")}),confirm:async()=>true,info:()=>{}});
        const render=await TOOLS.effectcraft.run({method:"render.frame",params:{base64:true}});
        assert.deepEqual(await fs.readdir(code),[]);
        const motion=require("../src/motion-workspace").motionWorkspace();assert.ok((await fs.stat(path.join(motion,render.path))).isFile());
        assert.equal((await TOOLS.view_image.run({path:render.path})).vision_queued,true);
        state.motionDesign=false;validateToolCall({name:"read_file",args:{path:"file.js"}});
    }finally{Object.assign(state,old);setUiBackend(null);}
});

test("a motion task never reads code context or starts code hooks, profiles or MCP servers",async()=>{
    const code=await fs.mkdtemp(path.join(os.tmpdir(),"frst-private-code-"));
    await fs.writeFile(path.join(code,"AGENTS.md"),"PRIVATE_CODE_INSTRUCTIONS");
    const api=require("../src/api/api"),profile=require("../src/project/profile"),mcp=require("../src/mcp/manager").manager;
    const previous={workspace:state.workspace,motionDesign:state.motionDesign,history:state.history,chatIds:state.chatIds};
    const originals={request:api.requestModel,profile:profile.buildPreprompt,mcp:mcp.ensureStarted,read:fs.readFile,list:fs.readdir};let reads=0,profileCalls=0,mcpCalls=0;
    try{
        state.workspace=code;state.motionDesign=true;state.history=[];state.chatIds={chat:null,agent:null};
        for(const [name,original] of [["readFile",originals.read],["readdir",originals.list]])fs[name]=async(...args)=>{if(String(args[0]).startsWith(code)){reads++;throw Error("Code folder must not be read");}return original(...args);};
        profile.buildPreprompt=()=>{profileCalls++;throw Error("Code profile must not be loaded");};mcp.ensureStarted=async()=>{mcpCalls++;throw Error("Code MCP must not be started");};
        api.requestModel=async prompt=>{assert.doesNotMatch(prompt,/PRIVATE_CODE_INSTRUCTIONS/);assert.ok(!prompt.includes(code));return JSON.stringify({type:"final",message:"Motion task complete",completed:true});};
        const result=await require("../src/agent/agent").runAgent("Anime le titre dans EffectCraft");
        assert.equal(result.completed,true);assert.equal(reads,0);assert.equal(profileCalls,0);assert.equal(mcpCalls,0);
    }finally{api.requestModel=originals.request;profile.buildPreprompt=originals.profile;mcp.ensureStarted=originals.mcp;fs.readFile=originals.read;fs.readdir=originals.list;Object.assign(state,previous);}
});

test("motion always routes to EffectCraft even without a code project or with chat mode selected",async()=>{
    const agent=require("../src/agent/agent"),chat=require("../src/core/chat"),session=require("../src/core/session");
    const before={workspace:state.workspace,motionDesign:state.motionDesign,mode:state.mode},original={agent:agent.runAgent,chat:chat.send};let calls=0;
    try{
        state.motionDesign=true;state.workspace=null;state.mode="chat";
        agent.runAgent=async()=>{calls++;return {completed:true};};chat.send=async()=>{throw Error("Code chat must not receive a motion task");};
        assert.equal((await session.handleInput("Anime mon texte")).completed,true);
        assert.equal((await session.handleInput("Dans quel projet sommes-nous ?")).completed,true);
        assert.equal(calls,2);
    }finally{agent.runAgent=original.agent;chat.send=original.chat;Object.assign(state,before);}
});
