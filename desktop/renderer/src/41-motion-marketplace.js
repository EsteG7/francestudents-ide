/* Curated motion workflows; ordinary marketplace searches remain explicit. */
let motionCollection="effectcraft";
function libraryInstallKey(item,scope){return `${item.application==="effectcraft" && scope==="projet"?"motion":scope}:${item.id}`;}
const motionMarket=centerNode("section","motion-marketplace");motionMarket.id="motion-marketplace";
const motionMarketHead=centerNode("div","motion-marketplace-head");
motionMarketHead.innerHTML='<div><span class="ext-tag">Sélection motion design</span><h2>Les bons outils pour tes animations.</h2><p>EffectCraft pour l’éditeur intégré. Remotion pour les projets vidéo en React.</p></div><label>Installer pour<select id="motion-skill-scope" aria-label="Portée des skills motion"><option value="utilisateur">Tous mes projets</option><option value="projet">Ce projet seulement</option></select></label>';
const motionMarketFilters=centerNode("div","motion-marketplace-filters");motionMarketFilters.setAttribute("role","group");motionMarketFilters.setAttribute("aria-label","Moteur de motion design");
for(const [key,label] of [["effectcraft","EffectCraft · intégré"],["code","Remotion · chat code"]]){const button=centerButton(label,()=>{motionCollection=key;renderMotionMarketplace();});button.dataset.motionCollection=key;motionMarketFilters.append(button);}
const motionMarketNote=centerNode("p","settings-help");motionMarketNote.id="motion-marketplace-note";
const motionMarketList=centerNode("div","center-grid");motionMarketList.id="motion-marketplace-list";
motionMarket.append(motionMarketHead,motionMarketFilters,motionMarketNote,motionMarketList);
document.querySelector('[data-center-panel="motion"]').append(motionMarket);
$("library-category").append(centerNode("option","","Motion design"));
$("motion-skill-scope").onchange=renderMotionMarketplace;
function renderMotionMarketplace(){
    if(!centerData)return;
    const scope=$("motion-skill-scope").value;
    $("motion-skill-scope").querySelector('[value="projet"]').disabled=motionCollection!=="effectcraft" && !centerData.workspace;
    $("motion-skill-scope").querySelector('[value="projet"]').textContent=motionCollection==="effectcraft"?"Projet EffectCraft":"Ce projet code";
    for(const button of motionMarketFilters.children)button.setAttribute("aria-pressed",String(button.dataset.motionCollection===motionCollection));
    motionMarketNote.replaceChildren(document.createTextNode(motionCollection==="effectcraft"?"8 skills FranceStudent prêts à installer, sans téléchargement ni clé API. L’agent les utilise dans le chat Motion design ; les consulter ne consomme pas de quota.":"Sélection des 5 skills les plus installés de la collection officielle remotion-dev/skills sur Skills.sh, vérifiée le 23 octobre 2026. Ils nécessitent un projet Remotion dans le chat code ; ils ne pilotent pas EffectCraft. "));
    if(motionCollection==="code")motionMarketNote.append(centerButton("Voir la source du classement",()=>api.openExternal("https://www.skills.sh/remotion-dev/skills")));
    motionMarketList.replaceChildren();
    const entries=motionCollection==="effectcraft"?centerData.library.filter(item=>item.application==="effectcraft"):(centerData.motionCommunity || []);
    for(const item of entries){
        const card=centerNode("article","center-card");card.dataset.motionSkillId=item.id;
        card.append(centerNode("span","ext-tag",motionCollection==="effectcraft"?"EffectCraft · natif":`Remotion · ≈ ${Math.round(item.installs/1000)} k installations`),centerNode("h3","",item.title),centerNode("p","",item.description));
        const actions=centerNode("div","center-card-actions");
        const installed=centerData.skills.find(skill=>skill.key===libraryInstallKey(item,scope));
        if(motionCollection==="effectcraft"){
            actions.append(centerButton("Voir les instructions",()=>{openSkillEditor({kind:"library",item});$("skill-editor-scope").value=scope;}));
            const install=centerButton(installed?"Installé":"Installer",()=>changeExtension("install",{id:item.id,scope},`${item.title} installé pour le chat Motion design.`),true);install.disabled=!!installed;actions.append(install);
        }else{
            actions.append(centerButton("Voir le dépôt",()=>api.openExternal(item.githubUrl)));
            const install=centerButton(installed?"Installé":"Lire et installer",async()=>{await downloadSkillPreview({...item,curatedId:item.id});$("skill-editor-scope").value=scope;},true);install.disabled=!!installed;actions.append(install);
        }
        if(installed)actions.append(centerButton("Désinstaller",()=>uninstallCenterSkill(installed)));
        card.append(actions);motionMarketList.append(card);
    }
}
const motionSkillsButton=centerButton("Skills",async()=>{
    await closeMotionDesign();if(isMotionOpen())return;
    showSideView("extensions");setCenterTab("motion");motionCollection="effectcraft";await loadExtensionCenter();motionMarket.scrollIntoView({block:"start"});
});motionSkillsButton.id="motion-skills";motionSkillsButton.title="Choisir des skills pour ton animation";document.querySelector(".motion-actions").prepend(motionSkillsButton);
