/* Fichiers non textuels : aperçu sans écriture et application associée. */
const studioAssetView=centerNode("section","studio-asset-view hidden");studioAssetView.id="studio-asset-view";$("editor-area").append(studioAssetView);
function showStudioAsset(tab) {
    const asset=tab?.kind==="asset"?tab.asset:null;
    studioAssetView.classList.toggle("hidden",!asset);studioAssetView.replaceChildren();
    if(!asset)return;
    $("editor").classList.add("hidden");$("editor-welcome").classList.add("hidden");
    const header=centerNode("div","studio-asset-header");header.append(centerNode("span","studio-pill","Aperçu · lecture seule"),centerNode("h2","",asset.name),centerNode("p","studio-muted",`${formatBytes(asset.size)} · ${asset.mime} · ${new Date(asset.modifiedAt).toLocaleString("fr-FR")}`));
    header.append(studioAction("Ouvrir dans l’application associée","ExternalLink",async()=>{const error=await api.openFileInApp(tab.path);if(error)lspStatus(error);}));studioAssetView.append(header);
    if(asset.dataUrl&&["image","audio","video"].includes(asset.kind)) {
        const media=document.createElement(asset.kind==="image"?"img":asset.kind);media.src=asset.dataUrl;if(asset.kind==="image")media.alt=asset.name;else media.controls=true;
        media.className="studio-asset-media";studioAssetView.append(media);
    }else {
        studioAssetView.append(centerNode("p","studio-muted",asset.kind==="text-preview"?"Extrait du fichier volumineux, non modifiable ici. Ouvre-le dans l’application associée pour accéder à son contenu complet.":"Ce format n’est pas édité comme du texte pour préserver ses données. Voici un aperçu des octets ; utilise son application associée pour le modifier."));
        studioAssetView.append(centerNode("pre","studio-asset-bytes",asset.preview));
        if(asset.truncated)studioAssetView.append(centerNode("p","studio-muted","Aperçu limité aux 16 premiers Ko."));
    }
}

/* Recherches et captures restent en arrière-plan, indépendamment de la saisie. */
const researchTab=centerNode("button","","Internet");researchTab.type="button";researchTab.dataset.studioTab="research";researchTab.setAttribute("role","tab");researchTab.setAttribute("aria-selected","false");researchTab.tabIndex=-1;$("project-studio").querySelector(".studio-tabs").append(researchTab);researchTab.onclick=()=>{setStudioTab("research");refreshStudioResearch();};
researchTab.onkeydown=event=>{if(!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();const buttons=[...document.querySelectorAll("[data-studio-tab]")];buttons[(buttons.indexOf(researchTab)+(event.key==="ArrowRight"?1:buttons.length-1))%buttons.length].click();};
const researchPage=centerNode("section","hidden");researchPage.dataset.studioPage="research";
researchPage.innerHTML=`<div class="studio-section-heading"><div><h2>Rechercher sans interrompre le travail.</h2><p class="studio-muted">Les résultats restent disponibles pendant que tu écris à l’agent ou modifies tes fichiers. Les extraits ne remplacent pas la consultation des sources.</p></div></div><form id="studio-research-form" class="center-filters"><input type="search" id="studio-research-query" required maxlength="1000" placeholder="Chercher une documentation ou une réponse sur le web…" aria-label="Recherche Internet"><button type="submit" class="primary">Rechercher en arrière-plan</button></form><div id="studio-research-jobs" class="studio-research-jobs"></div><article class="studio-card"><h3>Capturer une page web</h3><p class="studio-muted">Ouvre Chrome ou Edge sans fenêtre visible, relève le texte et les erreurs de console et enregistre un PNG dans .frst/screenshots. Une capture est distincte de son analyse par le modèle.</p><div class="center-filters"><input type="url" id="studio-capture-url" placeholder="http://localhost:5173" aria-label="Page à capturer"><button type="button" id="studio-capture-button">Prendre une capture</button></div><p id="studio-capture-status" class="studio-muted" role="status"></p><div id="studio-capture-results" class="studio-link-list"></div></article>`;
$("project-studio").append(researchPage);
async function refreshStudioResearch(){renderStudioResearch(await api.webResearch("list"));}
function renderStudioResearch(jobs) {
    const list=$("studio-research-jobs");list.replaceChildren();
    for(const job of jobs.slice().reverse()) {
        const card=centerNode("article","studio-card");card.append(centerNode("span","studio-pill",({running:"En cours",done:"Terminée",failed:"Échec",stopped:"Arrêtée",denied:"Désactivée"})[job.status]||job.status),centerNode("h3","",job.query));
        if(job.status==="running")card.append(centerButton("Arrêter la recherche",async()=>{await api.webResearch("cancel",{id:job.id});await refreshStudioResearch();}));
        if(job.error)card.append(centerNode("p","studio-muted",job.error));
        for(const source of job.result?.results||[]) {
            const row=centerNode("div","studio-research-source");row.append(centerButton(source.title||source.url,()=>api.openExternal(source.url)),centerNode("p","studio-muted",source.snippet));card.append(row);
        }
        if(job.status==="done"&&!job.result?.results?.length)card.append(centerNode("p","studio-muted",job.result?.message||"Aucun résultat exploitable."));
        list.append(card);
    }
    if(!jobs.length)list.append(centerNode("p","studio-empty","Aucune recherche pour l’instant."));
}
$("studio-research-form").onsubmit=async event=>{event.preventDefault();try{const result=await api.webResearch("start",{query:$("studio-research-query").value});if(result.denied)$("studio-message").textContent=result.message;await refreshStudioResearch();}catch(error){$("studio-message").textContent=error.message;}};
$("studio-capture-button").onclick=async()=>{
    $("studio-capture-button").disabled=true;$("studio-capture-status").textContent="Capture en cours. Si un accord est nécessaire, la demande apparaît dans le panneau Agent.";
    try {
        const result=await api.captureWebPage({url:$("studio-capture-url").value,full_page:false});
        $("studio-capture-status").textContent=result.message;
        if(result.screenshot)$("studio-capture-results").prepend(centerButton(`${result.title||"Capture"} · ${result.screenshot}`,async()=>{showSideView("explorer");await openFile(result.screenshot);}));
    }catch(error){$("studio-capture-status").textContent=error.message;}
    finally{$("studio-capture-button").disabled=false;}
};
api.onEvent(channel=>{if(channel==="webResearch")refreshStudioResearch().catch(()=>{});});

/* Paramètres de capture et mises à jour de la version installée. */
const captureSettings=document.createElement("section");captureSettings.className="settings-card";
captureSettings.innerHTML=`<h3>Captures et navigateur de l’agent</h3><p class="settings-help">Autorise l’outil browse à ouvrir une page en arrière-plan et à sauvegarder son rendu. L’outil view_image peut ensuite proposer de transmettre une image au modèle pour l’examiner. La prise en charge de la vision dépend du modèle et du fournisseur.</p><label class="center-code-label">Captures de pages<select id="studio-browser-permission"><option value="ask">Demander l’accord</option><option value="allow">Autoriser les captures de pages</option><option value="deny">Désactiver les captures</option></select></label><p id="studio-browser-permission-status" class="settings-help" role="status"></p>`;
$("settings-view").insertBefore(captureSettings,$("settings-message"));
api.browserPermission().then(value=>{$("studio-browser-permission").value=value;}).catch(()=>{});
$("studio-browser-permission").onchange=async()=>{try{await api.browserPermission("save",$("studio-browser-permission").value);$("studio-browser-permission-status").textContent="Permission de capture enregistrée.";}catch(error){$("studio-browser-permission-status").textContent=error.message;}};
const updateSettings=document.createElement("section");updateSettings.className="settings-card";
updateSettings.innerHTML=`<h3>Application et mises à jour</h3><p id="studio-app-version" class="settings-help"></p><label class="setting-toggle"><span><b>Mises à jour automatiques</b><small>Vérifier et télécharger les versions publiées. Dans la version installée, une mise à jour téléchargée est appliquée à la fermeture. Les projets et réglages restent dans leurs dossiers.</small></span><input type="checkbox" role="switch" id="studio-automatic-updates"></label><p id="studio-update-message" class="settings-help" role="status"></p><progress id="studio-update-progress" max="100" value="0" class="hidden"></progress><div class="studio-actions"><button type="button" id="studio-update-check">Vérifier maintenant</button><button type="button" id="studio-update-download" class="hidden">Télécharger la mise à jour</button><button type="button" id="studio-update-install" class="primary hidden">Enregistrer et redémarrer</button></div><p class="settings-help">Source prévue : versions GitHub de extraopaa/francestudents-ide. Les nouvelles versions doivent être publiées avec leur installateur et leurs métadonnées de mise à jour. Aucune version n’est publiée automatiquement par cette interface.</p>`;
$("settings-view").insertBefore(updateSettings,$("settings-message"));
function renderStudioUpdates(data){$("studio-app-version").textContent=`Version de l’application : ${data.version}`;$("studio-automatic-updates").checked=data.automatic;$("studio-update-message").textContent=data.message;$("studio-update-progress").value=data.progress;$("studio-update-progress").classList.toggle("hidden",data.status!=="downloading");$("studio-update-check").disabled=["unavailable","checking","downloading"].includes(data.status);$("studio-update-download").classList.toggle("hidden",(data.status!=="available"||data.canInstall===false));$("studio-update-install").classList.toggle("hidden",data.status!=="downloaded");}
api.updates().then(renderStudioUpdates).catch(()=>{});
$("studio-automatic-updates").onchange=()=>api.updates("automatic",{enabled:$("studio-automatic-updates").checked}).then(renderStudioUpdates).catch(error=>{$("studio-update-message").textContent=error.message;});
for(const action of ["check","download","install"])$("studio-update-"+action).onclick=async()=>{try{if(action==="install"){await saveAllStudioFiles();if(ui.tabs.some(tab=>tab.dirty))throw new Error("Certains fichiers n’ont pas pu être enregistrés. Enregistre-les avant de redémarrer.");}renderStudioUpdates(await api.updates(action));}catch(error){$("studio-update-message").textContent=error.message;}};
api.onEvent((channel,data)=>{if(channel==="appUpdate")renderStudioUpdates(data);});

/* Actions explicites pour gérer le contexte de l’agent. */
const contextActions=centerNode("section","starter-context");
contextActions.setAttribute("aria-label","Gérer la conversation");
contextActions.append(centerNode("h3","","Conversation"));
const contextButtons=centerNode("div","starter-context-actions");
for(const [label,description,icon,command] of [
    ["Voir le contexte","Consulter le résumé du projet","BookOpen","/resume"],
    ["Compacter","Alléger la conversation","Command","/compact"]
]){
    const button=studioAction("",icon,()=>{input.value=command;autosizeInput();input.focus();});
    button.setAttribute("aria-label",label);
    button.title=description;
    const text=centerNode("span","starter-context-text");
    text.append(centerNode("b","",label),centerNode("small","",description));
    button.append(text);contextButtons.append(button);
}
contextActions.append(contextButtons);
$("agent-starter")?.append(contextActions);
for(const [index,button] of [...document.querySelectorAll(".starter-prompts button")].entries()){
    const slot=button.querySelector("span"),icon=studioIcon(["Search","GitCompareArrows","Check"][index]);
    if(slot&&icon)slot.replaceChildren(icon);
}

/* A bounded startup check; downloads continue without blocking the editor. */
async function runStartupUpdateCheck() {
    const overlay=$("startup-loading"),message=$("startup-message"),appRoot=$("app");
    const primary=$("startup-update-now"),progress=$("startup-update-progress"),later=$("startup-continue"),openButton=$("startup-update-open");
    let finished=false,deadline=null,finishTimer=null,current=null,off=null;
    appRoot.inert=true;
    const close=()=>{if(finished)return;finished=true;clearTimeout(deadline);clearTimeout(finishTimer);overlay.hidden=true;appRoot.inert=false;if(overlay.contains(document.activeElement))input.focus();};
    const offer=data=>{
        current=data;
        const available=["available","downloading","downloaded"].includes(data.status);
        openButton.classList.toggle("hidden",!available);
        if(finished)return;
        overlay.querySelector(".startup-track").classList.toggle("hidden",data.status!=="checking");
        if(available){
            clearTimeout(deadline);clearTimeout(finishTimer);
            $("startup-heading").textContent=data.status==="downloaded"?"La mise à jour est prête.":`Nouvelle version ${data.availableVersion||"disponible"}`;
            later.textContent="Plus tard";
            primary.classList.remove("hidden");
            primary.textContent=data.canInstall===false?"Télécharger l’installateur":data.status==="downloaded"?"Redémarrer et installer":data.status==="downloading"?"Téléchargement en cours…":"Mettre à jour maintenant";
            primary.disabled=data.status==="downloading";
            progress.classList.toggle("hidden",data.status!=="downloading");progress.value=data.progress||0;
            message.textContent=data.status==="downloading"?`Téléchargement : ${Math.round(data.progress||0)} %`:
                data.status==="downloaded"?"Enregistre ton travail pour redémarrer et installer la nouvelle version.":data.canInstall===false?"Cette version portable ne s’installe pas automatiquement. Télécharge l’installateur Windows pour passer à la nouvelle version.":"La nouvelle version est disponible. Tu peux l’installer maintenant ou continuer dans l’IDE.";
        }else if(data.status==="error"){
            message.textContent=data.message;progress.classList.add("hidden");primary.classList.remove("hidden");primary.disabled=false;primary.textContent="Réessayer";later.textContent="Ouvrir l’IDE";
        }else if(["current","unavailable"].includes(data.status)){
            message.textContent=data.message;primary.classList.add("hidden");progress.classList.add("hidden");
            clearTimeout(finishTimer);finishTimer=setTimeout(close,650);
        }
    };
    later.onclick=close;later.focus();
    openButton.onclick=()=>{finished=false;overlay.hidden=false;appRoot.inert=true;offer(current);primary.focus();};
    off=api.onEvent((channel,data)=>{if(channel==="appUpdate")offer(data);});
    window.addEventListener("unload",()=>off?.(),{once:true});
    primary.onclick=async()=>{
        primary.disabled=true;
        try{
            if(current?.canInstall===false){await api.openExternal("https://github.com/extraopaa/francestudents-ide/releases/latest");close();return;}
            if(current?.status==="downloaded"){
                await saveAllStudioFiles();
                if(ui.tabs.some(tab=>tab.dirty))throw new Error("Enregistre tes fichiers avant de redémarrer.");
                await api.updates("install");return;
            }
            if(current?.status==="error"){offer(await api.updates("check",{startup:true}));return;}
            offer(await api.updates("download"));
        }catch(error){message.textContent=error.message;}
        finally{primary.disabled=current?.status==="downloading";}
    };
    const start=Date.now();
    try {
        const result=await Promise.race([
            api.updates("check",{startup:true}),
            new Promise(resolve=>{deadline=setTimeout(()=>resolve({status:"timeout",message:"La vérification continue en arrière-plan. Ouverture de l’IDE…"}),8000);})
        ]);
        if(finished)return;
        if(["available","downloading","downloaded"].includes(current?.status))return;
        if(["available","downloading","downloaded"].includes(result.status)){offer(result);return;}
        current=result;
        message.textContent=result.status==="unavailable"?"Mode développement : ouverture de l’IDE…":result.message;
    } catch {
        if(!finished)message.textContent="Vérification indisponible. Ouverture de l’IDE…";
    } finally {
        clearTimeout(deadline);
        if(!finished&&!["available","downloading","downloaded"].includes(current?.status))finishTimer=setTimeout(close,Math.max(650,1100-(Date.now()-start)));
    }
}
runStartupUpdateCheck().catch(()=>{$("startup-loading").hidden=true;$("app").inert=false;});
