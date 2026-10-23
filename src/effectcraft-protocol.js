"use strict";
const METHODS=new Set(["host.info","host.save","engine.execute","engine.commands","ui.inspect","ui.elements","ui.set","ui.playback","ui.menu.list","ui.menu.invoke","ui.click","ui.key","ui.type","render.frame"]);
function validate(request){
    if(!request || !METHODS.has(request.method))throw new Error("Méthode EffectCraft non autorisée.");
    const params=request.params || {};
    if(typeof params!=="object" || Array.isArray(params) || JSON.stringify(params).length>200000)throw new Error("Paramètres EffectCraft invalides ou trop volumineux.");
    if(request.method==="engine.execute" && (typeof params.command!=="string" || !/^[a-zA-Z][\w.]*$/.test(params.command)))throw new Error("Commande EffectCraft invalide.");
    if(request.method==="host.save" && (typeof params.path!=="string" || !/^[\w -]{1,100}\.ecproj$/.test(params.path)))throw new Error("Nom de projet .ecproj attendu, sans dossier.");
    return {method:request.method,params};
}
module.exports={METHODS,validate};
