"use strict";
const fs=require("node:fs"),path=require("node:path");
function createAttachmentStore(queueFile){
    const directory=queueFile+".attachments";
    const target=id=>{if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error("Identifiant de tâche invalide.");return path.join(directory,id+".json");};
    function write(id,list){
        if(!Array.isArray(list))throw new Error("Liste de fichiers invalide.");
        const attachments=list.map(item=>{
            if(!item||!["image","file","text"].includes(item.kind)||typeof item.data!=="string")throw new Error("Pièce jointe invalide.");
            const size=Buffer.byteLength(item.data,"utf8");
            const limit=item.kind==="text"?1024*1024:item.kind==="image"?7*1024*1024:35*1024*1024;
            if(size>limit)throw new Error("Pièce jointe trop volumineuse pour la file.");
            if(item.kind!=="text"&&!/^data:[^,]*;base64,[A-Za-z0-9+/=\s]+$/.test(item.data))throw new Error("Pièce jointe encodée invalide.");
            return {...item,name:String(item.name||"fichier").replace(/[\r\n]/g," ").slice(0,200),size:Math.max(0,Math.min(Number(item.size)||size,25*1024*1024))};
        });
        const json=JSON.stringify(attachments),bytes=Buffer.byteLength(json);
        if(bytes>50*1024*1024)throw new Error("Maximum 50 Mo de pièces jointes encodées par demande.");
        const file=target(id);
        fs.mkdirSync(directory,{recursive:true,mode:0o700});
        let total=bytes;
        for(const name of fs.readdirSync(directory))if(name.endsWith(".json")&&path.join(directory,name)!==file)total+=fs.statSync(path.join(directory,name)).size;
        if(total>200*1024*1024)throw new Error("La file contient déjà trop de fichiers (200 Mo). Retire des demandes ou leurs pièces jointes.");
        const tmp=file+".tmp";fs.writeFileSync(tmp,json,{mode:0o600});fs.renameSync(tmp,file);
        return attachments.map(({data,...metadata})=>metadata);
    }
    function read(task){
        if(!task.attachments?.length)return [];
        try{const file=target(task.id);if(fs.statSync(file).size>50*1024*1024)throw Error("too large");return JSON.parse(fs.readFileSync(file,"utf8"));}
        catch(error){throw new Error("Les pièces jointes de cette demande ne sont plus disponibles. Modifie-la pour les joindre à nouveau.",{cause:error});}
    }
    function remove(id){try{fs.unlinkSync(target(id));}catch(error){if(error.code!=="ENOENT")throw error;}}
    return {write,read,remove};
}
module.exports={createAttachmentStore};
