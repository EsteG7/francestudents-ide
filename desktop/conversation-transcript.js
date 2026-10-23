"use strict";
const fs=require("node:fs/promises"),path=require("node:path"),{createHash}=require("node:crypto");
function createTranscriptStore(directory){
    const base=path.resolve(directory),key=id=>createHash("sha256").update(String(id)).digest("hex");
    const file=(id,ext)=>path.join(base,key(id)+ext);
    let queue=Promise.resolve(),active=null;
    function enqueue(fn){const job=queue.then(fn);queue=job.catch(()=>{});return job;}
    async function readMeta(id){try{return JSON.parse(await fs.readFile(file(id,".json"),"utf8"));}catch(error){if(error.code==="ENOENT")return null;throw error;}}
    async function writeMeta(id,data){const target=file(id,".json"),temp=target+".tmp";await fs.writeFile(temp,JSON.stringify(data),{mode:0o600});await fs.rename(temp,target);}
    async function load(id){
        let latestId=id,meta=null;const seen=new Set();
        while(!seen.has(latestId)){seen.add(latestId);meta=await readMeta(latestId);if(!meta?.latestId || meta.latestId===latestId)break;latestId=meta.latestId;}
        let text;try{text=await fs.readFile(file(latestId,".jsonl"),"utf8");}catch(error){if(error.code==="ENOENT")return null;throw error;}
        const entries=[];for(const line of text.split("\n")){if(!line.trim())continue;try{const entry=JSON.parse(line);if(entry && typeof entry.type==="string")entries.push(entry);}catch{/* A crash can leave an incomplete last line; earlier entries remain readable. */}}
        return {latestId,metadata:meta?.metadata || {},entries};
    }
    async function bind(id){
        if(!active || !id || id===active.id)return;
        await fs.mkdir(base,{recursive:true});
        const snapshot=active;const previous=snapshot.id;snapshot.id=id;
        await fs.writeFile(file(id,".jsonl"),snapshot.entries.map(entry=>JSON.stringify(entry)).join("\n")+(snapshot.entries.length?"\n":""),{mode:0o600});
        await writeMeta(id,{latestId:id,metadata:snapshot.metadata});
        if(previous)await writeMeta(previous,{latestId:id,metadata:snapshot.metadata});
    }
    return {
        load,
        metadata:readMeta,
        begin(id,metadata){return enqueue(async()=>{const saved=id?await load(id):null;active={id:saved?.latestId || id || null,entries:saved?.entries || [],metadata:{...saved?.metadata,...metadata}};if(active.id){await fs.mkdir(base,{recursive:true});await writeMeta(active.id,{latestId:active.id,metadata:active.metadata});}});},
        capture(id,entry){return enqueue(async()=>{if(!active || entry.debug)return;await bind(id);const event={...entry,at:entry.at || new Date().toISOString()};active.entries.push(event);if(active.id)await fs.appendFile(file(active.id,".jsonl"),JSON.stringify(event)+"\n",{mode:0o600});});},
        finish(id){return enqueue(async()=>{await bind(id);active=null;});},
        flush(){return queue;}
    };
}
function serverEntries(dto){
    const messages=Array.isArray(dto?.chatMessages)?dto.chatMessages:[];
    const entries=[];
    for(const message of messages){
        const role=String(message.role || "").toLowerCase(),text=String(message.content || "");if(!text)continue;
        if(role==="user")entries.push({type:"user",text,at:message.createdAt});
        else if(role==="assistant"){
            let action;try{action=JSON.parse(text);}catch{/* Plain chat text. */}
            if(action?.type==="final" && typeof action.message==="string")entries.push({type:"assistant",text:action.message,at:message.createdAt});
            else if(action?.type==="tool"){if(action.reason)entries.push({type:"reason",text:action.reason});entries.push({type:"tool",name:action.name || "action",arg:JSON.stringify(action.args || action.calls || {})});}
            else entries.push({type:"assistant",text,at:message.createdAt});
        }else if(role==="tool")entries.push({type:"result",text,at:message.createdAt});
    }
    return entries;
}
module.exports={createTranscriptStore,serverEntries};
