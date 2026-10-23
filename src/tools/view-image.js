"use strict";
const fs=require("node:fs/promises"),path=require("node:path");
const {resolveInWorkspace}=require("./security"),{state}=require("../state"),{ui}=require("../ui-bridge");
async function viewImage(args,deps={}) {
    const {target,rel}=await resolveInWorkspace(deps.workspace||require("../motion-workspace").toolWorkspace(),args.path);
    const mime={".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif"}[path.extname(rel).toLowerCase()];
    if(!mime)throw new Error("Vision : utilise une image PNG, JPEG, WebP ou GIF.");
    if((await fs.stat(target)).size>require("../api/image-input").MAX_IMAGE_INPUT_BYTES)throw new Error("Image trop volumineuse pour la vision (25 Mo maximum avant préparation).");
    if(!(await (deps.confirm||ui.confirm)(`Transmettre l’image ${rel} au modèle pour l’examiner ?`)))return {denied:true,changed:false,message:"Examen de l’image refusé."};
    const data=await fs.readFile(target);
    const prepared=await require("../api/image-input").prepareImageInput(`data:${mime};base64,${data.toString("base64")}`);
    const warning=prepared.resized?`Capture réduite de ${prepared.originalWidth} × ${prepared.originalHeight} à ${prepared.width} × ${prepared.height} pixels. Les petits textes et détails peuvent être illisibles ; utilise une capture de zone ou du viewport pour vérifier ces détails.`:"";
    if(!Array.isArray(state.pendingImages))state.pendingImages=[];
    if(state.pendingImages.length>=10)throw new Error("Dix images sont déjà en attente.");
    state.pendingImages.push(`data:${prepared.type};base64,${prepared.bytes.toString("base64")}`);
    if(warning)ui.info(warning);
    return {path:rel,vision_queued:true,changed:false,resized:prepared.resized,original_dimensions:{width:prepared.originalWidth,height:prepared.originalHeight},sent_dimensions:{width:prepared.width,height:prepared.height},readability_warning:warning||null,message:"Image préparée et jointe à la prochaine requête au modèle. Si le fournisseur refuse la vision, utilise le texte du rendu et indique cette limite."};
}
module.exports={name:"view_image",run:viewImage,viewImage,check:args=>require("./core/args").requireString(args.path,"path"),describe:args=>args.path};
