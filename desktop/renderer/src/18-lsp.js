"use strict";

/* LSP (typescript-language-server) : complétion, survol et diagnostics pour les fichiers JS/TS de l'éditeur. */

const LSP_FILE_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const lspDiagnosticsByPath = new Map();
let lspSyncTimer = null;
let lspWarned = false;

function lspEnabledFor(rel) {
    return Boolean(rel) && LSP_FILE_RE.test(String(rel)) && Boolean(api && api.lspSync);
}

function lspActivePath() {
    const tab = currentTab();
    return tab ? (tab.path || tab.rel || "") : "";
}

function lspWarn(err) {
    if (lspWarned) return;
    lspWarned = true;
    const detail = err && err.message ? err.message : String(err || "erreur inconnue");
    renderEntry({ type: "warn", text: `LSP indisponible : ${detail}` });
}

function lspCompletionOptions(result) {
    const items = Array.isArray(result) ? result : (result && Array.isArray(result.items) ? result.items : []);
    return items.slice(0, 300).map((item) => ({
        label: item.label,
        type: item.type || undefined,
        detail: item.detail || undefined,
        info: item.documentation || undefined,
        boost: 0,
        apply: item.insertText && item.insertText !== item.label ? item.insertText : undefined
    }));
}

function lspHoverString(result) {
    if (!result) return "";
    const raw = typeof result === "string" ? result : String(result.text || result.contents || "");
    /* Le serveur renvoie du Markdown : on retire les lignes de clôture ``` pour un affichage texte brut. */
    return raw.replace(/^```[\w-]*$\n?/gm, "");
}

function lspExtension(kind) {
    if (kind !== "js" && kind !== "ts") return [];
    const CM = window.CM;
    if (!CM || !CM.hoverTooltip || !CM.lintGutter || !CM.EditorState) return [];
    const source = async (context) => {
        const rel = lspActivePath();
        if (!lspEnabledFor(rel) || !api.lspCompletion) return null;
        const word = context.matchBefore(/[\w$]*/);
        const before = context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos);
        if (!context.explicit && (!word || word.from === word.to) && before !== ".") return null;
        const line = context.state.doc.lineAt(context.pos);
        let result;
        try {
            result = await api.lspCompletion(rel, context.state.doc.toString(), line.number - 1, context.pos - line.from);
        } catch (err) {
            lspWarn(err);
            return null;
        }
        if (context.aborted) return null;
        const options = lspCompletionOptions(result);
        if (!options.length) return null;
        return { from: word ? word.from : context.pos, options, validFor: /^[\w$]*$/ };
    };
    const hover = CM.hoverTooltip(async (view, pos) => {
        const rel = lspActivePath();
        if (!lspEnabledFor(rel) || !api.lspHover) return null;
        const line = view.state.doc.lineAt(pos);
        const result = await api.lspHover(rel, view.state.doc.toString(), line.number - 1, pos - line.from).catch(() => null);
        const text = lspHoverString(result).trim();
        if (!text) return null;
        return {
            pos,
            above: true,
            create() {
                const dom = document.createElement("div");
                dom.className = "cm-lsp-hover";
                dom.style.whiteSpace = "pre-wrap";
                dom.style.maxWidth = "560px";
                dom.style.padding = "4px 8px";
                dom.style.fontFamily = "var(--mono, monospace)";
                dom.textContent = text;
                return { dom };
            }
        };
    });
    return [
        CM.EditorState.languageData.of(() => [{ autocomplete: source }]),
        hover,
        CM.lintGutter(),
        lspEditingExtension()
    ];
}

function lspApplyDiagnostics(diagnostics) {
    const CM = window.CM;
    if (!CM || !CM.setDiagnostics || !code.view) return;
    const view = code.view;
    const doc = view.state.doc;
    const toPos = (p) => {
        const lineNo = Math.max(1, Math.min(doc.lines, (Number(p && p.line) || 0) + 1));
        const line = doc.line(lineNo);
        return Math.min(line.to, line.from + Math.max(0, Number(p && p.character) || 0));
    };
    const list = (Array.isArray(diagnostics) ? diagnostics : []).map((d) => {
        const from = toPos(d.from);
        const to = Math.max(from, toPos(d.to || d.from));
        const severity = d.severity === "error" || d.severity === "warning" ? d.severity : "info";
        const origin = [d.source, d.code].filter((x) => x !== undefined && x !== null && x !== "").join(" ");
        return { from, to, severity, message: String(d.message || ""), source: origin || undefined };
    });
    try {
        view.dispatch(CM.setDiagnostics(view.state, list));
    } catch (err) {
        lspWarn(err);
    }
}

function lspSyncActive() {
    const tab = currentTab();
    const rel = lspActivePath();
    if (!tab || !lspEnabledFor(rel)) return;
    const text = typeof tab.content === "string" ? tab.content : code.value;
    Promise.resolve(api.lspSync(rel, text)).catch(lspWarn);
}

function lspScheduleSync() {
    if (!lspEnabledFor(lspActivePath())) return;
    clearTimeout(lspSyncTimer);
    lspSyncTimer = setTimeout(lspSyncActive, 400);
}

function lspOnActivate() {
    const rel = lspActivePath();
    if (!lspEnabledFor(rel)) return;
    lspSyncActive();
    lspApplyDiagnostics(lspDiagnosticsByPath.get(rel) || []);
}

function lspOnClose(rel) {
    if (!rel) return;
    lspDiagnosticsByPath.delete(rel);
    if (lspEnabledFor(rel) && api.lspClose) Promise.resolve(api.lspClose(rel)).catch(() => {});
}

/* ---------- Navigation, renommage, signature, actions de code, formatage ---------- */

function lspOffset(doc, p) {
    const lineNo = Math.max(1, Math.min(doc.lines, (Number(p && p.line) || 0) + 1));
    const line = doc.line(lineNo);
    return Math.min(line.to, line.from + Math.max(0, Number(p && p.character) || 0));
}

function lspCursor() {
    const rel = lspActivePath();
    if (!lspEnabledFor(rel) || !code.view) return null;
    const view = code.view;
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    return { rel, view, pos, text: view.state.doc.toString(), line: line.number - 1, character: pos - line.from };
}

function lspNotice(text) {
    renderEntry({ type: "warn", text });
}

function lspStatus(text) {
    const el = $("st-file");
    if (el) el.textContent = text;
}

function lspSyncTabFromEditor(tab) {
    if (!tab) return;
    tab.content = code.value;
    tab.dirty = tab.content !== tab.saved;
}

function lspLocationLabel(loc) {
    const label = `${loc.rel}:${loc.line + 1}:${loc.character + 1}`;
    const tab = ui.tabs.find((t) => t.path === loc.rel);
    const lineText = tab && typeof tab.content === "string" ? tab.content.split("\n")[loc.line] : "";
    return { label, detail: lineText ? lineText.trim().slice(0, 120) : "" };
}

/** Liste de choix modale ; renvoie l'index choisi ou null. */
function lspPick(title, items) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        const box = document.createElement("div");
        box.className = "modal";
        const heading = document.createElement("div");
        heading.className = "modal-title";
        heading.textContent = title;
        const list = document.createElement("div");
        list.style.maxHeight = "50vh";
        list.style.overflowY = "auto";
        list.style.display = "flex";
        list.style.flexDirection = "column";
        list.style.gap = "2px";
        const close = (result) => {
            overlay.remove();
            resolve(result);
        };
        items.forEach((item, i) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.style.textAlign = "left";
            btn.style.whiteSpace = "pre";
            btn.style.overflow = "hidden";
            btn.style.textOverflow = "ellipsis";
            btn.textContent = item.detail ? `${item.label}   ${item.detail}` : item.label;
            btn.title = btn.textContent;
            btn.onclick = () => close(i);
            list.appendChild(btn);
        });
        const buttons = document.createElement("div");
        buttons.className = "buttons";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Annuler";
        cancel.onclick = () => close(null);
        buttons.appendChild(cancel);
        box.append(heading, list, buttons);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        overlay.addEventListener("mousedown", (ev) => {
            if (ev.target === overlay) close(null);
        });
        overlay.addEventListener("keydown", (ev) => {
            const choices = [...list.querySelectorAll("button")];
            const index = choices.indexOf(document.activeElement);
            if (ev.key === "Escape") {
                ev.preventDefault();
                ev.stopPropagation();
                close(null);
            } else if (ev.key === "ArrowDown" && choices.length) {
                ev.preventDefault();
                choices[Math.min(choices.length - 1, index + 1)].focus();
            } else if (ev.key === "ArrowUp" && choices.length) {
                ev.preventDefault();
                choices[Math.max(0, index - 1)].focus();
            }
        });
        setTimeout(() => {
            const first = list.querySelector("button") || cancel;
            first.focus();
        }, 0);
    });
}

async function lspReveal(loc) {
    if (!loc || !loc.rel) return;
    if (lspActivePath() !== loc.rel) await openFile(loc.rel);
    if (lspActivePath() !== loc.rel || !code.view) return;
    /* activate() rétablit le défilement à l'image suivante : on place la sélection après. */
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const view = code.view;
    const doc = view.state.doc;
    const anchor = lspOffset(doc, { line: loc.line, character: loc.character });
    const head = Math.max(anchor, lspOffset(doc, { line: loc.endLine, character: loc.endCharacter }));
    view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
    code.focus();
}

async function lspGoToDefinition() {
    const at = lspCursor();
    if (!at) {
        lspNotice("Aller à la définition : disponible pour les fichiers JS/TS.");
        return;
    }
    let locations;
    try {
        locations = await api.lspDefinition(at.rel, at.text, at.line, at.character);
    } catch (err) {
        lspNotice(`Définition introuvable : ${err.message}`);
        return;
    }
    if (!Array.isArray(locations) || !locations.length) {
        lspStatus("Aucune définition trouvée dans le projet.");
        return;
    }
    if (locations.length === 1) {
        await lspReveal(locations[0]);
        return;
    }
    const index = await lspPick("Définitions", locations.map(lspLocationLabel));
    if (index !== null) await lspReveal(locations[index]);
}

async function lspFindReferences() {
    const at = lspCursor();
    if (!at) {
        lspNotice("Références : disponible pour les fichiers JS/TS.");
        return;
    }
    let refs;
    try {
        refs = await api.lspReferences(at.rel, at.text, at.line, at.character);
    } catch (err) {
        lspNotice(`Références introuvables : ${err.message}`);
        return;
    }
    if (!Array.isArray(refs) || !refs.length) {
        lspStatus("Aucune référence trouvée.");
        return;
    }
    const index = await lspPick(`${refs.length} référence(s)`, refs.map(lspLocationLabel));
    if (index !== null) await lspReveal(refs[index]);
}

/** Applique des TextEdit LSP à un texte (normalisé en \n). */
function lspApplyEditsToText(text, edits) {
    const source = String(text ?? "");
    const starts = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
    const offset = (p) => {
        const line = Math.max(0, Number(p && p.line) || 0);
        if (line >= starts.length) return source.length;
        const end = line + 1 < starts.length ? starts[line + 1] - 1 : source.length;
        return Math.min(starts[line] + Math.max(0, Number(p && p.character) || 0), end);
    };
    const sorted = edits
        .map((e, index) => ({ from: offset(e.range.start), to: offset(e.range.end), insert: String(e.newText ?? ""), index }))
        .sort((a, b) => b.from - a.from || b.index - a.index);
    let out = source;
    for (const e of sorted) out = out.slice(0, e.from) + e.insert + out.slice(Math.max(e.from, e.to));
    return out;
}

/**
 * Applique une modification multi-fichiers : onglet actif via CodeMirror (annulable),
 * autres onglets ouverts en mémoire (à enregistrer), fichiers fermés directement sur disque.
 */
async function lspApplyWorkspaceEdit(edit, expected) {
    const files = edit && Array.isArray(edit.files) ? edit.files : [];
    const failures = [];
    let changed = 0;
    for (const file of files) {
        const edits = (file.edits || []).filter((e) => e && e.range);
        if (!edits.length) continue;
        const tab = ui.tabs.find((t) => t.path === file.rel);
        try {
            if (tab && tab.path === ui.active && code.view) {
                const view = code.view;
                if (expected && file.rel === expected.rel && view.state.doc.toString() !== expected.text) {
                    throw new Error("le fichier a changé pendant la requête");
                }
                const doc = view.state.doc;
                const changes = edits
                    .map((e) => {
                        const from = lspOffset(doc, e.range.start);
                        return { from, to: Math.max(from, lspOffset(doc, e.range.end)), insert: String(e.newText ?? "") };
                    })
                    .sort((a, b) => a.from - b.from);
                view.dispatch({ changes, userEvent: "input.lsp" });
                lspSyncTabFromEditor(tab);
            } else if (tab) {
                tab.content = lspApplyEditsToText(tab.content, edits);
                tab.dirty = tab.content !== tab.saved;
                tab.cmState = null;
            } else {
                const data = await api.readFile(file.rel);
                const eol = data.content.includes("\r\n") ? "\r\n" : "\n";
                const next = lspApplyEditsToText(normalize(data.content), edits);
                await api.writeFile(file.rel, eol === "\r\n" ? next.split("\n").join("\r\n") : next);
            }
            changed++;
        } catch (err) {
            failures.push(`${file.rel} : ${err.message}`);
        }
    }
    renderTabs();
    lspScheduleSync();
    if (changed) scheduleGitRefresh();
    return { changed, failures };
}

function lspReportEdit(label, edit, result) {
    const skipped = edit && edit.skipped ? ` (${edit.skipped} modification(s) hors projet ignorée(s))` : "";
    if (result.failures.length) {
        lspNotice(`${label} : ${result.changed} fichier(s) modifié(s), échecs :\n${result.failures.join("\n")}${skipped}`);
    } else {
        lspStatus(`${label} : ${result.changed} fichier(s) modifié(s)${skipped}`);
    }
}

async function lspRenameSymbol() {
    const at = lspCursor();
    if (!at) {
        lspNotice("Renommer : disponible pour les fichiers JS/TS.");
        return;
    }
    const word = at.view.state.wordAt(at.pos);
    const current = word ? at.view.state.sliceDoc(word.from, word.to) : "";
    const name = await inputDialog("Renommer le symbole", current);
    if (!name || name === current) return;
    let edit;
    try {
        edit = await api.lspRename(at.rel, at.text, at.line, at.character, name);
    } catch (err) {
        lspNotice(`Renommage impossible : ${err.message}`);
        return;
    }
    if (!edit || !Array.isArray(edit.files) || !edit.files.length) {
        lspNotice("Renommage impossible : ce symbole ne peut pas être renommé ici.");
        return;
    }
    lspReportEdit(`Renommé en ${name}`, edit, await lspApplyWorkspaceEdit(edit, { rel: at.rel, text: at.text }));
}

async function lspShowCodeActions() {
    const at = lspCursor();
    if (!at) {
        lspNotice("Actions de code : disponibles pour les fichiers JS/TS.");
        return;
    }
    const sel = at.view.state.selection.main;
    const doc = at.view.state.doc;
    const a = doc.lineAt(sel.from);
    const b = doc.lineAt(sel.to);
    let actions;
    try {
        actions = await api.lspCodeActions(at.rel, at.text, {
            fromLine: a.number - 1,
            fromChar: sel.from - a.from,
            toLine: b.number - 1,
            toChar: sel.to - b.from
        });
    } catch (err) {
        lspNotice(`Actions de code indisponibles : ${err.message}`);
        return;
    }
    if (!Array.isArray(actions) || !actions.length) {
        lspStatus("Aucune action de code disponible ici.");
        return;
    }
    actions = [...actions].sort((x, y) => Number(Boolean(y.preferred)) - Number(Boolean(x.preferred)));
    const index = await lspPick("Actions de code", actions.map((x) => ({ label: (x.preferred ? "★ " : "") + x.title, detail: x.kind })));
    if (index === null) return;
    const chosen = actions[index];
    lspReportEdit(chosen.title, chosen.edit, await lspApplyWorkspaceEdit(chosen.edit, { rel: at.rel, text: at.text }));
}

async function lspFormatDocument() {
    const at = lspCursor();
    if (!at) {
        lspNotice("Formatage : disponible pour les fichiers JS/TS.");
        return;
    }
    const CM = window.CM;
    const unit = CM && CM.indentUnit ? at.view.state.facet(CM.indentUnit) : "    ";
    const tabSize = unit === "\t" ? 4 : unit.length || 4;
    let result;
    try {
        result = await api.lspFormat(at.rel, at.text, tabSize);
    } catch (err) {
        lspNotice(`Formatage impossible : ${err.message}`);
        return;
    }
    if (!result || !result.changed || result.text === at.text) {
        lspStatus(`${at.rel} : déjà formaté`);
        return;
    }
    const view = code.view;
    if (lspActivePath() !== at.rel || !view || view.state.doc.toString() !== at.text) {
        lspNotice("Formatage annulé : le fichier a changé pendant la requête.");
        return;
    }
    const before = at.text;
    const after = String(result.text);
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let endA = before.length;
    let endB = after.length;
    while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) {
        endA--;
        endB--;
    }
    view.dispatch({ changes: { from: start, to: endA, insert: after.slice(start, endB) }, userEvent: "input.format" });
    lspSyncTabFromEditor(currentTab());
    renderTabs();
    lspScheduleSync();
}

/* Aide à la signature : champ d'état + infobulle (créés à la demande, window.CM étant chargé avant). */
function lspSignatureState() {
    if (lspSignatureState.cache) return lspSignatureState.cache;
    const CM = window.CM;
    if (!CM || !CM.StateField || !CM.StateEffect || !CM.showTooltip) return null;
    const set = CM.StateEffect.define();
    const field = CM.StateField.define({
        create: () => null,
        update(value, tr) {
            for (const e of tr.effects) if (e.is(set)) return e.value;
            if (!value) return value;
            let next = value;
            if (tr.docChanged) next = { ...value, pos: tr.changes.mapPos(value.pos) };
            if (tr.selection) {
                const doc = tr.state.doc;
                const head = tr.state.selection.main.head;
                if (doc.lineAt(head).number !== doc.lineAt(Math.min(next.pos, doc.length)).number) return null;
            }
            return next;
        },
        provide: (f) => CM.showTooltip.from(f)
    });
    lspSignatureState.cache = { set, field };
    return lspSignatureState.cache;
}

function lspSignatureTooltip(pos, sig) {
    return {
        pos,
        above: true,
        create() {
            const dom = document.createElement("div");
            dom.className = "cm-lsp-signature";
            dom.style.maxWidth = "560px";
            dom.style.padding = "4px 8px";
            dom.style.fontFamily = "var(--mono, monospace)";
            dom.style.whiteSpace = "pre-wrap";
            const head = document.createElement("div");
            const param = sig.parameters && sig.parameters[sig.activeParameter];
            if (param && param.to > param.from) {
                const strong = document.createElement("b");
                strong.textContent = sig.label.slice(param.from, param.to);
                strong.style.textDecoration = "underline";
                head.append(sig.label.slice(0, param.from), strong, sig.label.slice(param.to));
            } else {
                head.textContent = sig.label;
            }
            if (sig.count > 1) head.append(`  (${sig.index + 1}/${sig.count})`);
            dom.appendChild(head);
            if (sig.documentation) {
                const doc = document.createElement("div");
                doc.style.opacity = "0.8";
                doc.style.marginTop = "4px";
                doc.textContent = sig.documentation;
                dom.appendChild(doc);
            }
            return { dom };
        }
    };
}

function lspCloseSignature(view) {
    const parts = lspSignatureState();
    if (!parts || !view || !view.state.field(parts.field, false)) return false;
    view.dispatch({ effects: parts.set.of(null) });
    return true;
}

async function lspShowSignature(view = code.view, explicit = true) {
    const parts = lspSignatureState();
    const rel = lspActivePath();
    if (!parts || !view || !lspEnabledFor(rel) || !api.lspSignatureHelp) return;
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const text = view.state.doc.toString();
    let sig = null;
    try {
        sig = await api.lspSignatureHelp(rel, text, line.number - 1, pos - line.from);
    } catch (err) {
        if (explicit) lspNotice(`Aide à la signature indisponible : ${err.message}`);
    }
    if (lspActivePath() !== rel || view.state.doc.toString() !== text) return;
    if (!sig) {
        lspCloseSignature(view);
        if (explicit) lspStatus("Aucune signature à afficher ici.");
        return;
    }
    view.dispatch({ effects: parts.set.of(lspSignatureTooltip(pos, sig)) });
}

/** Raccourcis LSP (fichiers JS/TS) et déclenchement automatique de l'aide à la signature. */
function lspEditingExtension() {
    const CM = window.CM;
    if (!CM || !CM.keymap || !CM.Prec || !CM.EditorView) return [];
    const parts = lspSignatureState();
    const run = (fn) => () => {
        Promise.resolve()
            .then(fn)
            .catch((err) => lspNotice(`LSP : ${err && err.message ? err.message : err}`));
        return true;
    };
    const keys = CM.Prec.high(CM.keymap.of([
        { key: "F12", run: run(lspGoToDefinition) },
        { key: "Shift-F12", run: run(lspFindReferences) },
        { key: "F2", run: run(lspRenameSymbol) },
        { key: "Ctrl-Shift-Space", run: run(() => lspShowSignature(code.view, true)) },
        { key: "Mod-.", run: run(lspShowCodeActions) },
        { key: "Shift-Alt-f", run: run(lspFormatDocument) },
        { key: "Escape", run: (view) => lspCloseSignature(view) }
    ]));
    const trigger = CM.EditorView.updateListener.of((update) => {
        if (!update.docChanged || !parts) return;
        const head = update.state.selection.main.head;
        const before = update.state.sliceDoc(Math.max(0, head - 1), head);
        const open = Boolean(update.state.field(parts.field, false));
        clearTimeout(lspShowSignature.timer);
        if (before === ")" && open) {
            lspShowSignature.timer = setTimeout(() => lspCloseSignature(update.view), 0);
        } else if (before === "(" || before === "," || open) {
            lspShowSignature.timer = setTimeout(() => lspShowSignature(update.view, false), 150);
        }
    });
    return parts ? [keys, parts.field, trigger] : [keys];
}

code.addEventListener("input", lspScheduleSync);

api.onEvent((channel, data) => {
    if (channel !== "lspDiagnostics" || !data || !data.path) return;
    const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
    lspDiagnosticsByPath.set(data.path, diagnostics);
    if (data.path === lspActivePath()) lspApplyDiagnostics(diagnostics);
});
