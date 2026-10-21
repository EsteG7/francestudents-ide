"use strict";
const fs=require("node:fs/promises"),path=require("node:path");
const {resolveInWorkspace}=require("./security"),{state}=require("../state"),{ui}=require("../ui-bridge");
async function viewImage(args,deps={}) {
    const {target,rel}=await resolveInWorkspace(deps.workspace||state.workspace,args.path);
    const mime={".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif"}[path.extname(rel).toLowerCase()];
    if(!mime)throw new Error("Vision : utilise une image PNG, JPEG, WebP ou GIF.");
    if((await fs.stat(target)).size>5*1024*1024)throw new Error("Image trop volumineuse pour la vision (5 Mo maximum).");
    if(!(await (deps.confirm||ui.confirm)(`Transmettre l’image ${rel} au modèle pour l’examiner ?`)))return {denied:true,changed:false,message:"Examen de l’image refusé."};
    const data=await fs.readFile(target);
    if(!Array.isArray(state.pendingImages))state.pendingImages=[];
    if(state.pendingImages.length>=10)throw new Error("Dix images sont déjà en attente.");
    state.pendingImages.push(`data:${mime};base64,${data.toString("base64")}`);
    return {path:rel,vision_queued:true,changed:false,message:"Image jointe à la prochaine requête au modèle. Si le fournisseur refuse la vision, utilise le texte du rendu et indique cette limite."};
}
module.exports={name:"view_image",run:viewImage,viewImage,check:args=>require("./core/args").requireString(args.path,"path"),describe:args=>args.path};
