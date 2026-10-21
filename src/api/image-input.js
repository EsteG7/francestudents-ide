"use strict";
const MAX_IMAGE_BYTES=5*1024*1024;
const MAX_IMAGE_INPUT_BYTES=25*1024*1024;
const MAX_IMAGE_SIDE=6000;

async function prepareImageInput(dataUrl){
    const match=/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(String(dataUrl));
    if(!match)throw new Error("Image jointe invalide (data URL base64 attendue).");
    const original=Buffer.from(match[2],"base64");
    if(!original.length||original.length>MAX_IMAGE_INPUT_BYTES)throw new Error("Image jointe vide ou trop volumineuse (25 Mo maximum avant préparation).");
    const sharp=require("sharp");
    let metadata;
    try{metadata=await sharp(original,{limitInputPixels:100000000}).metadata();}
    catch(error){throw new Error("Impossible de décoder l’image jointe.",{cause:error});}
    if(!["png","jpeg","webp","gif"].includes(metadata.format)||!metadata.width||!metadata.height)throw new Error("Format d’image non pris en charge : PNG, JPEG, WebP ou GIF attendu.");
    const mime={png:"image/png",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif"}[metadata.format];
    if(metadata.width<=MAX_IMAGE_SIDE&&metadata.height<=MAX_IMAGE_SIDE&&original.length<=MAX_IMAGE_BYTES){return {bytes:original,type:mime,width:metadata.width,height:metadata.height,originalWidth:metadata.width,originalHeight:metadata.height,resized:false};}
    // Resize the outgoing copy only. Never modify the screenshot on disk.
    let pipeline=sharp(original,{limitInputPixels:100000000,animated:false}).rotate().resize({width:MAX_IMAGE_SIDE,height:MAX_IMAGE_SIDE,fit:"inside",withoutEnlargement:true});
    let result=await pipeline.clone().png().toBuffer({resolveWithObject:true});
    let type="image/png";
    if(result.data.length>MAX_IMAGE_BYTES){
        type="image/jpeg";
        for(const quality of [85,70,50]){
            result=await pipeline.clone().flatten({background:"#ffffff"}).jpeg({quality}).toBuffer({resolveWithObject:true});
            if(result.data.length<=MAX_IMAGE_BYTES)break;
        }
    }
    if(result.data.length>MAX_IMAGE_BYTES)throw new Error("L’image reste trop volumineuse après compression (5 Mo maximum).");
    return {bytes:result.data,type,width:result.info.width,height:result.info.height,originalWidth:metadata.width,originalHeight:metadata.height,resized:true};
}
module.exports={prepareImageInput,MAX_IMAGE_SIDE,MAX_IMAGE_BYTES,MAX_IMAGE_INPUT_BYTES};
