/* Explicit progress and cancellation for community instruction downloads. */
function renderMarketplaceSkillActions(card){
    const item=card.marketplaceItem;
    card.querySelector(".center-card-actions")?.remove();
    const actions=centerNode("div","center-card-actions");
    const key=readStudioStorage("frst.marketplace-installed",{})[item.githubUrl];
    const installed=centerData?.skills.find(skill=>skill.key===key);
    actions.append(centerButton("Voir le dépôt",()=>api.openExternal(item.githubUrl)),installed?uninstallSkillButton(installed):centerButton("Lire et installer",()=>downloadSkillPreview(item),true));
    card.append(actions);
}
async function uninstallCenterSkill(skill) {
    if (!skill || !await confirmStudioAction(`Désinstaller « ${skill.name} » ? Il ne sera plus disponible pour l’IA. Son dossier sera conservé dans .trash pour pouvoir le récupérer.`,{title:"Désinstaller ce skill",confirmLabel:"Désinstaller",danger:true})) return;
    await changeExtension("remove", {key:skill.key}, `« ${skill.name} » désinstallé. Son dossier reste récupérable dans .trash.`);
}
const extensionDownloads = new Map();
const extensionDownloadList = centerNode("section", "extension-downloads hidden");
extensionDownloadList.setAttribute("aria-label", "Téléchargements des skills");
$("marketplace-status").after(extensionDownloadList);
function showSkillDownload(job) {
    const card = job.card;
    card.replaceChildren();
    const heading = centerNode("div");
    heading.append(centerNode("b", "", job.item.name));
    const button = centerNode("button", "", job.state === "loading" ? "Annuler" : job.state === "failed" || job.state === "canceled" ? "Réessayer" : "Fermer");
    button.type = "button";
    button.onclick = async () => {
        if (job.state === "loading") {
            button.disabled = true;
            try { await api.marketplace("cancel", {requestId:job.id}); }
            catch (error) { button.disabled = false; card.append(centerNode("p", "", error.message)); }
        } else if (job.state === "failed" || job.state === "canceled") { card.remove(); extensionDownloads.delete(job.id); downloadSkillPreview(job.item); }
        else { card.remove(); extensionDownloads.delete(job.id); extensionDownloadList.classList.toggle("hidden", !extensionDownloadList.children.length); }
    };
    heading.append(button); card.append(heading);
    if (job.state === "loading") {
        const progress = document.createElement("progress"); progress.setAttribute("aria-label", "Téléchargement du SKILL.md");
        if (job.total) { progress.max = job.total; progress.value = Math.min(job.received, job.total); }
        card.append(progress);
    }
    const bytes = count => `${(count / 1024).toLocaleString("fr-FR", {maximumFractionDigits:1})} Ko`;
    card.append(centerNode("p", "", job.message || `${bytes(job.received)} reçus${job.total ? ` sur ${bytes(job.total)}` : " · taille totale inconnue"}`));
}
async function downloadSkillPreview(item) {
    const job = {id:crypto.randomUUID(), item, received:0, total:null, state:"loading", card:centerNode("article", "download-card")};
    extensionDownloads.set(job.id, job); extensionDownloadList.classList.remove("hidden"); extensionDownloadList.append(job.card); showSkillDownload(job);
    // Keep only recent completed entries; in-flight downloads are always visible.
    for (const [id, old] of extensionDownloads) if (extensionDownloads.size > 8 && old.state !== "loading") { old.card.remove(); extensionDownloads.delete(id); }
    try {
        const preview = await api.marketplace("preview", {githubUrl:item.githubUrl, curatedId:item.curatedId, requestId:job.id});
        job.state = "ready"; job.message = "Téléchargé · lis les instructions puis choisis Installer. Tu pourras ensuite l’activer dans Mes skills.";
        showSkillDownload(job); openSkillEditor({kind:"remote", item:{...item, ...preview}});
        if(preview.resourceCount)$("skill-editor-message").textContent=`Ressources incluses : ${preview.resourceNames.join(", ")}`;
    } catch (error) {
        job.state = error.message.includes("annulé") ? "canceled" : "failed"; job.message = error.message; showSkillDownload(job);
    }
}
api.onEvent((channel, data) => {
    if (channel !== "marketplaceDownload") return;
    const job = extensionDownloads.get(data.requestId);
    if (!job || job.state !== "loading") return;
    job.received = data.received; job.total = data.total; showSkillDownload(job);
});
