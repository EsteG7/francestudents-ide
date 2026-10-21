"use strict";

/*
 * Modification IA de la sélection (style Cmd+K) : Ctrl/Cmd+K ouvre une consigne, l'IA réécrit la
 * sélection (ou la ligne courante si rien n'est sélectionné), puis un diff permet d'accepter ou de rejeter.
 * inlineEditExtension est appelée par createCodeEditor (00-base) avant l'exécution de ce module :
 * elle ne doit donc utiliser aucune constante de haut niveau de ce fichier.
 */

function inlineEditExtension() {
    const CM = window.CM;
    if (!CM || !CM.keymap || !CM.Prec) return [];
    return CM.Prec.highest(CM.keymap.of([
        {
            key: "Mod-k",
            run: () => {
                inlineEditStart().catch((err) => renderEntry({ type: "error", text: `Modification IA : ${err.message}` }));
                return true;
            }
        }
    ]));
}

function inlineEditRange(view) {
    const sel = view.state.selection.main;
    if (!sel.empty) return { from: sel.from, to: sel.to };
    const line = view.state.doc.lineAt(sel.head);
    return { from: line.from, to: line.to };
}

/** Modale de diff : renvoie true (accepter) ou false (rejeter). */
function inlineEditReview(title, before, after) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        const box = document.createElement("div");
        box.className = "modal";
        box.style.width = "900px";
        box.style.maxWidth = "90vw";
        const heading = document.createElement("div");
        heading.className = "modal-title";
        heading.textContent = title;
        const diff = document.createElement("div");
        diff.className = "inline-edit-diff";
        diff.style.maxHeight = "60vh";
        diff.style.overflow = "auto";
        diff.style.fontFamily = "var(--mono, monospace)";
        diff.style.fontSize = "12px";
        diff.style.whiteSpace = "pre";
        for (const op of undoLineDiff(before, after, 1000000)) {
            const row = document.createElement("div");
            row.className = "diff-line" + (op.t === "+" ? " add" : op.t === "-" ? " del" : "");
            if (op.t === "+") row.style.background = "rgba(46, 160, 67, 0.25)";
            if (op.t === "-") row.style.background = "rgba(248, 81, 73, 0.25)";
            row.textContent = `${op.t} ${op.s}`;
            diff.appendChild(row);
        }
        const buttons = document.createElement("div");
        buttons.className = "buttons";
        const accept = document.createElement("button");
        accept.type = "button";
        accept.className = "primary undo-btn accept";
        accept.textContent = "Accepter";
        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "undo-btn reject";
        reject.textContent = "Rejeter";
        buttons.append(accept, reject);
        box.append(heading, diff, buttons);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        const close = (result) => {
            overlay.remove();
            resolve(result);
        };
        accept.onclick = () => close(true);
        reject.onclick = () => close(false);
        overlay.addEventListener("mousedown", (ev) => {
            if (ev.target === overlay) close(false);
        });
        overlay.addEventListener("keydown", (ev) => {
            if (ev.key === "Escape") {
                ev.preventDefault();
                ev.stopPropagation();
                close(false);
            } else if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
                ev.preventDefault();
                close(true);
            }
        });
        setTimeout(() => accept.focus(), 0);
    });
}

async function inlineEditStart() {
    const tab = currentTab();
    const view = code.view;
    if (!tab || !view) {
        renderEntry({ type: "warn", text: "Modification IA : ouvre d'abord un fichier." });
        return;
    }
    if (!api.inlineEdit) {
        renderEntry({ type: "warn", text: "Modification IA indisponible dans cette version." });
        return;
    }
    const { from, to } = inlineEditRange(view);
    const doc = view.state.doc;
    const selection = doc.sliceString(from, to);
    const instruction = await inputDialog(
        selection.trim() ? "Modifier la sélection avec l'IA : consigne" : "Générer du code ici avec l'IA : consigne"
    );
    if (!instruction) return;
    const rel = tab.path;
    $("st-file").textContent = `${rel} — modification IA en cours…`;
    let result;
    try {
        result = await api.inlineEdit({
            path: rel,
            language: extKind(rel),
            instruction,
            selection,
            prefix: doc.sliceString(Math.max(0, from - 3000), from),
            suffix: doc.sliceString(to, Math.min(doc.length, to + 1500))
        });
    } catch (err) {
        $("st-file").textContent = rel;
        renderEntry({ type: "error", text: `Modification IA : ${err.message}` });
        return;
    }
    $("st-file").textContent = rel;
    const replacement = String(result ?? "");
    if (replacement === selection) {
        renderEntry({ type: "warn", text: "Modification IA : aucune modification proposée." });
        return;
    }
    const accepted = await inlineEditReview(`Modification IA — ${rel}`, selection, replacement);
    if (!accepted) return;
    if (currentTab() !== tab || code.view !== view || view.state.doc.sliceString(from, to) !== selection) {
        renderEntry({ type: "warn", text: "Modification IA annulée : le fichier a changé entre-temps." });
        return;
    }
    view.dispatch({
        changes: { from, to, insert: replacement },
        selection: { anchor: from, head: from + replacement.length },
        userEvent: "input.ai"
    });
    code.focus();
}
