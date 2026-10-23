"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const {createTranscriptStore,serverEntries}=require("../desktop/conversation-transcript");
test("visible transcript survives compaction, restart and histories longer than 30 messages",async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),"frst-transcript-"));
    const store=createTranscriptStore(dir);await store.begin("old",{mode:"agent",model:-3002});
    for(let i=0;i<60;i++){await store.capture("old",{type:"user",text:"Request "+i});await store.capture("old",{type:"tool",name:"write_file",arg:"file-"+i});await store.capture("old",{type:"assistant",text:"Finished step "+i});}
    await store.capture("new-after-compaction",{type:"info",text:"Context compacted"});await store.finish("new-after-compaction");
    const reopened=await createTranscriptStore(dir).load("old");
    assert.equal(reopened.latestId,"new-after-compaction");assert.equal(reopened.entries.length,181);
    assert.equal(reopened.entries[0].text,"Request 0");assert.equal(reopened.entries[179].text,"Finished step 59");
    assert.equal(reopened.entries.filter(entry=>entry.type==="tool").length,60);
});
test("server history fallback preserves all messages and translates agent actions for display",()=>{
    const entries=serverEntries({chatMessages:[{role:"user",content:"My task"},{role:"assistant",content:JSON.stringify({type:"tool",name:"write_file",args:{path:"index.html"},reason:"Create site"})},{role:"assistant",content:JSON.stringify({type:"final",message:"Done"})}]});
    assert.deepEqual(entries.map(entry=>entry.type),["user","reason","tool","assistant"]);assert.equal(entries.at(-1).text,"Done");
});
