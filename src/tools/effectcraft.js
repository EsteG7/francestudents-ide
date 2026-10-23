"use strict";
module.exports = {
    name:"effectcraft",
    check:args=>require("../effectcraft-protocol").validate(args),
    describe:args=>({"comp.new":"Créer une composition","layer.newText":"Ajouter un texte","prop.set":"Ajuster l’animation","project.summary":"Examiner le projet","command.describe":"Vérifier une commande","layer.tree":"Examiner les calques"}[args.params?.command] || {"host.save":"Enregistrer le projet","render.frame":"Vérifier le rendu","engine.commands":"Rechercher les outils d’animation","ui.inspect":"Examiner l’éditeur","ui.playback":"Contrôler la lecture"}[args.method] || `EffectCraft · ${args.params?.command || args.method}`),
    async run(args) {
        const backend=require("../ui-bridge").getUiBackend();
        if(typeof backend.effectCraftControl!=="function")throw new Error("EffectCraft nécessite l’application de bureau et son onglet Motion design.");
        if(!require("../state").state.motionDesign)throw new Error("Utilise le chat Motion design pour piloter EffectCraft.");
        const read = ["host.info","engine.commands","ui.inspect","ui.elements","ui.menu.list","render.frame"].includes(args.method) || args.method==="engine.execute" && /^(project.summary|comp.info|layer.tree|prop.get|editor.state|command.list|command.describe|app.capabilities|jobs.list)$/.test(args.params?.command);
        if(!read && !await require("../ui-bridge").ui.confirm(`EffectCraft : ${args.params?.command || args.method} ?`))return {denied:true};
        const result=await backend.effectCraftControl(args);
        // Never flood a model prompt with rendered image bytes.
        if(result && typeof result==="object" && result.png) {
            const png=String(result.png);const bytes=Buffer.from(png,"base64");
            if(bytes.length>10*1024*1024)throw new Error("Rendu EffectCraft trop volumineux.");
            const workspace=require("../motion-workspace").motionWorkspace();
            const fs=require("node:fs/promises"),path=require("node:path"),rel=`.frst/screenshots/effectcraft-${Date.now()}.png`;
            await fs.mkdir(workspace,{recursive:true});
            const {target}=await require("./security").resolveInWorkspace(workspace,rel);
            await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);
            return {...result,png:undefined,path:rel,message:"Rendu sauvegardé. Utilise view_image pour le vérifier visuellement."};
        }
        const text=JSON.stringify(result);return text?.length>80000?{excerpt:text.slice(0,80000),truncated:true,message:"Filtre engine.commands ou interroge command.describe pour une commande précise."}:result;
    }
};
