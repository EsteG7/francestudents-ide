"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {manager,formatToolResult}=require("../src/mcp/manager");
const {state}=require("../src/state"),{setUiBackend}=require("../src/ui-bridge");
const tool=require("../src/mcp/tool");

test("MCP screenshots and embedded image resources reach the vision queue without leaking base64 to the prompt",async()=>{
    const original={start:manager.ensureStarted,find:manager.findTool,call:manager.call,images:state.pendingImages};
    try{
        const bytes=await require("sharp")({create:{width:48,height:32,channels:4,background:"blue"}}).png().toBuffer();
        const data=bytes.toString("base64");
        manager.ensureStarted=async()=>{};manager.findTool=()=>({});
        manager.call=async()=>formatToolResult({content:[
            {type:"text",text:"Roblox viewport"},
            {type:"image",mimeType:"image/png",data},
            {type:"resource",resource:{uri:"screenshot://viewport",mimeType:"image/png",blob:data}},
            {type:"image",mimeType:"image/png",data:"broken"}
        ]});
        state.pendingImages=[];setUiBackend({confirm:async()=>true});
        const result=await tool.run({server:"roblox",tool:"capture_screenshot"});
        assert.equal(result.vision_queued,true);assert.equal(state.pendingImages.length,2);
        assert.deepEqual(result.vision.map(image=>image.queued),[true,true,false]);
        assert.equal(result.vision[0].width,48);assert.equal(result.vision[0].height,32);
        assert.match(state.pendingImages[0],/^data:image\/png;base64,/);
        assert.ok(!JSON.stringify(result).includes(data));assert.match(result.vision[2].error,/décoder/);
        // Text-only responses and denied calls must not enqueue phantom images.
        manager.call=async()=>formatToolResult({content:[{type:"text",text:"Properties checked"}]});
        assert.equal((await tool.run({server:"roblox",tool:"get_properties"})).vision_queued,undefined);
        assert.equal(state.pendingImages.length,2);
        setUiBackend({confirm:async()=>false});
        assert.equal((await tool.run({server:"roblox",tool:"capture_screenshot"})).denied,true);
        assert.equal(state.pendingImages.length,2);
    }finally{
        manager.ensureStarted=original.start;manager.findTool=original.find;manager.call=original.call;state.pendingImages=original.images;setUiBackend(null);
    }
});
