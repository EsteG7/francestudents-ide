/* The official EffectCraft editor, embedded next to its specialized agent chat. */
const motionNav=document.createElement("button");
motionNav.type="button";motionNav.className="activity";motionNav.dataset.view="motion";motionNav.id="btn-motion";
motionNav.title="Motion design · EffectCraft (Bêta)";motionNav.setAttribute("aria-label","Motion design · EffectCraft, Bêta");
motionNav.innerHTML='<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>';
$("activity-bar").insertBefore(motionNav,document.querySelector("#activity-bar .spacer"));
const motionView=document.createElement("section");motionView.id="motion-view";motionView.className="motion-page";motionView.setAttribute("aria-label","EffectCraft et agent motion design");
motionView.innerHTML=`<header class="motion-header"><div class="motion-brand"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17 8-13 8 13H4Zm4-1 4-7 4 7"/></svg><h1>EffectCraft</h1><span class="motion-pill">Bêta</span></div><div class="motion-actions"><button type="button" id="motion-local-save" title="Enregistrer dans le stockage local d’EffectCraft">Enregistrer</button><button type="button" id="motion-close">Retour au code</button></div></header>
<div class="motion-commandbar"><div role="group" aria-label="Contrôles de composition"><button type="button" id="motion-undo" title="Annuler la dernière modification">↶ Annuler</button><button type="button" id="motion-play">▶ Lecture</button><button type="button" id="motion-stop">■ Arrêter</button></div><span id="motion-engine-status" role="status">EffectCraft attend ton ouverture.</span><button type="button" id="motion-engine-reload" title="Recharger EffectCraft">Recharger</button></div>
<div class="motion-stage" aria-label="Chargement d’EffectCraft"><div><h2>Chargement d’EffectCraft…</h2><p>Le véritable éditeur se prépare. Le chat motion design reste à droite.</p><button type="button" id="motion-retry">Réessayer</button></div></div>
<div id="motion-engine" class="motion-engine" hidden><div id="motion-engine-frame" class="motion-engine-frame"></div></div>
<div id="motion-consent" class="motion-consent" role="alertdialog" aria-modal="true" aria-labelledby="motion-consent-title" tabindex="-1"><div class="motion-consent-card"><span class="motion-pill">Bêta</span><h2 id="motion-consent-title">Ton espace motion design</h2><p>EffectCraft à gauche, ton agent spécialisé à droite. Le chat peut modifier les compositions, les calques, les keyframes et les effets. Cette intégration reste expérimentale : conserve une copie des projets importants.</p><div class="motion-consent-actions"><button type="button" id="motion-consent-back">Retour au code</button><button type="button" id="motion-consent-ok" class="primary">J’ai compris, continuer</button></div></div></div>`;
$("app").append(motionView);
const motionEngine={frame:null,loading:false,accepted:false};
function isMotionOpen(){return $("app").classList.contains("view-motion");}
function setMotionEngineStatus(text){$("motion-engine-status").textContent=text;$("motion-engine-status").title=text;}
async function openMotionDesign(){
    if(!await selectMotionChat("motion"))return;
    setActivity(null);$("app").classList.add("view-motion");motionNav.classList.add("active");
    $("motion-consent").classList.toggle("hidden-consent",motionEngine.accepted);
    if(motionEngine.accepted)loadMotionEngine();else $("motion-consent-ok").focus({preventScroll:true});
    syncMotionChat();
}
async function closeMotionDesign(){
    if(!isMotionOpen() || !await selectMotionChat("code"))return;
    $("app").classList.remove("view-motion");motionNav.classList.remove("active");
    setActivity($("app").classList.contains("no-sidebar")?null:ui.sideView);syncMotionChat();
}
motionNav.onclick=()=>isMotionOpen()?closeMotionDesign():openMotionDesign();
$("motion-close").onclick=closeMotionDesign;$("motion-consent-back").onclick=closeMotionDesign;
$("motion-consent-ok").onclick=()=>{motionEngine.accepted=true;$("motion-consent").classList.add("hidden-consent");loadMotionEngine();input.focus({preventScroll:true});};
for(const button of document.querySelectorAll("#activity-bar .activity"))if(button!==motionNav)button.addEventListener("click",event=>{
    if(isMotionOpen() && ui.status.busy){event.preventDefault();event.stopImmediatePropagation();studioFeedback("Attends la fin de la tâche ou utilise Stop avant de changer de chat.");return;}
    closeMotionDesign();
},true);
function showMotionEngineFallback(message){$("motion-engine").hidden=true;motionView.querySelector(".motion-stage").hidden=false;motionView.querySelector(".motion-stage h2").textContent="EffectCraft indisponible";motionView.querySelector(".motion-stage p").textContent=message;setMotionEngineStatus(message);}
async function loadMotionEngine(force=false){
    if(motionEngine.loading || motionEngine.frame && !force)return;
    if(force && ui.status.busy){studioFeedback("Arrête d’abord la tâche pour recharger EffectCraft.");return;}
    motionEngine.loading=true;
    try{
        if(motionEngine.frame){motionEngine.frame.remove();motionEngine.frame=null;}
        const info=await api.effectCraft("start"),url=new URL(info.url);
        if(url.protocol!=="http:" || url.hostname!=="127.0.0.1")throw new Error("Adresse EffectCraft inattendue.");
        url.search="?nosw&frameworkers=0&webgl";
        const frame=document.createElement("iframe");frame.className="motion-engine-iframe";frame.title="EffectCraft · Motion design";
        frame.setAttribute("sandbox","allow-scripts allow-same-origin allow-downloads");frame.setAttribute("allow","fullscreen");frame.referrerPolicy="no-referrer";
        frame.addEventListener("load",async()=>{
            for(let attempt=0;attempt<60 && motionEngine.frame===frame;attempt++){
                try{await api.effectCraftControl({method:"host.info",params:{}});await api.effectCraftControl({method:"ui.set",params:{theme:"Dark"}});await applyMotionInterface(motionEngine.advanced,true);setMotionEngineStatus("Prêt · décris ton animation dans le chat");return;}
                catch(error){if(attempt===59){setMotionEngineStatus(error.message);return;}await new Promise(resolve=>setTimeout(resolve,200));}
            }
        });
        frame.src=url.toString();$("motion-engine-frame").replaceChildren(frame);motionEngine.frame=frame;
        $("motion-engine").hidden=false;motionView.querySelector(".motion-stage").hidden=true;setMotionEngineStatus(`EffectCraft ${info.version} · chargement…`);
    }catch(error){showMotionEngineFallback(error.message);}finally{motionEngine.loading=false;}
}
$("motion-engine-reload").onclick=()=>loadMotionEngine(true);$("motion-retry").onclick=()=>loadMotionEngine(true);
async function motionControl(request){
    if(ui.status.busy){studioFeedback("L’agent travaille sur la composition ; attends ou utilise Stop.");return;}
    try{await api.effectCraftControl(request);setMotionEngineStatus("EffectCraft · action effectuée");}catch(error){studioFeedback(error.message);}
}
$("motion-play").onclick=()=>motionControl({method:"ui.playback",params:{action:"play"}});
$("motion-stop").onclick=()=>motionControl({method:"ui.playback",params:{action:"stop"}});
$("motion-undo").onclick=()=>motionControl({method:"engine.execute",params:{command:"edit.undo",params:{}}});
$("motion-local-save").onclick=()=>motionControl({method:"host.save",params:{path:"FranceStudent.ecproj"}});
const motionChat={placeholder:null,badge:null};
function syncMotionChat(){
    const bar=document.querySelector("#agent .agent-context-bar");if(!bar)return;
    if(!motionChat.badge){const badge=document.createElement("span");badge.id="agent-motion-badge";badge.className="agent-motion-badge";badge.textContent="Motion design";bar.insertBefore(badge,$("agent-access"));motionChat.badge=badge;}
    const open=isMotionOpen();motionChat.badge.hidden=!open;
    if(open){if(motionChat.placeholder===null)motionChat.placeholder=input.placeholder;input.placeholder="Décris ton animation… l’agent agit dans EffectCraft.";}
    else if(motionChat.placeholder!==null){input.placeholder=motionChat.placeholder;motionChat.placeholder=null;}
}
new MutationObserver(syncMotionChat).observe($("app"),{attributes:true,attributeFilter:["class"]});syncMotionChat();
