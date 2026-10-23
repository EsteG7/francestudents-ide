"use strict";
const fs=require("node:fs/promises"),path=require("node:path");
const {resolveInWorkspace}=require("../src/tools/security");
const types={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml",bmp:"image/bmp",ico:"image/x-icon",mp3:"audio/mpeg",wav:"audio/wav",ogg:"audio/ogg",m4a:"audio/mp4",mp4:"video/mp4",webm:"video/webm",mov:"video/quicktime",pdf:"application/pdf",zip:"application/zip"};
function decodeText(buffer) {
    let encoding="utf8",bom=false;
    if(buffer[0]===255&&buffer[1]===254){encoding="utf16le";bom=true;}
    else if(buffer[0]===254&&buffer[1]===255){encoding="utf16be";bom=true;}
    else if(buffer[0]===239&&buffer[1]===187&&buffer[2]===191)bom=true;
    if(encoding==="utf8"&&buffer.includes(0))throw new Error("Fichier binaire : ouverture en aperçu.");
    try{return {content:new TextDecoder(encoding==="utf8"?"utf-8":encoding==="utf16le"?"utf-16le":"utf-16be",{fatal:true}).decode(buffer),encoding,bom};}
    catch(error){throw new Error("Encodage non pris en charge : aperçu binaire disponible.",{cause:error});}
}
function encodeText(text,{encoding="utf8",bom=false}={}) {
    if(!["utf8","utf16le","utf16be"].includes(encoding))throw new Error("Encodage refusé.");
    if(encoding==="utf8")return Buffer.from((bom?"\uFEFF":"")+text,"utf8");
    const bytes=Buffer.from((bom?"\uFEFF":"")+text,"utf16le");return encoding==="utf16be"?bytes.swap16():bytes;
}
async function inspectFile(workspace,relative) {
    const {target,rel}=await resolveInWorkspace(workspace,relative);const info=await fs.stat(target);
    if(!info.isFile())throw new Error("Ce chemin n’est pas un fichier.");
    const ext=path.extname(rel).slice(1).toLowerCase(),mime=types[ext]||"application/octet-stream";
    const data={path:rel,name:path.basename(rel),size:info.size,mime,modifiedAt:info.mtimeMs,kind:"binary",dataUrl:null,preview:"",truncated:info.size>16384};
    if(/^(image|audio|video)\//.test(mime)&&info.size<=20*1024*1024){data.kind=mime.split("/")[0];data.dataUrl=`data:${mime};base64,${(await fs.readFile(target)).toString("base64")}`;return data;}
    const handle=await fs.open(target,"r");const buffer=Buffer.alloc(Math.min(info.size,16384));try{await handle.read(buffer,0,buffer.length,0);}finally{await handle.close();}
    if(mime==="application/octet-stream")try{const decoded=decodeText(buffer);data.kind="text-preview";data.preview=decoded.content;return data;}catch{/* aperçu hexadécimal */}
    const lines=[];for(let i=0;i<buffer.length;i+=16){const row=buffer.subarray(i,i+16);lines.push(`${i.toString(16).padStart(8,"0")}  ${[...row].map(byte=>byte.toString(16).padStart(2,"0")).join(" ").padEnd(47)}  ${[...row].map(byte=>byte>=32&&byte<127?String.fromCharCode(byte):".").join("")}`);}data.preview=lines.join("\n");return data;
}
module.exports={decodeText,encodeText,inspectFile,types};
