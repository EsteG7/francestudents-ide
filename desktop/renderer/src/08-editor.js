/* ---------- Éditeur ---------- */

function currentTab() {
    return ui.tabs.find((t) => t.path === ui.active) || null;
}

/* La numérotation des lignes est désormais gérée par CodeMirror (basicSetup). */
function updateGutter() {}

function normalize(content) {
    return content.split("\r\n").join("\n");
}

async function openFile(rel) {
    let tab = ui.tabs.find((t) => t.path === rel);
    if (!tab) {
        try {
            if(/\.(png|jpe?g|gif|webp|bmp|ico|mp3|wav|ogg|m4a|mp4|webm|mov|pdf|docx?|xlsx?|pptx?|zip|gz|7z|rar)$/i.test(rel)) {
                tab={path:rel,content:"",saved:"",dirty:false,kind:"asset",asset:await api.inspectFile(rel),eol:"\n",scroll:0};
            }else{
            const file = await api.readFile(rel);
            const text = normalize(file.content);
            tab = { path: rel, content: text, saved: text, encoding:file.encoding||"utf8",bom:file.bom===true,eol: file.content.includes("\r\n") ? "\r\n" : "\n", dirty: false, scroll: 0 };
            }
            ui.tabs.push(tab);
        } catch (err) {
            try {tab={path:rel,content:"",saved:"",dirty:false,kind:"asset",asset:await api.inspectFile(rel),eol:"\n",scroll:0};ui.tabs.push(tab);}
            catch {renderEntry({ type: "error", text: `${rel} : ${err.message}` });return;}
        }
    }
    if(["project","settings","extensions"].includes(ui.sideView))showSideView("explorer");
    activate(rel);
}

function activate(rel) {
    const previous = currentTab();
    if (previous) {
        previous.scroll = code.scrollTop;
        previous.cmState = code.getState();
    }

    ui.active = rel;
    const tab = currentTab();
    $("editor").classList.toggle("hidden", !tab);
    $("editor-welcome").classList.toggle("hidden", Boolean(tab));
    const welcomeSub = $("welcome-sub");
    if (welcomeSub) {
        welcomeSub.textContent = ui.workspace
            ? "Projet ouvert : choisis un fichier dans l'explorateur ou demande à l'agent dans le panneau de droite."
            : "Ouvre un dossier, puis discute avec l'agent dans le panneau de droite.";
    }
    code.load(tab ? tab.content : "", tab ? extKind(tab.path) : "default", tab && tab.cmState);
    showStudioAsset(tab);
    const scroll = tab ? tab.scroll : 0;
    code.scrollTop = scroll;
    /* CodeMirror mesure la mise en page de façon asynchrone : on réapplique le défilement à l'image suivante. */
    requestAnimationFrame(() => {
        if (currentTab() === tab) code.scrollTop = scroll;
    });
    $("st-file").textContent = tab ? tab.path : "";
    updateBreadcrumbs(tab);
    updateGutter();
    syncHighlight();
    renderTabs();
    document.querySelectorAll(".node").forEach((n) => n.classList.toggle("selected", n.dataset.path === rel));
    if (tab&&tab.kind!=="asset") code.focus();
    syncEditorContext();
    lspOnActivate();
    if(studioPreviewVisible)updateDocumentPreview();
}

/* Indique au processus principal quels fichiers sont ouverts (contexte de l'agent). */
let lastEditorContext = null;

/* Taille (caractères) des fichiers du contexte, pour l'estimation de tokens (≈ caractères / 4). */
const contextSizes = new Map();

function contextTokenEstimate(files) {
    let chars = 0;
    let known = 0;
    for (const f of files) {
        if (!contextSizes.has(f)) continue;
        chars += contextSizes.get(f);
        known++;
    }
    return { tokens: Math.ceil(chars / 4), known };
}

function formatTokens(n) {
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

function measureContextFiles(files) {
    const missing = files.filter((f) => !contextSizes.has(f));
    if (!missing.length) return;
    for (const f of missing) contextSizes.set(f, 0); // évite les lectures en double
    Promise.all(missing.map(async (f) => {
        try {
            const res = await api.readFile(f);
            const text = typeof res === "string" ? res : (res && (res.content ?? res.text ?? res.data)) || "";
            contextSizes.set(f, String(text).length);
        } catch {
            contextSizes.set(f, 0);
        }
    })).then(() => {
        lastEditorContext = null;
        syncEditorContext();
    });
}

function renderEditorContext(files, active) {
    const el = $("st-context");
    if (!el) return;
    el.classList.toggle("hidden", !files.length);
    if (!files.length) {
        el.textContent = "";
        el.title = "Contexte envoyé à l'agent";
        return;
    }
    const pinned = ui.pinnedFiles || [];
    const name = active ? active.split("/").pop() : pinned.length ? pinned[0].split("/").pop() : "aucun";
    const { tokens, known } = contextTokenEstimate(files);
    const estimate = known && tokens ? ` · ~${formatTokens(tokens)} tokens` : "";
    el.textContent = `Contexte : ${name}${files.length > 1 ? ` +${files.length - 1}` : ""}${estimate}`;
    el.title = [
        "Contexte envoyé à l'agent",
        `Fichier actif : ${active || "aucun"}`,
        pinned.length ? `Fichiers épinglés (@) :\n${pinned.map((f) => `• ${f}`).join("\n")}` : "",
        `Fichiers ouverts :\n${ui.tabs.map((t) => `• ${t.path}`).join("\n") || "• aucun"}`,
        known ? `Estimation : ~${tokens} tokens (caractères / 4)` : ""
    ].filter(Boolean).join("\n");
}

function syncEditorContext() {
    const pinned = ui.pinnedFiles || [];
    const files = [...new Set([...pinned, ...ui.tabs.map((t) => t.path)])];
    const active = ui.active || null;
    const { tokens } = contextTokenEstimate(files);
    const key = `${active}|${files.join(",")}|${tokens}`;
    if (key === lastEditorContext) return;
    lastEditorContext = key;
    renderEditorContext(files, active);
    api.setEditorContext(files, active).catch(() => {});
    measureContextFiles(files);
}

function updateBreadcrumbs(tab) {
    const bc = $("breadcrumbs");
    const name = tab ? tab.path.split("/").pop() : "";
    document.title = tab ? `${name} — FranceStudent Code` : "FranceStudent Code";
    const tbTitle = $("tb-title");
    if (tbTitle) tbTitle.textContent = document.title;
    if (!bc) return;
    bc.innerHTML = "";
    bc.classList.toggle("hidden", !tab);
    if (!tab) return;
    const parts = tab.path.split("/").filter((p) => p && p !== ".");
    parts.forEach((part, i) => {
        if (i > 0) {
            const sep = document.createElement("span");
            sep.className = "sep";
            sep.textContent = "›";
            bc.appendChild(sep);
        }
        const crumb = document.createElement("span");
        crumb.className = "crumb";
        if (i === parts.length - 1) crumb.appendChild(fileIcon(part, "file"));
        crumb.appendChild(document.createTextNode(part));
        bc.appendChild(crumb);
    });
}

function renderTabs() {
    const bar = $("tabs");
    bar.innerHTML = "";
    for (const t of ui.tabs) {
        const el = document.createElement("div");
        el.className = "tab" + (t.path === ui.active ? " active" : "") + (t.dirty ? " dirty" : "");
        el.title = t.path;
        const label = document.createElement("span");
        label.textContent = t.path.split("/").pop();
        const close = document.createElement("span");
        close.className = t.dirty ? "close dirty" : "close";
        close.textContent = t.dirty ? "●" : "×";
        close.onclick = (ev) => {
            ev.stopPropagation();
            closeTab(t.path);
        };
        el.onclick = () => activate(t.path);
        el.append(fileIcon(t.path, "file"), label, close);
        bar.appendChild(el);
    }
}

function closeTab(rel) {
    const tab = ui.tabs.find((t) => t.path === rel);
    if (!tab) return;
    if (tab.dirty && !window.confirm(`${rel} n'est pas enregistré. Fermer quand même ?`)) return;
    const index = ui.tabs.indexOf(tab);
    ui.tabs.splice(index, 1);
    lspOnClose(rel);
    if (ui.active === rel) {
        const next = ui.tabs[index] || ui.tabs[index - 1];
        ui.active = null;
        activate(next ? next.path : null);
    } else {
        renderTabs();
    }
}

async function saveCurrent() {
    const tab = currentTab();
    if (!tab||tab.kind==="asset") return;
    if(studioEditorPreferences.formatOnSave&&currentTab()===tab)await formatEditorDocument();
    const snapshot=tab.content;
    const content = tab.eol === "\r\n" ? snapshot.split("\n").join("\r\n") : snapshot;
    try {
        await api.writeFile(tab.path, content,{encoding:tab.encoding||"utf8",bom:tab.bom===true});
        tab.saved = snapshot;
        tab.dirty = tab.content!==snapshot;
        renderTabs();
        $("st-file").textContent = `${tab.path} (enregistré)`;
        scheduleGitRefresh();
        if(studioPreviewVisible)updateDocumentPreview();
    } catch (err) {
        renderEntry({ type: "error", text: `Enregistrement impossible : ${err.message}` });
    }
}

let refreshTimer = null;

/** Après une modification par l'agent : arbre et onglets non modifiés rechargés. */
function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
        if (!ui.workspace) return;
        await renderTree();
        for (const tab of ui.tabs) {
            if (tab.dirty) continue;
            try {
                const file = await api.readFile(tab.path);
                const text = normalize(file.content);
                if (text === tab.saved) continue;
                tab.content = text;
                tab.saved = text;
                if (tab.path === ui.active) {
                    const scroll = code.scrollTop;
                    code.value = text;
                    lspScheduleSync();
                    code.scrollTop = scroll;
                    updateGutter();
                    syncHighlight();
                }
            } catch {
                // fichier supprimé ou illisible : onglet laissé tel quel
            }
        }
    }, 400);
}

code.addEventListener("scroll", () => {
    syncHighlightScroll();
});

code.addEventListener("input", () => {
    const tab = currentTab();
    if(tab?.kind==="asset")return;
    if (tab) {
        tab.content = code.value;
        const dirty = tab.content !== tab.saved;
        if (dirty !== tab.dirty) {
            tab.dirty = dirty;
            renderTabs();
        }
    }
    updateGutter();
    scheduleHighlight();
});

