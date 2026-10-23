"use strict";
const {createHash}=require("node:crypto");
const {unzipSync}=require("fflate");
const {setFrontmatterValue}=require("../src/skills");
const REVISION="6c67adcd9cdbe6eb84d76342da89b225f9161cb2";
const SHA256="f4a99ab68e484fe9b1155c2c021ef860c0de1175d8e263f8ab693bb164470849";
const catalog=[
    ["remotion-best-practices","Remotion · Les bases","La méthode complète pour créer des vidéos avec React.",667300],
    ["remotion-render","Remotion · Export vidéo","Rendre une vidéo ou une image depuis un projet Remotion.",199500],
    ["remotion-create","Remotion · Créer une vidéo","Démarrer un projet ou une nouvelle composition Remotion.",198400],
    ["remotion-captions","Remotion · Sous-titres","Créer et synchroniser des sous-titres dans Remotion.",196100],
    ["remotion-markup","Remotion · Animation et mise en page","Texte, rythme, médias et animations dans une vidéo React.",192100]
].map(([id,title,description,installs])=>({id,title,name:id,description,installs,author:"remotion-dev",application:"code",checkedAt:"2026-10-23",popularityUrl:"https://www.skills.sh/remotion-dev/skills",githubUrl:`https://github.com/remotion-dev/skills/tree/${REVISION}/skills/${id}`}));
function extractBundle(bytes,id){
    if(!catalog.some(item=>item.id===id))throw new Error("Skill motion inconnu.");
    if(createHash("sha256").update(bytes).digest("hex")!==SHA256)throw new Error("L’empreinte du paquet Remotion ne correspond pas à la version vérifiée.");
    const prefix=`skills-${REVISION}/skills/${id}/`;
    let size=0,count=0;
    const archive=unzipSync(bytes,{filter:entry=>{
        if(!entry.name.startsWith(prefix) || entry.name.endsWith("/"))return false;
        if(++count>200 || entry.originalSize>2000000 || (size+=entry.originalSize)>4000000)throw new Error("Paquet motion trop volumineux.");
        return true;
    }});
    const files=[];let content;
    for(const [name,data] of Object.entries(archive)){
        const relative=name.slice(prefix.length);
        if(!relative || relative.includes("\\") || relative.split("/").some(part=>!part || part==="." || part===".." || part.includes(":")))throw new Error("Chemin de ressource invalide.");
        if(relative==="SKILL.md")content=Buffer.from(data).toString("utf8");
        else files.push({path:relative,data:Buffer.from(data)});
    }
    if(!content)throw new Error("Le paquet ne contient pas de SKILL.md.");
    content=setFrontmatterValue(setFrontmatterValue(content,"disabled","true"),"application","code");
    return {content,files};
}
async function downloadBundle({id,fetchFn,signal,onProgress}){
    const response=await fetchFn(`https://codeload.github.com/remotion-dev/skills/zip/${REVISION}`,{redirect:"error",signal});
    if(!response.ok || !response.body)throw new Error(`Paquet Remotion indisponible (HTTP ${response.status}).`);
    const reader=response.body.getReader(),chunks=[];let size=0;
    const total=Number(response.headers.get("content-length")) || null;
    try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8000000)throw new Error("Téléchargement motion trop volumineux.");chunks.push(Buffer.from(value));onProgress(size,total);}}
    finally{await reader.cancel().catch(()=>{});}
    signal.throwIfAborted();return extractBundle(Buffer.concat(chunks),id);
}
module.exports={catalog,downloadBundle,extractBundle,REVISION,SHA256};
