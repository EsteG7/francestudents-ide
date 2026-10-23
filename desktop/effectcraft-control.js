"use strict";
const {METHODS,validate}=require("../src/effectcraft-protocol");
function createEffectCraftControl({getWindow,host}) {
    let pending = null;
    return async function control(input) {
        const request = validate(input), window = getWindow(), status = host.status();
        if (!window || window.isDestroyed() || !status.running) throw new Error("Ouvre l’espace Motion design et attends le chargement d’EffectCraft.");
        const frame = window.webContents.mainFrame.framesInSubtree.find(frame => frame.url.startsWith(status.url) && frame !== window.webContents.mainFrame);
        if (!frame) throw new Error("Le moteur EffectCraft n’est pas encore chargé.");
        if (pending === frame) throw new Error("Une commande EffectCraft est déjà en cours. Attends son résultat ou recharge le moteur.");
        pending = frame;
        let timer;
        try {
            const encoded = JSON.stringify(request);
            const operation = frame.executeJavaScript(`(async()=>{const request=${encoded};if(document.querySelector('#device-lost') && getComputedStyle(document.querySelector('#device-lost')).display!=='none')throw new Error('EffectCraft a perdu son périphérique graphique. Recharge le moteur.');if(!window.effectcraft || !window.effectcraftLoad?.readyMs)throw new Error(window.effectcraftLoad?.error || 'EffectCraft est encore en cours de chargement.');if(request.method==='host.info')return window.effectcraft.info();if(request.method==='host.save'){await window.effectcraft.saveToBrowser(request.params.path);await window.effectcraft.flush();return {saved:true,path:request.params.path,storage:'EffectCraft browser storage'};}return await window.effectcraft.request(request.method,request.params);})()`);
            operation.finally(()=>{if(pending===frame)pending=null;}).catch(()=>{});
            const result = await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("EffectCraft n’a pas répondu en 30 secondes. Vérifie l’éditeur et les tâches en cours avant de relancer.")),30000);})]);
            return typeof result === "string" ? result : JSON.parse(JSON.stringify(result ?? null));
        } finally {clearTimeout(timer);}
    };
}
module.exports = {createEffectCraftControl,validate,METHODS};
