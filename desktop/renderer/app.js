"use strict";

/* Interface façon VS Code : explorateur, éditeur à onglets, sortie des commandes, panneau Agent. */

const api = window.frst;
const $ = (id) => document.getElementById(id);

const SLASH_COMMANDS = [
    ["/help", "Aide"], ["/project", "Choisir un projet"], ["/unproject", "Quitter le projet"],
    ["/plan", "Plan en lecture seule"], ["/undo", "Annuler la dernière modification"],
    ["/changes", "Modifications annulables"], ["/memory", "Notes du projet"],
    ["/remember", "Ajouter une note"], ["/forget", "Supprimer une note"],
    ["/permissions", "Règles des commandes"], ["/jobs", "Commandes en arrière-plan"],
    ["/mcp", "Serveurs MCP"], ["/skills", "Skills (SKILL.md)"], ["/auto", "Auto-approbation on|off|always|never"], ["/mode", "auto|agent|chat"],
    ["/new", "Nouvelle conversation"], ["/chat-id", "Chat ID / reprendre"], ["/history", "Conversations"],
    ["/messages", "Messages de la session"], ["/usage", "Consommation"], ["/model", "Changer d'agent"],
    ["/web", "Recherche web on|off"], ["/index", "Régénérer RESUME.md"], ["/init", "Créer FRSTCLI.md"],
    ["/resume", "Résumé du projet"], ["/fr-project", "Projet FranceStudent"], ["/auth", "État de la connexion"],
    ["/login", "Se connecter"], ["/logout", "Se déconnecter"], ["/github", "Compte GitHub : login, remote, push, pull"],
    ["/preprompt", "Pré-prompt"], ["/profil", "Profil"], ["/clear", "Effacer"]
];

const ui = {
    status: {},
    prompts: [],
    live: null,
    liveText: "",
    spinnerId: null,
    tabs: [],
    active: null,
    workspace: null,
    history: [],
    historyIndex: 0,
    slashIndex: 0,
    changes: new Map(),      // chemin -> { added, removed }
    changesOrder: [],
    models: null,            // { agents, source, error, current }
    currentModelId: null,
    highlightTimer: null,
    quota: null,             // { percent, bucket, resetAt, powerUp, limits }
    sessionRequests: ""
};

const transcript = $("transcript");
const input = $("input");
/* Couche de compatibilité : API proche de l'ancien <textarea> au-dessus de CodeMirror 6. */
function createCodeEditor(host) {
    const CM = window.CM;
    if (!CM || !host) {
        throw new Error("CodeMirror introuvable : vérifie que vendor/codemirror.js est chargé (npm run vendor:renderer).");
    }
    const events = new EventTarget();
    const language = new CM.Compartment();
    let silent = false;
    const emit = (name) => events.dispatchEvent(new Event(name));
    const extensions = (kind) => [
        CM.basicSetup,
        CM.keymap.of([CM.indentWithTab]),
        CM.indentUnit.of("    "),
        CM.EditorState.tabSize.of(4),
        CM.oneDark,
        language.of(CM.languageFor(kind || "default")),
        CM.EditorView.updateListener.of((update) => {
            if (update.docChanged && !silent) emit("input");
            if (update.selectionSet) emit("select");
        })
    ];
    const view = new CM.EditorView({
        state: CM.EditorState.create({ doc: "", extensions: extensions("default") }),
        parent: host
    });
    for (const name of ["keyup", "click", "focus"]) view.contentDOM.addEventListener(name, () => emit(name));
    view.scrollDOM.addEventListener("scroll", () => emit("scroll"));
    const clamp = (n) => Math.max(0, Math.min(view.state.doc.length, Number(n) || 0));

    return {
        view,
        get value() { return view.state.doc.toString(); },
        set value(text) {
            silent = true;
            try {
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(text ?? "") } });
            } finally {
                silent = false;
            }
        },
        get selectionStart() { return view.state.selection.main.from; },
        get selectionEnd() { return view.state.selection.main.to; },
        setSelectionRange(a, b) {
            const anchor = clamp(a);
            const head = clamp(b ?? a);
            view.dispatch({ selection: { anchor, head }, effects: CM.EditorView.scrollIntoView(anchor, { y: "center" }) });
        },
        focus() { view.focus(); },
        hasFocus() { return view.hasFocus; },
        get scrollTop() { return view.scrollDOM.scrollTop; },
        set scrollTop(v) { view.scrollDOM.scrollTop = v; },
        get scrollLeft() { return view.scrollDOM.scrollLeft; },
        set scrollLeft(v) { view.scrollDOM.scrollLeft = v; },
        get clientHeight() { return view.scrollDOM.clientHeight; },
        addEventListener: (name, fn, opts) => events.addEventListener(name, fn, opts),
        removeEventListener: (name, fn, opts) => events.removeEventListener(name, fn, opts),
        dispatchEvent: (ev) => events.dispatchEvent(ev),
        getState() { return view.state; },
        /* Charge un texte ; réutilise l'état sauvegardé (historique, sélection) s'il correspond encore. */
        load(text, kind, saved) {
            const doc = String(text ?? "");
            const state = saved && saved.doc.toString() === doc
                ? saved
                : CM.EditorState.create({ doc, extensions: extensions(kind) });
            view.setState(state);
        }
    };
}

const code = createCodeEditor($("cm-host"));
const highlightEl = $("highlight");
const modelMenuEl = $("model-menu");
const output = $("output");
const expanded = new Set();

/* ---------- Rendu du texte ---------- */

const TOOL_LABELS = {
    list_directory: "Lister", read_file: "Lire", search_files: "Chercher",
    create_directory: "Créer le dossier", write_file: "Écrire", edit_file: "Éditer",
    move_path: "Déplacer", copy_path: "Copier", delete_path: "Supprimer",
    remember: "Mémoriser", run_command: "Commande"
};

function toolLabel(name) {
    return TOOL_LABELS[name] || String(name ?? "");
}

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function inline(text) {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

function renderMarkdown(src) {
    const lines = String(src ?? "").split("\n");
    let html = "";
    let block = null;
    let list = null;
    const closeList = () => {
        if (list) {
            html += `</${list}>`;
            list = null;
        }
    };

    for (const line of lines) {
        if (/^\s*(```|~~~)/.test(line)) {
            if (block === null) {
                closeList();
                block = [];
            } else {
                html += `<pre><code>${escapeHtml(block.join("\n"))}</code></pre>`;
                block = null;
            }
            continue;
        }
        if (block !== null) {
            block.push(line);
            continue;
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
        if (heading) {
            closeList();
            html += `<h4>${inline(heading[2])}</h4>`;
        } else if (bullet || numbered) {
            const kind = bullet ? "ul" : "ol";
            if (list !== kind) {
                closeList();
                html += `<${kind}>`;
                list = kind;
            }
            html += `<li>${inline((bullet || numbered)[1])}</li>`;
        } else if (!line.trim()) {
            closeList();
            html += "<br>";
        } else {
            closeList();
            html += `<div>${inline(line)}</div>`;
        }
    }

    if (block !== null) html += `<pre><code>${escapeHtml(block.join("\n"))}</code></pre>`;
    closeList();
    return html;
}

function diffLine(line) {
    if (typeof line === "string") {
        const first = line[0];
        const cls = first === "+" ? "add" : first === "-" ? "del" : first === "@" ? "hunk" : "";
        return { text: line, cls };
    }
    const kind = String(line?.type ?? line?.kind ?? line?.op ?? "");
    const text = String(line?.text ?? line?.line ?? line?.value ?? "");
    const cls = /add|ins|\+/.test(kind) ? "add" : /del|rem|-/.test(kind) ? "del" : /hunk|sep|@/.test(kind) ? "hunk" : "";
    const sign = cls === "add" ? "+ " : cls === "del" ? "- " : "  ";
    return { text: cls === "hunk" ? text : sign + text, cls };
}

function buildDiffCard(entry) {
    const card = document.createElement("div");
    card.className = "diff-card";

    if (entry.path) {
        const head = document.createElement("div");
        head.className = "diff-head";
        head.appendChild(fileIcon(entry.path, "file"));
        const p = document.createElement("span");
        p.className = "diff-path";
        p.textContent = entry.path;
        p.title = `${entry.path} — cliquez pour ouvrir`;
        p.onclick = () => openFile(entry.path);
        head.appendChild(p);
        const stats = document.createElement("span");
        stats.className = "diff-stats";
        const add = document.createElement("b");
        add.className = "add";
        add.textContent = `+${entry.added ?? 0}`;
        const del = document.createElement("b");
        del.className = "del";
        del.textContent = `-${entry.removed ?? 0}`;
        stats.append(add, del);
        head.appendChild(stats);
        card.appendChild(head);
    } else {
        const summary = document.createElement("div");
        summary.className = "diff-summary";
        summary.textContent = `+${entry.added ?? 0} / -${entry.removed ?? 0}`;
        card.appendChild(summary);
    }

    const body = document.createElement("div");
    body.className = "diff";
    body.innerHTML = (entry.lines || [])
        .map((line) => {
            const d = diffLine(line);
            return `<div class="${d.cls}">${escapeHtml(d.text) || " "}</div>`;
        })
        .join("");
    card.appendChild(body);
    return card;
}

/* ---------- Coloration syntaxique de l'éditeur ---------- */

const JS_KEYWORDS = ("await async break case catch class const continue debugger default delete do else enum export extends " +
    "false finally for from function get if implements import in instanceof interface let new null of return set static " +
    "super switch this throw true try typeof undefined var void while with yield").split(" ");
const TS_EXTRA = ("type namespace declare public private protected readonly abstract keyof infer never unknown any satisfies " +
    "as is asserts").split(" ");
const HL_KEYWORDS = {
    js: new Set(JS_KEYWORDS),
    ts: new Set([...JS_KEYWORDS, ...TS_EXTRA]),
    json: new Set(["true", "false", "null"]),
    py: new Set(("and as assert async await break class continue def del elif else except False finally for from global if " +
        "import in is lambda None nonlocal not or pass raise return True try while with yield self").split(" "))
};

function hlSpan(cls, text) {
    return `<span class="tok-${cls}">${escapeHtml(text)}</span>`;
}

function hlClike(text, kw) {
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d[\w.]*\b|\b0[xX][0-9a-fA-F]+\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.:=+\-*/%<>!&|?~^]+)/g;
    let out = "";
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out += escapeHtml(text.slice(last, m.index));
        if (m[1] != null) out += hlSpan("comment", m[1]);
        else if (m[2] != null) out += hlSpan("string", m[2]);
        else if (m[3] != null) out += hlSpan("number", m[3]);
        else if (m[4] != null) {
            const word = m[4];
            const prev = text[m.index - 1];
            const rest = text.slice(re.lastIndex);
            if (kw.has(word)) out += hlSpan("keyword", word);
            else if (/^\s*\(/.test(rest)) out += hlSpan("func", word);
            else if (prev === ".") out += hlSpan("prop", word);
            else if (/^[A-Z]/.test(word)) out += hlSpan("type", word);
            else out += escapeHtml(word);
        } else {
            out += hlSpan("punct", m[5]);
        }
        last = re.lastIndex;
    }
    return out + escapeHtml(text.slice(last));
}

function hlPython(text) {
    const kw = HL_KEYWORDS.py;
    const re = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d[\w.]*\b)|([A-Za-z_]\w*)|([{}()[\];,.:=+\-*/%<>!&|?~^@]+)/g;
    let out = "";
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out += escapeHtml(text.slice(last, m.index));
        if (m[1] != null) out += hlSpan("comment", m[1]);
        else if (m[2] != null) out += hlSpan("string", m[2]);
        else if (m[3] != null) out += hlSpan("number", m[3]);
        else if (m[4] != null) {
            const word = m[4];
            const rest = text.slice(re.lastIndex);
            if (kw.has(word)) out += hlSpan("keyword", word);
            else if (/^\s*\(/.test(rest)) out += hlSpan("func", word);
            else if (/^[A-Z]/.test(word)) out += hlSpan("type", word);
            else out += escapeHtml(word);
        } else {
            out += hlSpan("punct", m[5]);
        }
        last = re.lastIndex;
    }
    return out + escapeHtml(text.slice(last));
}

function hlCss(text) {
    const re = /(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[0-9a-fA-F]{3,8}\b)|(@[a-zA-Z-]+)|([.#:%][A-Za-z_][\w-]*|::?[a-zA-Z-]+)|([a-zA-Z-]+)(?=\s*:)|(-?\d*\.?\d+(?:[a-z%]{1,4})?)|([{}();:,>~+])/g;
    let out = "";
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out += escapeHtml(text.slice(last, m.index));
        if (m[1] != null) out += hlSpan("comment", m[1]);
        else if (m[2] != null) out += hlSpan("string", m[2]);
        else if (m[3] != null) out += hlSpan("color", m[3]);
        else if (m[4] != null) out += hlSpan("atrule", m[4]);
        else if (m[5] != null) out += hlSpan("selector", m[5]);
        else if (m[6] != null) out += hlSpan("prop", m[6]);
        else if (m[7] != null) out += hlSpan("number", m[7]);
        else out += hlSpan("punct", m[8]);
        last = re.lastIndex;
    }
    return out + escapeHtml(text.slice(last));
}

function hlHtml(text) {
    const re = /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z][\w:-]*)|([a-zA-Z_:][\w:.-]*)(?==)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(&[a-zA-Z#0-9]+;)|(\/?>)/g;
    let out = "";
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out += escapeHtml(text.slice(last, m.index));
        if (m[1] != null) out += hlSpan("comment", m[1]);
        else if (m[2] != null) out += hlSpan("tag", m[2]);
        else if (m[3] != null) out += hlSpan("attr", m[3]);
        else if (m[4] != null) out += hlSpan("string", m[4]);
        else if (m[5] != null) out += hlSpan("entity", m[5]);
        else out += hlSpan("tag", m[6]);
        last = re.lastIndex;
    }
    return out + escapeHtml(text.slice(last));
}

function hlMarkdown(text) {
    const re = /(^#{1,6} .*$)|(```[\s\S]*?```|`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(!?\[[^\]\n]*\]\([^)\n]*\))|(^\s*(?:[-*+]|\d+[.)]) )/gm;
    let out = "";
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out += escapeHtml(text.slice(last, m.index));
        if (m[1] != null) out += hlSpan("heading", m[1]);
        else if (m[2] != null) out += hlSpan("code", m[2]);
        else if (m[3] != null) out += hlSpan("bold", m[3]);
        else if (m[4] != null) out += hlSpan("link", m[4]);
        else out += hlSpan("list", m[5]);
        last = re.lastIndex;
    }
    return out + escapeHtml(text.slice(last));
}

function extKind(path) {
    if (!path) return "default";
    const base = String(path).split("/").pop();
    const ext = base.includes(".") ? base.split(".").pop().toLowerCase() : "";
    return FILE_KINDS[ext] || "default";
}

function highlightCode(text, kind) {
    if (text.length > 400000) return escapeHtml(text);
    try {
        if (kind === "js") return hlClike(text, HL_KEYWORDS.js);
        if (kind === "ts") return hlClike(text, HL_KEYWORDS.ts);
        if (kind === "json") return hlClike(text, HL_KEYWORDS.json);
        if (kind === "py") return hlPython(text);
        if (kind === "css") return hlCss(text);
        if (kind === "html") return hlHtml(text);
        if (kind === "md") return hlMarkdown(text);
    } catch {
        // en cas d'erreur de coloration, on retombe sur le texte brut
    }
    return escapeHtml(text);
}

function syncHighlightScroll() {
    if (!highlightEl) return;
    highlightEl.scrollTop = code.scrollTop;
    highlightEl.scrollLeft = code.scrollLeft;
}

function syncHighlight() {
    if (!highlightEl) return;
    const tab = currentTab();
    if (!tab) {
        highlightEl.textContent = "";
        return;
    }
    const kind = extKind(tab.path);
    if (kind === "default" || kind === "img") {
        highlightEl.textContent = code.value;
    } else {
        highlightEl.innerHTML = `${highlightCode(code.value, kind)}\n`;
    }
    syncHighlightScroll();
}

let highlightFrame = null;

function scheduleHighlight() {
    if (highlightFrame) return;
    highlightFrame = requestAnimationFrame(() => {
        highlightFrame = null;
        syncHighlight();
    });
}

/* ---------- Transcript ---------- */

function scrollDown() {
    transcript.scrollTop = transcript.scrollHeight;
}

const QUIET_TOOLS = new Set(["read_file", "search_files", "list_directory"]);
let toolGroup = null;

function toolRowHtml(e) {
    return `<span class="tdot"></span><span class="name">${escapeHtml(toolLabel(e.name))}</span><span class="arg" title="${escapeHtml(e.arg || "")}">${escapeHtml(e.arg || "")}</span>`;
}

function plural(n, word) {
    return `${n} ${word}${n > 1 ? "s" : ""}`;
}

/** Lectures, recherches et listes successives : une seule ligne repliable. */
function addQuietTool(e) {
    if (!toolGroup) {
        const el = addEntry("tool-group", "<details><summary></summary><div class=\"tool-group-body\"></div></details>");
        toolGroup = { el, summary: el.querySelector("summary"), body: el.querySelector(".tool-group-body"), reads: 0, searches: 0, lists: 0, awaitingResult: false };
    }
    const g = toolGroup;
    if (e.name === "read_file") g.reads++;
    else if (e.name === "search_files") g.searches++;
    else g.lists++;
    const parts = [];
    if (g.reads) parts.push(plural(g.reads, "lecture"));
    if (g.searches) parts.push(plural(g.searches, "recherche"));
    if (g.lists) parts.push(`${plural(g.lists, "dossier")} listé${g.lists > 1 ? "s" : ""}`);
    g.summary.textContent = parts.join(" · ");
    const row = document.createElement("div");
    row.className = "entry tool";
    row.innerHTML = toolRowHtml(e);
    g.body.appendChild(row);
    g.awaitingResult = true;
    scrollDown();
    return row;
}

function addEntry(cls, html) {
    toolGroup = null;
    const div = document.createElement("div");
    div.className = `entry ${cls}`;
    div.innerHTML = html;
    transcript.appendChild(div);
    scrollDown();
    return div;
}

function appendOutput(text) {
    output.textContent += `${text}\n`;
    if (output.textContent.length > 200000) output.textContent = output.textContent.slice(-150000);
    output.scrollTop = output.scrollHeight;
}

function renderEntry(e) {
    switch (e.type) {
        case "welcome":
            return null;
        case "user":
            return addEntry("user", escapeHtml(e.text));
        case "assistant":
            return addEntry("assistant", renderMarkdown(e.text));
        case "reason": {
            const el = addEntry("reason collapsed", `<span class="reason-mark">✻</span><span class="reason-text">${inline(e.text)}</span>`);
            el.title = "Cliquer pour déplier ou replier la réflexion";
            el.onclick = () => {
                if (!String(window.getSelection())) el.classList.toggle("collapsed");
            };
            return el;
        }
        case "info":
        case "warn":
        case "error":
            return addEntry(e.type, escapeHtml(e.text));
        case "print":
            return addEntry("print", `<pre>${escapeHtml((e.lines || []).join("\n"))}</pre>`);
        case "plan":
            return addEntry("plan", `<b>Plan</b><ol>${(e.items || []).map((i) => `<li>${inline(i)}</li>`).join("")}</ol>`);
        case "tool":
            if (e.name === "run_command") appendOutput(`$ ${e.arg}`);
            if (QUIET_TOOLS.has(e.name)) return addQuietTool(e);
            return addEntry("tool", toolRowHtml(e));
        case "result": {
            if (toolGroup && toolGroup.awaitingResult) {
                const row = document.createElement("div");
                row.className = `entry result ${e.tone || ""}`;
                row.textContent = `└ ${e.text}`;
                toolGroup.body.appendChild(row);
                toolGroup.awaitingResult = false;
                if (e.tone === "error" || e.tone === "err") toolGroup.el.classList.add("has-error");
                scrollDown();
                return row;
            }
            return addEntry(`result ${e.tone || ""}`, `└ ${escapeHtml(e.text)}`);
        }
        case "diff": {
            const el = addEntry("diff-entry", "");
            el.appendChild(buildDiffCard(e));
            if (e.path) recordChange(e.path, e.added, e.removed);
            return el;
        }
        default:
            return addEntry("info", escapeHtml(JSON.stringify(e)));
    }
}

function liveStart() {
    ui.liveText = "";
    ui.live = addEntry("assistant", "");
}

function liveAppend(text) {
    if (!ui.live) liveStart();
    ui.liveText += text;
    ui.live.innerHTML = renderMarkdown(ui.liveText);
    scrollDown();
}

function liveEnd() {
    ui.live = null;
    ui.liveText = "";
}

function setSpinner(data) {
    if (data.stop) {
        if (ui.spinnerId === data.id) {
            $("spinner").classList.add("hidden");
            ui.spinnerId = null;
            ui.spinnerStart = 0;
            if (ui.spinnerTimer) clearInterval(ui.spinnerTimer);
            ui.spinnerTimer = null;
        }
        return;
    }
    if (ui.spinnerId !== data.id || !ui.spinnerStart) ui.spinnerStart = Date.now();
    ui.spinnerId = data.id;
    ui.spinnerLabel = data.label || "";
    const paint = () => {
        const secs = Math.floor((Date.now() - ui.spinnerStart) / 1000);
        const elapsed = secs >= 60 ? `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, "0")} s` : `${secs} s`;
        $("spinner-label").textContent = ui.spinnerLabel ? `${ui.spinnerLabel} · ${elapsed}` : elapsed;
    };
    paint();
    if (!ui.spinnerTimer) ui.spinnerTimer = setInterval(() => { if (ui.spinnerId) paint(); }, 1000);
    $("spinner").classList.remove("hidden");
}

/* ---------- Confirmations et questions ---------- */

function showPrompt() {
    const zone = $("prompt-zone");
    const p = ui.prompts[0];
    zone.innerHTML = "";

    if (!p) {
        zone.classList.add("hidden");
        input.focus();
        return;
    }

    zone.classList.remove("hidden");
    const question = document.createElement("div");
    question.className = "question";
    question.textContent = p.question;
    zone.appendChild(question);

    const buttons = document.createElement("div");
    buttons.className = "buttons";
    const answer = (value) => api.resolvePrompt(p.id, value).catch((err) => renderEntry({ type: "error", text: err.message }));
    const addButton = (label, onClick, primary = false) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (primary) b.className = "primary";
        b.onclick = onClick;
        buttons.appendChild(b);
        return b;
    };

    if (p.kind === "confirm") {
        const yes = addButton("Oui", () => answer("o"), true);
        addButton("Non", () => answer("n"));
        if (!p.force) addButton("Tout autoriser (session)", () => answer("t"));
        if (!p.force) addButton("Toujours autoriser", () => answer("tt"));
        zone.appendChild(buttons);
        setTimeout(() => yes.focus(), 0);
        scrollDown();
        return;
    }

    if (p.kind === "command" && p.prefix) {
        const prefix = document.createElement("div");
        prefix.className = "question";
        prefix.textContent = `Préfixe : ${p.prefix}`;
        zone.appendChild(prefix);
    }

    const field = document.createElement("input");
    field.type = p.kind === "secret" ? "password" : "text";
    field.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
            ev.preventDefault();
            answer(field.value);
        }
    });
    zone.appendChild(field);

    addButton("Valider", () => answer(field.value), true);
    if (p.kind === "command") {
        addButton("Oui (o)", () => answer("o"));
        addButton("Non (n)", () => answer("n"));
    }
    zone.appendChild(buttons);
    setTimeout(() => field.focus(), 0);
}

/* ---------- Barre d'état ---------- */

function applyStatus(s) {
    if (!s || typeof s !== "object") return;
    const wasBusy = Boolean(ui.status.busy);
    ui.status = s;
    const busy = Boolean(s.busy);

    $("statusbar").classList.toggle("busy", busy);
    $("btn-stop").classList.toggle("hidden", !busy);
    $("btn-send").disabled = busy;
    $("st-busy").textContent = busy ? "⟳ en cours" : "";
    $("st-jobs").textContent = s.jobs ? `jobs : ${s.jobs}` : "";
    $("st-auto").textContent = s.autoApprove ? "auto-approbation" : "";
    $("st-mode").textContent = s.mode ? `mode : ${s.mode}` : "";
    $("st-model").textContent = s.model || "";
    $("model-label").textContent = s.model || "modèle";
    if (s.modelId != null) ui.currentModelId = s.modelId;
    const u = s.usage;
    let tokensText = "";
    if (u && u.reported > 0) {
        tokensText = ` · ${formatTokens(u.inputTokens || 0)} ↑ ${formatTokens(u.outputTokens || 0)} ↓ tokens`;
    } else if (u && u.chars > 0) {
        tokensText = ` · ~${formatTokens(Math.round(u.chars / 3.5))} tokens`;
    }
    ui.sessionRequests = u && u.requests ? `${u.requests} requête(s)${tokensText}` : "";
    if (busy) {
        $("btn-resume").classList.add("hidden");
    } else if (wasBusy && ui.interrupted) {
        $("btn-resume").classList.remove("hidden");
        ui.interrupted = false;
    }
    renderQuota();
    if (s.mode) $("mode-select").value = s.mode;

    if ((s.workspace || null) !== ui.workspace) {
        ui.workspace = s.workspace || null;
        onWorkspaceChanged();
    } else if (wasBusy && !busy) {
        scheduleRefresh();
    }

    if (wasBusy && !busy) refreshQuota();
}

/* ---------- Quota du compte FranceStudent ---------- */

function renderQuota() {
    const el = $("st-usage");
    const quota = ui.quota;

    if (!quota || quota.percent == null) {
        el.textContent = ui.sessionRequests || "";
        el.title = "";
        el.classList.remove("warn", "crit");
        return;
    }

    const session = ui.sessionRequests ? ` · ${ui.sessionRequests}` : "";
    const approx = quota.uncertain ? "~" : "";
    el.textContent = `quota chat ${approx}${quota.percent} %${session}`;
    el.classList.toggle("warn", quota.percent >= 75 && quota.percent < 90);
    el.classList.toggle("crit", quota.percent >= 90);

    const fmtReset = (iso) => (iso ? ` — réinit. ${new Date(iso).toLocaleString()}` : "");
    const lines = [`Quota général de chat : ${approx}${quota.percent} %${fmtReset(quota.resetAt)}`];
    if (quota.uncertain) lines.push("(décompte approximatif côté serveur)");
    const isImage = (l) => /image/i.test(`${l.type || ""} ${l.bucket || ""}`);
    for (const limit of quota.limits || []) {
        const name = [limit.type, limit.bucket].filter(Boolean).join("/") || "limite";
        const total = limit.limit ? `${limit.used}/${limit.limit}` : `${limit.used}`;
        const prefix = isImage(limit) ? "Images" : "Limite";
        lines.push(`${prefix} ${name} : ${Math.round(limit.usedPercent)} % (${total})${fmtReset(limit.resetAt)}`);
    }
    if (quota.powerUp) lines.push("Power-up de quota actif");
    lines.push("Cliquer pour le détail (/usage)");
    el.title = lines.join("\n");
}

async function refreshQuota() {
    try {
        ui.quota = await api.usage();
    } catch {
        ui.quota = null;
    }
    renderQuota();
}

/* ---------- Choix du modèle (/model) ---------- */

function hideModelMenu() {
    modelMenuEl.classList.add("hidden");
    modelMenuEl.innerHTML = "";
}

function positionModelMenu(anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(300, rect.width);
    modelMenuEl.style.minWidth = `${width}px`;
    modelMenuEl.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    modelMenuEl.style.top = `${rect.bottom + 6}px`;
    const menuRect = modelMenuEl.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8) {
        modelMenuEl.style.top = `${Math.max(8, rect.top - menuRect.height - 6)}px`;
    }
}

/** Fournisseur d'un modèle d'après provider / nom / modèle : "claude", "gpt", "gemini" ou null. */
function modelVendor(agent) {
    const text = [agent && agent.provider, agent && agent.name, agent && agent.model]
        .filter(Boolean).join(" ").toLowerCase();
    if (/claude|anthropic/.test(text)) return "claude";
    if (/gemini|google/.test(text)) return "gemini";
    if (/\bgpt|openai|\bo[134]\b/.test(text)) return "gpt";
    return null;
}

function modelLogo(agent, className = "model-logo") {
    const vendor = modelVendor(agent);
    if (!vendor) return null;
    const img = document.createElement("img");
    img.className = className;
    img.src = `assets/models/${vendor}.svg`;
    img.alt = vendor;
    return img;
}

function renderModelMenu(data) {
    const agents = (data && data.agents) || [];
    modelMenuEl.innerHTML = "";

    const head = document.createElement("div");
    head.className = "model-menu-head";
    head.textContent = data && data.source === "api" ? "Modèles FranceStudent" : "Modèles (liste locale)";
    modelMenuEl.appendChild(head);

    if (!agents.length) {
        const empty = document.createElement("div");
        empty.className = "model-empty";
        empty.textContent = "Aucun modèle disponible.";
        modelMenuEl.appendChild(empty);
        return;
    }

    for (const agent of agents) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "model-item" + (agent.id === ui.currentModelId ? " active" : "");

        const logo = modelLogo(agent);
        if (logo) row.appendChild(logo);

        const main = document.createElement("span");
        main.className = "model-item-main";
        const name = document.createElement("span");
        name.className = "model-item-name";
        name.textContent = agent.name;
        main.appendChild(name);
        const details = [agent.provider, agent.model].filter(Boolean).join(" · ");
        const sub = document.createElement("span");
        sub.className = "model-item-sub";
        sub.textContent = details || (agent.id === ui.currentModelId ? "modèle actuel" : "");
        main.appendChild(sub);
        row.appendChild(main);

        if (agent.isDefault) {
            const badge = document.createElement("span");
            badge.className = "model-badge";
            badge.textContent = "défaut";
            row.appendChild(badge);
        }
        const check = document.createElement("span");
        check.className = "model-check";
        check.textContent = agent.id === ui.currentModelId ? "✓" : "";
        row.appendChild(check);

        row.onclick = () => selectModel(agent.id);
        modelMenuEl.appendChild(row);
    }

    if (data && data.error) {
        const err = document.createElement("div");
        err.className = "model-error";
        err.textContent = `API indisponible : ${data.error}`;
        modelMenuEl.appendChild(err);
    }
}

async function openModelMenu() {
    const anchor = $("btn-model");
    modelMenuEl.classList.remove("hidden");
    modelMenuEl.dataset.kind = "model";
    if (ui.models) renderModelMenu(ui.models);
    else modelMenuEl.innerHTML = '<div class="model-empty">Chargement des modèles…</div>';
    positionModelMenu(anchor);
    const stillModel = () => !modelMenuEl.classList.contains("hidden") && modelMenuEl.dataset.kind === "model";
    try {
        const data = await api.models();
        ui.models = data;
        if (data && data.current != null) ui.currentModelId = data.current;
        if (stillModel()) {
            renderModelMenu(data);
            positionModelMenu(anchor);
        }
    } catch (err) {
        if (stillModel()) {
            modelMenuEl.innerHTML = `<div class="model-error">${escapeHtml(err.message)}</div>`;
        }
    }
}

function toggleModelMenu() {
    if (!modelMenuEl.classList.contains("hidden") && modelMenuEl.dataset.kind === "model") hideModelMenu();
    else openModelMenu();
}

async function selectModel(id) {
    hideModelMenu();
    if (id === ui.currentModelId) return;
    try {
        const res = await api.setModel(id);
        ui.currentModelId = res.id;
        $("model-label").textContent = res.name;
        $("st-model").textContent = res.name;
        if (ui.models) renderModelMenu(ui.models);
    } catch (err) {
        renderEntry({ type: "error", text: err.message });
    }
}

/* ---------- Historique des conversations (/history, reprise par /chat-id) ---------- */

function historyCurrentWorkspace() {
    return ui.workspace || (ui.status && ui.status.workspace) || null;
}

function historyMatches(item) {
    if (ui.historyOnlyProject && (item.workspace || null) !== historyCurrentWorkspace()) return false;
    const query = String(ui.historyQuery || "").trim().toLowerCase();
    if (!query) return true;
    return [item.title, item.model, item.mode, item.workspace, item.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
}

function renderHistoryMenu(items) {
    ui.historyItems = Array.isArray(items) ? items : [];
    modelMenuEl.innerHTML = "";
    modelMenuEl.dataset.kind = "history";
    const head = document.createElement("div");
    head.className = "model-menu-head";
    head.textContent = "Conversations récentes";
    modelMenuEl.appendChild(head);

    const tools = document.createElement("div");
    tools.className = "history-tools";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "history-search";
    search.placeholder = "Rechercher (titre, modèle, dossier)…";
    search.value = ui.historyQuery || "";
    search.oninput = () => {
        ui.historyQuery = search.value;
        renderHistoryList();
    };
    search.onkeydown = (e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        e.preventDefault();
        if (search.value) {
            // Premier Escape : vide la recherche ; second Escape : ferme le menu.
            search.value = "";
            ui.historyQuery = "";
            renderHistoryList();
        } else {
            hideModelMenu();
        }
    };
    search.onclick = (e) => e.stopPropagation();

    const label = document.createElement("label");
    label.className = "history-filter";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.disabled = !historyCurrentWorkspace();
    check.checked = !check.disabled && !!ui.historyOnlyProject;
    check.onchange = () => {
        ui.historyOnlyProject = check.checked;
        renderHistoryList();
    };
    label.title = check.disabled ? "Aucun projet ouvert." : historyCurrentWorkspace();
    label.onclick = (e) => e.stopPropagation();
    label.append(check, document.createTextNode(" Ce projet"));

    tools.append(search, label);
    modelMenuEl.appendChild(tools);

    const list = document.createElement("div");
    list.className = "history-list";
    modelMenuEl.appendChild(list);
    renderHistoryList();
    setTimeout(() => {
        if (search.isConnected) search.focus();
    }, 0);
}

function renderHistoryList() {
    const list = modelMenuEl.querySelector(".history-list");
    if (!list) return;
    list.innerHTML = "";
    const all = ui.historyItems || [];
    const shown = all.filter(historyMatches);
    if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "model-empty";
        empty.textContent = all.length ? "Aucune conversation ne correspond." : "Aucune conversation enregistrée.";
        list.appendChild(empty);
        return;
    }
    for (const item of shown) list.appendChild(renderHistoryRow(item));
}

function renderHistoryRow(item) {
    const row = document.createElement("div");
    row.className = "model-item history-item";
    row.title = [item.title, item.workspace, item.id].filter(Boolean).join("\n");

    const open = document.createElement("button");
    open.type = "button";
    open.className = "history-open";
    const main = document.createElement("span");
    main.className = "model-item-main";
    const name = document.createElement("span");
    name.className = "model-item-name";
    name.textContent = `${item.number}. ${item.title}`;
    main.appendChild(name);
    const sub = document.createElement("span");
    sub.className = "model-item-sub";
    const when = item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "";
    sub.textContent = [when, item.mode, item.model, `${item.messages} message(s)`].filter(Boolean).join(" · ");
    main.appendChild(sub);
    open.appendChild(main);
    open.onclick = () => {
        hideModelMenu();
        if (ui.status && ui.status.busy) {
            renderEntry({ type: "error", text: "Une demande est en cours : attends sa fin avant de changer de conversation." });
            return;
        }
        send(`/chat-id ${item.id}`);
    };

    const actions = document.createElement("span");
    actions.className = "history-actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "history-action";
    renameBtn.textContent = "✎";
    renameBtn.title = "Renommer";
    renameBtn.setAttribute("aria-label", "Renommer la conversation");
    renameBtn.onclick = (e) => {
        e.stopPropagation();
        startHistoryRename(row, item);
    };

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "history-action";
    removeBtn.textContent = "✕";
    removeBtn.title = "Supprimer de l'historique";
    removeBtn.setAttribute("aria-label", "Supprimer la conversation de l'historique");
    removeBtn.onclick = async (e) => {
        e.stopPropagation();
        if (removeBtn.dataset.confirm !== "1") {
            // Deux clics pour supprimer : évite les suppressions accidentelles.
            removeBtn.dataset.confirm = "1";
            removeBtn.textContent = "Supprimer ?";
            removeBtn.classList.add("danger");
            setTimeout(() => {
                if (removeBtn.isConnected && removeBtn.dataset.confirm === "1") {
                    removeBtn.dataset.confirm = "";
                    removeBtn.textContent = "✕";
                    removeBtn.classList.remove("danger");
                }
            }, 3000);
            return;
        }
        removeBtn.disabled = true;
        try {
            await api.conversationsRemove(item.id);
            ui.historyItems = (ui.historyItems || []).filter((x) => x.id !== item.id);
            ui.historyItems.forEach((x, i) => {
                x.number = i + 1; // même numérotation que /history
            });
            renderHistoryList();
        } catch (err) {
            removeBtn.disabled = false;
            renderEntry({ type: "error", text: err.message });
        }
    };

    actions.append(renameBtn, removeBtn);
    row.append(open, actions);
    return row;
}

function startHistoryRename(row, item) {
    const open = row.querySelector(".history-open");
    const actions = row.querySelector(".history-actions");
    if (!open || row.querySelector(".history-rename")) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "history-rename";
    input.value = item.title;
    input.maxLength = 200;
    open.style.display = "none";
    if (actions) actions.style.display = "none";
    row.insertBefore(input, open);
    input.focus();
    input.select();

    let done = false;
    const finish = async (save) => {
        if (done) return;
        done = true;
        const value = input.value.trim();
        if (save && value && value !== item.title) {
            try {
                const res = await api.conversationsRename(item.id, value);
                item.title = res.title;
            } catch (err) {
                renderEntry({ type: "error", text: err.message });
            }
        }
        renderHistoryList();
    };
    input.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
        } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
        }
    };
    input.onclick = (e) => e.stopPropagation();
    input.onblur = () => finish(true);
}

async function openHistoryMenu() {
    const anchor = $("btn-history");
    modelMenuEl.classList.remove("hidden");
    modelMenuEl.dataset.kind = "history";
    modelMenuEl.innerHTML = '<div class="model-empty">Chargement de l\'historique…</div>';
    positionModelMenu(anchor);
    try {
        const items = await api.conversationsRecent(30);
        if (!modelMenuEl.classList.contains("hidden") && modelMenuEl.dataset.kind === "history") {
            renderHistoryMenu(items);
            positionModelMenu(anchor);
        }
    } catch (err) {
        if (!modelMenuEl.classList.contains("hidden") && modelMenuEl.dataset.kind === "history") {
            modelMenuEl.innerHTML = `<div class="model-error">${escapeHtml(err.message)}</div>`;
        }
    }
}

function toggleHistoryMenu() {
    if (!modelMenuEl.classList.contains("hidden") && modelMenuEl.dataset.kind === "history") hideModelMenu();
    else openHistoryMenu();
}

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
function undoLineDiff(before, after) {
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
    for (let i = Math.max(0, start - 3); i < start; i++) ops.push({ t: " ", s: a[i] });
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
    for (let i = endA; i < Math.min(a.length, endA + 3); i++) ops.push({ t: " ", s: a[i] });
    return ops;
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
        let added = 0;
        let removed = 0;
        for (const op of undoLineDiff(diff.before, diff.after)) {
            const line = document.createElement("span");
            line.className = op.t === "+" ? "diff-line add" : op.t === "-" ? "diff-line del" : "diff-line";
            line.textContent = `${op.t} ${op.s}\n`;
            if (op.t === "+") added++;
            if (op.t === "-") removed++;
            box.appendChild(line);
        }
        const head = document.createElement("span");
        head.className = "diff-line head";
        head.textContent = `${diff.rel} · +${added} -${removed}\n`;
        box.prepend(head);
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
            const file = await api.readFile(rel);
            const text = normalize(file.content);
            tab = { path: rel, content: text, saved: text, eol: file.content.includes("\r\n") ? "\r\n" : "\n", dirty: false, scroll: 0 };
            ui.tabs.push(tab);
        } catch (err) {
            renderEntry({ type: "error", text: `${rel} : ${err.message}` });
            return;
        }
    }
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
    if (tab) code.focus();
    syncEditorContext();
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
    if (!tab) return;
    const content = tab.eol === "\r\n" ? tab.content.split("\n").join("\r\n") : tab.content;
    try {
        await api.writeFile(tab.path, content);
        tab.saved = tab.content;
        tab.dirty = false;
        renderTabs();
        $("st-file").textContent = `${tab.path} (enregistré)`;
        scheduleGitRefresh();
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

/* ---------- Saisie de l'agent ---------- */

/* ---------- Pièces jointes (fichiers / images) ---------- */

const MAX_ATTACHMENTS = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
let pendingAttachments = [];

/* Extensions binaires connues -> type MIME (utilisé si le navigateur n'en fournit pas). */
const BINARY_TYPES = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    dot: "application/msword",
    dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",
    rtf: "application/rtf",
    epub: "application/epub+zip",
    pages: "application/vnd.apple.pages",
    numbers: "application/vnd.apple.numbers",
    key: "application/vnd.apple.keynote",
    zip: "application/zip",
    gz: "application/gzip",
    tgz: "application/gzip",
    tar: "application/x-tar",
    "7z": "application/x-7z-compressed",
    rar: "application/vnd.rar",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    mov: "video/quicktime",
    heic: "image/heic",
    psd: "image/vnd.adobe.photoshop"
};

function fileExtension(name) {
    const match = /\.([a-z0-9]+)$/i.exec(String(name || ""));
    return match ? match[1].toLowerCase() : "";
}

/** true pour les PDF, documents Office, archives, médias… (à ne pas lire comme du texte). */
function isBinaryFile(file, name) {
    if (Object.prototype.hasOwnProperty.call(BINARY_TYPES, fileExtension(name))) return true;
    const type = String(file.type || "").toLowerCase();
    if (!type || type.startsWith("text/")) return false;
    if (/(json|xml|javascript|ecmascript|x-sh|x-python|yaml|toml|sql|csv)/.test(type)) return false;
    return /^(application|audio|video|font|image)\//.test(type);
}

/** Fichier quelconque -> pièce jointe { kind: "file" } en data URL base64 avec un type MIME. */
async function prepareFile(file, name) {
    if (file.size > MAX_FILE_BYTES) {
        throw new Error(`fichier trop lourd (${formatBytes(file.size)}, max ${formatBytes(MAX_FILE_BYTES)})`);
    }
    const mime = file.type || BINARY_TYPES[fileExtension(name)] || "application/octet-stream";
    const raw = await readAsDataUrl(file);
    const base64 = raw.slice(raw.indexOf(",") + 1);
    return { name, kind: "file", size: file.size, mime, data: `data:${mime};base64,${base64}` };
}

/** Icône de puce selon le type de fichier. */
function attachmentIcon(item) {
    const ext = fileExtension(item.name);
    if (ext === "pdf") return "📕";
    if (["doc", "docx", "dot", "dotx", "odt", "rtf", "pages"].includes(ext)) return "📘";
    if (["xls", "xlsx", "xlsm", "ods", "csv", "numbers"].includes(ext)) return "📗";
    if (["ppt", "pptx", "odp", "key"].includes(ext)) return "📙";
    if (["zip", "gz", "tgz", "tar", "7z", "rar"].includes(ext)) return "🗜️";
    if (/^audio\//.test(item.mime || "")) return "🎵";
    if (/^video\//.test(item.mime || "")) return "🎬";
    return item.kind === "file" ? "📎" : "📄";
}

function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error("Lecture impossible."));
        reader.readAsDataURL(file);
    });
}

function renderAttachments() {
    const box = $("attachments");
    box.replaceChildren();
    box.classList.toggle("hidden", pendingAttachments.length === 0);
    pendingAttachments.forEach((item, index) => {
        const chip = document.createElement("span");
        chip.className = "attachment-chip";
        const kindLabel = item.kind === "image" ? "image" : item.kind === "file" ? (item.mime || "fichier") : "texte";
        chip.title = item.size != null ? `${item.name} (${kindLabel}, ${formatBytes(item.size)})` : item.name;
        if (item.kind === "image") {
            const img = document.createElement("img");
            img.src = item.data;
            img.alt = "";
            chip.appendChild(img);
        } else {
            const icon = document.createElement("span");
            icon.className = "attachment-icon";
            icon.textContent = attachmentIcon(item);
            chip.appendChild(icon);
        }
        const label = document.createElement("span");
        label.className = "attachment-name";
        label.textContent = item.name;
        chip.appendChild(label);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "attachment-remove";
        remove.textContent = "×";
        remove.title = "Retirer";
        remove.onclick = () => {
            pendingAttachments.splice(index, 1);
            renderAttachments();
        };
        chip.appendChild(remove);
        box.appendChild(chip);
    });
}

/* Formats envoyés tels quels ; les autres (bmp, svg, tiff…) sont convertis via un canvas. */
const DIRECT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_SIDE = 2048;

function formatBytes(n) {
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
    return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

/**
 * Image -> data URL prête à l'envoi. Les images trop lourdes, trop grandes ou dans un
 * format peu pris en charge sont décodées, redimensionnées (2048 px max) puis
 * réencodées (PNG si possible, sinon JPEG) au lieu d'être refusées.
 */
async function prepareImage(file) {
    const direct = DIRECT_IMAGE_TYPES.has(file.type);
    if (direct && file.size <= MAX_IMAGE_BYTES) return readAsDataUrl(file);

    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error(`format d'image illisible (${file.type || "inconnu"}) : utiliser PNG, JPEG, WebP ou GIF`);
    }
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    const draw = (background) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    };
    try {
        if (file.type !== "image/jpeg") {
            draw(null);
            const png = canvas.toDataURL("image/png");
            if (png.length * 0.75 <= MAX_IMAGE_BYTES) return png;
        }
        draw("#ffffff"); // JPEG sans transparence : fond blanc plutôt que noir
        for (const quality of [0.88, 0.75, 0.6]) {
            const jpeg = canvas.toDataURL("image/jpeg", quality);
            if (jpeg.length * 0.75 <= MAX_IMAGE_BYTES) return jpeg;
        }
    } finally {
        if (bitmap.close) bitmap.close();
    }
    throw new Error(`image trop lourde même après compression (max ${formatBytes(MAX_IMAGE_BYTES)})`);
}

async function addAttachments(fileList) {
    for (const file of Array.from(fileList || [])) {
        if (pendingAttachments.length >= MAX_ATTACHMENTS) {
            renderEntry({ type: "error", text: `Maximum ${MAX_ATTACHMENTS} pièces jointes par message.` });
            break;
        }
        const name = file.name || (file.type.startsWith("image/") ? "image-collée.png" : "fichier");
        // Même fichier ajouté deux fois (double glisser-déposer, re-sélection) : ignoré.
        if (pendingAttachments.some((a) => a.name === name && a.size === file.size)) continue;
        try {
            if (file.size === 0) throw new Error("fichier vide");
            if (file.type.startsWith("image/")) {
                try {
                    pendingAttachments.push({ name, kind: "image", size: file.size, data: await prepareImage(file) });
                    continue;
                } catch (err) {
                    // Image non décodable (HEIC, PSD…) : envoyée telle quelle comme fichier.
                    if (file.size > MAX_FILE_BYTES) throw err;
                }
                pendingAttachments.push(await prepareFile(file, name));
                continue;
            }
            if (!isBinaryFile(file, name) && file.size <= MAX_TEXT_BYTES) {
                const data = await file.text();
                if (!data.includes("\u0000")) {
                    pendingAttachments.push({ name, kind: "text", size: file.size, data });
                    continue;
                }
            }
            // PDF, Office, archives, autres binaires : envoyés tels quels (Files v2).
            pendingAttachments.push(await prepareFile(file, name));
        } catch (err) {
            renderEntry({ type: "error", text: `${name} : ${err.message || err}` });
        }
    }
    renderAttachments();
}

async function send(text) {
    const value = text ?? input.value;
    const withFiles = text === undefined && pendingAttachments.length > 0;
    if (!value.trim() && !withFiles) return;
    const attachments = withFiles ? pendingAttachments : [];
    if (text === undefined) {
        if (value.trim()) {
            ui.history.push(value);
            ui.historyIndex = ui.history.length;
        }
        input.value = "";
        if (withFiles) {
            pendingAttachments = [];
            renderAttachments();
        }
    }
    hideSlash();
    try {
        await api.submit(value, attachments);
    } catch (err) {
        renderEntry({ type: "error", text: err.message });
    }
}

function slashMatches() {
    const value = input.value;
    if (!value.startsWith("/") || /\s/.test(value)) return [];
    return SLASH_COMMANDS.filter(([cmd]) => cmd.startsWith(value.toLowerCase()));
}

function hideSlash() {
    $("slash-menu").classList.add("hidden");
    ui.slashIndex = 0;
}

function updateSlash() {
    const matches = slashMatches();
    const menu = $("slash-menu");
    if (!matches.length) {
        hideSlash();
        return;
    }
    ui.slashIndex = Math.min(ui.slashIndex, matches.length - 1);
    menu.innerHTML = "";
    matches.forEach(([cmd, desc], i) => {
        const el = document.createElement("div");
        el.textContent = `${cmd}  —  ${desc}`;
        if (i === ui.slashIndex) el.className = "active";
        el.onmousedown = (ev) => {
            ev.preventDefault();
            ui.slashIndex = i;
            pickSlash();
        };
        menu.appendChild(el);
    });
    menu.classList.remove("hidden");
}

function moveSlash(delta) {
    const count = slashMatches().length;
    if (!count) return;
    ui.slashIndex = (ui.slashIndex + delta + count) % count;
    updateSlash();
}

function pickSlash() {
    const match = slashMatches()[ui.slashIndex];
    if (match) input.value = `${match[0]} `;
    hideSlash();
    input.focus();
}

input.addEventListener("input", updateSlash);

input.addEventListener("keydown", (ev) => {
    const menuOpen = !$("slash-menu").classList.contains("hidden");

    if (menuOpen && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
        ev.preventDefault();
        moveSlash(ev.key === "ArrowDown" ? 1 : -1);
        return;
    }
    if (menuOpen && (ev.key === "Tab" || (ev.key === "Enter" && !ev.shiftKey))) {
        const match = slashMatches()[ui.slashIndex];
        if (ev.key === "Tab" || (match && match[0] !== input.value.trim())) {
            ev.preventDefault();
            pickSlash();
            return;
        }
    }
    if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        send();
        return;
    }
    if (ev.key === "Escape") {
        ev.preventDefault();
        if (menuOpen) hideSlash();
        else if (ui.status.busy) api.interrupt().catch(() => {});
        else input.value = "";
        return;
    }
    if ((ev.key === "ArrowUp" || ev.key === "ArrowDown") && !input.value.includes("\n") && ui.history.length) {
        ev.preventDefault();
        const delta = ev.key === "ArrowUp" ? -1 : 1;
        ui.historyIndex = Math.max(0, Math.min(ui.history.length, ui.historyIndex + delta));
        input.value = ui.history[ui.historyIndex] ?? "";
    }
});

$("composer").addEventListener("submit", (ev) => {
    ev.preventDefault();
    send();
});

$("btn-attach").onclick = () => $("attach-input").click();
$("attach-input").addEventListener("change", async (ev) => {
    await addAttachments(ev.target.files);
    ev.target.value = "";
    input.focus();
});
input.addEventListener("paste", (ev) => {
    const files = Array.from(ev.clipboardData?.files || []);
    if (!files.length) return;
    ev.preventDefault();
    addAttachments(files);
});
$("composer").addEventListener("dragover", (ev) => {
    if (!ev.dataTransfer || !Array.from(ev.dataTransfer.types || []).includes("Files")) return;
    ev.preventDefault();
    $("composer").classList.add("drag-over");
});
$("composer").addEventListener("dragleave", (ev) => {
    // Ignorer les passages d'un enfant à l'autre du composer (sinon la surbrillance clignote).
    if (ev.relatedTarget && $("composer").contains(ev.relatedTarget)) return;
    $("composer").classList.remove("drag-over");
});
$("composer").addEventListener("drop", (ev) => {
    $("composer").classList.remove("drag-over");
    const files = ev.dataTransfer?.files;
    if (!files || !files.length) return;
    ev.preventDefault();
    addAttachments(files);
});

/* ---------- Contexte choisi par l'utilisateur : @fichier épinglé ---------- */

const AT_MAX_RESULTS = 12;
const MAX_PINNED = 20;
let atFilesCache = null;
let atFilesAt = 0;
let atFilesWorkspace = null;
let atIndex = 0;
let atItems = [];
let atSeq = 0;
if (!ui.pinnedFiles) ui.pinnedFiles = [];

function atMenuEl() {
    let menu = $("at-menu");
    if (!menu) {
        menu = document.createElement("div");
        menu.id = "at-menu";
        menu.className = "at-menu hidden";
        menu.setAttribute("role", "listbox");
        const slash = $("slash-menu");
        slash.parentNode.insertBefore(menu, slash.nextSibling);
    }
    return menu;
}

/** Jeton « @requête » juste avant le curseur, ou null. */
function atToken() {
    const caret = input.selectionStart ?? input.value.length;
    const m = /(^|\s)@([^\s@]*)$/.exec(input.value.slice(0, caret));
    return m ? { query: m[2], start: caret - m[2].length - 1, end: caret } : null;
}

async function atFiles() {
    const ws = ui.workspace || null;
    if (ws !== atFilesWorkspace) {
        // Autre projet : les fichiers épinglés de l'ancien n'ont plus de sens.
        atFilesWorkspace = ws;
        atFilesCache = null;
        if (ui.pinnedFiles.length) {
            ui.pinnedFiles = [];
            renderPinned();
            lastEditorContext = null;
            syncEditorContext();
        }
    }
    if (!ws) return [];
    if (!atFilesCache || Date.now() - atFilesAt > 30000) {
        try {
            const res = await api.listAllFiles();
            atFilesCache = Array.isArray(res) ? res : [];
        } catch {
            atFilesCache = [];
        }
        atFilesAt = Date.now();
    }
    return atFilesCache;
}

function atScore(path, q) {
    if (!q) return 3;
    const p = path.toLowerCase();
    const name = p.split("/").pop();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (p.includes(q)) return 2;
    let i = 0;
    for (const c of p) if (c === q[i]) i++;
    return i === q.length ? 4 : -1;
}

function hideAt() {
    const menu = $("at-menu");
    if (menu) menu.classList.add("hidden");
    atItems = [];
    atIndex = 0;
}

function renderAtMenu() {
    const menu = atMenuEl();
    menu.innerHTML = "";
    if (!atItems.length) {
        const empty = document.createElement("div");
        empty.className = "at-empty";
        empty.textContent = ui.workspace ? "Aucun fichier ne correspond." : "Aucun projet ouvert.";
        menu.appendChild(empty);
    }
    atItems.forEach((path, i) => {
        const el = document.createElement("div");
        el.className = i === atIndex ? "at-item active" : "at-item";
        el.setAttribute("role", "option");
        if (ui.pinnedFiles.includes(path)) el.classList.add("pinned");
        const name = document.createElement("span");
        name.className = "at-name";
        name.textContent = path.split("/").pop();
        const dir = document.createElement("span");
        dir.className = "at-dir";
        dir.textContent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        el.append(name, dir);
        el.onmousedown = (ev) => {
            ev.preventDefault();
            atIndex = i;
            pickAt();
        };
        menu.appendChild(el);
    });
    menu.classList.remove("hidden");
    const active = menu.querySelector(".at-item.active");
    if (active) active.scrollIntoView({ block: "nearest" });
}

async function updateAt() {
    const tok = atToken();
    if (!tok) {
        hideAt();
        return;
    }
    hideSlash();
    const seq = ++atSeq;
    const files = await atFiles();
    if (seq !== atSeq || !atToken()) return;
    const q = tok.query.toLowerCase();
    atItems = files
        .map((path) => ({ path, score: atScore(path, q) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => a.score - b.score || a.path.length - b.path.length)
        .slice(0, AT_MAX_RESULTS)
        .map((x) => x.path);
    atIndex = Math.min(atIndex, Math.max(0, atItems.length - 1));
    renderAtMenu();
}

function pickAt() {
    const path = atItems[atIndex];
    const tok = atToken();
    if (path && tok) {
        // Le jeton @… est retiré du message : le fichier passe en contexte épinglé.
        input.value = input.value.slice(0, tok.start) + input.value.slice(tok.end);
        input.setSelectionRange(tok.start, tok.start);
        pinFile(path);
    }
    hideAt();
    input.focus();
}

function pinFile(path) {
    if (ui.pinnedFiles.includes(path)) return;
    if (ui.pinnedFiles.length >= MAX_PINNED) {
        renderEntry({ type: "error", text: `Maximum ${MAX_PINNED} fichiers épinglés.` });
        return;
    }
    ui.pinnedFiles.push(path);
    renderPinned();
    lastEditorContext = null;
    syncEditorContext();
}

function unpinFile(path) {
    ui.pinnedFiles = ui.pinnedFiles.filter((p) => p !== path);
    renderPinned();
    lastEditorContext = null;
    syncEditorContext();
}

function renderPinned() {
    let box = $("pinned-files");
    if (!box) {
        box = document.createElement("div");
        box.id = "pinned-files";
        box.className = "pinned-files";
        const attachments = $("attachments");
        attachments.parentNode.insertBefore(box, attachments);
    }
    box.replaceChildren();
    box.classList.toggle("hidden", ui.pinnedFiles.length === 0);
    for (const path of ui.pinnedFiles) {
        const chip = document.createElement("span");
        chip.className = "attachment-chip pinned-chip";
        chip.title = `${path}\n(épinglé dans le contexte de l'agent)`;
        const icon = document.createElement("span");
        icon.className = "attachment-icon";
        icon.textContent = "@";
        const label = document.createElement("span");
        label.className = "attachment-name";
        label.textContent = path.split("/").pop();
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "attachment-remove";
        remove.textContent = "×";
        remove.title = "Retirer du contexte";
        remove.onclick = () => unpinFile(path);
        chip.append(icon, label, remove);
        box.appendChild(chip);
    }
}

input.addEventListener("input", updateAt);
input.addEventListener("blur", () => setTimeout(() => {
    if (document.activeElement !== input) hideAt();
}, 150));

// Phase de capture : passe avant le gestionnaire du menu « / » et de l'envoi.
input.addEventListener("keydown", (ev) => {
    const menu = $("at-menu");
    if (!menu || menu.classList.contains("hidden")) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (!atItems.length) return;
        atIndex = (atIndex + (ev.key === "ArrowDown" ? 1 : -1) + atItems.length) % atItems.length;
        renderAtMenu();
    } else if (ev.key === "Tab" || (ev.key === "Enter" && !ev.shiftKey)) {
        if (!atItems.length) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        pickAt();
    } else if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        hideAt();
    }
}, true);

/* ---------- Boutons et raccourcis ---------- */

$("btn-stop").onclick = () => {
    ui.interrupted = true;
    api.interrupt().catch(() => {});
};
$("btn-resume").onclick = () => {
    ui.interrupted = false;
    $("btn-resume").classList.add("hidden");
    send("Reprends la tâche précédente là où tu t'es arrêté (elle a été interrompue).");
};
$("btn-new").onclick = () => send("/new");
$("btn-clear").onclick = () => send("/clear");
$("btn-help").onclick = () => send("/help");
$("mode-select").onchange = (ev) => send(`/mode ${ev.target.value}`);
$("btn-model").onclick = (ev) => {
    ev.stopPropagation();
    toggleModelMenu();
};
$("st-model").onclick = () => toggleModelMenu();
$("btn-history").onclick = (ev) => {
    ev.stopPropagation();
    toggleHistoryMenu();
};
$("st-usage").onclick = () => {
    if (ui.status && ui.status.busy) return;
    api.submit("/usage", []).catch((err) => renderEntry({ type: "error", text: err.message }));
};
if (!$("st-usage").title) $("st-usage").title = "Cliquer pour afficher la consommation (/usage)";
$("btn-open-project").onclick = openProject;
$("btn-open-project-2").onclick = openProject;
$("btn-refresh-tree").onclick = () => renderTree();
$("btn-clear-output").onclick = () => {
    output.textContent = "";
};

function toggleSidebar() {
    const app = $("app");
    app.classList.toggle("no-sidebar");
    document.querySelector('[data-view="explorer"]').classList.toggle("active", !app.classList.contains("no-sidebar"));
}

document.querySelector('[data-view="explorer"]').onclick = toggleSidebar;
document.querySelector('[data-view="agent"]').onclick = () => input.focus();

const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent || "");
if (IS_MAC) document.documentElement.classList.add("mac");

document.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || (IS_MAC && ev.metaKey))) {
        if (ev.key === "Escape" && ui.status.busy && document.activeElement !== input) {
            api.interrupt().catch(() => {});
        }
        return;
    }
    const key = ev.key.toLowerCase();
    if (ev.shiftKey && key === "e") {
        ev.preventDefault();
        toggleSidebar();
    } else if (ev.shiftKey && key === "a") {
        ev.preventDefault();
        input.focus();
    } else if (key === "s") {
        ev.preventDefault();
        saveCurrent();
    } else if (key === "o") {
        ev.preventDefault();
        openProject();
    } else if (key === "w") {
        ev.preventDefault();
        if (ui.active) closeTab(ui.active);
    } else if (key === "l") {
        ev.preventDefault();
        input.focus();
    }
});

window.addEventListener("beforeunload", (ev) => {
    if (ui.tabs.some((t) => t.dirty)) {
        ev.preventDefault();
        ev.returnValue = "";
    }
});

function dragResizer(id, cssVar, axis, invert, min, max) {
    $(id).addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        const start = axis === "x" ? ev.clientX : ev.clientY;
        const initial = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10);
        const move = (e) => {
            const delta = (axis === "x" ? e.clientX : e.clientY) - start;
            const value = Math.max(min, Math.min(max, initial + (invert ? -delta : delta)));
            document.documentElement.style.setProperty(cssVar, `${value}px`);
        };
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    });
}

dragResizer("resizer-left", "--left", "x", false, 150, 600);
dragResizer("resizer-right", "--right", "x", true, 280, 900);
dragResizer("resizer-bottom", "--bottom", "y", true, 60, 600);

/* ---------- Boîte de saisie ---------- */

function inputDialog(title, value = "") {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        const box = document.createElement("div");
        box.className = "modal";
        const heading = document.createElement("div");
        heading.className = "modal-title";
        heading.textContent = title;
        const field = document.createElement("input");
        field.type = "text";
        field.value = value;
        const buttons = document.createElement("div");
        buttons.className = "buttons";
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "primary";
        ok.textContent = "OK";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Annuler";
        buttons.append(ok, cancel);
        box.append(heading, field, buttons);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const close = (result) => {
            overlay.remove();
            resolve(result);
        };
        ok.onclick = () => close(field.value.trim() || null);
        cancel.onclick = () => close(null);
        overlay.addEventListener("mousedown", (ev) => {
            if (ev.target === overlay) close(null);
        });
        field.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                close(field.value.trim() || null);
            } else if (ev.key === "Escape") {
                ev.preventDefault();
                ev.stopPropagation();
                close(null);
            }
        });
        setTimeout(() => {
            field.focus();
            const slash = field.value.lastIndexOf("/");
            const dot = field.value.lastIndexOf(".");
            field.setSelectionRange(slash + 1, dot > slash + 1 ? dot : field.value.length);
        }, 0);
    });
}

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
    if (!window.confirm(`Mettre « ${entry.path} » à la corbeille ?`)) return;
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
    if (s.webSearch !== undefined) $("set-web-search").checked = Boolean(s.webSearch);
    if (s.extensionsMode !== undefined) {
        $("set-extensions-auto").checked = s.extensionsMode !== "manual";
        $("set-extensions-manual").checked = s.extensionsMode === "manual";
    }
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
$("set-web-search").onchange = (e) => changeSetting(e.target.checked ? "web-on" : "web-off");
$("set-extensions-auto").onchange = (e) => { if (e.target.checked) changeSetting("extensions-auto"); };
$("set-extensions-manual").onchange = (e) => { if (e.target.checked) changeSetting("extensions-manual"); };

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
        ["Aller à la saisie de l'agent", "Ctrl+L", () => input.focus()]
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

/* ---------- Panneau du bas : sortie de l'agent et terminal ---------- */

ui.panel = "output";

/* Terminaux multiples (comme VS Code) : chaque terminal a sa sortie colorée (ANSI),
   son dossier courant, son historique et au plus une commande en cours. */
const termInput = $("terminal-input");
const termViews = $("term-views");
const termList = $("term-list");
const terms = [];
const termByProc = new Map();
const earlyData = new Map();
const exitedProcs = new Map();
let termSeq = 0;
let activeTermKey = null;

/* ---------- Vrai terminal : xterm.js + pseudo-terminal (node-pty) ----------
   Chaque onglet lance un shell interactif (zsh/bash, PowerShell sous Windows).
   Repli automatique sur le terminal simple ci-dessous si node-pty ou xterm.js
   est indisponible. */
const termByPty = new Map();
const earlyPty = new Map();
const exitedPty = new Map();
let ptyBroken = false;
const XTERM_THEME = {
    background: "#181818",
    foreground: "#cccccc",
    cursor: "#aeafad",
    cursorAccent: "#181818",
    selectionBackground: "#264f78",
    black: "#000000", red: "#cd3131", green: "#0dbc79", yellow: "#e5e510",
    blue: "#2472c8", magenta: "#bc3fbc", cyan: "#11a8cd", white: "#e5e5e5",
    brightBlack: "#666666", brightRed: "#f14c4c", brightGreen: "#23d18b", brightYellow: "#f5f543",
    brightBlue: "#3b8eea", brightMagenta: "#d670d6", brightCyan: "#29b8db", brightWhite: "#ffffff"
};

function xtermSupported() {
    return !ptyBroken
        && typeof window.Terminal === "function"
        && Boolean(window.FitAddon && window.FitAddon.FitAddon)
        && typeof api.ptyCreate === "function";
}

/** Ajuste xterm à la taille de son conteneur et prévient le shell (SIGWINCH). */
function fitTerm(term) {
    if (!term || !term.xterm || !term.el.isConnected || term.el.classList.contains("hidden")) return;
    if (!term.el.clientWidth || !term.el.clientHeight) return;
    try {
        term.fit.fit();
    } catch {
        return;
    }
    const { cols, rows } = term.xterm;
    if (term.ptyId && (cols !== term.lastCols || rows !== term.lastRows)) {
        term.lastCols = cols;
        term.lastRows = rows;
        api.ptyResize(term.ptyId, cols, rows).catch(() => {});
    }
}

function focusTerm(term = terms.find((t) => t.key === activeTermKey)) {
    if (term && term.xterm) term.xterm.focus();
    else termInput.focus();
}

function clearTerm(term) {
    if (!term) return;
    if (term.xterm) term.xterm.clear();
    else term.el.replaceChildren();
}

function disposeXterm(term) {
    if (!term || !term.xterm) return;
    if (term.ptyId) {
        termByPty.delete(term.ptyId);
        api.ptyKill(term.ptyId).catch(() => {});
        term.ptyId = null;
    }
    if (term.resizeObs) term.resizeObs.disconnect();
    try {
        term.xterm.dispose();
    } catch {
        // déjà libéré
    }
    term.xterm = null;
}

function startPty(term) {
    const xterm = term.xterm;
    if (!ui.workspace) {
        xterm.writeln("\x1b[33mAucun projet ouvert : ouvrez un dossier puis un nouveau terminal (+).\x1b[0m");
        return;
    }
    api.ptyCreate(".", xterm.cols, xterm.rows).then((res) => {
        if (!terms.includes(term) || !term.xterm) {
            api.ptyKill(res.id).catch(() => {});
            return;
        }
        term.ptyId = res.id;
        term.lastCols = xterm.cols;
        term.lastRows = xterm.rows;
        term.name = `${res.shell || "Terminal"} ${term.key}`;
        termByPty.set(res.id, term);
        if (earlyPty.has(res.id)) {
            xterm.write(earlyPty.get(res.id));
            earlyPty.delete(res.id);
        }
        if (exitedPty.has(res.id)) {
            const data = exitedPty.get(res.id);
            exitedPty.delete(res.id);
            ptyExit(data);
        }
        renderTermList();
        fitTerm(term);
    }).catch((err) => {
        const message = err && err.message ? err.message : String(err);
        xterm.writeln(`\x1b[31mTerminal indisponible : ${message}\x1b[0m`);
        if (/node-pty/i.test(message)) {
            ptyBroken = true;
            xterm.writeln("\x1b[90mLes prochains terminaux (+) utiliseront le mode simple.\x1b[0m");
        }
    });
}

function createXtermTerminal(focus) {
    const el = document.createElement("div");
    el.className = "term-view xterm-host";
    termViews.appendChild(el);
    const term = {
        key: termSeq,
        name: `Terminal ${termSeq}`,
        cwd: ".",
        root: ui.workspace || null,
        el,
        procId: null,
        ptyId: null,
        history: [],
        historyIndex: 0,
        style: {},
        pending: "",
        draft: ""
    };
    const xterm = new window.Terminal({
        cursorBlink: true,
        fontFamily: "Menlo, Monaco, 'SF Mono', Consolas, 'Courier New', monospace",
        fontSize: 13,
        lineHeight: 1.15,
        scrollback: 5000,
        macOptionIsMeta: true,
        theme: XTERM_THEME
    });
    const fit = new window.FitAddon.FitAddon();
    xterm.loadAddon(fit);
    term.xterm = xterm;
    term.fit = fit;
    terms.push(term);
    selectTerminal(term.key, false);
    xterm.open(el);
    // Laisse passer les raccourcis globaux de l'application (Ctrl+², Ctrl+J, Ctrl+P…).
    xterm.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== "keydown" || !(ev.ctrlKey || ev.metaKey)) return true;
        const k = String(ev.key || "").toLowerCase();
        if (ev.code === "Backquote" || k === "`" || k === "²") return false;
        if (k === "j" || k === "p") return false;
        if (ev.metaKey && (k === "c" || k === "v")) return false;
        return true;
    });
    xterm.onData((data) => {
        if (term.ptyId) api.ptyWrite(term.ptyId, data).catch(() => {});
    });
    term.resizeObs = new ResizeObserver(() => fitTerm(term));
    term.resizeObs.observe(el);
    fitTerm(term);
    startPty(term);
    if (focus) setTimeout(() => focusTerm(term), 0);
    return term;
}

/** Sortie d'un pseudo-terminal (événement ptyData). */
function ptyData(data) {
    if (!data || data.id === undefined || data.id === null || typeof data.data !== "string") return;
    const term = termByPty.get(data.id);
    if (term && term.xterm) {
        term.xterm.write(data.data);
        return;
    }
    earlyPty.set(data.id, (earlyPty.get(data.id) || "") + data.data);
    while (earlyPty.size > 50) earlyPty.delete(earlyPty.keys().next().value);
}

function ptyExit(data) {
    if (!data || data.id === undefined || data.id === null) return;
    const term = termByPty.get(data.id);
    if (!term) {
        exitedPty.set(data.id, data);
        while (exitedPty.size > 50) exitedPty.delete(exitedPty.keys().next().value);
        return;
    }
    termByPty.delete(data.id);
    term.ptyId = null;
    if (term.xterm) {
        const how = data.signal ? `signal ${data.signal}` : `code ${data.code}`;
        term.xterm.writeln(`\r\n\x1b[90m[shell terminé, ${how}] · + pour ouvrir un nouveau terminal\x1b[0m`);
    }
    renderTermList();
}

const ANSI_COLORS = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5"];
const ANSI_BRIGHT = ["#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"];

function ansi256(n) {
    if (n < 8) return ANSI_COLORS[n];
    if (n < 16) return ANSI_BRIGHT[n - 8];
    if (n < 232) {
        const v = n - 16;
        const c = (x) => (x ? 55 + x * 40 : 0);
        return `rgb(${c(Math.floor(v / 36))},${c(Math.floor(v / 6) % 6)},${c(v % 6)})`;
    }
    const g = 8 + (n - 232) * 10;
    return `rgb(${g},${g},${g})`;
}

function applySgr(style, params) {
    const p = params.length ? params : [0];
    for (let i = 0; i < p.length; i++) {
        const n = p[i];
        if (n === 0) Object.assign(style, { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false });
        else if (n === 1) style.bold = true;
        else if (n === 2) style.dim = true;
        else if (n === 3) style.italic = true;
        else if (n === 4) style.underline = true;
        else if (n === 7) style.inverse = true;
        else if (n === 22) { style.bold = false; style.dim = false; }
        else if (n === 23) style.italic = false;
        else if (n === 24) style.underline = false;
        else if (n === 27) style.inverse = false;
        else if (n >= 30 && n <= 37) style.fg = ANSI_COLORS[n - 30];
        else if (n === 39) style.fg = null;
        else if (n >= 40 && n <= 47) style.bg = ANSI_COLORS[n - 40];
        else if (n === 49) style.bg = null;
        else if (n >= 90 && n <= 97) style.fg = ANSI_BRIGHT[n - 90];
        else if (n >= 100 && n <= 107) style.bg = ANSI_BRIGHT[n - 100];
        else if (n === 38 || n === 48) {
            let color = null;
            if (p[i + 1] === 5) { color = ansi256(p[i + 2] || 0); i += 2; }
            else if (p[i + 1] === 2) { color = `rgb(${p[i + 2] || 0},${p[i + 3] || 0},${p[i + 4] || 0})`; i += 4; }
            if (n === 38) style.fg = color;
            else style.bg = color;
        }
    }
}

/** Ajoute du texte (avec séquences ANSI) à la sortie d'un terminal. */
function termAppend(term, text) {
    if (!term || !text) return;
    let data = term.pending + String(text);
    term.pending = "";
    const cut = /\x1b(\[[0-9;?]*)?$/.exec(data);
    if (cut) {
        term.pending = cut[0];
        data = data.slice(0, cut.index);
    }
    data = data.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "").split("\r\n").join("\n");
    const el = term.el;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    const frag = document.createDocumentFragment();
    const flush = (chunk) => {
        const part = chunk.replace(/[^\n\r]*\r/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
        if (!part) return;
        const s = term.style;
        if (!s.fg && !s.bg && !s.bold && !s.dim && !s.italic && !s.underline && !s.inverse) {
            frag.appendChild(document.createTextNode(part));
            return;
        }
        const span = document.createElement("span");
        span.textContent = part;
        let fg = s.fg;
        let bg = s.bg;
        if (s.inverse) {
            fg = s.bg || "#181818";
            bg = s.fg || "#cccccc";
        }
        if (fg) span.style.color = fg;
        if (bg) span.style.backgroundColor = bg;
        if (s.bold) span.style.fontWeight = "bold";
        if (s.dim) span.style.opacity = "0.7";
        if (s.italic) span.style.fontStyle = "italic";
        if (s.underline) span.style.textDecoration = "underline";
        frag.appendChild(span);
    };
    const re = /\x1b\[([0-9;?]*)([ -/]*)([@-~])/g;
    let last = 0;
    let m;
    while ((m = re.exec(data))) {
        flush(data.slice(last, m.index));
        last = re.lastIndex;
        if (m[3] === "m" && !m[1].includes("?")) {
            applySgr(term.style, m[1].split(";").filter((x) => x !== "").map(Number));
        }
    }
    flush(data.slice(last));
    el.appendChild(frag);
    while (el.childNodes.length > 4000) el.removeChild(el.firstChild);
    if (atBottom) el.scrollTop = el.scrollHeight;
}

function termPrompt(term) {
    const root = String(ui.workspace || "").split(/[\\/]/).filter(Boolean).pop() || "projet";
    return `PS ${term.cwd === "." ? root : `${root}/${term.cwd}`}>`;
}

function createTerminal(focus = true) {
    termSeq++;
    if (xtermSupported()) {
        try {
            return createXtermTerminal(focus);
        } catch (err) {
            console.warn("[terminal] xterm.js indisponible, repli sur le terminal simple :", err);
            ptyBroken = true;
            const broken = terms.find((t) => t.key === termSeq);
            if (broken) {
                disposeXterm(broken);
                broken.el.remove();
                terms.splice(terms.indexOf(broken), 1);
            }
        }
    }
    const el = document.createElement("pre");
    el.className = "output term-view";
    termViews.appendChild(el);
    const term = {
        key: termSeq,
        name: `PowerShell ${termSeq}`,
        cwd: ".",
        root: ui.workspace || null,
        el,
        procId: null,
        history: [],
        historyIndex: 0,
        style: {},
        pending: "",
        draft: ""
    };
    applySgr(term.style, [0]);
    terms.push(term);
    selectTerminal(term.key, focus);
    termAppend(term, "\x1b[90mPowerShell dans le dossier du projet · « cd » change de dossier · « cls » ou Ctrl+L efface · Ctrl+C arrête.\x1b[0m\n");
    return term;
}

function activeTerm() {
    return terms.find((t) => t.key === activeTermKey) || terms[0] || createTerminal(false);
}

function selectTerminal(key, focus = false) {
    const prev = terms.find((t) => t.key === activeTermKey);
    if (prev && prev.key !== key) prev.draft = termInput.value;
    activeTermKey = key;
    const term = terms.find((t) => t.key === key);
    for (const t of terms) t.el.classList.toggle("hidden", t !== term);
    if (term && prev !== term) termInput.value = term.draft || "";
    // La ligne de saisie simple ne sert qu'au terminal de repli : xterm gère sa propre saisie.
    const line = document.querySelector("#terminal .terminal-line");
    if (line) line.classList.toggle("hidden", Boolean(term && term.xterm));
    renderTermList();
    updateKillButton();
    if (term && term.xterm) requestAnimationFrame(() => fitTerm(term));
    if (focus) setTimeout(() => focusTerm(term), 0);
}

function renderTermList() {
    termList.replaceChildren();
    termList.classList.toggle("hidden", terms.length < 2);
    for (const t of terms) {
        const row = document.createElement("div");
        row.className = `term-item${t.key === activeTermKey ? " active" : ""}${t.procId ? " running" : ""}`;
        row.title = t.cwd === "." ? t.name : `${t.name} — ${t.cwd}`;
        const dot = document.createElement("span");
        dot.className = "term-dot";
        const label = document.createElement("span");
        label.className = "term-name";
        label.textContent = t.name;
        const close = document.createElement("button");
        close.type = "button";
        close.className = "term-close";
        close.textContent = "×";
        close.title = "Fermer ce terminal";
        close.onclick = (ev) => {
            ev.stopPropagation();
            closeTerminal(t.key);
        };
        row.append(dot, label, close);
        row.onclick = () => selectTerminal(t.key, true);
        termList.appendChild(row);
    }
    const term = terms.find((t) => t.key === activeTermKey);
    $("terminal-ps").textContent = term ? termPrompt(term) : "PS>";
}

function closeTerminal(key) {
    const index = terms.findIndex((t) => t.key === key);
    if (index < 0) return;
    const term = terms[index];
    if (term.procId && term.procId !== "pending") {
        termByProc.delete(term.procId);
        api.killTerminal(term.procId).catch(() => {});
    }
    disposeXterm(term);
    term.el.remove();
    terms.splice(index, 1);
    if (!terms.length) {
        activeTermKey = null;
        createTerminal(ui.panel === "terminal");
        return;
    }
    if (activeTermKey === key) selectTerminal(terms[Math.min(index, terms.length - 1)].key, true);
    else renderTermList();
}

function selectPanel(name, focus = false) {
    ui.panel = name;
    $("app").classList.remove("no-panel");
    $("tab-output").classList.toggle("active", name === "output");
    $("tab-terminal").classList.toggle("active", name === "terminal");
    $("tab-changes").classList.toggle("active", name === "changes");
    output.classList.toggle("hidden", name !== "output");
    $("terminal").classList.toggle("hidden", name !== "terminal");
    $("changes").classList.toggle("hidden", name !== "changes");
    if (name === "changes") renderChangesList();
    if (name === "terminal" && !terms.length) createTerminal(focus);
    updateKillButton();
    if (name === "terminal") {
        const current = terms.find((t) => t.key === activeTermKey);
        if (current && current.xterm) requestAnimationFrame(() => fitTerm(current));
    }
    if (focus && name === "terminal") setTimeout(() => focusTerm(), 0);
    saveLayout();
}

function togglePanel(name) {
    const app = $("app");
    if (!app.classList.contains("no-panel") && (!name || name === ui.panel)) {
        app.classList.add("no-panel");
        saveLayout();
        return;
    }
    selectPanel(name || ui.panel, true);
}

function updateKillButton() {
    const term = terms.find((t) => t.key === activeTermKey);
    const running = Boolean(term && term.procId && term.procId !== "pending");
    const onTerminal = ui.panel === "terminal";
    $("btn-kill-terminal").classList.toggle("hidden", !running || !onTerminal);
    $("btn-new-terminal").classList.toggle("hidden", !onTerminal);
    $("btn-close-terminal").classList.toggle("hidden", !onTerminal);
    $("terminal").classList.toggle("running", running);
}

$("tab-output").onclick = () => selectPanel("output");
$("tab-terminal").onclick = () => selectPanel("terminal", true);
$("tab-changes").onclick = () => selectPanel("changes");
$("btn-undo").onclick = () => send("/undo");
$("btn-clear-output").onclick = () => {
    if (ui.panel === "terminal") clearTerm(activeTerm());
    else if (ui.panel === "changes") clearChanges();
    else output.textContent = "";
};

function capMap(map, max = 50) {
    while (map.size > max) map.delete(map.keys().next().value);
}

/** Sortie d'un processus : envoyée au terminal qui l'a lancé (mise de côté si son id n'est pas encore connu). */
function termData(data) {
    if (!data || data.id === undefined || data.id === null || !data.text) return;
    const term = termByProc.get(data.id);
    if (term) {
        termAppend(term, data.text);
        return;
    }
    earlyData.set(data.id, (earlyData.get(data.id) || "") + String(data.text));
    capMap(earlyData);
}

function termExit(data) {
    if (!data || data.id === undefined || data.id === null) return;
    const term = termByProc.get(data.id);
    if (!term) {
        exitedProcs.set(data.id, data);
        capMap(exitedProcs);
        return;
    }
    termByProc.delete(data.id);
    term.procId = null;
    const ok = !data.signal && Number(data.code) === 0;
    const how = data.signal ? `signal ${data.signal}` : `code ${data.code}`;
    termAppend(term, `\x1b[${ok ? "90" : "31"}m[processus terminé, ${how}]\x1b[0m\n`);
    renderTermList();
    updateKillButton();
}

async function runTerminalLine(line, term = activeTerm()) {
    const trimmed = String(line || "").trim();
    if (!trimmed) {
        termAppend(term, `\x1b[1;32m${termPrompt(term)}\x1b[0m\n`);
        return;
    }
    if (term.history[term.history.length - 1] !== trimmed) term.history.push(trimmed);
    if (term.history.length > 200) term.history.shift();
    term.historyIndex = term.history.length;
    if (/^(cls|clear|clear-host)$/i.test(trimmed)) {
        term.el.replaceChildren();
        return;
    }
    if (term.procId) {
        termAppend(term, "\x1b[33mUne commande est déjà en cours (Ctrl+C ou ■ pour l'arrêter, + pour ouvrir un autre terminal).\x1b[0m\n");
        return;
    }
    if (!ui.workspace) {
        termAppend(term, "\x1b[31mOuvrez d'abord un projet.\x1b[0m\n");
        return;
    }
    termAppend(term, `\x1b[1;32m${termPrompt(term)}\x1b[0m ${trimmed}\n`);

    const cd = /^(cd|chdir|set-location|sl)(?:\s+(.*))?$/i.exec(trimmed);
    if (cd && !/[;&|]/.test(trimmed)) {
        const target = String(cd[2] || "").trim().replace(/^["']|["']$/g, "") || ".";
        try {
            term.cwd = (await api.terminalCd(term.cwd, target)) || ".";
        } catch (err) {
            termAppend(term, `\x1b[31m${err.message}\x1b[0m\n`);
        }
        renderTermList();
        return;
    }

    term.procId = "pending";
    renderTermList();
    updateKillButton();
    try {
        const res = await api.runTerminal(trimmed, term.cwd);
        const id = res && typeof res === "object" ? res.id : res;
        if (!terms.includes(term)) {
            api.killTerminal(id).catch(() => {});
            return;
        }
        term.procId = id;
        termByProc.set(id, term);
        if (earlyData.has(id)) {
            const text = earlyData.get(id);
            earlyData.delete(id);
            termAppend(term, text);
        }
        if (exitedProcs.has(id)) {
            const data = exitedProcs.get(id);
            exitedProcs.delete(id);
            termExit(data);
            return;
        }
    } catch (err) {
        term.procId = null;
        termAppend(term, `\x1b[31mErreur : ${err.message}\x1b[0m\n`);
    }
    renderTermList();
    updateKillButton();
}

async function killTerm(term = activeTerm()) {
    const id = term.procId;
    if (!id || id === "pending") return;
    try {
        await api.killTerminal(id);
    } catch (err) {
        termAppend(term, `\x1b[31mArrêt impossible : ${err.message}\x1b[0m\n`);
    }
}

$("btn-kill-terminal").onclick = () => killTerm();
$("btn-new-terminal").onclick = () => createTerminal(true);
$("btn-close-terminal").onclick = () => {
    if (activeTermKey !== null) closeTerminal(activeTermKey);
};

termInput.addEventListener("keydown", (ev) => {
    const term = activeTerm();
    const key = String(ev.key || "").toLowerCase();
    if (ev.key === "Enter") {
        ev.preventDefault();
        const value = termInput.value;
        termInput.value = "";
        term.draft = "";
        runTerminalLine(value, term);
    } else if (ev.ctrlKey && !ev.shiftKey && key === "c" && termInput.selectionStart === termInput.selectionEnd) {
        ev.preventDefault();
        if (term.procId && term.procId !== "pending") {
            killTerm(term);
        } else {
            termAppend(term, `\x1b[1;32m${termPrompt(term)}\x1b[0m ${termInput.value}\x1b[90m^C\x1b[0m\n`);
            termInput.value = "";
            term.historyIndex = term.history.length;
        }
    } else if (ev.ctrlKey && !ev.shiftKey && key === "l") {
        ev.preventDefault();
        term.el.replaceChildren();
    } else if ((ev.key === "ArrowUp" || ev.key === "ArrowDown") && term.history.length) {
        ev.preventDefault();
        const delta = ev.key === "ArrowUp" ? -1 : 1;
        term.historyIndex = Math.max(0, Math.min(term.history.length, term.historyIndex + delta));
        termInput.value = term.history[term.historyIndex] ?? "";
    }
});

$("terminal").addEventListener("mouseup", (ev) => {
    // Clic dans la liste des onglets : selectTerminal gère déjà le focus.
    if (ev.target && ev.target.closest && ev.target.closest("#term-list")) return;
    const current = terms.find((t) => t.key === activeTermKey);
    if (current && current.xterm) {
        if (!current.xterm.hasSelection()) current.xterm.focus();
        return;
    }
    if (!String(window.getSelection())) termInput.focus();
});

/* ---------- Raccourcis globaux ---------- */

function isEditable(el) {
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
}

window.addEventListener("keydown", (ev) => {
    if (!ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        if (ev.key === "Escape" && !contextMenu.classList.contains("hidden")) {
            ev.stopPropagation();
            hideContextMenu();
            return;
        }
        if (ev.key === "Escape" && !modelMenuEl.classList.contains("hidden")) {
            const active = document.activeElement;
            // La recherche et le renommage de l'historique gèrent Escape eux-mêmes.
            if (active && modelMenuEl.contains(active) && active.matches(".history-search, .history-rename")) return;
            ev.stopPropagation();
            hideModelMenu();
            return;
        }
        const p = ui.prompts[0];
        const free = !isEditable(document.activeElement) && !document.querySelector(".modal-overlay") && $("palette").classList.contains("hidden");
        if (p && p.kind === "confirm" && free) {
            const k = ev.key.toLowerCase();
            const value = k === "o" || k === "y" ? "o" : k === "n" ? "n" : k === "t" && !p.force ? "t" : null;
            if (value) {
                ev.preventDefault();
                ev.stopPropagation();
                api.resolvePrompt(p.id, value).catch((err) => renderEntry({ type: "error", text: err.message }));
            }
        }
        return;
    }
    const key = ev.key.toLowerCase();
    let action = null;
    if ((ev.code === "Backquote" || key === "`" || key === "²") && ev.shiftKey) action = () => {
        selectPanel("terminal", false);
        createTerminal(true);
    };
    else if (ev.code === "Backquote" || key === "`" || key === "²") action = () => togglePanel("terminal");
    else if (key === "p" && ev.shiftKey) action = () => openPalette("commands");
    else if (key === "p") action = () => openPalette("files");
    else if (key === "f" && ev.shiftKey) action = focusSearch;
    else if (key === "e" && ev.shiftKey) action = () => toggleSideView("explorer");
    else if (key === "j" && !ev.shiftKey) action = () => togglePanel();
    else if (key === "g" && ev.shiftKey) action = () => toggleSideView("git");
    else if (key === "g" && !ev.shiftKey) action = askGoToLine;
    else if (key === "n" && !ev.shiftKey) action = () => newEntry("file", ".");
    else if (key === "b" && !ev.shiftKey) action = () => toggleSideView(ui.sideView || "explorer");
    if (!action) return;
    ev.preventDefault();
    ev.stopPropagation();
    action();
}, true);

document.addEventListener("mousedown", (ev) => {
    if (!contextMenu.classList.contains("hidden") && !contextMenu.contains(ev.target)) hideContextMenu();
    if (!modelMenuEl.classList.contains("hidden") &&
        !modelMenuEl.contains(ev.target) &&
        !ev.target.closest("#btn-model") &&
        !ev.target.closest("#btn-history") &&
        !ev.target.closest("#st-model")) {
        hideModelMenu();
    }
    const pal = $("palette");
    if (!pal.classList.contains("hidden") && !pal.contains(ev.target)) closePalette();
});
window.addEventListener("blur", hideContextMenu);

/* ---------- Copie des blocs de code ---------- */

transcript.addEventListener("dblclick", (ev) => {
    const pre = ev.target.closest("pre");
    if (!pre) return;
    navigator.clipboard.writeText(pre.textContent).then(() => {
        pre.classList.add("copied");
        setTimeout(() => pre.classList.remove("copied"), 900);
    }).catch(() => {});
});

/* ---------- Disposition mémorisée ---------- */

const LAYOUT_KEY = "frst.desktop.layout";
const LAYOUT_VARS = ["--left", "--right", "--bottom"];

function saveLayout() {
    try {
        const data = { noPanel: $("app").classList.contains("no-panel") };
        for (const v of LAYOUT_VARS) {
            const value = document.documentElement.style.getPropertyValue(v).trim();
            if (value) data[v] = value;
        }
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(data));
    } catch {
        // stockage local indisponible
    }
}

try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}");
    for (const v of LAYOUT_VARS) {
        if (/^[0-9]+px$/.test(saved[v] || "")) document.documentElement.style.setProperty(v, saved[v]);
    }
    if (saved.noPanel) $("app").classList.add("no-panel");
} catch {
    // disposition par défaut
}

/* ---------- Barre de titre, accueil et zone de saisie ---------- */

function bindClick(id, fn) {
    const el = $(id);
    if (el) el.addEventListener("click", fn);
}

function toggleAgent() {
    const app = $("app");
    app.classList.toggle("no-agent");
    if (!app.classList.contains("no-agent")) input.focus();
}

function syncTitlebar() {
    const app = $("app");
    const set = (id, on) => {
        const el = $(id);
        if (el) el.classList.toggle("active", on);
    };
    set("tb-toggle-sidebar", !app.classList.contains("no-sidebar"));
    set("tb-toggle-panel", !app.classList.contains("no-panel"));
    set("tb-toggle-agent", !app.classList.contains("no-agent"));
}

bindClick("tb-palette", () => openPalette("files"));
bindClick("tb-toggle-sidebar", () => toggleSideView(ui.sideView || "explorer"));
bindClick("tb-toggle-panel", () => togglePanel());
bindClick("tb-toggle-agent", toggleAgent);
bindClick("wa-open", () => openProject());
bindClick("wa-goto", () => openPalette("files"));
bindClick("wa-palette", () => openPalette("commands"));
bindClick("wa-terminal", () => togglePanel("terminal"));

new MutationObserver(syncTitlebar).observe($("app"), { attributes: true, attributeFilter: ["class"] });
syncTitlebar();

function autosizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
}

input.addEventListener("input", autosizeInput);
input.addEventListener("keyup", autosizeInput);
$("composer").addEventListener("submit", () => setTimeout(autosizeInput, 0));

window.addEventListener("mouseup", () => setTimeout(saveLayout, 0));
window.addEventListener("beforeunload", saveLayout);

/* ---------- Événements du processus principal ---------- */

api.onEvent((channel, data) => {
    switch (channel) {
        case "entry":
            renderEntry(data);
            if (data.type === "result" || data.type === "diff") scheduleRefresh();
            break;
        case "liveStart":
            liveStart();
            break;
        case "liveAppend":
            liveAppend(data);
            break;
        case "liveEnd":
            liveEnd();
            break;
        case "spinner":
            setSpinner(data);
            break;
        case "prompt":
            ui.prompts.push(data);
            if (ui.prompts.length === 1) showPrompt();
            break;
        case "promptResolved": {
            const wasFirst = ui.prompts[0] && ui.prompts[0].id === data.id;
            ui.prompts = ui.prompts.filter((p) => p.id !== data.id);
            if (wasFirst) showPrompt();
            break;
        }
        case "commandLine":
            appendOutput(data);
            break;
        case "clear":
            transcript.innerHTML = "";
            toolGroup = null;
            liveEnd();
            clearChanges();
            break;
        case "terminalData":
            termData(data);
            break;
        case "terminalExit":
            termExit(data || {});
            break;
        case "ptyData":
            ptyData(data);
            break;
        case "ptyExit":
            ptyExit(data || {});
            break;
        case "status":
            applyStatus(data);
            break;
        default:
            break;
    }
});

/* ---------- Vue Git : état du dépôt, diff inline et journal ---------- */

ui.git = { open: null, timer: null, busy: false };

function gitCode(file) {
    const code = `${file.index || " "}${file.worktree || " "}`.trim();
    return code || "M";
}

function gitDiffLines(result) {
    const text = typeof result === "string" ? result : String(result?.diff ?? result?.text ?? "");
    return text
        .split(/\r?\n/)
        .filter((line) => line && !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename from|rename to)/.test(line));
}

function gitCountChanges(lines) {
    let added = 0;
    let removed = 0;
    for (const line of lines) {
        if (line[0] === "+") added++;
        else if (line[0] === "-") removed++;
    }
    return { added, removed };
}

function updateGitBadge(count) {
    const badge = $("git-count");
    if (!badge) return;
    badge.textContent = count ? String(count) : "";
    badge.classList.toggle("hidden", !count);
}

function gitMessage(container, text) {
    container.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "ext-empty";
    empty.textContent = text;
    container.appendChild(empty);
}

async function toggleGitDiff(file, row) {
    const next = row.nextElementSibling;
    if (next && next.classList.contains("git-diff")) {
        next.remove();
        ui.git.open = null;
        return;
    }
    document.querySelectorAll("#git-files .git-diff").forEach((el) => el.remove());
    ui.git.open = file.path;
    const holder = document.createElement("div");
    holder.className = "git-diff";
    holder.textContent = "Chargement du diff…";
    row.after(holder);
    try {
        let lines;
        if (file.worktree === "?") {
            // Fichier non suivi : tout son contenu est un ajout.
            const content = await api.readFile(file.path);
            const text = typeof content === "string" ? content : String(content?.content ?? "");
            lines = text.split(/\r?\n/).map((l) => `+${l}`);
        } else {
            lines = gitDiffLines(await api.gitDiff(file.path, Boolean(file.staged)));
        }
        holder.innerHTML = "";
        if (!lines.length) {
            holder.textContent = "Aucune différence textuelle (fichier binaire ou changement de mode).";
            return;
        }
        holder.appendChild(buildDiffCard({ path: file.path, lines, ...gitCountChanges(lines) }));
    } catch (error) {
        holder.textContent = `Diff impossible : ${error.message}`;
    }
}

function renderGitFiles(files) {
    const list = $("git-files");
    list.innerHTML = "";
    if (!files.length) {
        gitMessage(list, "Aucune modification : l'arbre de travail est propre.");
        return;
    }
    for (const file of files) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "git-row";
        row.title = `${file.path}${file.from ? ` (depuis ${file.from})` : ""} — ${file.label || ""}\nClic : diff · Double-clic : ouvrir`;
        row.appendChild(fileIcon(file.path, "file"));
        const p = document.createElement("span");
        p.className = "git-path";
        p.textContent = file.path;
        row.appendChild(p);
        const c = document.createElement("span");
        c.className = "git-code";
        c.textContent = gitCode(file) + (file.staged ? " ·indexé" : "");
        row.appendChild(c);
        row.onclick = () => toggleGitDiff(file, row);
        row.ondblclick = () => { if (file.worktree !== "D" && file.index !== "D") openFile(file.path); };
        list.appendChild(row);
        if (ui.git.open === file.path) toggleGitDiff(file, row);
    }
}

function renderGitLog(commits) {
    const list = $("git-log");
    list.innerHTML = "";
    if (!commits.length) {
        gitMessage(list, "Aucun commit pour l'instant.");
        return;
    }
    for (const commit of commits) {
        const row = document.createElement("div");
        row.className = "git-commit";
        row.title = `${commit.hash}\n${commit.author} — ${commit.date}`;
        const h = document.createElement("span");
        h.className = "git-hash";
        h.textContent = commit.short;
        row.appendChild(h);
        const s = document.createElement("span");
        s.textContent = ` ${commit.subject}`;
        row.appendChild(s);
        list.appendChild(row);
    }
}

async function refreshGit() {
    if (ui.git.busy) return;
    ui.git.busy = true;
    const branch = $("git-branch");
    try {
        const st = await api.gitStatus();
        if (!st || !st.repo) {
            branch.textContent = "Pas de dépôt Git dans ce dossier.";
            gitMessage($("git-files"), "Initialisez un dépôt avec « git init » dans le terminal.");
            $("git-log").innerHTML = "";
            updateGitBadge(0);
            return;
        }
        const sync = [st.ahead ? `↑${st.ahead}` : "", st.behind ? `↓${st.behind}` : ""].filter(Boolean).join(" ");
        branch.textContent = `Branche ${st.branch || "(détachée)"}${sync ? ` · ${sync}` : ""} · ${st.files.length} fichier(s) modifié(s)`;
        updateGitBadge(st.files.length);
        renderGitFiles(st.files);
        renderGitLog(await api.gitLog(20));
    } catch (error) {
        branch.textContent = `Git : ${gitErrorText(error)}`;
    } finally {
        ui.git.busy = false;
        refreshGitHub();
    }
}

/** Message d'erreur IPC sans le préfixe ajouté par Electron. */
function gitErrorText(error) {
    return String((error && error.message) || error || "").replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
}

function gitActionMessage(text, kind) {
    const box = $("git-action-msg");
    box.textContent = text || "";
    box.className = `git-action-msg${kind ? ` ${kind}` : ""}`;
}

/** État du compte GitHub et du remote origin (seule la version masquée du token arrive ici). */
async function refreshGitHub() {
    if (!api.githubStatus) return;
    const account = $("gh-account");
    try {
        const st = await api.githubStatus();
        if (st.connected) {
            account.textContent = `Connecté : ${st.login || "?"}${st.name ? ` (${st.name})` : ""} · token ${st.masked || ""}${st.source ? ` (${st.source})` : ""}`;
        } else if (st.error) {
            account.textContent = `Token refusé ou réseau indisponible : ${st.error}`;
        } else {
            account.textContent = "Non connecté à GitHub.";
        }
        $("gh-login-row").classList.toggle("hidden", Boolean(st.connected));
        $("gh-logout-row").classList.toggle("hidden", !(st.connected || st.masked));
        $("gh-remote").textContent = st.remote ? `Remote origin : ${st.remote}` : "Aucun remote « origin ».";
    } catch (error) {
        account.textContent = `GitHub : ${gitErrorText(error)}`;
    }
}

/** Lance une action Git/GitHub : boutons désactivés pendant l'action, message, puis actualisation. */
async function runGitAction(label, fn) {
    if (ui.git.action) return;
    ui.git.action = true;
    const buttons = Array.from(document.querySelectorAll("#git-view button"));
    buttons.forEach((b) => { b.disabled = true; });
    gitActionMessage(`${label}…`, "");
    try {
        const text = await fn();
        gitActionMessage(text || `${label} : terminé.`, "ok");
    } catch (error) {
        gitActionMessage(`${label} : ${gitErrorText(error)}`, "error");
    } finally {
        buttons.forEach((b) => { b.disabled = false; });
        ui.git.action = false;
        refreshGit();
    }
}

function gitCommitNow() {
    const input = $("git-commit-msg");
    const message = input.value.trim();
    if (!message) {
        gitActionMessage("Écrivez un message de commit.", "error");
        input.focus();
        return;
    }
    runGitAction("Commit", async () => {
        const r = await api.gitCommit(message);
        input.value = "";
        return `Commit créé (${r.files} fichier(s)).`;
    });
}

/** Rafraîchissement différé (écritures de l'agent, sauvegardes). */
function scheduleGitRefresh() {
    clearTimeout(ui.git.timer);
    ui.git.timer = setTimeout(() => {
        if (ui.workspace) refreshGit();
    }, 400);
}

$("btn-git-refresh").onclick = () => refreshGit();
$("btn-git-commit").onclick = () => gitCommitNow();
$("git-commit-msg").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        gitCommitNow();
    }
});
$("btn-git-push").onclick = () => runGitAction("Push", async () => {
    const r = await api.githubPush();
    return `Push terminé : ${r.branch} → ${r.remote}.`;
});
$("btn-git-pull").onclick = () => runGitAction("Pull", async () => {
    const r = await api.githubPull();
    return `Pull terminé (${r.remote}/${r.branch})${r.output ? ` : ${r.output.split("\n").pop()}` : "."}`;
});
$("btn-git-fetch").onclick = () => runGitAction("Fetch", async () => {
    const r = await api.githubFetch();
    return `Fetch terminé (${r.remote}).`;
});
$("btn-gh-login").onclick = () => {
    const input = $("gh-token");
    const token = input.value.trim();
    if (!token) {
        gitActionMessage("Collez un token GitHub.", "error");
        input.focus();
        return;
    }
    runGitAction("Connexion GitHub", async () => {
        try {
            const u = await api.githubLoginToken(token);
            return `Connecté en tant que ${u.login || "?"}.`;
        } finally {
            input.value = "";
        }
    });
};
$("gh-token").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("btn-gh-login").click();
});
$("btn-gh-logout").onclick = () => runGitAction("Déconnexion GitHub", async () => {
    await api.githubLogout();
    return "Token GitHub supprimé de cet ordinateur.";
});
$("btn-gh-remote").onclick = () => {
    const input = $("gh-remote-input");
    const spec = input.value.trim();
    if (!spec) {
        gitActionMessage("Indiquez owner/repo ou une URL GitHub.", "error");
        input.focus();
        return;
    }
    runGitAction("Remote", async () => {
        const r = await api.githubSetRemote(spec);
        input.value = "";
        return `Remote ${r.remote} ${r.updated ? "mis à jour" : "ajouté"} : ${r.url}`;
    });
};
$("btn-gh-create").onclick = () => {
    const input = $("gh-repo-name");
    const name = input.value.trim();
    if (!name) {
        gitActionMessage("Indiquez le nom du dépôt à créer.", "error");
        input.focus();
        return;
    }
    const isPublic = $("gh-repo-public").checked;
    runGitAction("Création du dépôt", async () => {
        const repo = await api.githubCreateRepo(name, isPublic);
        input.value = "";
        let extra = "";
        const st = await api.githubStatus().catch(() => null);
        if (st && !st.remote && ui.workspace) {
            await api.githubSetRemote(repo.full_name);
            extra = " Remote origin défini.";
        }
        return `Dépôt ${repo.private ? "privé" : "public"} créé : ${repo.html_url}.${extra}`;
    });
};
/* ---------- Démarrage ---------- */

(async () => {
    try {
        applyStatus(await api.status());
    } catch {
        // statut indisponible au démarrage
    }
    renderTree();
    input.focus();
    try {
        await api.bootstrap();
    } catch (err) {
        renderEntry({ type: "error", text: err.message });
    }
    refreshQuota();
    setInterval(refreshQuota, 120000);
})();
