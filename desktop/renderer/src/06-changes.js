/* ---------- Modifications de l'agent ---------- */

function recordChange(path, added, removed) {
    if (!path) return;
    const previous = ui.changes.get(path) || { added: 0, removed: 0 };
    if (!ui.changes.has(path)) ui.changesOrder.push(path);
    ui.changes.set(path, {
        added: previous.added + (added || 0),
        removed: previous.removed + (removed || 0)
    });
    updateChangesBadge();
    if (ui.panel === "changes") renderChangesList();
    markTreeNode(path);
    scheduleGitRefresh();
}

function markTreeNode(path) {
    let node = null;
    document.querySelectorAll("#tree .node").forEach((n) => { if (n.dataset.path === path) node = n; });
    if (!node || node.classList.contains("agent-modified")) return;
    node.classList.add("agent-modified");
    const mark = document.createElement("span");
    mark.className = "mod-mark";
    mark.textContent = "M";
    mark.title = "Modifié par l'agent";
    node.appendChild(mark);
}

function updateChangesBadge() {
    const badge = $("changes-count");
    if (!badge) return;
    badge.textContent = ui.changes.size ? String(ui.changes.size) : "";
    badge.classList.toggle("hidden", !ui.changes.size);
}

function clearChanges() {
    ui.changes.clear();
    ui.changesOrder = [];
    updateChangesBadge();
    renderChangesList();
}

/* ---------- Annulation par modification (pile du journal, via IPC) ---------- */

let undoRefreshSeq = 0;

async function renderUndoList(note) {
    const section = $("undo-section");
    const list = $("undo-list");
    if (!section || !list || !api.undoList) return;
    const seq = ++undoRefreshSeq;
    let entries;
    try {
        entries = await api.undoList();
    } catch {
        entries = [];
    }
    if (seq !== undoRefreshSeq) return;
    list.innerHTML = "";
    if (note) {
        const msg = document.createElement("div");
        msg.className = "undo-note";
        msg.textContent = note;
        list.appendChild(msg);
    }
    if (!ui.acceptedUndo) ui.acceptedUndo = new Set();
    entries = entries.filter((entry) => !ui.acceptedUndo.has(undoKey(entry)));
    section.classList.toggle("hidden", !entries.length && !note);
    for (const entry of entries) {
        renderUndoRow(list, entry);
    }
}

/** Clé stable d'une entrée de la pile (l'index change quand on en annule une). */
function undoKey(entry) {
    return `${entry.at || ""}|${entry.kind}|${(entry.paths || []).join("|")}`;
}

/** Diff ligne à ligne simple (LCS) avec 3 lignes de contexte autour du bloc modifié. */
function undoLineDiff(before, after, context = 3) {
    const a = String(before).split("\n");
    const b = String(after).split("\n");
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }
    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);
    const ops = [];
    for (let i = Math.max(0, start - context); i < start; i++) ops.push({ t: " ", s: a[i] });
    const n = midA.length;
    const m = midB.length;
    if (n && m && (n + 1) * (m + 1) <= 2000000) {
        const w = m + 1;
        const dp = new Uint32Array((n + 1) * w);
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                dp[i * w + j] = midA[i] === midB[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
            }
        }
        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            if (midA[i] === midB[j]) {
                ops.push({ t: " ", s: midA[i] });
                i++;
                j++;
            } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
                ops.push({ t: "-", s: midA[i++] });
            } else {
                ops.push({ t: "+", s: midB[j++] });
            }
        }
        while (i < n) ops.push({ t: "-", s: midA[i++] });
        while (j < m) ops.push({ t: "+", s: midB[j++] });
    } else {
        for (const s of midA) ops.push({ t: "-", s });
        for (const s of midB) ops.push({ t: "+", s });
    }
    for (let i = endA; i < Math.min(a.length, endA + context); i++) ops.push({ t: " ", s: a[i] });
    return ops;
}

/** Blocs (hunks) : suites consécutives de lignes ajoutées/supprimées, {start, end} (end exclu) dans ops. */
function undoHunks(ops) {
    const hunks = [];
    let current = null;
    ops.forEach((op, i) => {
        if (op.t === " ") {
            current = null;
            return;
        }
        if (!current) {
            current = { start: i, end: i + 1 };
            hunks.push(current);
        } else {
            current.end = i + 1;
        }
    });
    return hunks;
}

/**
 * Recompose le fichier à partir d'un diff complet (contexte infini) : les blocs dont
 * l'index est dans `rejected` reprennent leurs lignes d'origine, les autres gardent les nouvelles.
 */
function composeHunks(ops, rejected) {
    const hunks = undoHunks(ops);
    const owner = new Array(ops.length).fill(-1);
    hunks.forEach((hunk, h) => {
        for (let i = hunk.start; i < hunk.end; i++) owner[i] = h;
    });
    const lines = [];
    ops.forEach((op, i) => {
        if (op.t === " ") lines.push(op.s);
        else if (rejected.has(owner[i]) ? op.t === "-" : op.t === "+") lines.push(op.s);
    });
    return lines.join("\n");
}

async function toggleUndoDiff(row, entry, btn) {
    const existing = row.nextElementSibling;
    if (existing && existing.classList.contains("undo-diff")) {
        existing.remove();
        btn.classList.remove("active");
        return;
    }
    const box = document.createElement("pre");
    box.className = "undo-diff";
    box.textContent = "Chargement du diff…";
    row.after(box);
    btn.classList.add("active");
    try {
        const diff = await api.undoDiff(entry.index, entry.at);
        box.textContent = "";
        if (diff.kind === "move") {
            box.textContent = `Déplacement ${diff.rel} : contenu inchangé.`;
            return;
        }
        if (diff.before === null || diff.after === null) {
            box.textContent = diff.before === null
                ? "Contenu d'origine indisponible (sauvegarde absente ou fichier binaire)."
                : "Le fichier n'existe plus sur le disque.";
            return;
        }
        if (diff.before === diff.after) {
            box.textContent = "Aucune différence avec l'état actuel du fichier.";
            return;
        }
        const ops = undoLineDiff(diff.before, diff.after, Infinity);
        const hunks = undoHunks(ops);
        let added = 0;
        let removed = 0;
        for (const op of ops) {
            if (op.t === "+") added++;
            if (op.t === "-") removed++;
        }
        const head = document.createElement("span");
        head.className = "diff-line head";
        head.textContent = `${diff.rel} · +${added} -${removed} · ${hunks.length} bloc(s)\n`;
        box.appendChild(head);
        const tooBig = (s) => String(s).startsWith("(fichier trop volumineux");
        const canSplit = Boolean(api.undoApplyContent) && hunks.length > 1 &&
            ["create", "copy", "write", "edit"].includes(entry.kind) && !tooBig(diff.before) && !tooBig(diff.after);
        let shown = 0;
        hunks.forEach((hunk, h) => {
            const bar = document.createElement("span");
            bar.className = "diff-line hunk-head";
            bar.textContent = `@@ bloc ${h + 1}/${hunks.length} `;
            if (canSplit) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "undo-btn reject hunk-reject";
                btn.textContent = "Rejeter ce bloc";
                btn.title = "Remettre ce bloc à l'état d'origine et garder les autres";
                btn.onclick = async () => {
                    box.querySelectorAll(".hunk-reject").forEach((b) => { b.disabled = true; });
                    let message;
                    try {
                        message = await api.undoApplyContent(entry.index, entry.at, composeHunks(ops, new Set([h])), diff.after);
                    } catch (error) {
                        message = error && error.message ? error.message : String(error);
                    }
                    scheduleGitRefresh();
                    renderUndoList(message);
                };
                bar.appendChild(btn);
            }
            bar.appendChild(document.createTextNode("\n"));
            box.appendChild(bar);
            const from = Math.max(shown, hunk.start - 3);
            const to = Math.min(ops.length, hunk.end + 3);
            for (let i = from; i < to; i++) {
                const op = ops[i];
                const line = document.createElement("span");
                line.className = op.t === "+" ? "diff-line add" : op.t === "-" ? "diff-line del" : "diff-line";
                line.textContent = `${op.t} ${op.s}\n`;
                box.appendChild(line);
            }
            shown = Math.max(shown, to);
        });
    } catch (error) {
        box.textContent = error && error.message ? error.message : String(error);
    }
}

function renderUndoRow(list, entry) {
    const row = document.createElement("div");
    row.className = "undo-row";
    const label = document.createElement("span");
    label.className = "change-path";
    label.textContent = entry.label;
    label.title = entry.at ? `${entry.label} · ${new Date(entry.at).toLocaleString()}` : entry.label;
    const target = entry.paths && entry.paths.length ? entry.paths[entry.paths.length - 1] : null;
    if (target && entry.kind !== "delete" && entry.kind !== "mkdir") {
        label.classList.add("clickable");
        label.onclick = () => openFile(target);
    }
    row.appendChild(label);
    const when = document.createElement("span");
    when.className = "undo-when";
    when.textContent = entry.at ? new Date(entry.at).toLocaleTimeString() : "";
    row.appendChild(when);

    const makeBtn = (text, title, cls) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = cls;
        b.textContent = text;
        b.title = title;
        return b;
    };

    const diffBtn = makeBtn("Diff", "Afficher les différences avant / après", "undo-btn");
    if (entry.kind === "mkdir") diffBtn.disabled = true;
    diffBtn.onclick = () => toggleUndoDiff(row, entry, diffBtn);

    const acceptBtn = makeBtn("Accepter", "Garder cette modification et la retirer de la liste", "undo-btn accept");
    acceptBtn.onclick = () => {
        // Masque seulement la ligne : l'entrée reste dans le journal (/undo reste possible).
        ui.acceptedUndo.add(undoKey(entry));
        const next = row.nextElementSibling;
        if (next && next.classList.contains("undo-diff")) next.remove();
        row.remove();
        if (!list.querySelector(".undo-row")) renderUndoList();
    };

    const rejectBtn = makeBtn("Rejeter", "Annuler cette modification (restaure l'état précédent)", "undo-btn reject");
    rejectBtn.onclick = async () => {
        rejectBtn.disabled = true;
        acceptBtn.disabled = true;
        let message;
        try {
            message = await api.undoEntry(entry.index, entry.at);
        } catch (error) {
            message = error && error.message ? error.message : String(error);
        }
        scheduleGitRefresh();
        renderUndoList(message);
    };

    const actions = document.createElement("span");
    actions.className = "undo-actions";
    actions.append(diffBtn, acceptBtn, rejectBtn);
    row.appendChild(actions);
    list.appendChild(row);
}

function renderChangesList() {
    const list = $("changes-list");
    const summary = $("changes-summary");
    if (!list) return;
    renderUndoList();
    list.innerHTML = "";

    if (!ui.changes.size) {
        summary.textContent = "Aucune modification par l'agent pour l'instant.";
        const empty = document.createElement("div");
        empty.className = "changes-empty";
        empty.textContent = "Les fichiers écrits ou édités par l'agent apparaîtront ici. Cliquez sur un fichier pour l'ouvrir.";
        list.appendChild(empty);
        return;
    }

    let totalAdd = 0;
    let totalDel = 0;
    for (const value of ui.changes.values()) {
        totalAdd += value.added;
        totalDel += value.removed;
    }
    summary.textContent = `${ui.changes.size} fichier(s) modifié(s) · +${totalAdd} -${totalDel}`;

    for (const path of ui.changesOrder) {
        if (!ui.changes.has(path)) continue;
        const value = ui.changes.get(path);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "change-row";
        row.title = path;
        row.appendChild(fileIcon(path, "file"));
        const p = document.createElement("span");
        p.className = "change-path";
        p.textContent = path;
        row.appendChild(p);
        const stats = document.createElement("span");
        stats.className = "diff-stats";
        stats.innerHTML = `<b class="add">+${value.added}</b><b class="del">-${value.removed}</b>`;
        row.appendChild(stats);
        row.onclick = () => openFile(path);
        list.appendChild(row);
    }
}

