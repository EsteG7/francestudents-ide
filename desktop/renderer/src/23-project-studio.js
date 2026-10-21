/* ---------- Cockpit du projet : commandes, qualité et outils locaux ---------- */
let projectStudioData = null;
let studioSelectedRun = null;
let studioRuns = [];
let projectStudioTab = "overview";
let studioSeq = 0;
function studioIcon(name) { return window.StudioVendor?.icon(name); }
function studioAction(label, icon, handler, primary=false) {
    const button=centerButton(label,handler,primary); const svg=studioIcon(icon);
    if(svg)button.prepend(svg); return button;
}
const projectNav=document.createElement("button");
projectNav.type="button";projectNav.className="activity";projectNav.dataset.view="project";projectNav.title="Cockpit du projet (Ctrl+Maj+D)";projectNav.setAttribute("aria-label","Cockpit du projet");
projectNav.append(studioIcon("LayoutDashboard"));
$("activity-bar").insertBefore(projectNav,$("activity-bar").firstElementChild);
projectNav.onclick=()=>showSideView("project");
$("sidebar").insertAdjacentHTML("afterbegin",`
<div id="project-studio" class="studio-page">
 <header class="studio-header"><div><span class="studio-eyebrow">FRANCESTUDENT CODE</span><h1>Ton espace de travail.</h1></div><div class="studio-actions"><button type="button" id="studio-refresh" aria-label="Actualiser le projet">Actualiser</button><button type="button" id="studio-close">Retour au code</button></div></header>
 <div class="studio-project-heading"><div><h2 id="studio-project-name">Aucun projet</h2><p id="studio-project-description"></p><p id="studio-project-path"></p></div><div id="studio-stack" class="studio-stack"></div></div>
 <nav class="studio-tabs" aria-label="Cockpit du projet" role="tablist"><button type="button" data-studio-tab="overview" role="tab" aria-selected="true">Vue d’ensemble</button><button type="button" data-studio-tab="tasks" role="tab" aria-selected="false">Exécutions</button><button type="button" data-studio-tab="quality" role="tab" aria-selected="false">Qualité</button><button type="button" data-studio-tab="tools" role="tab" aria-selected="false">Boîte à outils</button><button type="button" data-studio-tab="shortcuts" role="tab" aria-selected="false">Raccourcis</button></nav>
 <p id="studio-message" class="studio-message" role="status"></p>
 <section data-studio-page="overview"><div id="studio-stats" class="studio-stats"></div><div class="studio-section-heading"><h2>Une action, un résultat.</h2><span>Les outils du projet, à portée de main.</span></div><div id="studio-quick-actions" class="studio-quick-grid"></div><div class="studio-two-columns"><article class="studio-card"><h3>Documentation du projet</h3><div id="studio-docs" class="studio-link-list"></div></article><article class="studio-card"><h3>Repères dans le code</h3><p class="studio-muted">Marque une ligne dans l’éditeur avec Ctrl+F2 pour la retrouver ici.</p><div id="studio-bookmarks" class="studio-link-list"></div></article></div><div class="studio-section-heading"><h2>Dernières exécutions</h2><button type="button" id="studio-see-runs">Tout voir</button></div><div id="studio-recent-runs" class="studio-run-list"></div></section>
 <section data-studio-page="tasks" class="hidden"><div class="studio-section-heading"><div><h2>Les commandes de ton projet.</h2><p class="studio-muted">Détectées dans package.json, Cargo.toml et go.mod. Rien ne s’exécute sans un clic.</p></div><button type="button" id="studio-add-task" class="primary">+ Commande personnelle</button></div><div class="center-filters"><input type="search" id="studio-task-filter" placeholder="Filtrer : dev, test, build…" aria-label="Filtrer les commandes"><select id="studio-task-kind" aria-label="Type de commande"><option value="">Tous les types</option><option value="dev">Développement</option><option value="test">Tests</option><option value="build">Construction</option><option value="quality">Qualité</option><option value="custom">Personnelles</option></select></div><div id="studio-task-list" class="studio-task-grid"></div><div class="studio-section-heading"><h2>Exécutions de cette session</h2><button type="button" id="studio-clear-runs">Effacer les exécutions terminées</button></div><div id="studio-runs" class="studio-run-list"></div><article class="studio-card studio-log-card"><div class="studio-section-heading"><div><h3 id="studio-log-title">Sortie de la commande</h3><p id="studio-log-meta" class="studio-muted">Sélectionne une exécution pour lire sa sortie.</p></div><div class="studio-actions"><button type="button" id="studio-copy-log">Copier la sortie</button><label class="studio-muted"><input type="checkbox" id="studio-log-follow" checked> Suivre</label></div></div><pre id="studio-log" class="studio-log" tabindex="0"></pre></article></section>
 <section data-studio-page="quality" class="hidden"><div class="studio-section-heading"><h2>Un environnement prêt à travailler.</h2><button type="button" id="studio-diagnose">Vérifier l’environnement</button></div><div id="studio-environment" class="studio-stats"></div><div class="studio-section-heading"><h2>Problèmes signalés par l’éditeur</h2><span>Diagnostics JS/TS des fichiers ouverts</span></div><div id="studio-problems" class="studio-link-list"></div><div class="studio-section-heading"><h2>Améliorer le projet avec l’agent</h2></div><div id="studio-quality-actions" class="studio-quick-grid"></div></section>
 <section data-studio-page="tools" class="hidden"><div class="studio-section-heading"><h2>Petits outils, sans quitter ton projet.</h2><span>Traitement local · aucun envoi au modèle</span></div><article class="studio-card"><div class="center-filters"><select id="studio-transform" aria-label="Opération"><option value="json">Valider et formater JSON</option><option value="base64-encode">Texte → Base64</option><option value="base64-decode">Base64 → texte</option><option value="url-encode">Encoder une URL</option><option value="url-decode">Décoder une URL</option><option value="sha256">Empreinte SHA-256</option><option value="uuid">Générer un UUID</option><option value="sort">Trier les lignes</option><option value="unique">Supprimer les lignes identiques</option></select><button type="button" id="studio-transform-run" class="primary">Exécuter</button><button type="button" id="studio-transform-copy">Copier le résultat</button></div><div class="studio-two-columns"><label class="center-code-label">Entrée<textarea id="studio-tool-input" rows="12" maxlength="500000" spellcheck="false" placeholder="Colle ton texte ici…"></textarea></label><label class="center-code-label">Résultat<textarea id="studio-tool-output" rows="12" spellcheck="false" readonly></textarea></label></div><p id="studio-tool-status" class="studio-muted" role="status"></p></article><article class="studio-card"><h3>Raccourcis de création</h3><div id="studio-new-file-actions" class="studio-actions"></div></article></section>
 <section data-studio-page="shortcuts" class="hidden"><div class="studio-section-heading"><h2>Moins de clics, plus de fluidité.</h2></div><div id="studio-shortcuts" class="studio-shortcuts"></div><article class="studio-card"><h3>Construit avec l’open source</h3><p class="studio-muted">CodeMirror, Prettier, Marked, DOMPurify, Fuse.js, Lucide, xterm.js et node-pty participent aux outils de cette interface.</p><button type="button" id="studio-licenses">Lire les licences des composants intégrés</button></article></section>
</div>`);
document.body.insertAdjacentHTML("beforeend",`<dialog id="studio-task-dialog" class="center-dialog" aria-labelledby="studio-task-dialog-title"><form id="studio-task-form"><div class="center-dialog-head"><h2 id="studio-task-dialog-title">Ajouter une commande personnelle</h2><button type="button" id="studio-task-close" aria-label="Fermer">×</button></div><p class="studio-muted">La commande sera enregistrée dans ce projet, puis lancée uniquement quand tu cliqueras sur Exécuter. Sous Windows, elle s’exécute dans PowerShell avec les droits de ton compte.</p><label class="center-code-label">Nom<input id="studio-task-name" required maxlength="100" placeholder="Mes tests Python"></label><label class="center-code-label">Commande<textarea id="studio-task-command" required maxlength="8000" rows="4" placeholder="python -m pytest"></textarea></label><p id="studio-task-error" role="status" class="studio-message"></p><div class="center-dialog-actions"><button type="button" id="studio-task-cancel">Annuler</button><button type="submit" class="primary">Enregistrer</button></div></form></dialog><dialog id="studio-licenses-dialog" class="center-dialog" aria-labelledby="studio-licenses-title"><div class="center-dialog-head"><h2 id="studio-licenses-title">Licences open source</h2><button type="button" id="studio-licenses-close">Fermer</button></div><pre id="studio-licenses-content" class="studio-license-text"></pre></dialog>`);
function setStudioTab(tab) {
    projectStudioTab=tab;
    for(const panel of document.querySelectorAll("[data-studio-page]"))panel.classList.toggle("hidden",panel.dataset.studioPage!==tab);
    for(const button of document.querySelectorAll("[data-studio-tab]")){const selected=button.dataset.studioTab===tab;button.setAttribute("aria-selected",String(selected));button.tabIndex=selected?0:-1;}
    if(tab==="quality")renderStudioProblems();
    if(tab==="overview")renderProjectStudio();
}
for(const button of document.querySelectorAll("[data-studio-tab]")) {
    button.onclick=()=>setStudioTab(button.dataset.studioTab);
    button.onkeydown=event=>{
        if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
        event.preventDefault();const buttons=[...document.querySelectorAll("[data-studio-tab]")];
        const index=event.key==="Home"?0:event.key==="End"?buttons.length-1:(buttons.indexOf(button)+(event.key==="ArrowRight"?1:buttons.length-1))%buttons.length;
        buttons[index].click();buttons[index].focus();
    };
}
async function refreshProjectStudio() {
    const sequence=++studioSeq;
    $("studio-message").textContent="";
    try {
        const data=await api.projectStudio("overview");if(sequence!==studioSeq)return;
        projectStudioData=data;studioRuns=data.runs;renderProjectStudio();
    }catch(error){$("studio-message").textContent=error.message;}
}
function draftStudioPrompt(prompt) {input.value=prompt;input.dispatchEvent(new Event("input"));showSideView("explorer");input.focus();}
function studioStat(value,label,detail="") {const card=centerNode("article","studio-stat");card.append(centerNode("strong","",String(value)),centerNode("span","",label));if(detail)card.append(centerNode("small","",detail));return card;}
function studioQuick(title,description,icon,handler) {const button=studioAction("",icon,handler);button.classList.add("studio-quick");const text=centerNode("span","");text.append(centerNode("b","",title),centerNode("small","",description));button.append(text);return button;}
function renderProjectStudio() {
    const data=projectStudioData;if(!data)return;
    $("studio-project-name").textContent=data.name;
    $("studio-project-description").textContent=data.description||"Ton code, tes commandes et tes outils dans un seul espace.";
    $("studio-project-path").textContent=data.workspace||"Ouvre un dossier pour retrouver ses commandes et sa documentation.";
    $("studio-stack").replaceChildren(...data.stack.map(label=>centerNode("span","studio-pill",label)));
    $("studio-stats").replaceChildren(studioStat(data.tasks.length,"commandes disponibles",data.packageManager?`Gestionnaire : ${data.packageManager}`:"Scripts détectés dans le projet"),studioStat(studioRuns.filter(run=>run.status==="running").length,"en cours","Exécutions locales"),studioStat(studioRuns.filter(run=>run.status==="passed").length,"réussies","Pendant cette session"),studioStat(data.docs.length,"documents repérés","Guides à la racine du projet"));
    $("studio-quick-actions").replaceChildren(
        studioQuick("Lancer le projet","Choisir un script de développement","Play",()=>setStudioTab("tasks")),
        studioQuick("Comprendre le code","Préparer une exploration avec l’agent","Sparkles",()=>draftStudioPrompt("Explore ce projet et explique les points d’entrée, son architecture et les commandes utiles. Ne modifie aucun fichier.")),
        studioQuick("Terminal","Ouvrir un terminal dans ce dossier","Terminal",()=>{showSideView("explorer");selectPanel("terminal",true);}),
        studioQuick("Aperçu local","Voir un fichier HTML ou le Markdown actif","Eye",()=>{showSideView("explorer");openDocumentPreview();}),
        studioQuick("Vérifier l’environnement","Node.js, npm et Git","Activity",()=>{setStudioTab("quality");diagnoseStudio();}),
        studioQuick("Ouvrir un dossier","Changer de projet","FolderOpen",openProject));
    const docs=$("studio-docs");docs.replaceChildren();
    for(const file of data.docs)docs.append(studioAction(file,"BookOpen",async()=>{showSideView("explorer");await openFile(file);openDocumentPreview();}));
    if(!data.docs.length)docs.append(centerNode("p","studio-muted","Aucun README ou guide repéré à la racine du projet."));
    renderStudioBookmarks();renderStudioTasks();renderStudioRuns();
}
function renderStudioTasks() {
    if(!projectStudioData)return;
    const query=$("studio-task-filter").value.toLowerCase().trim(),kind=$("studio-task-kind").value;
    const list=$("studio-task-list");list.replaceChildren();
    for(const task of projectStudioData.tasks.filter(task=>(!kind||task.kind===kind)&&`${task.name} ${task.description}`.toLowerCase().includes(query))) {
        const card=centerNode("article","studio-card studio-task");card.dataset.taskId=task.id;
        card.append(centerNode("span","studio-pill",task.source),centerNode("h3","",task.name),centerNode("p","studio-muted",task.description),centerNode("code","studio-command",task.command));
        const running=studioRuns.find(run=>run.taskId===task.id&&run.status==="running");
        const button=studioAction(running?"Arrêter":"Exécuter",running?"Square":"Play",async()=>{
            if(running)await api.projectStudio("stop",{id:running.id});
            else {const run=await api.projectStudio("start",{id:task.id});studioSelectedRun=run.id;}
            studioRuns=await api.projectStudio("runs");renderStudioRuns();renderStudioTasks();
        },!running);
        card.append(button);list.append(card);
        if(task.id.startsWith("custom:"))card.append(centerButton("Retirer cette commande",async()=>{await api.projectStudio("remove",{id:task.id});await refreshProjectStudio();setStudioTab("tasks");}));
    }
    if(!list.children.length)list.append(centerNode("p","studio-empty",projectStudioData.tasks.length?"Aucune commande ne correspond à ces filtres.":"Aucun script détecté. Ajoute une commande personnelle pour lancer ton outil de test ou ton serveur."));
}
const studioRunLabels={running:"En cours",passed:"Réussie",failed:"Échec",stopped:"Arrêtée"};
function studioRunRow(run) {
    const row=centerNode("div","studio-run");row.dataset.status=run.status;
    const button=centerButton(run.name,()=>{studioSelectedRun=run.id;setStudioTab("tasks");renderStudioLog();});button.className="studio-run-name";
    row.append(centerNode("span","studio-status-dot"),button,centerNode("span","studio-run-status",studioRunLabels[run.status]),centerNode("span","studio-muted",`${Math.max(0,Math.floor(((run.endedAt||Date.now())-run.startedAt)/1000))} s`));
    if(run.status==="running")row.append(studioAction("Arrêter","Square",()=>api.projectStudio("stop",{id:run.id})));
    else row.append(studioAction("Relancer","Play",async()=>{const next=await api.projectStudio("start",{id:run.taskId});studioSelectedRun=next.id;studioRuns=await api.projectStudio("runs");renderStudioRuns();renderStudioTasks();}));
    return row;
}
function renderStudioRuns() {
    for(const [id,limit]of[["studio-runs",30],["studio-recent-runs",4]]) {
        const list=$(id);list.replaceChildren(...studioRuns.slice().reverse().slice(0,limit).map(studioRunRow));
        if(!list.children.length)list.append(centerNode("p","studio-empty","Aucune exécution pour l’instant."));
    }
    renderStudioLog();
    $("studio-task-badge").textContent=studioRuns.some(run=>run.status==="running")?`${studioRuns.filter(run=>run.status==="running").length} commande(s)` : "";
}
function renderStudioLog() {
    if(!studioSelectedRun&&studioRuns.length)studioSelectedRun=studioRuns.at(-1).id;
    const run=studioRuns.find(run=>run.id===studioSelectedRun);if(!run){$("studio-log").textContent="";return;}
    $("studio-log-title").textContent=run.name;
    $("studio-log-meta").textContent=`${run.command} · ${studioRunLabels[run.status]}${run.exitCode!=null?` · code ${run.exitCode}`:""}`;
    $("studio-log").textContent=(run.truncated?"[… début de la sortie tronqué …]\n":"")+run.output;
    if($("studio-log-follow").checked)$("studio-log").scrollTop=$("studio-log").scrollHeight;
}
async function diagnoseStudio() {
    $("studio-environment").replaceChildren(centerNode("p","studio-muted","Vérification des outils disponibles…"));
    try {const data=await api.environmentDiagnostics();$("studio-environment").replaceChildren(...data.map(item=>studioStat(item.available?"✓":"—",item.name,item.version)));}
    catch(error){$("studio-message").textContent=error.message;}
}
function renderStudioProblems() {
    const list=$("studio-problems");list.replaceChildren();let count=0;
    for(const [file,diagnostics]of lspDiagnosticsByPath)for(const diagnostic of diagnostics) {
        const line=(diagnostic.from?.line||0)+1;
        const button=centerButton(`${diagnostic.severity === "error"?"Erreur":"Diagnostic"} · ${file}:${line} — ${diagnostic.message}`,async()=>{showSideView("explorer");await openFile(file);goToLine(line);});
        list.append(button);count++;
    }
    if(!count)list.append(centerNode("p","studio-empty","Aucun problème signalé pour les fichiers JS/TS ouverts. Lance les tests ou le lint du projet pour une vérification plus large."));
}
function studioBookmarkKey(){return `frst-bookmarks:${ui.workspace||""}`;}
function readStudioBookmarks(){try{return JSON.parse(localStorage.getItem(studioBookmarkKey())||"[]").slice(0,200);}catch{return [];}}
function toggleStudioBookmark() {
    const tab=currentTab();if(!tab)return;
    const line=code.view.state.doc.lineAt(code.selectionStart).number;
    let items=readStudioBookmarks();const exists=items.some(item=>item.file===tab.path&&item.line===line);
    items=exists?items.filter(item=>item.file!==tab.path||item.line!==line):[...items,{file:tab.path,line,text:code.view.state.doc.line(line).text.trim().slice(0,100)}];
    try{localStorage.setItem(studioBookmarkKey(),JSON.stringify(items));}catch{/* stockage indisponible */}
    lspStatus(exists?"Repère retiré":"Ligne marquée dans le cockpit du projet");renderStudioBookmarks();
}
function renderStudioBookmarks() {
    const list=$("studio-bookmarks");if(!list)return;list.replaceChildren();
    for(const item of readStudioBookmarks())list.append(centerButton(`${item.file}:${item.line} ${item.text}`,async()=>{showSideView("explorer");await openFile(item.file);goToLine(item.line);}));
    if(!list.children.length)list.append(centerNode("p","studio-empty","Aucune ligne marquée."));
}
$("studio-refresh").onclick=refreshProjectStudio;$("studio-close").onclick=()=>showSideView("explorer");
$("studio-see-runs").onclick=()=>setStudioTab("tasks");$("studio-diagnose").onclick=diagnoseStudio;
$("studio-task-filter").oninput=renderStudioTasks;$("studio-task-kind").onchange=renderStudioTasks;
$("studio-copy-log").onclick=()=>api.copyText($("studio-log").textContent).catch(error=>{$("studio-message").textContent=error.message;});
$("studio-clear-runs").onclick=async()=>{await api.projectStudio("clear");studioRuns=await api.projectStudio("runs");studioSelectedRun=null;renderStudioRuns();};
$("studio-add-task").onclick=()=>{$("studio-task-form").reset();$("studio-task-error").textContent="";$("studio-task-dialog").showModal();};
for(const id of ["studio-task-close","studio-task-cancel"])$(id).onclick=()=>$("studio-task-dialog").close();
$("studio-task-form").onsubmit=async event=>{
    event.preventDefault();
    try{await api.projectStudio("add",{name:$("studio-task-name").value,command:$("studio-task-command").value});$("studio-task-dialog").close();await refreshProjectStudio();setStudioTab("tasks");}
    catch(error){$("studio-task-error").textContent=error.message;}
};
$("studio-licenses").onclick=async()=>{try{$("studio-licenses-content").textContent=await api.openSourceLicenses();$("studio-licenses-dialog").showModal();}catch(error){$("studio-message").textContent=error.message;}};
$("studio-licenses-close").onclick=()=>$("studio-licenses-dialog").close();
$("studio-quality-actions").append(studioQuick("Revue des changements","Préparer une demande de revue sans modification","GitCompare",()=>draftStudioPrompt("Relis les changements Git actuels. Cherche les régressions et les erreurs concrètes, avec les fichiers et les cas déclencheurs. Ne modifie rien.")),studioQuick("Renforcer les tests","Préparer une demande de tests utiles","Check",()=>draftStudioPrompt("Inspecte les tests de ce projet, identifie les comportements critiques mal couverts et ajoute des tests pertinents. Exécute les tests concernés.")),studioQuick("Examiner la sécurité","Préparer une revue ciblée des entrées et accès","Activity",()=>draftStudioPrompt("Examine les entrées, contrôles d’accès et manipulations de fichiers de ce projet. Identifie les problèmes vérifiables et propose des corrections ciblées. Commence en lecture seule.")));
$("studio-new-file-actions").append(studioAction("Nouveau fichier","FileCode",()=>newEntry("file",".")),studioAction("Nouveau dossier","FolderOpen",()=>newEntry("directory",".")),studioAction("Créer un skill","Sparkles",()=>{showSideView("extensions");setCenterTab("installed");openSkillEditor({kind:"new"});}));
const studioShortcuts=[["Ctrl+P","Rechercher un fichier"],["Ctrl+Maj+P","Palette des commandes"],["Ctrl+Maj+D","Cockpit du projet"],["Ctrl+S","Enregistrer"],["Ctrl+Maj+S","Enregistrer tous les onglets"],["Maj+Alt+F","Formater avec Prettier"],["Ctrl+F2","Ajouter ou retirer un repère"],["Ctrl+Maj+V","Aperçu du document"],["F12","Aller à la définition JS/TS"],["Maj+F12","Rechercher les références"],["F2","Renommer un symbole"],["Ctrl+K","Modifier une sélection avec l’IA"],["Ctrl+L","Écrire à l’agent"],["Ctrl+J","Afficher ou masquer le panneau"],["Ctrl+Maj+F","Rechercher dans le projet"],["Ctrl+O","Ouvrir un dossier"]];
for(const [keys,label]of studioShortcuts){const row=centerNode("div","studio-shortcut");row.append(centerNode("span","",label),centerNode("kbd","",keys));$("studio-shortcuts").append(row);}
const taskBadge=centerNode("button","studio-status-button","");taskBadge.id="studio-task-badge";taskBadge.type="button";taskBadge.onclick=()=>{showSideView("project");setStudioTab("tasks");};$("statusbar").append(taskBadge);
let studioEventFrame=0;
api.onEvent((channel,data)=>{
    if(channel==="projectTask"&&data?.workspace===ui.workspace){const index=studioRuns.findIndex(run=>run.id===data.id);if(index<0)studioRuns.push(data);else studioRuns[index]=data;if(!studioEventFrame)studioEventFrame=requestAnimationFrame(()=>{studioEventFrame=0;renderStudioRuns();renderStudioTasks();});}
    if(channel==="lspDiagnostics"&&projectStudioTab==="quality")renderStudioProblems();
});
$("studio-transform-run").onclick=async()=>{
    const text=$("studio-tool-input").value;let result="";
    try {
        switch($("studio-transform").value){
            case "json":result=JSON.stringify(JSON.parse(text),null,2);break;
            case "base64-encode": {const bytes=new TextEncoder().encode(text);let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));result=btoa(binary);break;}
            case "base64-decode":result=new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(atob(text.trim()),character=>character.charCodeAt(0)));break;
            case "url-encode":result=encodeURIComponent(text);break;
            case "url-decode":result=decodeURIComponent(text);break;
            case "uuid":result=crypto.randomUUID();break;
            case "sha256": {const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));result=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");break;}
            case "sort":result=text.split(/\r?\n/).sort((a,b)=>a.localeCompare(b,"fr")).join("\n");break;
            case "unique":result=[...new Set(text.split(/\r?\n/))].join("\n");break;
        }
        $("studio-tool-output").value=result;$("studio-tool-status").textContent=`${result.length.toLocaleString("fr-FR")} caractères · traitement local terminé.`;
    }catch(error){$("studio-tool-status").textContent=`Conversion impossible : ${error.message}`;}
};
$("studio-transform-copy").onclick=()=>api.copyText($("studio-tool-output").value).catch(error=>{$("studio-tool-status").textContent=error.message;});
