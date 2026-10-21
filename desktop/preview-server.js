"use strict";
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const {randomBytes} = require("node:crypto");
const {resolveInWorkspace} = require("../src/tools/security");
const mime={".html":"text/html; charset=utf-8",".htm":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",".webp":"image/webp",".ico":"image/x-icon",".woff2":"font/woff2",".txt":"text/plain; charset=utf-8"};
function createPreviewServer() {
    let active=null;
    async function stop() {
        if(!active)return;
        const previous=active;active=null;
        previous.server.closeAllConnections();
        await new Promise(resolve=>previous.server.close(resolve));
    }
    async function start(workspace,entry="index.html") {
        if(!workspace)throw new Error("Ouvre un projet avant de lancer l’aperçu.");
        const {target}=await resolveInWorkspace(workspace,entry);
        if(!(await fs.stat(target)).isFile() || !/\.html?$/i.test(entry))throw new Error("Choisis un fichier HTML pour l’aperçu statique.");
        if(active?.workspace===workspace) return {url:`${active.base}${entry.split("/").map(encodeURIComponent).join("/")}`,root:active.base};
        await stop();
        const token=randomBytes(24).toString("hex");
        const prefix=`/${token}/`;
        const server=http.createServer(async(req,res)=>{
            try {
                if(!["GET","HEAD","OPTIONS"].includes(req.method)){res.writeHead(405);res.end();return;}
                if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||"")){res.writeHead(403);res.end();return;}
                const url=new URL(req.url,"http://127.0.0.1");
                if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end();return;}
                let rel=decodeURIComponent(url.pathname.slice(prefix.length))||"index.html";
                if(rel.endsWith("/"))rel+="index.html";
                if(rel.split(/[\\/]/).some(segment=>segment.startsWith(".")))throw new Error("Fichier privé");
                const resolved=await resolveInWorkspace(workspace,rel);
                const info=await fs.stat(resolved.target);
                if(!info.isFile()||info.size>10000000)throw new Error("Fichier non disponible");
                res.writeHead(200,{"Content-Type":mime[path.extname(rel).toLowerCase()]||"application/octet-stream","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Access-Control-Allow-Origin":"*","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'"});
                res.end(req.method==="HEAD"?undefined:await fs.readFile(resolved.target));
            } catch {res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});res.end("Fichier introuvable ou non autorisé dans l’aperçu.");}
        });
        await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
        const base=`http://127.0.0.1:${server.address().port}${prefix}`;
        active={server,workspace,base};
        return {url:`${base}${entry.split("/").map(encodeURIComponent).join("/")}`,root:base};
    }
    return {start,stop};
}
function localPreviewUrl(value) {
    const url=new URL(String(value));
    if(!["http:","https:"].includes(url.protocol)||!["localhost","127.0.0.1"].includes(url.hostname)||url.username||url.password)throw new Error("L’aperçu accepte uniquement une adresse locale : localhost ou 127.0.0.1.");
    return url.href;
}
module.exports={createPreviewServer,localPreviewUrl};
