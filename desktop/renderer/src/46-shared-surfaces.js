/* Shared identity for secondary flows. Keep existing controls and their handlers. */
function studioSurfaceHeader(dialog,{title,subtitle,icon="spark",badge,close}){
    dialog.classList.add("fs-dialog");
    const header=centerNode("header","fs-dialog-header"),mark=centerNode("span","fs-dialog-icon");mark.innerHTML=icon==="eco"?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4c-6-1-13 1-13 7a6 6 0 0 0 6 6c6 0 8-7 7-13ZM4 21 15 10"/></svg>':apiNoticeIcon(icon);
    const copy=centerNode("div","fs-dialog-heading"),line=centerNode("div","fs-dialog-title-row");
    const old=dialog.querySelector("h2");
    const heading=old || centerNode("h2");heading.textContent=title;
    if(!heading.id)heading.id=dialog.id+"-heading";
    dialog.setAttribute("aria-labelledby",heading.id);
    line.append(heading);if(badge)line.append(centerNode("span","fs-surface-badge",badge));copy.append(line,centerNode("p","",subtitle));
    const dismiss=close || centerNode("button","","×");dismiss.type="button";dismiss.classList.add("fs-dialog-close");dismiss.setAttribute("aria-label",`Fermer : ${title}`);dismiss.onclick=()=>dialog.close();
    header.append(mark,copy,dismiss);dialog.prepend(header);return header;
}
function studioSurfaceSection(title,description,nodes){
    const section=centerNode("section","fs-dialog-section");
    const heading=centerNode("h3","",title);section.append(heading);
    if(description)section.append(centerNode("p","fs-section-description",description));
    for(const node of nodes)if(node)section.append(node);return section;
}
function decorateEcoDialog(){
    const dialog=ecoModeDialog;
    studioSurfaceHeader(dialog,{title:"Activer le mode Éco",subtitle:"Moins de quota, des tâches plus courtes.",icon:"eco",badge:"Optionnel"});
    const items=[...dialog.querySelectorAll("li")];
    const list=centerNode("div","fs-eco-grid");
    for(const [index,item] of items.entries()){
        const card=centerNode("article","fs-feature-card"),number=centerNode("span","fs-feature-number",String(index+1).padStart(2,"0"));
        card.append(number,centerNode("strong","",["Des demandes plus courtes","Un contexte allégé","Moins de relances","Des réponses ciblées"][index]),centerNode("p","",item.textContent));list.append(card);
    }
    dialog.querySelector("ul").replaceWith(list);
    const paragraphs=[...dialog.querySelectorAll(":scope > p")];
    if(paragraphs[1])paragraphs[1].classList.add("fs-dialog-note");
    const footer=dialog.querySelector(".studio-actions");footer.classList.add("fs-dialog-footer");
    $("eco-mode-enable").classList.add("primary");
}
function decorateImportDialog(){
    const dialog=conversationImportDialog;
    studioSurfaceHeader(dialog,{title:"Continuer avec ton IA",subtitle:"Importe les échanges Codex, puis reprends dans FranceStudent IDE.",icon:"chat",badge:"Bêta"});
    const url=$("conversation-import-url").closest("label"),text=$("conversation-import-text").closest("label");
    const file=$("conversation-import-file").parentElement,analyze=$("conversation-import-preview").parentElement;
    const urlHelp=url.nextElementSibling;
    const section=studioSurfaceSection("1. Ajoute ta conversation","Colle un lien de partage, choisis un export ou colle directement le texte.",[url,urlHelp,file,text,analyze]);
    dialog.insertBefore(section,$("conversation-import-status"));
    const choices=dialog.querySelector(".conversation-import-choices");
    const settings=studioSurfaceSection("2. Choisis comment continuer","La reprise prépare un brouillon. Tu décides quand l’envoyer.",[choices]);dialog.insertBefore(settings,dialog.querySelector(":scope > .studio-actions:last-child"));
    dialog.querySelector(":scope > .studio-actions:last-child").classList.add("fs-dialog-footer");
    $("conversation-import-project").classList.add("fs-project-summary");
    $("conversation-import-apply").title="Préparer un brouillon sans lancer de requête IA";
}
function decorateGithubDialog(){
    const dialog=githubConnectorDialog,oldHead=dialog.querySelector(".workspace-section-head");
    studioSurfaceHeader(dialog,{title:"Ton espace GitHub",subtitle:"Dépôts, échanges et versions, au même endroit.",icon:"tools",badge:"Bêta",close:$("github-connector-close")});oldHead.remove();
    const account=studioSurfaceSection("Projet connecté","",[$("github-connector-account"),$("github-connector-repo")]);dialog.querySelector(".fs-dialog-header").after(account);
    const nav=dialog.querySelector(".github-connector-nav");nav.setAttribute("role","group");nav.setAttribute("aria-label","Contenu GitHub");
    const readme=$("github-connector-readme");readme.classList.add("fs-readme-action");nav.after(readme);
    $("github-connector-create").classList.add("fs-dialog-section");$("github-release-create").classList.add("primary");
    const note=dialog.querySelector(":scope > p:last-child");if(note)note.classList.add("fs-dialog-note");
}
decorateEcoDialog();decorateImportDialog();decorateGithubDialog();
for(const [id,subtitle,icon] of [["skill-editor","Les instructions que ton agent pourra utiliser.","tools"],["mcp-editor","Relie un outil externe à ton espace de travail.","tools"]]){
    const dialog=$(id),oldHead=dialog.querySelector(".center-dialog-head");
    studioSurfaceHeader(dialog,{title:dialog.querySelector("h2").textContent,subtitle,icon,close:oldHead.querySelector("button")});oldHead.remove();
}

// Real modal confirmations replace browser-native alerts and restore focus on close.
let studioConfirmationQueue=Promise.resolve();
function confirmStudioAction(message,{title="Confirmer cette action",confirmLabel="Confirmer",danger=true}={}){
    const next=studioConfirmationQueue.then(()=>new Promise(resolve=>{
        const previous=document.activeElement,dialog=document.createElement("dialog");dialog.id="studio-confirm-dialog";dialog.className="fs-dialog fs-confirm-dialog";
        dialog.setAttribute("aria-labelledby","studio-confirm-title");
        const heading=centerNode("h2","",title);heading.id="studio-confirm-title";dialog.append(heading);
        studioSurfaceHeader(dialog,{title,subtitle:danger?"Vérifie l’action avant de continuer.":"Ton choix s’applique à cette action.",icon:danger?"trash":"spark"});
        const body=centerNode("p","fs-confirm-message",message);body.id="studio-confirm-message";dialog.setAttribute("aria-describedby",body.id);
        const footer=centerNode("div","fs-dialog-footer"),cancel=centerNode("button","","Annuler"),accept=centerNode("button",danger?"danger":"primary",confirmLabel);
        cancel.type=accept.type="button";accept.dataset.confirm="accept";cancel.dataset.confirm="cancel";
        let accepted=false;cancel.onclick=()=>dialog.close();accept.onclick=()=>{accepted=true;dialog.close();};footer.append(cancel,accept);dialog.append(body,footer);document.body.append(dialog);
        dialog.addEventListener("close",()=>{dialog.remove();resolve(accepted);requestAnimationFrame(()=>{if(previous?.isConnected)previous.focus();});},{once:true});dialog.showModal();cancel.focus();
    }));
    studioConfirmationQueue=next.catch(()=>false);return next;
}
