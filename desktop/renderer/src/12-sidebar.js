/* ---------- Vues latérales : explorateur et recherche ---------- */

ui.sideView = "explorer";

function setActivity(view) {
    for (const b of document.querySelectorAll('[data-view="explorer"], [data-view="search"], [data-view="git"], [data-view="extensions"], [data-view="settings"]')) {
        b.classList.toggle("active", b.dataset.view === view);
    }
}

function showSideView(view) {
    const app = $("app");
    ui.sideView = view;
    app.classList.remove("no-sidebar");
    app.classList.toggle("view-search", view === "search");
    app.classList.toggle("view-ext", view === "extensions");
    app.classList.toggle("view-settings", view === "settings");
    app.classList.toggle("view-git", view === "git");
    setActivity(view);
    if (view === "git") refreshGit();
    if (view === "extensions") refreshExtensions();
    if (view === "settings") refreshSettings();
    if (view === "search") {
        setTimeout(() => {
            $("search-input").focus();
            $("search-input").select();
        }, 0);
    }
}

function hideSidebar() {
    $("app").classList.add("no-sidebar");
    setActivity(null);
}

function toggleSideView(view) {
    if (!$("app").classList.contains("no-sidebar") && ui.sideView === view) hideSidebar();
    else showSideView(view);
}

function focusSearch() {
    const selected = code.value.slice(code.selectionStart, code.selectionEnd);
    if (code.hasFocus() && selected && !selected.includes("\n")) $("search-input").value = selected;
    showSideView("search");
}

document.querySelector('[data-view="explorer"]').onclick = () => toggleSideView("explorer");
document.querySelector('[data-view="search"]').onclick = () => toggleSideView("search");
document.querySelector('[data-view="git"]').onclick = () => toggleSideView("git");
document.querySelector('[data-view="extensions"]').onclick = () => toggleSideView("extensions");
document.querySelector('[data-view="settings"]').onclick = () => toggleSideView("settings");

/* ---------- Vue Paramètres : auto-approbation des écritures et des commandes ---------- */

function applySettings(s) {
    if (!s || typeof s !== "object") return;
    $("set-auto-writes").checked = Boolean(s.autoApprove);
    $("set-auto-writes-always").checked = Boolean(s.always);
    $("set-auto-commands").checked = Boolean(s.autoApproveCommands);
    $("set-auto-commands-always").checked = Boolean(s.commandsAlways);
    $("st-auto").textContent = s.autoApprove ? "auto-approbation" : "";
}

async function refreshSettings() {
    try {
        // Mode vide : main.js ne change rien et renvoie l'état actuel.
        applySettings(await api.setAutoApprove(""));
        $("settings-message").textContent = "";
    } catch (error) {
        $("settings-message").textContent = `Paramètres : ${error.message}`;
    }
}

async function changeSetting(mode) {
    try {
        applySettings(await api.setAutoApprove(mode));
        $("settings-message").textContent = "Réglage enregistré.";
    } catch (error) {
        $("settings-message").textContent = `Réglage non enregistré : ${error.message}`;
        await refreshSettings();
    }
}

$("set-auto-writes").onchange = (e) => changeSetting(e.target.checked ? "on" : "off");
$("set-auto-writes-always").onchange = (e) => changeSetting(e.target.checked ? "always" : "never");
$("set-auto-commands").onchange = (e) => changeSetting(e.target.checked ? "commands-on" : "commands-off");
$("set-auto-commands-always").onchange = (e) => changeSetting(e.target.checked ? "commands-always" : "commands-never");

/* ---------- Vue Extensions : serveurs MCP et skills (modules réels du CLI) ---------- */

function extItem(name, { dot = null, tag = "", sub = "", error = false, title = "" } = {}) {
    const item = document.createElement("div");
    item.className = "ext-item";
    if (title) item.title = title;
    const head = document.createElement("div");
    head.className = "ext-item-head";
    if (dot) {
        const d = document.createElement("span");
        d.className = `ext-dot ${dot}`;
        head.appendChild(d);
    }
    const n = document.createElement("span");
    n.className = "ext-item-name";
    n.textContent = name;
    head.appendChild(n);
    if (tag) {
        const t = document.createElement("span");
        t.className = "ext-tag";
        t.textContent = tag;
        head.appendChild(t);
    }
    item.appendChild(head);
    if (sub) {
        const s = document.createElement("div");
        s.className = "ext-item-sub" + (error ? " error" : "");
        s.textContent = sub;
        item.appendChild(s);
    }
    return item;
}

function extMessage(list, text) {
    list.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "ext-empty";
    empty.textContent = text;
    list.appendChild(empty);
}

async function refreshMcp(action = "") {
    const list = $("mcp-list");
    extMessage(list, action === "restart" ? "Redémarrage des serveurs…" : "Démarrage des serveurs…");
    try {
        const data = await api.mcpList(action);
        list.innerHTML = "";
        if (!data.servers.length) {
            extMessage(list, `Aucun serveur configuré. Ajoute-les dans ${data.configFile} (format mcpServers).`);
            return;
        }
        for (const server of data.servers) {
            const sub = server.status === "running"
                ? `${server.tools.length} outil(s) : ${server.tools.join(", ")}`
                : server.error || server.status;
            list.appendChild(extItem(server.name, {
                dot: server.status,
                tag: server.status,
                sub,
                error: server.status === "failed",
                title: data.configFile
            }));
        }
    } catch (error) {
        extMessage(list, `MCP : ${error.message}`);
    }
}

async function refreshSkills() {
    const list = $("skills-list");
    try {
        const data = await api.skillsList();
        list.innerHTML = "";
        if (!data.skills.length) {
            extMessage(
                list,
                `Aucun skill. Un sous-dossier avec SKILL.md dans ${data.userDir}` +
                (data.projectDir ? ` ou ${data.projectDir}` : "") + "."
            );
            return;
        }
        for (const skill of data.skills) {
            list.appendChild(extItem(skill.name, {
                tag: skill.disabled ? `${skill.scope}, désactivé` : skill.scope,
                sub: skill.description || "sans description",
                title: skill.file
            }));
        }
    } catch (error) {
        extMessage(list, `Skills : ${error.message}`);
    }
}

function refreshExtensions() {
    refreshMcp("");
    refreshSkills();
}

$("btn-ext-refresh").onclick = () => {
    refreshMcp("restart");
    refreshSkills();
};
$("btn-mcp-restart").onclick = () => refreshMcp("restart");
$("btn-mcp-config").onclick = async () => {
    try {
        await api.mcpOpenConfig();
    } catch (error) {
        extMessage($("mcp-list"), `mcp.json : ${error.message}`);
    }
};
$("btn-skill-dir").onclick = async () => {
    try {
        await api.skillsOpenDir("utilisateur");
    } catch (error) {
        extMessage($("skills-list"), `Dossier : ${error.message}`);
    }
};
$("btn-skill-new").onclick = async () => {
    const name = await inputDialog("Nom du nouveau skill (lettres, chiffres, - et _)");
    if (!name) return;
    const scope = ui.workspace
        ? ((await inputDialog("Portée : utilisateur ou projet", "utilisateur")) || "utilisateur")
        : "utilisateur";
    try {
        await api.skillsCreate(name, scope.trim().toLowerCase() === "projet" ? "projet" : "utilisateur");
        await refreshSkills();
    } catch (error) {
        extMessage($("skills-list"), `Création : ${error.message}`);
    }
};

let searchSeq = 0;

async function runSearch() {
    const query = $("search-input").value;
    const results = $("search-results");
    const summary = $("search-summary");
    const seq = ++searchSeq;
    results.innerHTML = "";
    if (!query.trim()) {
        summary.textContent = "";
        return;
    }
    if (!ui.workspace) {
        summary.textContent = "Aucun projet ouvert.";
        return;
    }
    summary.textContent = "Recherche…";
    let res;
    try {
        res = await api.searchText(query, { regex: $("search-regex").checked, caseSensitive: $("search-case").checked });
    } catch (err) {
        if (seq === searchSeq) summary.textContent = err.message;
        return;
    }
    if (seq !== searchSeq) return;

    const matches = (res && res.matches) || [];
    const groups = new Map();
    for (const m of matches) {
        if (!groups.has(m.path)) groups.set(m.path, []);
        groups.get(m.path).push(m);
    }
    summary.textContent = matches.length
        ? `${matches.length} résultat(s) dans ${groups.size} fichier(s)${res.truncated ? " (liste limitée)" : ""}`
        : "Aucun résultat.";

    for (const [file, list] of groups) {
        const head = document.createElement("div");
        head.className = "search-file";
        head.textContent = `${file} (${list.length})`;
        head.title = file;
        head.onclick = () => openFile(file);
        results.appendChild(head);
        for (const m of list) {
            const row = document.createElement("div");
            row.className = "search-match";
            row.title = `${file}:${m.line}`;
            const ln = document.createElement("span");
            ln.className = "ln";
            ln.textContent = String(m.line);
            const text = document.createElement("span");
            text.textContent = String(m.text ?? "").trim().slice(0, 300);
            row.append(ln, text);
            row.onclick = () => openFile(file).then(() => goToLine(m.line));
            results.appendChild(row);
        }
    }
}

$("search-input").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
        ev.preventDefault();
        runSearch();
    }
});
$("search-case").onchange = runSearch;
$("search-regex").onchange = runSearch;

/* ---------- Remplacer dans le projet ---------- */

function buildSearchRegex(query, isRegex, caseSensitive) {
    const source = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(source, caseSensitive ? "g" : "gi");
}

async function replaceAllInProject() {
    const query = $("search-input").value;
    const replacement = $("replace-input").value;
    const summary = $("search-summary");
    if (!query.trim() || !ui.workspace) return;
    const isRegex = $("search-regex").checked;
    const caseSensitive = $("search-case").checked;
    let pattern;
    try {
        pattern = buildSearchRegex(query, isRegex, caseSensitive);
    } catch (err) {
        summary.textContent = `Expression invalide : ${err.message}`;
        return;
    }

    let res;
    try {
        res = await api.searchText(query, { regex: isRegex, caseSensitive });
    } catch (err) {
        summary.textContent = err.message;
        return;
    }
    const files = [...new Set(((res && res.matches) || []).map((m) => m.path))];
    if (!files.length) {
        summary.textContent = "Aucun résultat à remplacer.";
        return;
    }
    const limited = res.truncated ? "\n(Liste de résultats limitée : relance ensuite pour traiter le reste.)" : "";
    if (!window.confirm(`Remplacer « ${query} » par « ${replacement} » dans ${files.length} fichier(s) ?${limited}`)) return;

    let changedFiles = 0;
    let total = 0;
    const skipped = [];
    for (const file of files) {
        const tab = ui.tabs.find((t) => t.path === file);
        if (tab && tab.dirty) {
            skipped.push(file);
            continue;
        }
        try {
            const data = await api.readFile(file);
            const before = data.content;
            let count = 0;
            pattern.lastIndex = 0;
            const after = before.replace(pattern, (...args) => {
                count++;
                if (!isRegex) return replacement;
                return args[0].replace(buildSearchRegex(query, true, caseSensitive), replacement);
            });
            if (!count || after === before) continue;
            await api.writeFile(file, after);
            changedFiles++;
            total += count;
            if (tab) {
                const text = normalize(after);
                tab.content = text;
                tab.saved = text;
                if (ui.active === file) {
                    code.value = text;
                    updateGutter();
                    syncHighlight();
                }
            }
        } catch (err) {
            skipped.push(`${file} (${err.message})`);
        }
    }
    renderTabs();
    await runSearch();
    summary.textContent = `${total} remplacement(s) dans ${changedFiles} fichier(s).` +
        (skipped.length ? ` Ignorés : ${skipped.join(", ")} (modifications non enregistrées ou erreur).` : "");
scheduleRefresh();
}

$("btn-replace-all").onclick = () => replaceAllInProject();
$("replace-input").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        replaceAllInProject();
    }
});

