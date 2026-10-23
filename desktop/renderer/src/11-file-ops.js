/* ---------- Opérations sur les fichiers ---------- */

function parentOf(rel) {
    const i = rel.lastIndexOf("/");
    return i < 0 ? "." : rel.slice(0, i);
}

function cleanRel(name) {
    return name.split("\\").join("/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function joinRel(dir, name) {
    const clean = cleanRel(name);
    return !dir || dir === "." ? clean : `${dir}/${clean}`;
}

async function newEntry(kind, baseDir = ".") {
    if (!ui.workspace) {
        openProject();
        return;
    }
    const name = await inputDialog(kind === "directory" ? "Nom du nouveau dossier" : "Nom du nouveau fichier", "");
    if (!name) return;
    const rel = joinRel(baseDir, name);
    try {
        await api.createEntry(rel, kind);
    } catch (err) {
        renderEntry({ type: "error", text: `Création impossible : ${err.message}` });
        return;
    }
    let dir = kind === "directory" ? rel : parentOf(rel);
    while (dir && dir !== ".") {
        expanded.add(dir);
        dir = parentOf(dir);
    }
    await renderTree();
    if (kind !== "directory") await openFile(rel);
}

async function renameNode(entry) {
    const name = await inputDialog(`Renommer ${entry.path}`, entry.path);
    if (!name) return;
    const from = entry.path;
    const to = cleanRel(name);
    if (!to || to === from) return;
    try {
        await api.renameEntry(from, to);
    } catch (err) {
        renderEntry({ type: "error", text: `Renommage impossible : ${err.message}` });
        return;
    }
    const moved = (p) => p === from || p.startsWith(`${from}/`);
    const remap = (p) => to + p.slice(from.length);
    for (const tab of ui.tabs) {
        if (moved(tab.path)) tab.path = remap(tab.path);
    }
    if (ui.active && moved(ui.active)) {
        ui.active = remap(ui.active);
        $("st-file").textContent = ui.active;
    }
    for (const p of [...expanded]) {
        if (moved(p)) {
            expanded.delete(p);
            expanded.add(remap(p));
        }
    }
    renderTabs();
    await renderTree();
}

async function deleteNode(entry) {
    if (!await confirmStudioAction(`Mettre « ${entry.path} » à la corbeille ?`,{title:"Supprimer cet élément",confirmLabel:"Mettre à la corbeille",danger:true})) return;
    try {
        await api.trashEntry(entry.path);
    } catch (err) {
        renderEntry({ type: "error", text: `Suppression impossible : ${err.message}` });
        return;
    }
    const gone = (p) => p === entry.path || p.startsWith(`${entry.path}/`);
    const wasActive = Boolean(ui.active && gone(ui.active));
    ui.tabs = ui.tabs.filter((t) => !gone(t.path));
    for (const p of [...expanded]) {
        if (gone(p)) expanded.delete(p);
    }
    if (wasActive) {
        ui.active = null;
        const last = ui.tabs[ui.tabs.length - 1];
        activate(last ? last.path : null);
    } else {
        renderTabs();
    }
    await renderTree();
}

function mention(rel) {
    const sep = input.value && !/\s$/.test(input.value) ? " " : "";
    input.value += `${sep}${rel} `;
    input.focus();
}

/* ---------- Menu contextuel de l'explorateur ---------- */

const contextMenu = $("context-menu");

function hideContextMenu() {
    contextMenu.classList.add("hidden");
    contextMenu.innerHTML = "";
}

function showContextMenu(ev, entry) {
    const isDir = !entry || entry.type === "directory";
    const rel = entry ? entry.path : ".";
    const dir = entry ? (isDir ? rel : parentOf(rel)) : ".";
    const items = [];
    if (entry && !isDir) items.push(["Ouvrir", () => openFile(rel)]);
    items.push(["Nouveau fichier…", () => newEntry("file", dir)]);
    items.push(["Nouveau dossier…", () => newEntry("directory", dir)]);
    if (entry) {
        items.push(null);
        items.push(["Renommer…", () => renameNode(entry)]);
        items.push(["Supprimer (corbeille)", () => deleteNode(entry)]);
    }
    items.push(null);
    items.push(["Mentionner à l'agent", () => mention(rel)]);
    items.push(["Copier le chemin relatif", () => navigator.clipboard.writeText(rel).catch(() => {})]);
    items.push(["Afficher dans l'Explorateur Windows", () => api.revealInExplorer(rel).catch(() => {})]);

    contextMenu.innerHTML = "";
    for (const item of items) {
        const el = document.createElement("div");
        if (!item) {
            el.className = "sep";
        } else {
            el.className = "item";
            el.textContent = item[0];
            el.onclick = () => {
                hideContextMenu();
                item[1]();
            };
        }
        contextMenu.appendChild(el);
    }
    contextMenu.classList.remove("hidden");
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = `${Math.max(0, Math.min(ev.clientX, window.innerWidth - rect.width - 4))}px`;
    contextMenu.style.top = `${Math.max(0, Math.min(ev.clientY, window.innerHeight - rect.height - 4))}px`;
}

$("tree").addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    if (ui.workspace) showContextMenu(ev, null);
});
$("tree").addEventListener("scroll", hideContextMenu);

$("btn-new-file").onclick = () => newEntry("file", ".");
$("btn-new-folder").onclick = () => newEntry("directory", ".");
$("btn-collapse-tree").onclick = () => {
    expanded.clear();
    renderTree();
};

