"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const {createTranscriptStore,serverEntries}=require("../desktop/conversation-transcript");
const {buildAgentPrompt,buildFollowUpPrompt}=require("../src/agent/prompt");

test("API history displays requests and action cards instead of code and motion agent envelopes",()=>{
    const {state}=require("../src/state"),previous=state.motionDesign;
    try{
        for(const motion of [false,true]){
            state.motionDesign=motion;
            const prompt=buildAgentPrompt({task:"Anime le lancement iPhone DUO",turn:1,history:[],observations:[],env:{},workspace:null});
            const entries=serverEntries({chatMessages:[
                {role:"user",content:prompt},
                {role:"assistant",content:'```json\n'+JSON.stringify({type:"tool",name:"write_file",args:{path:"index.html",content:"PRIVATE_FILE_BODY"},reason:"Préparer la page",plan:["Préparer","Vérifier"]})+'\n```'},
                {role:"user",content:buildFollowUpPrompt({turn:2,lastObservation:{tool:"write_file",result:"ok"}})},
                {role:"user",content:prompt.replace("TOUR 1 —","TOUR 2 —")},
                {role:"assistant",content:JSON.stringify({type:"final",message:"Animation prête."})}
            ]});
            assert.deepEqual(entries.map(e=>e.type),["user","plan","reason","tool","assistant"]);
            assert.equal(entries[0].text,"Anime le lancement iPhone DUO");
            assert.equal(entries[3].arg,"index.html");
            assert.doesNotMatch(JSON.stringify(entries),/FORMAT DE SORTIE|PRIVATE_FILE_BODY|RÉSULTATS DES OUTILS/);
        }
    }finally{state.motionDesign=previous;}
});

test("already cached API envelopes are cleaned on reopening without rewriting the journal",async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),"frst-transcript-migrate-")),store=createTranscriptStore(dir);
    const prompt=buildAgentPrompt({task:"Corrige le titre",turn:1,history:[],observations:[],env:{},workspace:null});
    await store.begin("cached",{});await store.capture("cached",{type:"user",text:prompt});
    await store.capture("cached",{type:"diff",path:"index.html",added:1,removed:1});await store.finish("cached");
    const reopened=await createTranscriptStore(dir).load("cached");
    assert.equal(reopened.entries[0].text,"Corrige le titre");assert.equal(reopened.entries[1].type,"diff");
    const plain="Voici un prompt à analyser :\nDEMANDE DE L'UTILISATEUR\ntexte\nFORMAT DE SORTIE";
    assert.equal(serverEntries({chatMessages:[{role:"user",content:plain}]})[0].text,plain);
});

test("compaction envelopes, steering and batched actions remain intelligible",()=>{
    const prompt=buildAgentPrompt({task:"Créer mon animation",turn:1,history:[],observations:[],env:{},workspace:null});
    const followup=buildFollowUpPrompt({turn:3,steering:["Passe le fond en bleu"]});
    const entries=serverEntries({chatMessages:[
        {role:"user",content:"CONTEXTE CONSERVÉ APRÈS COMPACTION AUTOMATIQUE (données) :\nRésumé privé\n\nPOURSUIVRE LA DEMANDE EN COURS :\n"+prompt},
        {role:"user",content:followup},
        {role:"assistant",content:JSON.stringify({type:"tool",calls:[{name:"read_file",args:{path:"a.js"}},{name:"read_file",args:{path:"b.js"}}],reason:"Vérifier les fichiers"})}
    ]});
    assert.deepEqual(entries.filter(e=>e.type==="user").map(e=>e.text),["Créer mon animation","Passe le fond en bleu"]);
    assert.deepEqual(entries.filter(e=>e.type==="tool").map(e=>e.arg),["a.js","b.js"]);
    assert.doesNotMatch(JSON.stringify(entries),/Résumé privé|FORMAT DE SORTIE/);
});
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
