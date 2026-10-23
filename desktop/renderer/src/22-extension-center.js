/* ---------- Bibliothèque, skills installés et profils ---------- */
let centerData = null;
let skillEditorState = null;
let centerLoading = 0;
let installedVisibleCount = 60;
function centerNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
function centerButton(text, handler, primary = false) {
    const button = centerNode("button", primary ? "primary" : "", text);
    button.type = "button";
    button.onclick = async () => {
        button.disabled = true;
        try { await handler(); }
        catch (error) { $("center-message").textContent = error.message; }
        finally { button.disabled = false; }
    };
    return button;
}
function uninstallSkillButton(skill){
    const button=centerButton("Désinstaller",()=>uninstallCenterSkill(skill));
    button.classList.add("skill-uninstall");return button;
}
function setCenterTab(tab) {
    for (const panel of document.querySelectorAll("[data-center-panel]")) panel.classList.toggle("hidden", panel.dataset.centerPanel !== tab);
    for (const button of document.querySelectorAll("[data-center-tab]")) {
        const selected = button.dataset.centerTab === tab;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
    }
}
for (const button of document.querySelectorAll("[data-center-tab]")) {
    button.onclick = () => setCenterTab(button.dataset.centerTab);
    button.onkeydown = event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...document.querySelectorAll("[data-center-tab]")];
        const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (buttons.indexOf(button) + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length;
        buttons[index].click(); buttons[index].focus();
    };
}
$("ext-close").onclick = () => showSideView("explorer");
async function loadExtensionCenter() {
    const seq = ++centerLoading;
    try {
        const data = await api.extensionAction("list");
        if (seq !== centerLoading) return;
        centerData = data;
        renderExtensionCenter();
    } catch (error) { $("center-message").textContent = `Extensions : ${error.message}`; }
}
async function changeExtension(action, payload, message = "Modification enregistrée.") {
    centerData = await api.extensionAction(action, payload);
    renderExtensionCenter();
    $("center-message").textContent = message;
}
function renderExtensionCenter() {
    if (!centerData) return;
    const active = centerData.skills.filter(skill => !skill.disabled).length;
    $("center-count").textContent = `${centerData.skills.length} installé(s) · ${active} activé(s)`;
    const selectedProfile = $("skill-profile").value;
    $("skill-profile").replaceChildren(centerNode("option", "", "Choisir un profil"));
    $("skill-profile").firstChild.value = "";
    for (const name of Object.keys(centerData.profiles).sort()) {
        const option = centerNode("option", "", name); option.value = name; $("skill-profile").appendChild(option);
    }
    $("skill-profile").value = selectedProfile;
    for (const select of [$("library-scope"), $("skill-editor-scope")]) select.querySelector('[value="projet"]').disabled = !centerData.workspace;
    renderLibrary(); renderInstalledSkills(); renderMotionMarketplace();
    for(const card of document.querySelectorAll("#marketplace-results .center-card"))if(card.marketplaceItem)renderMarketplaceSkillActions(card);
}
function renderLibrary() {
    if (!centerData) return;
    const query = $("library-search").value.toLocaleLowerCase("fr").trim();
    const category = $("library-category").value;
    const scope = $("library-scope").value;
    const list = $("library-list"); list.replaceChildren();
    for (const item of centerData.library.filter(item => (!category || category === item.category) && `${item.title} ${item.description} ${item.category} ${item.id}`.toLocaleLowerCase("fr").includes(query))) {
        const card = centerNode("article", "center-card");
        card.dataset.libraryId = item.id;
        card.append(centerNode("span", "ext-tag", item.category), centerNode("h3", "", item.title), centerNode("p", "", item.description), centerNode("p", "", `${item.author} · v${item.version}`));
        const actions = centerNode("div", "center-card-actions");
        actions.append(centerButton("Voir les instructions", () => openSkillEditor({ kind: "library", item })));
        const installedKey=libraryInstallKey(item,scope);
        const installed = centerData.skills.find(skill => skill.key === installedKey);
        actions.append(installed?uninstallSkillButton(installed):centerButton("Installer", () => changeExtension("install", {id:item.id, scope}, `${item.title} installé. Tu peux le désactiver dans Mes skills.`), true));
        card.append(actions); list.append(card);
    }
    if (!list.children.length) list.append(centerNode("p", "ext-empty", "Aucun skill ne correspond. Essaie un autre mot ou une autre catégorie."));
}
function renderInstalledSkills() {
    if (!centerData) return;
    const query = $("skills-search").value.toLocaleLowerCase("fr").trim();
    const filter = $("skills-filter").value;
    const list = $("skills-list"); list.replaceChildren();
    const filtered = centerData.skills.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase("fr").includes(query) && (filter === "all" || filter === "active" && !skill.disabled || filter === "disabled" && skill.disabled || filter === "favorites" && skill.favorite || filter === skill.scope));
    for (const skill of filtered.slice(0, installedVisibleCount)) {
        const card = centerNode("article", "center-card"); card.dataset.skillKey = skill.key;
        card.append(centerNode("span", "ext-tag", skill.scope === "motion" ? "Projet EffectCraft" : skill.scope === "projet" ? "Ce projet code" : "Tous mes projets"), centerNode("h3", "", skill.name), centerNode("p", "", skill.description));
        const actions = centerNode("div", "center-card-actions");
        const favorite = centerButton(skill.favorite ? "★" : "☆", () => changeExtension("favorite", {key:skill.key}));
        favorite.setAttribute("aria-label", `${skill.favorite ? "Retirer des" : "Ajouter aux"} favoris : ${skill.name}`);
        favorite.setAttribute("aria-pressed", String(skill.favorite));
        actions.append(favorite, centerButton("Ouvrir", async () => openSkillEditor({kind:"edit", item:await api.extensionAction("read", {key:skill.key}), key:skill.key})), uninstallSkillButton(skill));
        const label = centerNode("label", "skill-enabled");
        const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = !skill.disabled; toggle.setAttribute("role", "switch"); toggle.setAttribute("aria-label", `Activer ${skill.name}`);
        toggle.onchange = async () => {
            toggle.disabled = true;
            try { await changeExtension("toggle", {key:skill.key, disabled:!toggle.checked}); }
            catch (error) { toggle.checked = !toggle.checked; $("center-message").textContent = error.message; }
            finally { toggle.disabled = false; }
        };
        label.append(toggle, document.createTextNode(skill.disabled ? "Désactivé" : "Activé")); actions.append(label); card.append(actions); list.append(card);
    }
    if (!list.children.length) list.append(centerNode("p", "ext-empty", centerData.skills.length ? "Aucun résultat pour ces filtres." : "Aucun skill installé. Explore la bibliothèque ou crée tes propres instructions avec Nouveau."));
    if (filtered.length > installedVisibleCount) list.append(centerButton(`Afficher la suite (${filtered.length - installedVisibleCount})`, () => { installedVisibleCount += 60; renderInstalledSkills(); }));
}
$("library-search").oninput = renderLibrary;
$("library-category").onchange = renderLibrary;
$("library-scope").onchange = renderLibrary;
$("skills-search").oninput = () => { installedVisibleCount = 60; renderInstalledSkills(); };
$("skills-filter").onchange = () => { installedVisibleCount = 60; renderInstalledSkills(); };
$("profile-save").onclick = async () => {
    const name = await inputDialog("Nom du profil de skills", "Mon profil");
    if (!name) return;
    try { await changeExtension("profile-save", {name}, `Profil « ${name} » enregistré.`); $("skill-profile").value = name.trim(); }
    catch (error) { $("center-message").textContent = error.message; }
};
for (const action of ["apply", "delete"]) $("profile-" + action).onclick = async () => {
    const name = $("skill-profile").value;
    if (!name) { $("center-message").textContent = "Choisis d’abord un profil."; return; }
    try { await changeExtension("profile-" + action, {name}, action === "apply" ? `Profil « ${name} » appliqué. Les autres skills sont désactivés.` : "Profil supprimé. Les skills restent installés."); }
    catch (error) { $("center-message").textContent = error.message; }
};
function openSkillEditor(state) {
    skillEditorState = state;
    const item = state.item || {};
    const remote = state.kind === "remote";
    const library = state.kind === "library";
    $("skill-editor-title").textContent = library ? item.title : remote ? item.name : state.kind === "edit" ? `Modifier ${item.name}` : "Créer ou importer un skill";
    $("skill-editor-description").textContent = remote ? item.resourceCount ? `Remotion pour le chat code · ${item.resourceCount} ressources annexes incluses. Après installation, active le skill dans Mes skills pour l’utiliser.` : "Skill communautaire : vérifie les instructions et la licence du dépôt. Après installation, active-le dans Mes skills pour l’utiliser. Seul le SKILL.md est copié." : library ? `${item.description} · ${item.category}` : "Écris ou colle les instructions que l’agent doit suivre quand il utilise ce skill.";
    $("skill-editor-name").value = item.id || item.name || "mon-skill";
    $("skill-editor-name").disabled = !["new", "remote"].includes(state.kind);
    if (remote) $("skill-editor-name").value = item.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "community-skill";
    $("skill-editor-identity").classList.toggle("hidden", state.kind === "edit");
    $("skill-editor-scope").value = library ? $("library-scope").value : item.scope || "utilisateur";
    $("skill-editor-content").value = item.content || "---\nname: mon-skill\ndescription: Quand utiliser ce skill.\n---\n\n# Ma méthode\n\nDécris les étapes et les vérifications à suivre.\n";
    $("skill-editor-content").readOnly = library || remote;
    $("skill-editor-save").textContent = remote ? "Installer" : library ? "Installer ce skill" : "Enregistrer";
    $("skill-editor-save").disabled = false;
    $("skill-editor-message").textContent = "";
    $("skill-editor").showModal();
}
$("btn-skill-new").onclick = () => openSkillEditor({kind:"new"});
for (const id of ["skill-editor-close", "skill-editor-cancel"]) $(id).onclick = () => $("skill-editor").close();
$("skill-editor-form").onsubmit = async event => {
    event.preventDefault();
    const state = skillEditorState;
    $("skill-editor-save").disabled = true;
    try {
        const scope = $("skill-editor-scope").value;
        if (state.kind === "library") await changeExtension("install", {id:state.item.id, scope}, "Skill installé.");
        else if (state.kind === "remote") {
            centerData = await api.marketplace("install", {name:$("skill-editor-name").value, scope, url:state.item.url});
            const installed=centerData.skills.find(skill=>skill.key===`${scope}:${$("skill-editor-name").value.trim().toLowerCase()}`);
            if(installed){const links=readStudioStorage("frst.marketplace-installed",{});links[state.item.githubUrl || state.item.url]=installed.key;writeStudioStorage("frst.marketplace-installed",links);}
            renderExtensionCenter(); $("center-message").textContent = "Skill installé. Active-le dans Mes skills pour l’utiliser.";
        }
        else if (state.kind === "edit") await changeExtension("save", {key:state.key, content:$("skill-editor-content").value});
        else await changeExtension("import", {name:$("skill-editor-name").value, content:$("skill-editor-content").value, scope}, "Skill créé et activé.");
        $("skill-editor").close();
    } catch (error) { $("skill-editor-message").textContent = error.message; }
    finally { $("skill-editor-save").disabled = false; }
};

/* ---------- Serveurs MCP ---------- */
function renderMcpCard(server, sub) {
    const labels = {running:"Connecté", failed:"Erreur", disabled:"Désactivé", starting:"Connexion…"};
    const card = extItem(server.name, {dot:server.status, tag:labels[server.status] || server.status, sub:server.status === "running" ? `${server.tools.length} outil(s) disponible(s)` : sub, error:server.status === "failed"});
    const details = centerNode("details", "mcp-details");
    details.append(centerNode("summary", "", "Voir les outils"));
    const list = document.createElement("ul");
    for (const tool of server.tools) list.append(centerNode("li", "", tool));
    if (!server.tools.length) list.append(centerNode("li", "", "Aucun outil disponible dans cet état."));
    details.append(list); card.append(details);
    const actions = centerNode("div", "center-card-actions");
    actions.append(centerButton(server.status === "disabled" ? "Activer" : "Désactiver", async () => {
        await api.mcpManage("toggle", {name:server.name, disabled:server.status !== "disabled"}); await refreshMcp();
    }), centerButton("Retirer la connexion", async () => {
        if (!await confirmStudioAction(`Retirer le serveur « ${server.name} » de mcp.json ? La configuration précédente reste dans mcp.json.backup.`,{title:"Retirer ce serveur MCP",confirmLabel:"Retirer",danger:true})) return;
        await api.mcpManage("remove", {name:server.name}); await refreshMcp();
    }));
    card.append(actions); return card;
}
$("btn-mcp-add").onclick = () => {
    $("mcp-editor-form").reset(); $("mcp-editor-message").textContent = ""; $("mcp-editor").showModal();
};
for (const id of ["mcp-editor-close", "mcp-editor-cancel"]) $(id).onclick = () => $("mcp-editor").close();
$("mcp-editor-form").onsubmit = async event => {
    event.preventDefault(); $("mcp-editor-save").disabled = true;
    try {
        let args, env;
        try { args = JSON.parse($("mcp-args").value); env = JSON.parse($("mcp-env").value); }
        catch { throw new Error('Arguments et variables : utilise du JSON valide, par exemple ["mon-script.js"] et {"MA_CLE":"valeur"}.'); }
        await api.mcpManage("add", {name:$("mcp-name").value, command:$("mcp-command").value, args, env, cwd:$("mcp-cwd").value});
        $("mcp-env").value = "{}"; $("mcp-editor").close(); await refreshMcp();
        $("center-message").textContent = "Serveur enregistré. Son état de connexion apparaît dans la liste.";
    } catch (error) { $("mcp-editor-message").textContent = error.message; }
    finally { $("mcp-editor-save").disabled = false; }
};

/* ---------- Paramètres recherchables et contexte ---------- */
const preferenceFields = { contextMaxFiles:"context-max-files", contextBudgetChars:"context-budget", contextFileChars:"context-file-chars", agentContextChars:"context-agent-chars" };
function showPreferences(data) {
    for (const [key, id] of Object.entries(preferenceFields)) $(id).value = data[key];
    $("settings-default-model").value = data.defaultModel == null ? "" : String(data.defaultModel);
    renderContextEstimate();
}
function renderContextEstimate() {
    const budget = Number($("context-budget").value);
    $("context-estimate").textContent = `Budget d’indexation : ${budget.toLocaleString("fr-FR")} caractères. Le contexte réellement envoyé dépend aussi des limites du modèle et du prompt.`;
}
async function loadPreferences() {
    try {
        await refreshMarketplaceKey();
        const data = await api.preferences();
        const models = await api.models();
        const select = $("settings-default-model"); select.replaceChildren();
        const defaultOption = centerNode("option", "", "Modèle par défaut de l’application"); defaultOption.value = ""; select.append(defaultOption);
        for (const model of models.agents || []) { const option = centerNode("option", "", model.name); option.value = String(model.id); select.append(option); }
        if (data.defaultModel !== null && ![...select.options].some(option => option.value === String(data.defaultModel))) {
            const option = centerNode("option", "", `Modèle enregistré (${data.defaultModel})`); option.value = String(data.defaultModel); select.append(option);
        }
        showPreferences(data);
    } catch (error) { $("settings-message").textContent = error.message; }
}
for (const id of Object.values(preferenceFields)) $(id).oninput = renderContextEstimate;
const contextPresets = {
    light:{contextMaxFiles:100, contextBudgetChars:100000, contextFileChars:10000, agentContextChars:15000},
    balanced:{contextMaxFiles:500, contextBudgetChars:400000, contextFileChars:30000, agentContextChars:30000},
    large:{contextMaxFiles:3000, contextBudgetChars:1500000, contextFileChars:60000, agentContextChars:60000}
};
for (const button of document.querySelectorAll("[data-context-preset]")) button.onclick = () => {
    for (const [key, id] of Object.entries(preferenceFields)) $(id).value = contextPresets[button.dataset.contextPreset][key];
    renderContextEstimate(); $("settings-message").textContent = "Préréglage préparé. Clique sur Enregistrer ces réglages pour l’appliquer.";
};
$("preferences-reset").onclick = () => document.querySelector('[data-context-preset="balanced"]').click();
$("preferences-save").onclick = async () => {
    if (!Object.values(preferenceFields).every(id => $(id).reportValidity())) return;
    const values = {defaultModel:$("settings-default-model").value};
    for (const [key, id] of Object.entries(preferenceFields)) values[key] = Number($(id).value);
    try { showPreferences(await api.preferences("save", values)); $("settings-message").textContent = "Réglages enregistrés. Le contexte sera utilisé à la prochaine indexation et le modèle au prochain démarrage."; }
    catch (error) { $("settings-message").textContent = error.message; }
};
const defaultModelStatus = document.createElement("p");
defaultModelStatus.id = "settings-default-model-status";
defaultModelStatus.className = "settings-help";
defaultModelStatus.setAttribute("role", "status");
$("settings-default-model").after(defaultModelStatus);
$("settings-default-model").onchange = async () => {
    const select = $("settings-default-model");
    select.disabled = true;
    defaultModelStatus.textContent = "Enregistrement du modèle…";
    try {
        await api.preferences("save", { defaultModel: select.value });
        defaultModelStatus.textContent = "Modèle enregistré automatiquement pour les prochains démarrages.";
    } catch (error) {
        defaultModelStatus.textContent = `Modèle non enregistré : ${error.message}`;
        try { const saved = await api.preferences(); select.value = saved.defaultModel == null ? "" : String(saved.defaultModel); } catch { /* keep visible error */ }
    } finally { select.disabled = false; }
};
$("settings-search").oninput = () => {
    const query = $("settings-search").value.toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    let visible = 0;
    for (const card of $("settings-view").querySelectorAll(".settings-card")) {
        const text = card.textContent.toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const hidden = !text.includes(query); card.classList.toggle("hidden", hidden); if (!hidden) visible++;
    }
    $("settings-search-empty").classList.toggle("hidden", visible > 0);
};

/* ---------- Marketplace en ligne : recherche explicite, aperçu avant installation ---------- */
let marketplacePage = 1;
let marketplaceSearch = null;
let marketplaceSequence = 0;
async function searchMarketplace(page = 1) {
    const query = page === 1 ? $("marketplace-query").value.trim() : marketplaceSearch?.query;
    const sort = page === 1 ? $("marketplace-sort").value : marketplaceSearch?.sort;
    if (!query) return;
    const seq = ++marketplaceSequence;
    marketplaceSearch = {query, sort};
    $("marketplace-search-button").disabled = true;
    $("marketplace-previous").disabled = true; $("marketplace-next").disabled = true;
    $("marketplace-status").textContent = "Recherche sur SkillsMP…";
    try {
        const data = await api.marketplace("search", {query, sort, page});
        if (seq !== marketplaceSequence) return;
        marketplacePage = data.page;
        const list = $("marketplace-results"); list.replaceChildren();
        for (const item of data.items) {
            const card = centerNode("article", "center-card");
            card.append(centerNode("span", "ext-tag", `★ ${item.stars.toLocaleString("fr-FR")}`), centerNode("h3", "", item.name), centerNode("p", "", `par ${item.author}`), centerNode("p", "", item.description));
            card.marketplaceItem=item;renderMarketplaceSkillActions(card);list.append(card);
        }
        $("marketplace-status").textContent = data.items.length ? `${data.items.length} résultat(s) affiché(s)${data.remaining !== null ? ` · ${data.remaining} recherche(s) restante(s) aujourd’hui` : ""}.` : "Aucun résultat. Essaie un autre mot-clé.";
        $("marketplace-page").textContent = `Page ${data.page}`;
        $("marketplace-previous").disabled = data.page <= 1;
        $("marketplace-next").disabled = !data.hasNext;
    } catch (error) { if (seq === marketplaceSequence) $("marketplace-status").textContent = error.message; }
    finally { if (seq === marketplaceSequence) $("marketplace-search-button").disabled = false; }
}
$("marketplace-search-form").onsubmit = event => {event.preventDefault(); searchMarketplace(1);};
$("marketplace-previous").onclick = () => searchMarketplace(marketplacePage - 1);
$("marketplace-next").onclick = () => searchMarketplace(marketplacePage + 1);
async function refreshMarketplaceKey() {
    const data = await api.marketplaceKey();
    $("marketplace-key-status").textContent = data.fromEnvironment ? "Clé fournie par SKILLSMP_API_KEY. Effacer la clé locale ne changera pas cette variable." : data.configured ? "Une clé chiffrée est enregistrée sur cet ordinateur." : "Aucune clé : recherche publique disponible.";
}
for (const action of ["save", "clear"]) $("marketplace-key-" + action).onclick = async () => {
    try {
        await api.marketplaceKey(action, action === "save" ? $("settings-marketplace-key").value : "");
        $("settings-marketplace-key").value = "";
        await refreshMarketplaceKey();
        $("settings-message").textContent = action === "save" ? "Clé enregistrée et chiffrée." : "Clé locale effacée.";
    } catch (error) { $("settings-message").textContent = error.message; }
};
$("marketplace-docs").onclick = () => api.openExternal("https://skillsmp.com/docs/api").catch(error => { $("settings-message").textContent = error.message; });
