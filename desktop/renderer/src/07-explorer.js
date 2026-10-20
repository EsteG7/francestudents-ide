/* ---------- Explorateur ---------- */

function projectLabel() {
    return ui.workspace ? ui.workspace.split(/[\\/]/).pop() : "Aucun projet";
}

async function renderTree() {
    const tree = $("tree");
    $("project-name").textContent = projectLabel();
    $("st-project").textContent = ui.workspace ? `📁 ${projectLabel()}` : "Aucun projet";

    if (!ui.workspace) {
        tree.innerHTML = '<div class="empty"><p>Aucun dossier ouvert.</p><button class="primary" data-open>Ouvrir un dossier</button></div>';
        tree.querySelector("[data-open]").onclick = openProject;
        return;
    }

    const root = document.createElement("div");
    await renderDir(root, ".", 0);
    tree.innerHTML = "";
    tree.appendChild(root);
}

const FILE_KINDS = {
    js: "js", mjs: "js", cjs: "js", jsx: "js", ts: "ts", tsx: "ts", json: "json", md: "md",
    css: "css", scss: "css", html: "html", htm: "html", py: "py",
    png: "img", jpg: "img", jpeg: "img", gif: "img", svg: "img", ico: "img", webp: "img"
};
const FILE_TAGS = { js: "JS", ts: "TS", json: "{}", md: "M↓", css: "#", html: "<>", py: "PY", img: "▣", default: "•" };
const FOLDER_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const FOLDER_OPEN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1H7.5a2 2 0 0 0-1.9 1.4L3 19z"/><path d="M7.2 12h14.3l-2.6 6.6a2 2 0 0 1-1.9 1.4H4z"/></svg>';

function fileIcon(name, type, open = false) {
    const span = document.createElement("span");
    span.className = "ficon";
    if (type === "directory") {
        span.dataset.kind = "folder";
        span.innerHTML = open ? FOLDER_OPEN_SVG : FOLDER_SVG;
        return span;
    }
    const base = String(name || "").split("/").pop();
    const ext = base.includes(".") ? base.split(".").pop().toLowerCase() : "";
    const kind = FILE_KINDS[ext] || "default";
    span.dataset.kind = kind;
    span.textContent = FILE_TAGS[kind];
    return span;
}

async function renderDir(container, rel, depth) {
    let entries;
    try {
        entries = await api.listDir(rel);
    } catch (err) {
        const div = document.createElement("div");
        div.className = "empty";
        div.textContent = err.message;
        container.appendChild(div);
        return;
    }

    for (const e of entries) {
        if (e.type !== "directory" && /\.tmp$/i.test(e.name)) continue;
        const node = document.createElement("div");
        const open = expanded.has(e.path);
        const modified = e.type !== "directory" && ui.changes.has(e.path);
        node.className = "node" + (e.path === ui.active ? " selected" : "") + (modified ? " agent-modified" : "");
        node.style.paddingLeft = `${6 + depth * 12}px`;
        node.dataset.path = e.path;
        node.title = e.path;

        const twisty = document.createElement("span");
        twisty.className = "twisty";
        twisty.textContent = e.type === "directory" ? (open ? "▾" : "▸") : "";
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = e.name;
        node.append(twisty, fileIcon(e.name, e.type, open), label);
        if (modified) {
            const mark = document.createElement("span");
            mark.className = "mod-mark";
            mark.textContent = "M";
            mark.title = "Modifié par l'agent";
            node.appendChild(mark);
        }
        container.appendChild(node);

        node.oncontextmenu = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            showContextMenu(ev, e);
        };

        if (e.type === "directory") {
            node.onclick = () => {
                if (open) expanded.delete(e.path);
                else expanded.add(e.path);
                renderTree();
            };
            if (open) await renderDir(container, e.path, depth + 1);
        } else {
            node.onclick = () => openFile(e.path);
        }
    }
}

async function openProject() {
    if (ui.tabs.some((t) => t.dirty) && !window.confirm("Des fichiers ne sont pas enregistrés. Changer de projet quand même ?")) return;
    try {
        const ws = await api.openProject();
        if (ws && ws !== ui.workspace) {
            ui.workspace = ws;
            onWorkspaceChanged();
        }
    } catch (err) {
        renderEntry({ type: "error", text: err.message });
    }
}

function onWorkspaceChanged() {
    expanded.clear();
    ui.tabs = [];
    ui.active = null;
    activate(null);
    clearChanges();
    renderTree();
}

