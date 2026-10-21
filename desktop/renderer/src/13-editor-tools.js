/* ---------- Éditeur : curseur, aller à la ligne, indentation ---------- */

const cursorInfo = document.createElement("span");
cursorInfo.id = "st-cursor";
$("st-busy").parentNode.insertBefore(cursorInfo, $("st-busy"));

function updateCursor() {
    const tab = currentTab();
    if (!tab) {
        cursorInfo.textContent = "";
        return;
    }
    const before = code.value.slice(0, code.selectionStart);
    const line = before.split("\n").length;
    const col = code.selectionStart - before.lastIndexOf("\n");
    const selected = Math.abs(code.selectionEnd - code.selectionStart);
    const eol = tab.eol === "\r\n" ? "CRLF" : "LF";
    cursorInfo.textContent = `Ln ${line}, Col ${col}${selected ? ` (${selected} sél.)` : ""} · ${eol}`;
}

for (const name of ["keyup", "click", "input", "focus", "select"]) code.addEventListener(name, updateCursor);

function goToLine(n) {
    if (!currentTab()) return;
    const lines = code.value.split("\n");
    const target = Math.max(1, Math.min(lines.length, Number(n) || 1));
    let pos = 0;
    for (let i = 0; i < target - 1; i++) pos += lines[i].length + 1;
    code.focus();
    /* setSelectionRange fait défiler CodeMirror pour centrer la ligne visée. */
    code.setSelectionRange(pos, pos + lines[target - 1].length);
    updateCursor();
}

/* L'auto-indentation à la touche Entrée est assurée par CodeMirror (basicSetup). */

/* ---------- Palette (Ctrl+P / Ctrl+Maj+P) ---------- */

const palette = { items: [], index: 0, files: null };

function closePalette() {
    $("palette").classList.add("hidden");
}

async function openPalette(mode) {
    hideContextMenu();
    const field = $("palette-input");
    $("palette").classList.remove("hidden");
    field.value = mode === "commands" ? ">" : mode === "line" ? ":" : "";
    field.placeholder = "Fichier par nom · > commandes · : numéro de ligne";
    field.focus();
    palette.files = null;
    updatePalette();
    if (!ui.workspace) return;
    try {
        const res = await api.listAllFiles();
        const list = Array.isArray(res) ? res : (res && res.files) || [];
        palette.files = list.map((f) => (typeof f === "string" ? f : f.path)).filter(Boolean);
    } catch {
        palette.files = [];
    }
    if (!$("palette").classList.contains("hidden")) updatePalette();
}

function fuzzyScore(text, query) {
    if (!query) return 1;
    const t = text.toLowerCase();
    const q = query.toLowerCase();
    const idx = t.indexOf(q);
    if (idx >= 0) {
        const base = t.lastIndexOf("/") + 1;
        return 1000 + (idx >= base ? 500 : 0) - idx - t.length / 100;
    }
    let score = 0;
    let pos = 0;
    let last = -2;
    for (const ch of q) {
        const found = t.indexOf(ch, pos);
        if (found < 0) return 0;
        score += found === last + 1 ? 5 : 1;
        last = found;
        pos = found + 1;
    }
    return Math.max(0.01, score - t.length / 100);
}

function paletteCommands() {
    const cmds = [
        ["Ouvrir un dossier…", "Ctrl+O", openProject],
        ["Enregistrer le fichier", "Ctrl+S", saveCurrent],
        ["Fermer l'onglet", "Ctrl+W", () => ui.active && closeTab(ui.active)],
        ["Nouveau fichier…", "Ctrl+N", () => newEntry("file", ".")],
        ["Nouveau dossier…", "", () => newEntry("directory", ".")],
        ["Aller au fichier…", "Ctrl+P", () => openPalette("files")],
        ["Aller à la ligne…", "Ctrl+G", askGoToLine],
        ["Rechercher dans le projet", "Ctrl+Maj+F", focusSearch],
        ["Afficher l'explorateur", "Ctrl+Maj+E", () => showSideView("explorer")],
        ["Afficher/masquer le panneau du bas", "Ctrl+J", () => togglePanel()],
        ["Ouvrir le terminal", "Ctrl+²", () => selectPanel("terminal", true)],
        ["Afficher la sortie de l'agent", "", () => selectPanel("output")],
        ["Replier l'arborescence", "", () => { expanded.clear(); renderTree(); }],
        ["Actualiser l'arborescence", "", () => renderTree()],
        ["Changer de modèle…", "/model", () => openModelMenu()],
        ["Afficher les modifications", "", () => selectPanel("changes")],
        ["Interrompre l'agent", "Échap", () => api.interrupt().catch(() => {})],
        ["Aller à la saisie de l'agent", "Ctrl+L", () => input.focus()],
        ["Aller à la définition", "F12", () => lspGoToDefinition()],
        ["Rechercher les références", "Maj+F12", () => lspFindReferences()],
        ["Renommer le symbole", "F2", () => lspRenameSymbol()],
        ["Afficher l'aide à la signature", "Ctrl+Maj+Espace", () => lspShowSignature(code.view, true)],
        ["Actions de code / corrections rapides", "Ctrl+.", () => lspShowCodeActions()],
        ["Formater le document", "Maj+Alt+F", () => lspFormatDocument()],
        ["Modifier la sélection avec l'IA…", "Ctrl+K", () => inlineEditStart()]
    ].map(([label, detail, run]) => ({ label, detail, run }));
    for (const [cmd, desc] of SLASH_COMMANDS) {
        cmds.push({
            label: `Agent : ${desc}`,
            detail: cmd,
            run: () => {
                input.value = `${cmd} `;
                input.focus();
            }
        });
    }
    return cmds;
}

function askGoToLine() {
    if (!currentTab()) return;
    openPalette("line");
}

function updatePalette() {
    const raw = $("palette-input").value;
    let items = [];
    if (raw.startsWith(">")) {
        const q = raw.slice(1).trim();
        items = paletteCommands()
            .map((c) => ({ ...c, score: fuzzyScore(`${c.label} ${c.detail}`, q) }))
            .filter((c) => c.score > 0);
        if (q) items.sort((a, b) => b.score - a.score);
    } else if (raw.startsWith(":")) {
        const tab = currentTab();
        const n = parseInt(raw.slice(1), 10);
        if (tab) {
            const total = code.value.split("\n").length;
            items = [{
                label: Number.isFinite(n) ? `Aller à la ligne ${n}` : `Saisir un numéro de ligne (1 à ${total})`,
                detail: tab.path,
                run: Number.isFinite(n) ? () => goToLine(n) : null
            }];
        }
    } else if (ui.workspace) {
        const q = raw.trim();
        if (palette.files === null) {
            items = [{ label: "Chargement des fichiers…", detail: "", run: null }];
        } else {
            items = palette.files
                .map((p) => ({ p, score: fuzzyScore(p, q) }))
                .filter((x) => x.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 200)
                .map(({ p }) => ({ label: p.split("/").pop(), detail: p, run: () => openFile(p) }));
        }
    }
    palette.items = items;
    palette.index = 0;
    renderPaletteList();
}

function renderPaletteList() {
    const list = $("palette-list");
    list.innerHTML = "";
    if (!palette.items.length) {
        const empty = document.createElement("div");
        empty.className = "palette-empty";
        empty.textContent = ui.workspace || $("palette-input").value.startsWith(">") ? "Aucun résultat." : "Aucun projet ouvert (tapez > pour les commandes).";
        list.appendChild(empty);
        return;
    }
    palette.items.forEach((item, i) => {
        const el = document.createElement("div");
        el.className = "palette-item" + (i === palette.index ? " active" : "");
        const label = document.createElement("span");
        label.textContent = item.label;
        const detail = document.createElement("span");
        detail.className = "detail";
        detail.textContent = item.detail || "";
        el.append(label, detail);
        el.onmousedown = (ev) => {
            ev.preventDefault();
            palette.index = i;
            runPaletteItem();
        };
        list.appendChild(el);
    });
    const active = list.children[palette.index];
    if (active) active.scrollIntoView({ block: "nearest" });
}

function runPaletteItem() {
    const item = palette.items[palette.index];
    if (!item || !item.run) return;
    closePalette();
    Promise.resolve()
        .then(() => item.run())
        .catch((err) => renderEntry({ type: "error", text: err.message }));
}

$("palette-input").addEventListener("input", updatePalette);
$("palette-input").addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const n = palette.items.length;
        if (!n) return;
        palette.index = (palette.index + (ev.key === "ArrowDown" ? 1 : -1) + n) % n;
        renderPaletteList();
    } else if (ev.key === "Enter") {
        ev.preventDefault();
        runPaletteItem();
    } else if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closePalette();
    }
});

