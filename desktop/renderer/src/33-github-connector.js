/* ---------- Connecteur natif GitHub ---------- */
const githubConnectorDialog = document.createElement("dialog");
githubConnectorDialog.id = "github-connector-dialog";
githubConnectorDialog.className = "conversation-import-dialog github-connector-dialog";
githubConnectorDialog.setAttribute("aria-labelledby", "github-connector-title");
githubConnectorDialog.innerHTML = `<div class="workspace-section-head"><h2 id="github-connector-title">GitHub <small>Bêta</small></h2><button type="button" id="github-connector-close" aria-label="Fermer le connecteur GitHub">×</button></div>
<p id="github-connector-account" class="settings-help"></p><p id="github-connector-repo"></p>
<div class="studio-actions github-connector-nav"><button type="button" data-github-view="releases">Releases</button><button type="button" data-github-view="pull_requests">Pull requests</button><button type="button" data-github-view="issues">Issues</button><button type="button" data-github-view="repositories">Mes dépôts</button><button type="button" id="github-connector-readme">Modifier le README avec l’IA</button></div>
<p id="github-connector-status" role="status"></p><div id="github-connector-list"></div>
<details id="github-connector-create"><summary>Préparer une release</summary><p class="settings-help">Un brouillon sera créé. Ajoute ses fichiers et vérifie ses notes avant de publier.</p><label>Tag<input id="github-release-tag" placeholder="v1.0.0"></label><label>Commit ou branche cible<input id="github-release-target" placeholder="SHA du commit ou main"></label><label>Titre<input id="github-release-title" placeholder="Version 1.0.0"></label><label>Notes<textarea id="github-release-body" rows="4"></textarea></label><button type="button" id="github-release-create">Créer le brouillon</button></details>
<p class="settings-help">Le dépôt vient du remote origin du projet ouvert. Les droits dépendent du token connecté. L’agent dispose de l’outil natif github ; les modifications demandent une confirmation en mode Demander, mais pas en Full accès. Une publication ou un push ne peut pas être annulé comme une lecture locale.</p>`;
document.body.appendChild(githubConnectorDialog);
let githubConnectorView = "releases", githubConnectorLoading = false;
async function githubConnectorWork(operation) {
    if (githubConnectorLoading) return;
    githubConnectorLoading = true;
    const buttons = [...githubConnectorDialog.querySelectorAll("button:not(#github-connector-close)")];
    buttons.forEach(button => { button.disabled = true; });
    $("github-connector-status").textContent = "Chargement…";
    try { await operation(); }
    catch (error) { $("github-connector-status").textContent = error.message; }
    finally { githubConnectorLoading = false; buttons.forEach(button => { if (button.isConnected) button.disabled = false; }); }
}
async function loadGithubConnector() {
    const result = await api.githubConnector({ action: githubConnectorView });
    const list = $("github-connector-list"); list.replaceChildren();
    for (const item of result.items || result.repositories || []) {
        const card = document.createElement("article"); card.className = "github-connector-card";
        const title = document.createElement("b"); title.textContent = item.title || item.name;
        const status = document.createElement("span"); status.textContent = item.draft ? "Brouillon" : item.state || (item.private === true ? "Privé" : item.private === false ? "Public" : "Publié");
        const actions = document.createElement("div"); actions.className = "studio-actions";
        const open = document.createElement("button"); open.textContent = "Voir sur GitHub"; open.onclick = () => api.openExternal(item.url, true).catch(error => { $("github-connector-status").textContent = error.message; });
        actions.append(open);
        if (item.draft && githubConnectorView === "releases") {
            const upload = document.createElement("button"); upload.textContent = "Ajouter un fichier"; upload.onclick = () => githubConnectorWork(async () => { await api.githubUploadAsset(item.id); await loadGithubConnector(); });
            const publish = document.createElement("button"); publish.textContent = "Publier la release"; publish.onclick = () => githubConnectorWork(async () => { await api.githubConnector({ action: "publish_release", id: item.id }); await loadGithubConnector(); });
            actions.append(upload, publish);
        }
        if (githubConnectorView === "repositories") {
            const link = document.createElement("button"); link.textContent = "Lier au projet"; link.onclick = () => githubConnectorWork(async () => { await api.githubSetRemote(item.name); $("github-connector-repo").textContent = item.name; $("github-connector-status").textContent = "Remote origin mis à jour."; }); actions.append(link);
        }
        card.append(title, status);
        if (item.body) { const details = document.createElement("details"), summary = document.createElement("summary"), body = document.createElement("pre"); summary.textContent = "Notes"; body.textContent = item.body; details.append(summary, body); card.append(details); }
        for (const asset of item.assets || []) { const line = document.createElement("small"); line.textContent = `${asset.name} · ${formatBytes(asset.size)}`; card.append(line); }
        card.append(actions); list.append(card);
    }
    $("github-connector-status").textContent = list.children.length ? `${list.children.length} élément(s)` : "Aucun élément.";
    for (const button of githubConnectorDialog.querySelectorAll("[data-github-view]")) button.setAttribute("aria-pressed", String(button.dataset.githubView === githubConnectorView));
}
$("gh-connector-open").onclick = () => {
    githubConnectorDialog.showModal();
    githubConnectorWork(async () => {
        const account = await api.githubStatus();
        $("github-connector-account").textContent = account.connected ? `Compte connecté : ${account.login || "GitHub"}` : "Connecte ton compte avec le champ sécurisé du panneau Git.";
        $("github-connector-repo").textContent = account.remote || "Aucun dépôt lié au projet.";
        if (!account.connected) { $("github-connector-list").replaceChildren(); $("github-connector-status").textContent = "Connexion GitHub nécessaire."; return; }
        try { const repo = await api.githubConnector({ action: "overview" }); $("github-connector-repo").textContent = `${repo.repository} · ${repo.branch}${repo.private ? " · Privé" : " · Public"}`; $("github-release-target").value = repo.branch; } catch { githubConnectorView = "repositories"; }
        await loadGithubConnector();
    });
};
$("github-connector-close").onclick = () => githubConnectorDialog.close();
for (const button of githubConnectorDialog.querySelectorAll("[data-github-view]")) button.onclick = () => githubConnectorWork(async () => { githubConnectorView = button.dataset.githubView; await loadGithubConnector(); });
$("github-release-create").onclick = () => githubConnectorWork(async () => {
    await api.githubConnector({ action: "create_release", tag: $("github-release-tag").value.trim(), target: $("github-release-target").value.trim(), title: $("github-release-title").value.trim(), body: $("github-release-body").value });
    githubConnectorView = "releases"; await loadGithubConnector();
});
$("github-connector-readme").onclick = () => { githubConnectorDialog.close(); setAgentTab("conversation"); input.value = "Examine le projet et son README, puis mets à jour le README pour expliquer simplement son utilisation. Utilise les outils de fichiers locaux ; prépare un commit et un push uniquement si je te le demande."; autosizeInput(); saveStudioDraft(); input.focus(); };
