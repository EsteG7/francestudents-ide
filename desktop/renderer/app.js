"use strict";

/* Interface façon VS Code : explorateur, éditeur à onglets, sortie des commandes, panneau Agent. */

const api = window.frst;
const $ = (id) => document.getElementById(id);

const SLASH_COMMANDS = [
    ["/help", "Aide"], ["/project", "Choisir un projet"], ["/unproject", "Quitter le projet"],
    ["/pwd", "Projet sélectionné"], ["/tree", "Lister un dossier (2 niveaux)"], ["/read", "Lire un fichier"],
    ["/extensions", "Extensions"],
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
    ["/review-pr", "Revue d'une pull request GitHub (n|owner/repo#n|URL) [--post]"],
    ["/worktree", "Agents parallèles en worktrees : list|new|run|show|diff|stop|remove"],
    ["/compact", "Résumer la conversation (contexte léger)"], ["/checkpoints", "Points de reprise de la session"],
    ["/rewind", "Revenir avant une demande"],
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
/* Complétion IA en ligne : Alt+\\ (ou Ctrl+Alt+Espace) demande une suggestion, Tab l'accepte, Échap l'ignore. */
function inlineCompletionExtension(kind) {
    const CM = window.CM;
    if (!CM.StateField || !CM.StateEffect || !CM.Decoration || !CM.WidgetType || !CM.Prec) return [];
    const setGhost = CM.StateEffect.define();
    class GhostWidget extends CM.WidgetType {
        constructor(text) {
            super();
            this.text = text;
        }
        eq(other) { return other.text === this.text; }
        toDOM() {
            const span = document.createElement("span");
            span.className = "cm-ghost-text";
            span.textContent = this.text;
            return span;
        }
        ignoreEvent() { return true; }
    }
    const ghostField = CM.StateField.define({
        create: () => null,
        update(value, tr) {
            for (const effect of tr.effects) if (effect.is(setGhost)) return effect.value;
            if (value && (tr.docChanged || tr.selection)) return null;
            return value;
        },
        provide: (field) => CM.EditorView.decorations.from(field, (ghost) => ghost
            ? CM.Decoration.set([CM.Decoration.widget({ widget: new GhostWidget(ghost.text), side: 1 }).range(ghost.pos)])
            : CM.Decoration.none)
    });
    let seq = 0;
    const activePath = () => {
        const active = typeof ui !== "undefined" ? ui.active : null;
        if (typeof active === "string") return active;
        return (active && (active.path || active.rel)) || "";
    };
    const request = (view) => {
        if (!api || !api.inlineComplete) return false;
        const pos = view.state.selection.main.head;
        const doc = view.state.doc;
        const id = ++seq;
        api.inlineComplete({
            path: activePath(),
            language: kind || "",
            prefix: doc.sliceString(Math.max(0, pos - 4000), pos),
            suffix: doc.sliceString(pos, Math.min(doc.length, pos + 1500))
        }).then((text) => {
            if (id !== seq || !text || view.state.doc !== doc || view.state.selection.main.head !== pos) return;
            view.dispatch({ effects: setGhost.of({ pos, text }) });
        }).catch(() => {});
        return true;
    };
    const accept = (view) => {
        const ghost = view.state.field(ghostField, false);
        if (!ghost) return false;
        view.dispatch({
            changes: { from: ghost.pos, insert: ghost.text },
            selection: { anchor: ghost.pos + ghost.text.length }
        });
        return true;
    };
    const dismiss = (view) => {
        if (!view.state.field(ghostField, false)) return false;
        view.dispatch({ effects: setGhost.of(null) });
        return true;
    };
    return [
        ghostField,
        CM.Prec.highest(CM.keymap.of([
            { key: "Tab", run: accept },
            { key: "Escape", run: dismiss },
            { key: "Alt-\\", run: request },
            { key: "Ctrl-Alt-Space", run: request }
        ]))
    ];
}

/* Couche de compatibilité : API proche de l'ancien <textarea> au-dessus de CodeMirror 6. */
function createCodeEditor(host) {
    const CM = window.CM;
    if (!CM || !host) {
        throw new Error("CodeMirror introuvable : vérifie que vendor/codemirror.js est chargé (npm run vendor:renderer).");
    }
    const events = new EventTarget();
    const language = new CM.Compartment();
    const options = new CM.Compartment();
    let preferences = {fontSize:13,tabSize:4,wordWrap:false};
    const optionExtensions = () => [
        CM.indentUnit.of(" ".repeat(preferences.tabSize)), CM.EditorState.tabSize.of(preferences.tabSize),
        CM.EditorView.theme({"&":{fontSize:`${preferences.fontSize}px`},".cm-scroller":{fontFamily:"var(--mono)"}}),
        ...(preferences.wordWrap ? [CM.EditorView.lineWrapping] : [])
    ];
    let silent = false;
    const emit = (name) => events.dispatchEvent(new Event(name));
    const extensions = (kind) => [
        CM.basicSetup,
        CM.keymap.of([CM.indentWithTab]),
        options.of(optionExtensions()),
        CM.oneDark,
        language.of(CM.languageFor(kind || "default")),
        inlineCompletionExtension(kind),
        lspExtension(kind),
        inlineEditExtension(kind),
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
        configure(value) { preferences={...preferences,...value}; view.dispatch({effects:options.reconfigure(optionExtensions())}); },
        /* Charge un texte ; réutilise l'état sauvegardé (historique, sélection) s'il correspond encore. */
        load(text, kind, saved) {
            const doc = String(text ?? "");
            const state = saved && saved.doc.toString() === doc
                ? saved
                : CM.EditorState.create({ doc, extensions: extensions(kind) });
            view.setState(state);
            view.dispatch({effects:options.reconfigure(optionExtensions())});
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
    effectcraft: "EffectCraft",
    list_directory: "Lister", read_file: "Lire", search_files: "Chercher",web_search_result:"Résultat web",view_image:"Examiner l’image",
    create_directory: "Créer le dossier", write_file: "Écrire", edit_file: "Éditer",
    move_path: "Déplacer", copy_path: "Copier", delete_path: "Supprimer",
    remember: "Mémoriser", run_command: "Commande", web_search: "Rechercher sur le web", web_fetch: "Lire une source", update_plan: "Actualiser le plan", semantic_search: "Explorer le code", diagnostics: "Diagnostics", browse: "Vérifier la page", job_output: "Lire la commande", job_stop: "Arrêter la commande"
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
    return String(text ?? "").split(/(`[^`]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*]+\*\*|https?:\/\/[^\s<>]+)/g).map(part => {
        if (part.startsWith("`") && part.endsWith("`")) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
        if (part.startsWith("**") && part.endsWith("**")) return `<b>${escapeHtml(part.slice(2, -2))}</b>`;
        const match = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
        const url = match ? match[2] : /^https?:\/\//.test(part) ? part : null;
        if (url) return `<a href="${escapeHtml(url)}" data-web-url="${escapeHtml(url)}">${escapeHtml(match ? match[1] : url)}</a>`;
        return escapeHtml(part);
    }).join("");
}

function renderMarkdown(src) {
    if(typeof window!=="undefined"&&window.StudioVendor) {
        const template=document.createElement("template");template.innerHTML=window.StudioVendor.markdown(src);
        for(const anchor of template.content.querySelectorAll("a")) {
            const href=anchor.getAttribute("href")||"";
            if(/^https?:\/\//i.test(href))anchor.dataset.webUrl=href;
            else anchor.removeAttribute("href");
        }
        return template.innerHTML;
    }
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
    recordStudioEntry(e);
    switch (e.type) {
        case "welcome":
            return null;
        case "user":
            $("agent-starter").classList.add("hidden");
            return addEntry("user", `<div class="message-content">${escapeHtml(e.text)}</div>`);
        case "assistant": {
            $("agent-starter").classList.add("hidden");
            const message = addEntry("assistant", `<div class="message-content">${renderMarkdown(e.text)}</div>`);
            const actions = document.createElement("div");
            actions.className = "message-actions";
            const copy = document.createElement("button");
            copy.type = "button"; copy.textContent = "Copier";
            copy.onclick = () => api.copyText(e.text).then(() => { copy.textContent = "Copié ✓"; }).catch(error => studioFeedback(error.message));
            actions.appendChild(copy); message.appendChild(actions);
            attachServerControls(message, e.text);
            return message;
        }
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
        case "error": {
            if (e.type === "error") {
                const budget = parseBudgetNotice(e.text);
                if (budget) return renderBudgetEntry(budget, e.text);
            }
            return addEntry(e.type, escapeHtml(e.text));
        }
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
    if (ui.live && ui.liveText) attachServerControls(ui.live, ui.liveText);
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
    const ecoButton = $("eco-mode-toggle");
    if (ecoButton) {
        ecoButton.disabled = Boolean(s.busy);
        ecoButton.setAttribute("aria-pressed", String(Boolean(s.ecoMode)));
        ecoButton.querySelector(".eco-mode-label").textContent = s.ecoMode ? "Éco activé" : "Mode Éco";
        ecoButton.title = s.ecoMode ? "Désactiver le mode Éco" : "Réduire la consommation avec des capacités limitées";
    }
    const busy = Boolean(s.busy);
    $("settings-logout").disabled = !s.booted || busy;
    $("settings-account-status").textContent = !s.booted ? "Non connecté." : busy ? "Connecté · arrête la tâche avant de te déconnecter." : "Connecté à FranceStudent.";
    updateStudioStatus(s);

    $("statusbar").classList.toggle("busy", busy);
    $("btn-stop").classList.toggle("hidden", !busy);
    $("btn-send").disabled = false;
    $("btn-send").textContent = busy ? "Ajouter" : "Envoyer";
    $("btn-send").title = busy ? "Ajouter ce prompt à la file (Entrée)" : "Envoyer (Entrée)";
    input.placeholder = busy ? "Ajouter une demande à la suite…" : "Demande à l’agent… (/ pour les commandes)";
    document.querySelector(".composer-hint").textContent = busy ? "Entrée : ajouter à la suite" : "Entrée : envoyer · Maj+Entrée : ligne";
    $("mode-select").disabled = busy;
    renderInlinePending(queueSnapshot);
    $("st-busy").textContent = busy ? "⟳ en cours" : "";
    $("st-jobs").textContent = s.jobs ? `jobs : ${s.jobs}` : "";
    $("st-auto").textContent = s.fullAccess ? "Full accès" : s.autoApprove ? "auto-approbation" : "";
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
        refreshTaskQueue();
    } else if (wasBusy && !busy) {
        scheduleRefresh();
    }

    if (wasBusy && !busy) refreshQuota();
}

/* ---------- Quota du compte FranceStudent ---------- */

function renderQuota() {
    renderUsageMeter();
    renderUsageDashboard();
}

async function refreshQuota() {
    if (ui.quotaLoading) return;
    if (!ui.status.booted) { ui.quota = null; renderQuota(); return; }
    ui.quotaLoading = true;
    ui.quotaError = "";
    renderQuota();
    try {
        const quota = await api.usage();
        applyStatus(await api.status());
        ui.quota = ui.status.booted ? quota : null;
        ui.quotaUpdatedAt = new Date().toISOString();
    } catch {
        ui.quota = null;
        ui.quotaError = "Le quota est momentanément indisponible. Réessaie dans quelques instants.";
    }
    ui.quotaLoading = false;
    renderQuota();
}

/* ---------- Choix du modèle (/model) ---------- */

function hideModelMenu() {
    modelMenuEl.classList.add("hidden");
    modelMenuEl.innerHTML = "";
}

function positionModelMenu(anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(modelMenuEl.dataset.kind === "history" ? 520 : Math.max(300, rect.width), window.innerWidth - 16);
    modelMenuEl.style.minWidth = "0";
    modelMenuEl.style.width = `${width}px`;
    modelMenuEl.style.maxHeight = `${Math.max(0, window.innerHeight - 16)}px`;
    modelMenuEl.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    modelMenuEl.style.top = `${rect.bottom + 6}px`;
    const menuRect = modelMenuEl.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8) {
        modelMenuEl.style.top = `${Math.max(8, Math.min(rect.top - menuRect.height - 6, window.innerHeight - menuRect.height - 8))}px`;
    }
}

window.addEventListener("resize", () => {
    if (!modelMenuEl.classList.contains("hidden")) positionModelMenu($(modelMenuEl.dataset.kind === "history" ? "btn-history" : "btn-model"));
});

const HISTORY_DELETE_CONFIRM_KEY = "frst.history.confirm-delete";
function historyDeletionConfirmationEnabled() {
    try { return localStorage.getItem(HISTORY_DELETE_CONFIRM_KEY) !== "off"; } catch { return true; }
}

function confirmHistoryDeletion(item) {
    if (!historyDeletionConfirmationEnabled()) return Promise.resolve(true);
    return new Promise(resolve => {
        const dialog = document.createElement("dialog");
        dialog.id = "history-delete-dialog";
        dialog.className = "history-delete-dialog";
        dialog.innerHTML = '<h2>Supprimer cette conversation ?</h2><p class="history-delete-title"></p><p>Elle sera retirée de l’historique local. Les fichiers du projet sont conservés.</p><label><input type="checkbox"> Ne plus demander avant de supprimer une conversation</label><div class="studio-actions"><button type="button" data-action="cancel">Annuler</button><button type="button" data-action="delete" class="danger">Supprimer</button></div>';
        dialog.querySelector(".history-delete-title").textContent = item.title;
        let confirmed = false;
        dialog.querySelector('[data-action="cancel"]').onclick = () => dialog.close();
        dialog.querySelector('[data-action="delete"]').onclick = () => {
            confirmed = true;
            if (dialog.querySelector("input").checked) {
                try { localStorage.setItem(HISTORY_DELETE_CONFIRM_KEY, "off"); } catch { /* Confirmation remains enabled when storage is unavailable. */ }
            }
            dialog.close();
        };
        dialog.addEventListener("close", () => { dialog.remove(); resolve(confirmed); }, { once: true });
        document.body.appendChild(dialog);
        dialog.showModal();
        dialog.querySelector('[data-action="cancel"]').focus();
    });
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
    const confirmation = document.createElement("label");
    confirmation.className = "history-confirm-setting";
    const confirmationInput = document.createElement("input");
    confirmationInput.type = "checkbox";
    confirmationInput.checked = historyDeletionConfirmationEnabled();
    confirmationInput.onchange = () => {
        try { localStorage.setItem(HISTORY_DELETE_CONFIRM_KEY, confirmationInput.checked ? "on" : "off"); } catch { confirmationInput.checked = true; }
    };
    confirmation.append(confirmationInput, document.createTextNode(" Confirmer avant de supprimer"));
    modelMenuEl.appendChild(confirmation);

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
        removeBtn.disabled = true;
        try {
            if (!await confirmHistoryDeletion(item)) { removeBtn.disabled = false; return; }
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
    png: "img", jpg: "img", jpeg: "img", gif: "img", svg: "img", ico: "img", webp: "img", yaml:"yaml", yml:"yaml"
};
const FILE_TAGS = { js: "JS", ts: "TS", json: "{}", md: "M↓", css: "#", html: "<>", py: "PY", img: "▣", yaml:"YML", default: "•" };
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
    studioWorkspaceChanged();
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
    window.frstBrowserHide?.();
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
    window.frstBrowserTab?.();
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

/* ---------- Saisie de l'agent ---------- */

/* ---------- Pièces jointes (fichiers / images) ---------- */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_QUOTA_WARNING_COUNT = 5;
let pendingAttachments = [];
const attachmentQuotaWarning = document.createElement("p");
attachmentQuotaWarning.id = "attachment-quota-warning";
attachmentQuotaWarning.className = "attachment-quota-warning hidden";
attachmentQuotaWarning.setAttribute("role", "status");
attachmentQuotaWarning.setAttribute("aria-live", "polite");
$("attachments").after(attachmentQuotaWarning);

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
    const manyFiles = pendingAttachments.length >= ATTACHMENT_QUOTA_WARNING_COUNT;
    attachmentQuotaWarning.classList.toggle("hidden", !manyFiles);
    attachmentQuotaWarning.textContent = manyFiles
        ? `⚠ ${pendingAttachments.length} fichiers joints : leur analyse risque de consommer énormément de quota, notamment si les documents contiennent beaucoup de pages ou nécessitent plusieurs envois. Retire les fichiers inutiles avant d’envoyer.`
        : "";
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
        if(item.readabilityWarning){const warning=document.createElement("span");warning.className="attachment-readability-warning";warning.textContent="⚠ Lisibilité réduite";warning.title=item.readabilityWarning;chip.append(warning);chip.title+=" · "+item.readabilityWarning;}
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
async function prepareImage(file,details={}) {
    const direct = DIRECT_IMAGE_TYPES.has(file.type);

    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error(`format d'image illisible (${file.type || "inconnu"}) : utiliser PNG, JPEG, WebP ou GIF`);
    }
    const projectedScale=Math.min(1,MAX_IMAGE_SIDE/Math.max(bitmap.width,bitmap.height));
    details.originalWidth=bitmap.width;details.originalHeight=bitmap.height;
    details.sentWidth=Math.max(1,Math.round(bitmap.width*projectedScale));details.sentHeight=Math.max(1,Math.round(bitmap.height*projectedScale));
    if(projectedScale<.75||file.size>MAX_IMAGE_BYTES){details.readabilityWarning=`${bitmap.width} × ${bitmap.height} → ${details.sentWidth} × ${details.sentHeight} pixels. La réduction ou compression peut rendre les petits textes et détails difficiles à lire.`;}
    if(direct&&file.size<=MAX_IMAGE_BYTES&&bitmap.width<=MAX_IMAGE_SIDE&&bitmap.height<=MAX_IMAGE_SIDE){bitmap.close?.();return readAsDataUrl(file);}
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
        const name = file.name || (file.type.startsWith("image/") ? "image-collée.png" : "fichier");
        // Même fichier ajouté deux fois (double glisser-déposer, re-sélection) : ignoré.
        if (pendingAttachments.some((a) => a.name === name && a.size === file.size)) continue;
        try {
            if (file.size === 0) throw new Error("fichier vide");
            // Keep SVG source as well as its raster preview. Decode document
            // encodings in the backend instead of losing bytes with File.text().
            if (file.type.startsWith("image/") && !["image/svg+xml", "image/gif", "image/tiff"].includes(file.type) && !["svg", "gif", "tif", "tiff"].includes(fileExtension(name))) {
                try {
                    const details={};
                    const data=await prepareImage(file,details);
                    pendingAttachments.push({ name, kind: "image", size: file.size, data, ...details });
                    continue;
                } catch (err) {
                    // Image non décodable (HEIC, PSD…) : envoyée telle quelle comme fichier.
                    if (file.size > MAX_FILE_BYTES) throw err;
                }
                pendingAttachments.push(await prepareFile(file, name));
                continue;
            }
            // Documents are converted locally when sending, via the same path
            // for file selection, paste, drag and drop, and queued requests.
            pendingAttachments.push(await prepareFile(file, name));
        } catch (err) {
            renderEntry({ type: "error", text: `${name} : ${err.message || err}` });
        }
    }
    renderAttachments();
}

const imageReadabilityDialog=document.createElement("dialog");
imageReadabilityDialog.id="image-readability-dialog";imageReadabilityDialog.className="center-dialog image-readability-dialog";
imageReadabilityDialog.setAttribute("aria-labelledby","image-readability-title");
imageReadabilityDialog.innerHTML=`<h2 id="image-readability-title">Cette image risque d’être difficile à lire</h2><p class="settings-help">Pour respecter les limites du modèle, les images ci-dessous seront réduites ou compressées. Les petits textes et détails peuvent devenir illisibles.</p><ul id="image-readability-list"></ul><p class="settings-help">Pour une meilleure lecture, recadre la zone utile ou envoie plusieurs captures plus courtes. L’original reste intact.</p><form method="dialog" class="center-dialog-actions"><button value="cancel" autofocus>Revenir aux images</button><button value="send" class="primary">Envoyer quand même</button></form>`;
document.body.append(imageReadabilityDialog);
let imageReadabilityPending=false;
async function confirmImageReadability(attachments){
    const risky=attachments.filter(item=>item.readabilityWarning);
    if(!risky.length)return true;
    if(imageReadabilityPending)return false;
    imageReadabilityPending=true;
    const list=$("image-readability-list");list.replaceChildren();
    for(const item of risky){const row=document.createElement("li"),name=document.createElement("b"),detail=document.createElement("small");name.textContent=item.name;detail.textContent=item.readabilityWarning;row.append(name,detail);list.append(row);}
    imageReadabilityDialog.returnValue="cancel";
    return new Promise(resolve=>{
        imageReadabilityDialog.addEventListener("close",()=>{imageReadabilityPending=false;resolve(imageReadabilityDialog.returnValue==="send");},{once:true});
        imageReadabilityDialog.showModal();
    });
}

async function send(text) {
    if(typeof motionChatSwitch!=="undefined" && motionChatSwitch){studioFeedback("Le changement de chat est en cours.");return;}
    const value = text ?? input.value;
    const withFiles = text === undefined && pendingAttachments.length > 0;
    if (!value.trim() && !withFiles) return;
    if (!ui.status.booted && !value.trim().startsWith("/")) { openConnectionGuide(1); return; }
    const attachments = withFiles ? [...pendingAttachments] : [];
    if(withFiles&&!await confirmImageReadability(attachments))return;
    if (text === undefined) {
        if (value.trim()) {
            ui.history.push(value);
            ui.historyIndex = ui.history.length;
        }
        input.value = "";
        saveStudioDraft();
        if (withFiles) {
            pendingAttachments = [];
            renderAttachments();
        }
    }
    hideSlash();
    try {
        if (inlineEditingId) {
            await api.taskQueue("edit", { id: inlineEditingId, prompt: value.trim()||"Analyse les pièces jointes.", attachments });
            inlineEditingId = null;
            studioFeedback("Prompt en attente mis à jour.");
            return;
        }
        const result = await api.submit(value, attachments);
        if (result?.error) throw new Error(result.error);
        if (result?.queued) studioFeedback("Prompt ajouté à la suite.");
    } catch (err) {
        if (text === undefined && !input.value) {
            input.value = value;
            if (withFiles) { pendingAttachments = attachments; renderAttachments(); }
            saveStudioDraft(); autosizeInput();
        }
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
        if (inlineEditingId) { inlineEditingId = null; input.value = ""; pendingAttachments=[];renderAttachments();saveStudioDraft(); studioFeedback("Modification annulée."); return; }
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
const attachmentDropZone = $("agent");
const attachmentDropHint = document.createElement("div");
attachmentDropHint.className = "attachment-drop-hint hidden";
attachmentDropHint.setAttribute("role", "status");
attachmentDropHint.textContent = "Déposez vos fichiers pour les joindre";
attachmentDropZone.appendChild(attachmentDropHint);

function isFileDrag(ev) {
    return Array.from(ev.dataTransfer?.types || []).includes("Files") || Boolean(ev.dataTransfer?.files?.length);
}
function showAttachmentDrop(active) {
    attachmentDropZone.classList.toggle("drag-over", active);
    $("composer").classList.toggle("drag-over", active);
    attachmentDropHint.classList.toggle("hidden", !active);
}
attachmentDropZone.addEventListener("dragenter", (ev) => {
    if (!isFileDrag(ev)) return;
    ev.preventDefault();
    showAttachmentDrop(true);
});
attachmentDropZone.addEventListener("dragover", (ev) => {
    if (!isFileDrag(ev)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
    showAttachmentDrop(true);
});
attachmentDropZone.addEventListener("dragleave", (ev) => {
    if (ev.relatedTarget && attachmentDropZone.contains(ev.relatedTarget)) return;
    showAttachmentDrop(false);
});
attachmentDropZone.addEventListener("drop", async (ev) => {
    showAttachmentDrop(false);
    if (!isFileDrag(ev)) return;
    ev.preventDefault();
    const files = Array.from(ev.dataTransfer.files || []);
    if (!files.length) return;
    await addAttachments(files);
    input.focus();
});
// Prevent Chromium from navigating to a file dropped outside the conversation.
document.addEventListener("dragover", (ev) => {
    if (!isFileDrag(ev)) return;
    ev.preventDefault();
    if (!attachmentDropZone.contains(ev.target)) {
        ev.dataTransfer.dropEffect = "none";
        showAttachmentDrop(false);
    }
});
document.addEventListener("drop", (ev) => {
    if (isFileDrag(ev)) ev.preventDefault();
    showAttachmentDrop(false);
});
document.addEventListener("dragleave", (ev) => {
    if (!ev.relatedTarget) showAttachmentDrop(false);
});
document.addEventListener("dragend", () => showAttachmentDrop(false));
window.addEventListener("blur", () => showAttachmentDrop(false));

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
    setAgentTab("usage");
};
$("st-usage").setAttribute("role", "button");
$("st-usage").tabIndex = 0;
$("st-usage").onkeydown = event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setAgentTab("usage"); }
};
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
    if(document.querySelector("dialog[open]"))return;
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

const LAYOUT_LIMITS = {
    "--left": { min: 150, max: 600 },
    "--right": { min: 280, max: 900 },
    "--bottom": { min: 60, max: 600 },
};
const CENTER_MIN_WIDTH = 320;
const EDITOR_MIN_HEIGHT = 160;

function layoutPx(cssVar) {
    const value = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10);
    return Number.isFinite(value) ? value : LAYOUT_LIMITS[cssVar].min;
}

function layoutHidden(cssVar) {
    const app = $("app");
    if (cssVar === "--left") return app.classList.contains("no-sidebar");
    if (cssVar === "--right") return app.classList.contains("no-agent");
    return app.classList.contains("no-panel");
}

function layoutMax(cssVar) {
    const limits = LAYOUT_LIMITS[cssVar];
    let room;
    if (cssVar === "--bottom") {
        const center = $("center");
        const height = center && center.clientHeight ? center.clientHeight : window.innerHeight;
        room = height - EDITOR_MIN_HEIGHT;
    } else {
        const other = cssVar === "--left" ? "--right" : "--left";
        const otherWidth = layoutHidden(other) ? 0 : layoutPx(other) + 4;
        room = window.innerWidth - 48 - 4 - otherWidth - CENTER_MIN_WIDTH;
    }
    return Math.max(limits.min, Math.min(limits.max, room));
}

function clampLayout() {
    for (const v of ["--right", "--left", "--bottom"]) {
        if (layoutHidden(v)) continue;
        const current = layoutPx(v);
        const next = Math.max(LAYOUT_LIMITS[v].min, Math.min(layoutMax(v), current));
        if (next !== current) document.documentElement.style.setProperty(v, `${next}px`);
    }
}

let layoutFrame = 0;

function scheduleClampLayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        clampLayout();
    });
}

function dragResizer(id, cssVar, axis, invert) {
    const handle = $(id);
    if (!handle) return;
    handle.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        try {
            handle.setPointerCapture(ev.pointerId);
        } catch {
            // capture indisponible
        }
        const start = axis === "x" ? ev.clientX : ev.clientY;
        const initial = layoutPx(cssVar);
        const min = LAYOUT_LIMITS[cssVar].min;
        const max = layoutMax(cssVar);
        let last = start;
        let frame = 0;
        document.body.classList.add(axis === "x" ? "resizing-x" : "resizing-y");
        const apply = () => {
            frame = 0;
            const delta = last - start;
            const value = Math.max(min, Math.min(max, initial + (invert ? -delta : delta)));
            document.documentElement.style.setProperty(cssVar, `${value}px`);
        };
        const move = (e) => {
            last = axis === "x" ? e.clientX : e.clientY;
            if (!frame) frame = requestAnimationFrame(apply);
        };
        const up = () => {
            if (frame) {
                cancelAnimationFrame(frame);
                apply();
            }
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", up);
            handle.removeEventListener("pointercancel", up);
            document.body.classList.remove("resizing-x", "resizing-y");
            if (typeof saveLayout === "function") saveLayout();
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
    });
}

dragResizer("resizer-left", "--left", "x", false);
dragResizer("resizer-right", "--right", "x", true);
dragResizer("resizer-bottom", "--bottom", "y", true);

window.addEventListener("resize", scheduleClampLayout);
new MutationObserver(scheduleClampLayout).observe($("app"), { attributes: true, attributeFilter: ["class"] });
scheduleClampLayout();

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
    for (const b of document.querySelectorAll('[data-view="explorer"], [data-view="search"], [data-view="git"], [data-view="worktrees"], [data-view="extensions"], [data-view="settings"], [data-view="project"]')) {
        b.classList.toggle("active", b.dataset.view === view);
    }
}

function showSideView(view) {
    const app = $("app");
    ui.sideView = view;
    app.classList.remove("focus-agent");
    $("agent-focus").setAttribute("aria-pressed", "false");
    app.classList.remove("no-sidebar");
    app.classList.toggle("view-search", view === "search");
    app.classList.toggle("view-ext", view === "extensions");
    app.classList.toggle("view-settings", view === "settings");
    app.classList.toggle("view-git", view === "git");
    app.classList.toggle("view-worktrees", view === "worktrees");
    app.classList.toggle("view-project", view === "project");
    setActivity(view);
    if (view === "git") refreshGit();
    if (view === "worktrees") refreshWorktrees();
    if (view === "extensions") refreshExtensions();
    if (view === "settings") { refreshSettings(); loadPreferences(); }
    if (view === "project") refreshProjectStudio();
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
document.querySelector('[data-view="worktrees"]').onclick = () => toggleSideView("worktrees");
document.querySelector('[data-view="extensions"]').onclick = () => toggleSideView("extensions");
document.querySelector('[data-view="settings"]').onclick = () => toggleSideView("settings");

/* ---------- Vue Paramètres : auto-approbation des écritures et des commandes ---------- */
let settingsAccessMode = "ask";

function applySettings(s) {
    if (!s || typeof s !== "object") return;
    settingsAccessMode = s.fullAccess ? "full" : s.autoApprove && s.autoApproveCommands ? "auto" : !s.autoApprove && !s.autoApproveCommands ? "ask" : "custom";
    for (const button of document.querySelectorAll("[data-access-mode]")) {
        const selected = button.dataset.accessMode === settingsAccessMode;
        button.setAttribute("aria-checked", String(selected));
        button.classList.toggle("selected", selected);
        button.tabIndex = selected || (settingsAccessMode === "custom" && button.dataset.accessMode === "ask") ? 0 : -1;
    }
    const descriptions = {
        ask: "L’agent demande ton accord avant de modifier des fichiers ou de lancer des commandes sensibles.",
        auto: "Les modifications et les commandes autorisées s’exécutent sans demander. Les commandes bloquées restent interdites.",
        full: "Toutes les actions sont autorisées sans confirmation, y compris hors du projet. Lis l’avertissement ci-dessous.",
        custom: "Tu utilises des autorisations personnalisées. Choisis un mode ci-dessus ou ajuste les options détaillées."
    };
    $("access-mode-description").textContent = descriptions[settingsAccessMode];
    $("full-access-warning").classList.toggle("hidden", !s.fullAccess);
    $("set-remember-access").checked = s.rememberAccess !== undefined ? Boolean(s.rememberAccess) : settingsAccessMode === "full" ? Boolean(s.fullAccessAlways) : Boolean(s.always && s.commandsAlways);
    $("set-remember-access").disabled = settingsAccessMode === "custom";
    $("detailed-permissions").disabled = Boolean(s.fullAccess);
    $("set-auto-writes").checked = Boolean(s.autoApprove);
    $("set-auto-writes-always").checked = Boolean(s.always);
    $("set-auto-commands").checked = Boolean(s.autoApproveCommands);
    $("set-auto-commands-always").checked = Boolean(s.commandsAlways);
    if (s.webSearch !== undefined) $("set-web-search").checked = Boolean(s.webSearch);
    if (s.automaticWeb !== undefined) $("set-automatic-web").checked = Boolean(s.automaticWeb);
    if (s.extensionsMode !== undefined) {
        $("set-extensions-auto").checked = s.extensionsMode !== "manual";
        $("set-extensions-manual").checked = s.extensionsMode === "manual";
    }
    $("st-auto").textContent = s.fullAccess ? "Full accès" : s.autoApprove ? "auto-approbation" : "";
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

for (const button of document.querySelectorAll("[data-access-mode]")) button.onclick = () => changeSetting(`access-${button.dataset.accessMode}-${$("set-remember-access").checked ? "always" : "session"}`);
for (const button of document.querySelectorAll("[data-access-mode]")) button.onkeydown = event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...document.querySelectorAll("[data-access-mode]")];
    const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (buttons.indexOf(button) + (event.key === "ArrowLeft" ? buttons.length - 1 : 1)) % buttons.length;
    buttons[index].focus(); buttons[index].click();
};
$("set-remember-access").onchange = e => changeSetting(`access-${settingsAccessMode}-${e.target.checked ? "always" : "session"}`);

$("set-auto-writes").onchange = (e) => changeSetting(e.target.checked ? "on" : "off");
$("set-auto-writes-always").onchange = (e) => changeSetting(e.target.checked ? "always" : "never");
$("set-auto-commands").onchange = (e) => changeSetting(e.target.checked ? "commands-on" : "commands-off");
$("set-auto-commands-always").onchange = (e) => changeSetting(e.target.checked ? "commands-always" : "commands-never");
$("set-web-search").onchange = (e) => changeSetting(e.target.checked ? "web-on" : "web-off");
$("set-automatic-web").onchange = (e) => changeSetting(e.target.checked ? "auto-web-on" : "auto-web-off");
$("set-extensions-auto").onchange = (e) => { if (e.target.checked) changeSetting("extensions-auto"); };
$("set-extensions-manual").onchange = (e) => { if (e.target.checked) changeSetting("extensions-manual"); };
$("settings-close").onclick = () => showSideView("explorer");

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
            list.appendChild(renderMcpCard(server, sub));
        }
    } catch (error) {
        extMessage(list, `MCP : ${error.message}`);
    }
}

async function refreshSkills() {
    return loadExtensionCenter();
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
    if (!tab||tab.kind==="asset") {
        cursorInfo.textContent = tab?"Aperçu · lecture seule":"";
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
    cmds.push(...[
        ["Cockpit du projet","Ctrl+Maj+D",()=>showSideView("project")],
        ["Commandes et exécutions du projet","",()=>{showSideView("project");setStudioTab("tasks");}],
        ["Vérifier l’environnement","",()=>{showSideView("project");setStudioTab("quality");diagnoseStudio();}],
        ["Boîte à outils locale : JSON, Base64, SHA-256","",()=>{showSideView("project");setStudioTab("tools");}],
        ["Enregistrer tous les fichiers","Ctrl+Maj+S",saveAllStudioFiles],
        ["Aperçu Markdown ou HTML","Ctrl+Maj+V",openDocumentPreview],
        ["Comparer le document côte à côte","",openStudioCompare],
        ["Naviguer dans les symboles du document","Ctrl+Maj+O",openStudioSymbols],
        ["Marquer la ligne actuelle","Ctrl+F2",toggleStudioBookmark],
        ["Bibliothèque de skills","",()=>showSideView("extensions")],
        ["Paramètres de l’éditeur","",()=>showSideView("settings")],
        ["Raccourcis clavier","",()=>{showSideView("project");setStudioTab("shortcuts");}]
    ].map(([label,detail,run])=>({label,detail,run})));
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
        const commands=paletteCommands();
        items = q&&window.StudioVendor ? new window.StudioVendor.Fuse(commands,{keys:["label","detail"],threshold:.42,ignoreLocation:true}).search(q,{limit:100}).map(result=>result.item) : commands
            .map((c) => ({ ...c, score: fuzzyScore(`${c.label} ${c.detail}`, q) }))
            .filter((c) => c.score > 0);
        if (q&&!window.StudioVendor) items.sort((a, b) => b.score - a.score);
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
            const files=q&&window.StudioVendor ? new window.StudioVendor.Fuse(palette.files,{threshold:.4,ignoreLocation:true}).search(q,{limit:200}).map(result=>result.item):palette.files;
            const matches=q&&window.StudioVendor?files.map(p=>({p})):files
                .map((p) => ({ p, score: fuzzyScore(p, q) }))
                .filter((x) => x.score > 0)
                .sort((a, b) => b.score - a.score);
            items = matches
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
    xterm.registerLinkProvider({provideLinks(line,callback){
        const text=xterm.buffer.active.getLine(line-1)?.translateToString(true)||"";
        const links=[];
        for(const match of text.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s<>"']*)?/gi)){
            links.push({text:match[0],range:{start:{x:match.index+1,y:line},end:{x:match.index+match[0].length,y:line}},activate:()=>openLocalBrowser(match[0])});
        }
        callback(links);
    }});
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

/* Pending prompts live directly above the composer. */
let queueSnapshot = { tasks: [], enabled: false };
let inlineEditingId = null;
let pendingRenderSignature = null;
async function editQueuedPrompt(task,attach=false){
    try{
        const result=await api.taskQueue("attachments",{id:task.id});
        inlineEditingId=task.id;input.value=task.prompt;pendingAttachments=result.attachments||[];renderAttachments();autosizeInput();saveStudioDraft();input.focus();
        studioFeedback("Modifie le prompt ou ses fichiers · Entrée pour enregistrer · Échap pour annuler");
        if(attach)$("attach-input").click();
    }catch(error){studioFeedback(error.message);}
}
function renderTaskQueue(snapshot) {
    if (!snapshot) return;
    queueSnapshot = snapshot;
    renderInlinePending(snapshot);
}
async function queueAction(action, payload = {}) {
    try {
        renderTaskQueue(await api.taskQueue(action, payload));
        return true;
    } catch (error) {
        studioFeedback(error.message);
        return false;
    }
}
function refreshTaskQueue() {
    inlineEditingId = null;
    return api.taskQueue("list").then(renderTaskQueue).catch(error => studioFeedback(error.message));
}

function renderInlinePending(snapshot) {
    const host = $("pending-prompts");
    if (!host) return;
    const waiting = (snapshot?.tasks || []).filter(task => ["pending", "steering"].includes(task.status));
    const signature = JSON.stringify([waiting, snapshot.enabled, Boolean(ui.status.canSteer)]);
    if (signature === pendingRenderSignature) return;
    pendingRenderSignature = signature;
    const openMenus = new Set([...host.querySelectorAll(".pending-menu[open]")].map(menu => menu.dataset.taskId));
    host.replaceChildren();
    host.classList.toggle("hidden", !waiting.length);
    if (waiting.length && !snapshot.enabled) {
        const paused = document.createElement("div"); paused.className = "pending-paused";
        const label = document.createElement("span"); label.textContent = `En pause · ${waiting.length} demande(s) en attente`;
        const resume = document.createElement("button"); resume.type = "button"; resume.textContent = "Reprendre"; resume.onclick = () => queueAction("start");
        paused.append(label, resume); host.appendChild(paused);
    }
    for (const task of waiting) {
        const row = document.createElement("div"); row.className = "pending-prompt";
        const icon = document.createElement("span"); icon.className = "pending-icon"; icon.textContent = "↳";
        const text = document.createElement("span"); text.className = "pending-text"; text.textContent = task.prompt; text.title = task.prompt;
        if(task.attachments?.length){const files=document.createElement("small");files.className="pending-attachments";files.textContent="📎 "+task.attachments.map(file=>file.name).join(", ");files.title=files.textContent;text.append(files);}
        const steer = document.createElement("button"); steer.type = "button"; steer.className = "pending-steer"; steer.textContent = task.status === "steering" ? "Transmise…" : "Orienter";
        steer.title = "Transmettre cette consigne à l’agent en cours dès sa prochaine étape";
        steer.disabled = !ui.status.canSteer || task.status !== "pending" || task.mode === "plan";
        if(task.attachments?.length)steer.title="Transmettre cette consigne et ses fichiers à la prochaine étape de l’agent.";
        steer.onclick = () => queueAction("steer", { id: task.id });
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "pending-remove"; remove.title = "Supprimer ce prompt en attente"; remove.setAttribute("aria-label", `Supprimer : ${task.prompt.slice(0, 50)}`);
        remove.innerHTML = '<svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M6 7l1 13h10l1-13M9 7V4h6v3M10 10v7M14 10v7"/></svg>';
        remove.onclick = () => queueAction("remove", { id: task.id });
        const menu = document.createElement("details"); menu.className = "pending-menu";
        menu.dataset.taskId = task.id; menu.open = openMenus.has(String(task.id));
        const summary = document.createElement("summary"); summary.textContent = "⋯"; summary.setAttribute("aria-label", "Actions sur le prompt");
        const actions = document.createElement("div"); actions.className = "pending-menu-items";
        const action = (label, callback) => { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.onclick = () => { menu.open = false; callback(); }; actions.appendChild(button); };
        if (task.status === "pending") {
            action("Modifier", () => editQueuedPrompt(task));
            action("Joindre un fichier", () => editQueuedPrompt(task,true));
            action("Monter", () => queueAction("move", { id: task.id, direction: "up" }));
            action("Descendre", () => queueAction("move", { id: task.id, direction: "down" }));
        }
        menu.append(summary, actions); row.append(icon, text, steer, remove, menu); host.appendChild(row);
    }
}

/* ---------- Raccourcis globaux ---------- */

function isEditable(el) {
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
}

window.addEventListener("keydown", (ev) => {
    if (document.querySelector("dialog[open]")) return;
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
    else if (key === "w" && ev.shiftKey) action = () => toggleSideView("worktrees");
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
            studioEntries.length = 0;
            transcript.innerHTML = "";
            $("agent-starter").classList.remove("hidden");
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
        case "taskQueue":
            renderTaskQueue(data);
            break;
        case "agentActivity":
            renderAgentActivity(data);
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
/* ---------- Vue Worktrees : agents parallèles dans des worktrees Git ---------- */

ui.worktrees = { busy: false, agents: new Map(), cards: new Map() };

const WT_STATUS = { running: "en cours", done: "terminé", failed: "échec", stopped: "arrêté" };

function wtMessage(text, kind) {
    const box = $("wt-msg");
    if (!box) return;
    box.textContent = text || "";
    box.className = `git-action-msg${kind ? ` ${kind}` : ""}`;
}

function updateWorktreeBadge() {
    const badge = $("wt-count");
    if (!badge) return;
    let running = 0;
    for (const agent of ui.worktrees.agents.values()) if (agent.status === "running") running++;
    badge.textContent = running ? String(running) : "";
    badge.classList.toggle("hidden", !running);
}

function wtStatusText(agent) {
    if (!agent) return "Aucun agent lancé.";
    const label = WT_STATUS[agent.status] || agent.status;
    const ended = agent.status !== "running" && agent.exitCode !== null && agent.exitCode !== undefined;
    const mode = agent.readOnly ? "lecture seule" : agent.yes ? "écritures auto" : "sans écriture";
    return `Agent : ${label}${ended ? ` (code ${agent.exitCode})` : ""} · ${mode}`;
}

function wtAgentText(agent) {
    if (!agent) return "";
    const answer = String(agent.answer || "").trim();
    const text = answer || String(agent.log || "").trim();
    return text.length > 6000 ? `…${text.slice(-6000)}` : text;
}

function wtApplyCard(name) {
    const card = ui.worktrees.cards.get(name);
    if (!card) return;
    const agent = ui.worktrees.agents.get(name) || null;
    const running = Boolean(agent && agent.status === "running");
    card.status.textContent = wtStatusText(agent);
    card.status.className = `wt-status wt-${agent ? agent.status : "idle"}`;
    card.status.title = agent && agent.prompt ? `Demande : ${agent.prompt}` : "";
    card.output.textContent = wtAgentText(agent);
    card.output.classList.toggle("hidden", !card.output.textContent);
    card.start.disabled = running;
    card.stop.disabled = !running;
    card.remove.disabled = running;
}

/** Mise à jour envoyée par le processus principal (événement worktreeAgent). */
function wtUpdateAgent(agent) {
    if (!agent || !agent.name) return;
    const previous = ui.worktrees.agents.get(agent.name);
    ui.worktrees.agents.set(agent.name, agent);
    if (ui.worktrees.cards.has(agent.name)) wtApplyCard(agent.name);
    else if (ui.sideView === "worktrees") refreshWorktrees();
    if (previous && previous.status === "running" && agent.status !== "running") {
        const label = WT_STATUS[agent.status] || agent.status;
        wtMessage(`Agent ${agent.name} : ${label}. Ouvre « Diff » pour relire sa branche ${agent.branch}.`, agent.status === "done" ? "ok" : "error");
    }
    updateWorktreeBadge();
}

function wtButton(label, title, onClick, primary) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `git-btn${primary ? " git-btn-primary" : ""}`;
    button.textContent = label;
    button.title = title;
    button.onclick = onClick;
    return button;
}

function wtCheck(label, title, parent) {
    const wrap = document.createElement("label");
    wrap.className = "git-check";
    wrap.title = title;
    const box = document.createElement("input");
    box.type = "checkbox";
    wrap.append(box, ` ${label}`);
    parent.appendChild(wrap);
    return box;
}

function renderWorktrees(items) {
    const list = $("wt-list");
    const drafts = new Map();
    for (const [name, card] of ui.worktrees.cards) {
        drafts.set(name, { prompt: card.prompt.value, yes: card.yes.checked, plan: card.plan.checked });
    }
    list.innerHTML = "";
    ui.worktrees.cards.clear();
    if (!items.length) {
        gitMessage(list, "Aucun worktree. Crée-en un ci-dessus, puis donne une demande à son agent.");
        return;
    }
    for (const item of items) {
        const name = item.name;
        if (item.agent) ui.worktrees.agents.set(name, item.agent);

        const el = document.createElement("div");
        el.className = "wt-card";

        const head = document.createElement("div");
        head.className = "wt-head";
        const title = document.createElement("span");
        title.className = "wt-name";
        title.textContent = name;
        title.title = item.path;
        const branch = document.createElement("span");
        branch.className = "wt-branch";
        branch.textContent = item.branch || (item.detached ? "(détachée)" : "");
        head.append(title, branch);

        const status = document.createElement("div");
        const prompt = document.createElement("textarea");
        prompt.className = "git-input";
        prompt.rows = 2;
        prompt.placeholder = "Demande pour l'agent de ce worktree (Ctrl/Cmd+Entrée pour lancer)";
        prompt.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
                ev.preventDefault();
                wtStart(name);
            }
        });

        const options = document.createElement("div");
        options.className = "wt-options";
        const yes = wtCheck("écritures auto", "Autorise l'agent à écrire et à lancer des commandes sans confirmation (--yes). Sans cette option, il ne peut rien modifier.", options);
        const plan = wtCheck("lecture seule", "Mode plan : l'agent analyse sans rien modifier.", options);

        const output = document.createElement("pre");
        output.className = "wt-output hidden";
        const diff = document.createElement("div");
        diff.className = "wt-diff hidden";

        const card = { el, status, prompt, yes, plan, output, diff };
        card.start = wtButton("Lancer", "Lancer l'agent dans ce worktree", () => wtStart(name), true);
        card.stop = wtButton("Arrêter", "Arrêter l'agent en cours", () => wtStop(name));
        card.diffBtn = wtButton("Diff", "Afficher les modifications du worktree", () => wtToggleDiff(name));
        card.remove = wtButton("Supprimer", "Supprimer le worktree (la branche est conservée)", () => wtRemove(name));
        const actions = document.createElement("div");
        actions.className = "wt-actions";
        actions.append(card.start, card.stop, card.diffBtn, card.remove);

        const draft = drafts.get(name);
        if (draft) {
            prompt.value = draft.prompt;
            yes.checked = draft.yes;
            plan.checked = draft.plan;
        }

        el.append(head, status, prompt, options, actions, output, diff);
        list.appendChild(el);
        ui.worktrees.cards.set(name, card);
        wtApplyCard(name);
    }
}

async function refreshWorktrees() {
    if (ui.worktrees.busy) return;
    ui.worktrees.busy = true;
    try {
        const data = await api.worktreeList();
        $("wt-root").textContent = data.root ? `Dossier : ${data.root}` : "Ouvre un projet Git pour utiliser les worktrees.";
        for (const agent of data.agents || []) ui.worktrees.agents.set(agent.name, agent);
        renderWorktrees((data.worktrees || []).filter((w) => w.managed && w.name));
    } catch (error) {
        gitMessage($("wt-list"), `Worktrees indisponibles : ${gitErrorText(error)}`);
    } finally {
        ui.worktrees.busy = false;
        updateWorktreeBadge();
    }
}

async function wtCreate() {
    const nameInput = $("wt-name");
    const name = nameInput.value.trim();
    const base = $("wt-base").value.trim() || "HEAD";
    if (!name) {
        wtMessage("Donne un nom au worktree (lettres, chiffres, . _ -).", "error");
        nameInput.focus();
        return;
    }
    $("btn-wt-create").disabled = true;
    try {
        const made = await api.worktreeCreate(name, base);
        nameInput.value = "";
        wtMessage(`Worktree ${made.name} créé sur la branche ${made.branch} (depuis ${made.base}).`, "ok");
        await refreshWorktrees();
        const card = ui.worktrees.cards.get(made.name);
        if (card) card.prompt.focus();
    } catch (error) {
        wtMessage(gitErrorText(error), "error");
    } finally {
        $("btn-wt-create").disabled = false;
    }
}

async function wtStart(name) {
    const card = ui.worktrees.cards.get(name);
    if (!card) return;
    const prompt = card.prompt.value.trim();
    if (!prompt) {
        wtMessage("Écris d'abord une demande pour l'agent.", "error");
        card.prompt.focus();
        return;
    }
    try {
        const agent = await api.worktreeStart(name, prompt, { yes: card.yes.checked, readOnly: card.plan.checked });
        card.prompt.value = "";
        wtUpdateAgent(agent);
        wtMessage(`Agent lancé dans ${name} (branche ${agent.branch}).`, "ok");
    } catch (error) {
        wtMessage(gitErrorText(error), "error");
    }
}

async function wtStop(name) {
    try {
        wtUpdateAgent(await api.worktreeStop(name));
        wtMessage(`Agent ${name} arrêté.`, "ok");
    } catch (error) {
        wtMessage(gitErrorText(error), "error");
    }
}

async function wtToggleDiff(name) {
    const card = ui.worktrees.cards.get(name);
    if (!card) return;
    if (!card.diff.classList.contains("hidden")) {
        card.diff.classList.add("hidden");
        card.diff.innerHTML = "";
        return;
    }
    card.diff.classList.remove("hidden");
    card.diff.textContent = "Chargement du diff…";
    try {
        const changes = await api.worktreeChanges(name);
        card.diff.innerHTML = "";
        const status = String(changes.status || "").trim();
        const summary = document.createElement("pre");
        summary.className = "wt-output";
        summary.textContent = status || "Aucune modification non validée dans ce worktree.";
        card.diff.appendChild(summary);
        const lines = gitDiffLines(changes.diff);
        if (lines.length) {
            card.diff.appendChild(buildDiffCard({ path: `${name} (${changes.branch})`, lines, ...gitCountChanges(lines) }));
        }
    } catch (error) {
        card.diff.textContent = `Diff impossible : ${gitErrorText(error)}`;
    }
}

async function wtRemove(name) {
    if (!window.confirm(`Supprimer le worktree ${name} ?\nLa branche frst/${name} est conservée.`)) return;
    try {
        await api.worktreeRemove(name, false);
    } catch (error) {
        const reason = gitErrorText(error);
        if (!window.confirm(`Suppression refusée : ${reason}\n\nForcer la suppression ? Les modifications non validées du worktree seront perdues.`)) {
            wtMessage(reason, "error");
            return;
        }
        try {
            await api.worktreeRemove(name, true);
        } catch (forced) {
            wtMessage(gitErrorText(forced), "error");
            return;
        }
    }
    ui.worktrees.agents.delete(name);
    wtMessage(`Worktree ${name} supprimé (branche frst/${name} conservée).`, "ok");
    refreshWorktrees();
}

$("btn-wt-create").onclick = wtCreate;
$("btn-wt-refresh").onclick = refreshWorktrees;
$("wt-name").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
        ev.preventDefault();
        wtCreate();
    }
});

api.onEvent((channel, data) => {
    if (channel === "worktreeAgent") wtUpdateAgent(data);
});
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
    if(tab?.kind==="asset")return "";
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

async function lspFormatDocument() { return formatEditorDocument(); }

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
/* ---------- Espace agent : activité, sources, favoris et brouillons ---------- */
const studioEntries = [];
let studioRun = null;
let studioWorkspace = undefined;
let studioTab = "conversation";
let studioActivitySeq = 0;
let favoritePrompts = readStudioStorage("frst.prompt-favorites", []);
if (!Array.isArray(favoritePrompts)) favoritePrompts = [];
const starterFavorites = [
    { title: "Revue des changements", prompt: "Inspecte le diff Git local et recherche les bugs et régressions. Donne les fichiers et lignes concernés, le niveau de gravité et les vérifications utiles, sans modifier le code." },
    { title: "Corriger un bug", prompt: "Reproduis le problème suivant, identifie sa cause, corrige-le puis vérifie la correction : " },
    { title: "Écrire les tests utiles", prompt: "Inspecte le code et les tests existants. Identifie les comportements importants non couverts, ajoute les tests pertinents et lance-les." },
    { title: "Améliorer les performances", prompt: "Cherche un problème de performance mesurable. Établis une mesure de référence, propose et implémente une amélioration puis compare les résultats." },
    { title: "Documenter le projet", prompt: "Vérifie les commandes et le fonctionnement réel du projet, puis mets à jour sa documentation d’installation, d’utilisation et de test." }
];

function readStudioStorage(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeStudioStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { studioFeedback("Le stockage local est indisponible."); }
}
function studioFeedback(message) { $("composer-feedback").textContent = message || ""; }
function studioDraftKey(workspace,mode=typeof motionChatMode!=="undefined"?motionChatMode:"code") {return `frst.draft:${workspace || "global"}${mode==="motion"?":motion":""}`;}
function saveStudioDraft() {
    if (studioWorkspace !== undefined) writeStudioStorage(studioDraftKey(studioWorkspace), input.value);
}
function setAgentTab(tab) {
    studioTab = ["conversation", "activity", "usage"].includes(tab) ? tab : "conversation";
    $("agent").dataset.tab = studioTab;
    for (const button of document.querySelectorAll("[data-agent-tab]")) {
        const selected = button.dataset.agentTab === studioTab;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
    }
    if (studioTab === "activity") refreshStudioActivity();
    if (studioTab === "usage") { renderUsageDashboard(); refreshQuota(); }
}
function updateStudioStatus(status) {
    const workspace = status.workspace || null;
    $("agent-project-name").textContent = workspace ? workspace.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : "Aucun projet";
    $("agent-project-name").title = workspace || "Ouvre un dossier pour travailler sur un projet";
    $("agent-access").textContent = status.fullAccess ? "Full accès" : status.autoApprove && status.autoApproveCommands ? "Automatique" : "Sur approbation";
    $("agent-access").classList.toggle("full-access", Boolean(status.fullAccess));
    if (studioWorkspace !== workspace) {
        saveStudioDraft();
        studioWorkspace = workspace;
        input.value = readStudioStorage(studioDraftKey(workspace), "");
        autosizeInput();
        if (studioRun && studioRun.workspace !== workspace) { studioRun = null; renderAgentActivity(null); }
    }
}
function recordStudioEntry(entry) {
    if (entry.type === "user" && /^\/new\b/.test(entry.text || "")) studioEntries.length = 0;
    if (["user", "assistant", "tool", "result", "error", "warn", "plan"].includes(entry.type)) {
        studioEntries.push({ ...entry, at: new Date().toISOString() });
        if (studioEntries.length > 3000) studioEntries.shift();
    }
}
function exportStudioMarkdown() {
    const header = `# Conversation FranceStudent Code\n\nProjet : ${studioWorkspace || "Aucun"}\nExport : ${new Date().toISOString()}\n\n`;
    return header + studioEntries.map(entry => {
        if (entry.type === "user" || entry.type === "assistant") return `## ${entry.type === "user" ? "Vous" : "Agent"}\n\n${entry.text}\n`;
        if (entry.type === "tool") return `**${toolLabel(entry.name)}**\n\n\`\`\`text\n${entry.arg || ""}\n\`\`\`\n`;
        if (entry.type === "plan") return `### Plan\n${(entry.items || []).map(item => `- ${item}`).join("\n")}\n`;
        return `> ${String(entry.text || "").replace(/\n/g, "\n> ")}\n`;
    }).join("\n");
}
function humanDuration(start, end) {
    const seconds = Math.max(0, Math.floor(((end || Date.now()) - start) / 1000));
    return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}
function emptyStudioText(parent, text) {
    const note = document.createElement("p"); note.className = "muted"; note.textContent = text; parent.appendChild(note);
}
function renderAgentActivity(run) {
    studioRun = run;
    const livePlan = $("agent-live-plan");
    livePlan.replaceChildren();
    const steps = run?.steps || [];
    livePlan.classList.toggle("hidden", !steps.length);
    if (steps.length) {
        const done = steps.filter(step => step.status === "completed").length;
        const detail = document.createElement("details"); detail.open = run.status === "running";
        const summary = document.createElement("summary"); summary.textContent = `Plan de travail · ${done}/${steps.length}`;
        const progress = document.createElement("progress"); progress.max = steps.length; progress.value = done;
        progress.setAttribute("aria-label", "Étapes du plan terminées");
        const list = document.createElement("ol");
        for (const step of steps) {
            const li = document.createElement("li"); li.dataset.status = step.status;
            li.textContent = `${step.status === "completed" ? "✓" : step.status === "in_progress" ? "◉" : "○"} ${step.step}`; list.appendChild(li);
        }
        detail.append(summary, progress, list); livePlan.appendChild(detail);
    }
    const overview = $("activity-overview"); overview.replaceChildren();
    const timeline = $("activity-timeline"); timeline.replaceChildren();
    const sources = $("activity-sources"); sources.replaceChildren();
    if (!run) {
        emptyStudioText(overview, "Les actions, les commandes et les sources apparaîtront ici dès la prochaine demande.");
        return;
    }
    const status = { running: "En cours", done: "Terminée", failed: "À vérifier", interrupted: "Interrompue" }[run.status] || run.status;
    const title = document.createElement("div"); title.className = "run-title"; title.textContent = run.prompt;
    const line = document.createElement("p"); line.className = `run-status run-status-${run.status}`; line.textContent = `${status} · ${humanDuration(run.startedAt, run.endedAt)}`;
    const stats = document.createElement("div"); stats.className = "activity-stats";
    for (const [value, label] of [[run.commands, "commandes"], [run.reads, "explorations"], [run.writes, "écritures"]]) {
        const stat = document.createElement("div"); const number = document.createElement("strong"); number.textContent = value || 0;
        const name = document.createElement("small"); name.textContent = label; stat.append(number, name); stats.appendChild(stat);
    }
    overview.append(title, line, stats);
    for (const action of (run.actions || []).slice().reverse()) {
        const row = document.createElement("details"); row.className = `activity-action activity-action-${action.status}`;
        const summary = document.createElement("summary"); summary.textContent = `${action.status === "done" ? "✓" : action.status === "running" ? "◉" : "!"} ${toolLabel(action.name)} · ${humanDuration(action.startedAt, action.endedAt)}`;
        const body = document.createElement("pre"); body.textContent = [action.argument, action.result].filter(Boolean).join("\n\n");
        row.append(summary, body); timeline.appendChild(row);
    }
    if (!run.actions?.length) emptyStudioText(timeline, "L’agent prépare sa prochaine action.");
    for (const source of run.sources || []) {
        const row = document.createElement("button"); row.type = "button"; row.className = "source-card";
        const title = document.createElement("strong"); title.textContent = source.title;
        const meta = document.createElement("small");
        try { meta.textContent = `${new URL(source.url).hostname} · ${source.consulted ? "Source consultée" : "Résultat de recherche"}`; } catch { continue; }
        row.append(title, meta); row.onclick = () => api.openExternal(source.url).catch(error => studioFeedback(error.message)); sources.appendChild(row);
    }
    if (!run.sources?.length) emptyStudioText(sources, "Les liens sont distingués selon qu’ils ont été trouvés ou effectivement consultés.");
}
async function refreshStudioActivity() {
    const seq = ++studioActivitySeq;
    try {
        const [run, jobs, checkpoints] = await Promise.all([api.agentActivity(), api.backgroundJobs("list"), api.checkpoints("list")]);
        if (seq !== studioActivitySeq) return;
        renderAgentActivity(run?.workspace === ui.workspace ? run : null);
        const jobsHost = $("activity-jobs"); jobsHost.replaceChildren();
        if (!jobs.length) emptyStudioText(jobsHost, "Aucune commande en arrière-plan.");
        for (const job of jobs) {
            const row = document.createElement("div"); row.className = "workspace-item";
            const label = document.createElement("div"); label.textContent = `${job.id} · ${job.command}`;
            const meta = document.createElement("small"); meta.textContent = `${job.status} · ${Math.floor(job.duration_ms / 1000)} s${job.exit_code !== null ? ` · code ${job.exit_code}` : ""}`;
            const output = document.createElement("button"); output.type = "button"; output.textContent = "Sortie";
            output.onclick = async () => { try { const result = await api.backgroundJobs("output", job.id); $("activity-job-output").textContent = result.output || "Aucune sortie."; $("activity-job-output").classList.remove("hidden"); } catch (error) { studioFeedback(error.message); } };
            row.append(label, meta, output);
            if (job.status === "running") {
                const stop = document.createElement("button"); stop.type = "button"; stop.textContent = "Arrêter";
                stop.onclick = () => api.backgroundJobs("stop", job.id).then(refreshStudioActivity).catch(error => studioFeedback(error.message)); row.appendChild(stop);
            }
            jobsHost.appendChild(row);
        }
        const pointsHost = $("activity-checkpoints"); pointsHost.replaceChildren();
        if (!checkpoints.length) emptyStudioText(pointsHost, "Un point de reprise est créé avant chaque demande sur le projet.");
        for (const point of checkpoints) {
            const row = document.createElement("div"); row.className = "workspace-item";
            const label = document.createElement("div"); label.textContent = point.task;
            const time = document.createElement("small"); time.textContent = new Date(point.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
            const restore = document.createElement("button"); restore.type = "button"; restore.textContent = "Restaurer"; restore.disabled = Boolean(ui.status.busy);
            restore.onclick = async () => {
                if (!window.confirm(`Restaurer les modifications suivies avant « ${point.task} » ? Les commandes shell ne sont pas annulées.`)) return;
                try { const result = await api.checkpoints("restore", point.id); studioFeedback(`${result.reverted || 0} modification(s) restaurée(s).`); scheduleRefresh(); refreshStudioActivity(); }
                catch (error) { studioFeedback(error.message); }
            };
            row.append(label, time, restore); pointsHost.appendChild(row);
        }
    } catch (error) { studioFeedback(error.message); }
}
function renderFavoritePrompts() {
    const list = $("favorite-list"); list.replaceChildren();
    for (const [index, favorite] of [...favoritePrompts, ...starterFavorites].entries()) {
        const row = document.createElement("div"); row.className = "favorite-row";
        const use = document.createElement("button"); use.type = "button"; use.textContent = favorite.title; use.title = favorite.prompt;
        use.onclick = () => { input.value = favorite.prompt; saveStudioDraft(); autosizeInput(); setAgentTab("conversation"); $("agent-favorites").classList.add("hidden"); input.focus(); };
        row.appendChild(use);
        if (index < favoritePrompts.length) {
            const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", `Retirer ${favorite.title}`);
            remove.onclick = () => { favoritePrompts.splice(index, 1); writeStudioStorage("frst.prompt-favorites", favoritePrompts); renderFavoritePrompts(); }; row.appendChild(remove);
        }
        list.appendChild(row);
    }
}

for (const button of document.querySelectorAll("[data-agent-tab]")) {
    button.onclick = () => setAgentTab(button.dataset.agentTab);
    button.onkeydown = event => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const tabs = [...document.querySelectorAll("[data-agent-tab]")];
        const next = tabs[(tabs.indexOf(button) + (event.key === "ArrowLeft" ? tabs.length - 1 : 1)) % tabs.length];
        setAgentTab(next.dataset.agentTab); next.focus();
    };
}
for (const button of document.querySelectorAll("[data-starter]")) button.onclick = () => { input.value = button.dataset.starter; autosizeInput(); saveStudioDraft(); input.focus(); };
$("agent-access").onclick = () => showSideView("settings");
$("agent-focus").onclick = () => { const active = $("app").classList.toggle("focus-agent"); $("agent-focus").setAttribute("aria-pressed", String(active)); };
$("activity-refresh").onclick = refreshStudioActivity;
$("favorite-open").onclick = () => { renderFavoritePrompts(); $("agent-favorites").classList.toggle("hidden"); };
$("favorite-close").onclick = () => $("agent-favorites").classList.add("hidden");
$("draft-save-favorite").onclick = () => {
    const prompt = input.value.trim();
    if (!prompt) { studioFeedback("Écris un prompt avant de l’enregistrer."); return; }
    if (favoritePrompts.length >= 30) { studioFeedback("Tu as déjà 30 favoris. Retire un favori pour en ajouter un."); return; }
    favoritePrompts.unshift({ title: prompt.replace(/\s+/g, " ").slice(0, 55), prompt: prompt.slice(0, 30000) });
    writeStudioStorage("frst.prompt-favorites", favoritePrompts); studioFeedback("Prompt enregistré en favori.");
};
$("conversation-export").onclick = () => api.exportConversation(exportStudioMarkdown()).then(result => studioFeedback(result.canceled ? "Export annulé." : "Conversation exportée.")).catch(error => studioFeedback(error.message));
input.addEventListener("input", saveStudioDraft);
window.addEventListener("beforeunload", saveStudioDraft);
transcript.addEventListener("click", event => {
    const link = event.target.closest("a[data-web-url]");
    if (link) { event.preventDefault(); api.openExternal(link.dataset.webUrl).catch(error => studioFeedback(error.message)); }
});
setInterval(() => { if (studioTab === "activity" && !document.hidden) refreshStudioActivity(); }, 3000);
setAgentTab("conversation");
/* Connexion explicite et guide accessible, sans identifiants dans le chat. */
let guideStep = 1;
let guideBusy = false;
let guideReturnFocus = null;
let connectionOrigin = "https://ia.francestudent.org";

function openConnectionGuide(step) {
    guideReturnFocus = document.activeElement;
    $("connection-guide").classList.remove("hidden");
    setGuideStep(step || (ui.status.booted ? (ui.workspace ? 3 : 2) : 1));
    setTimeout(() => {
        const first = $("connection-guide").querySelector('input:not(:disabled), button:not(:disabled)');
        if (guideStep === 1 && !ui.status.booted) $("guide-email").focus();
        else if (first) first.focus();
    }, 0);
}
function closeConnectionGuide() {
    if (guideBusy) return;
    $("guide-password").value = "";
    $("connection-guide").classList.add("hidden");
    if (guideReturnFocus?.isConnected) guideReturnFocus.focus();
    else input.focus();
}
function setGuideStep(step) {
    guideStep = [1, 2, 3].includes(step) ? step : 1;
    for (const page of document.querySelectorAll("[data-guide-page]")) page.classList.toggle("hidden", Number(page.dataset.guidePage) !== guideStep);
    for (const marker of document.querySelectorAll("[data-guide-step]")) {
        marker.classList.toggle("current", Number(marker.dataset.guideStep) === guideStep);
        if (Number(marker.dataset.guideStep) === guideStep) marker.setAttribute("aria-current", "step");
        else marker.removeAttribute("aria-current");
    }
    $("guide-title").textContent = ["", "Bienvenue. On commence ?", "Ouvre le bon dossier", "Ta première demande"][guideStep];
    $("guide-description").textContent = ["", "Connecte-toi avec les mêmes identifiants que sur le site FranceStudent.", "Pas besoin de configuration technique : choisis simplement le dossier de ton projet.", "L’agent comprend tes demandes en français. Tu peux préciser ou corriger ce que tu veux au fil du travail."][guideStep];
    $("guide-login-form").classList.toggle("hidden", Boolean(ui.status.booted));
    $("guide-already-connected").classList.toggle("hidden", !ui.status.booted);
    $("guide-project-name").textContent = ui.workspace ? `Dossier choisi : ${ui.workspace.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}` : "Tu pourras aussi ouvrir un dossier plus tard avec le bouton Ouvrir un dossier.";
    $("guide-project-next").disabled = !ui.workspace;
    $("guide-message").textContent = "";
    $("guide-message").classList.remove("is-error");
}
function guideError(error) {
    const message = String(error?.message || error || "Connexion impossible.");
    const special = /captcha|double authentification|two.factor|cloudflare/i.test(message);
    $("guide-message").textContent = special
        ? "Ton compte demande une vérification supplémentaire que cette connexion ne prend pas encore en charge. Ouvre le site FranceStudent pour vérifier ton accès."
        : /password|mot de passe|identifiant|invalid|incorrect|401|403/i.test(message)
            ? "Connexion refusée. Vérifie l’adresse e-mail et le mot de passe de ton compte FranceStudent."
            : "La connexion n’a pas abouti. Vérifie tes identifiants et ta connexion Internet, puis réessaie.";
    $("guide-message").classList.add("is-error");
}

$("guide-login-form").onsubmit = async event => {
    event.preventDefault();
    if (guideBusy || !$("guide-login-form").reportValidity()) return;
    guideBusy = true;
    $("guide-message").textContent = "Connexion à FranceStudent…";
    $("guide-message").classList.remove("is-error");
    $("guide-login-submit").textContent = "Connexion…";
    $("guide-login-form").setAttribute("aria-busy", "true");
    for (const control of $("connection-guide").querySelectorAll("input, button")) control.disabled = true;
    try {
        const result = await api.loginAccount({ email: $("guide-email").value.trim(), password: $("guide-password").value });
        if (!result?.ok) throw new Error(result?.reason || "Connexion impossible.");
        applyStatus(await api.status());
        setGuideStep(2);
    } catch (error) { guideError(error); }
    finally {
        $("guide-password").value = "";
        guideBusy = false;
        for (const control of $("connection-guide").querySelectorAll("input, button")) control.disabled = false;
        $("guide-project-next").disabled = !ui.workspace;
        $("guide-login-submit").textContent = "Se connecter";
        $("guide-login-form").removeAttribute("aria-busy");
    }
};
$("guide-close").onclick = closeConnectionGuide;
$("guide-finish").onclick = closeConnectionGuide;
$("settings-guide").onclick = () => openConnectionGuide();
$("settings-logout").onclick = async () => {
    $("settings-logout").disabled = true;
    $("settings-message").textContent = "Déconnexion…";
    try { await api.logoutAccount(); }
    catch (error) {
        $("settings-message").textContent = `Déconnexion non terminée : ${error.message}`;
        applyStatus(await api.status());
    }
};
api.onEvent(async channel => {
    if (channel !== "signedOut") return;
    applyStatus(await api.status());
    ui.quota = null;
    renderQuota();
    $("guide-email").value = "";
    $("guide-password").value = "";
    $("guide-password").type = "password";
    $("guide-show-password").textContent = "Afficher";
    $("guide-show-password").setAttribute("aria-pressed", "false");
    $("guide-show-password").setAttribute("aria-label", "Afficher le mot de passe");
    showSideView("explorer");
    openConnectionGuide(1);
    $("guide-message").textContent = "Tu es déconnecté de cet ordinateur. Tu peux te reconnecter ou utiliser un autre compte.";
});
$("btn-help").onclick = () => openConnectionGuide();
$("btn-help").title = "Connexion et guide de démarrage";
$("guide-to-project").onclick = () => setGuideStep(2);
$("guide-show-password").onclick = () => {
    const reveal = $("guide-password").type === "password";
    $("guide-password").type = reveal ? "text" : "password";
    $("guide-show-password").textContent = reveal ? "Masquer" : "Afficher";
    $("guide-show-password").setAttribute("aria-pressed", String(reveal));
    $("guide-show-password").setAttribute("aria-label", reveal ? "Masquer le mot de passe" : "Afficher le mot de passe");
};
$("guide-open-site").onclick = () => api.openExternal(connectionOrigin).catch(guideError);
$("guide-open-account").onclick = () => api.openExternal(connectionOrigin).catch(guideError);
$("guide-pick-project").onclick = async () => {
    try { await api.openProject(); applyStatus(await api.status()); setGuideStep(2); }
    catch (error) { $("guide-message").textContent = error.message; }
};
$("guide-skip-project").onclick = () => setGuideStep(3);
$("guide-project-next").onclick = () => setGuideStep(3);
$("guide-first-prompt").onclick = () => {
    closeConnectionGuide();
    setAgentTab("conversation");
    input.value = ui.workspace ? "Explore ce projet et explique-moi comment le lancer et le vérifier." : "Explique-moi comment tu peux m’aider et comment démarrer mon premier projet.";
    saveStudioDraft(); autosizeInput(); input.focus();
};
$("connection-guide").addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); closeConnectionGuide(); return; }
    if (event.key !== "Tab") return;
    const controls = [...$("connection-guide").querySelectorAll("button:not(:disabled), input:not(:disabled), summary")].filter(element => element.offsetParent !== null);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});
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
    renderLibrary(); renderInstalledSkills();
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
        const installed = centerData.skills.some(skill => skill.key === `${scope}:${item.id}`);
        const install = centerButton(installed ? "Installé" : "Installer", () => changeExtension("install", {id:item.id, scope}, `${item.title} installé. Tu peux le désactiver dans Mes skills.`), true);
        install.disabled = installed; actions.append(install);
        if (installed) actions.append(centerButton("Désinstaller", () => uninstallCenterSkill(centerData.skills.find(skill => skill.key === `${scope}:${item.id}`))));
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
        card.append(centerNode("span", "ext-tag", skill.scope === "projet" ? "Ce projet" : "Tous mes projets"), centerNode("h3", "", skill.name), centerNode("p", "", skill.description));
        const actions = centerNode("div", "center-card-actions");
        const favorite = centerButton(skill.favorite ? "★" : "☆", () => changeExtension("favorite", {key:skill.key}));
        favorite.setAttribute("aria-label", `${skill.favorite ? "Retirer des" : "Ajouter aux"} favoris : ${skill.name}`);
        favorite.setAttribute("aria-pressed", String(skill.favorite));
        actions.append(favorite, centerButton("Ouvrir", async () => openSkillEditor({kind:"edit", item:await api.extensionAction("read", {key:skill.key}), key:skill.key})), centerButton("Désinstaller", () => uninstallCenterSkill(skill)));
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
    $("skill-editor-description").textContent = remote ? "Skill communautaire : vérifie les instructions et la licence du dépôt. Il sera installé désactivé. Seul le SKILL.md est copié." : library ? `${item.description} · ${item.category}` : "Écris ou colle les instructions que l’agent doit suivre quand il utilise ce skill.";
    $("skill-editor-name").value = item.id || item.name || "mon-skill";
    $("skill-editor-name").disabled = !["new", "remote"].includes(state.kind);
    if (remote) $("skill-editor-name").value = item.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "community-skill";
    $("skill-editor-identity").classList.toggle("hidden", state.kind === "edit");
    $("skill-editor-scope").value = library ? $("library-scope").value : item.scope || "utilisateur";
    $("skill-editor-content").value = item.content || "---\nname: mon-skill\ndescription: Quand utiliser ce skill.\n---\n\n# Ma méthode\n\nDécris les étapes et les vérifications à suivre.\n";
    $("skill-editor-content").readOnly = library || remote;
    $("skill-editor-save").textContent = remote ? "Installer désactivé" : library ? "Installer ce skill" : "Enregistrer";
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
            renderExtensionCenter(); $("center-message").textContent = "Skill communautaire installé désactivé. Retrouve-le dans Mes skills pour l’activer.";
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
        if (!window.confirm(`Retirer le serveur « ${server.name} » de mcp.json ? La configuration précédente reste dans mcp.json.backup.`)) return;
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
            const actions = centerNode("div", "center-card-actions");
            actions.append(centerButton("Voir le dépôt", () => api.openExternal(item.githubUrl)), centerButton("Lire et installer", async () => {
                await downloadSkillPreview(item);
            }, true));
            card.append(actions); list.append(card);
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
/* ---------- Cockpit du projet : commandes, qualité et outils locaux ---------- */
let projectStudioData = null;
let studioSelectedRun = null;
let studioRuns = [];
let projectStudioTab = "overview";
let studioSeq = 0;
function studioIcon(name) { return window.StudioVendor?.icon(name); }
function studioAction(label, icon, handler, primary=false) {
    const button=centerButton(label,handler,primary); const svg=studioIcon(icon);
    if(svg)button.prepend(svg); return button;
}
const projectNav=document.createElement("button");
projectNav.type="button";projectNav.className="activity";projectNav.dataset.view="project";projectNav.title="Cockpit du projet (Ctrl+Maj+D)";projectNav.setAttribute("aria-label","Cockpit du projet");
projectNav.append(studioIcon("LayoutDashboard"));
$("activity-bar").insertBefore(projectNav,$("activity-bar").firstElementChild);
projectNav.onclick=()=>showSideView("project");
$("sidebar").insertAdjacentHTML("afterbegin",`
<div id="project-studio" class="studio-page">
 <header class="studio-header"><div><span class="studio-eyebrow">FRANCESTUDENT CODE</span><h1>Ton espace de travail.</h1></div><div class="studio-actions"><button type="button" id="studio-refresh" aria-label="Actualiser le projet">Actualiser</button><button type="button" id="studio-close">Retour au code</button></div></header>
 <div class="studio-project-heading"><div><h2 id="studio-project-name">Aucun projet</h2><p id="studio-project-description"></p><p id="studio-project-path"></p></div><div id="studio-stack" class="studio-stack"></div></div>
 <nav class="studio-tabs" aria-label="Cockpit du projet" role="tablist"><button type="button" data-studio-tab="overview" role="tab" aria-selected="true">Vue d’ensemble</button><button type="button" data-studio-tab="tasks" role="tab" aria-selected="false">Exécutions</button><button type="button" data-studio-tab="quality" role="tab" aria-selected="false">Qualité</button><button type="button" data-studio-tab="tools" role="tab" aria-selected="false">Boîte à outils</button><button type="button" data-studio-tab="shortcuts" role="tab" aria-selected="false">Raccourcis</button></nav>
 <p id="studio-message" class="studio-message" role="status"></p>
 <section data-studio-page="overview"><div id="studio-stats" class="studio-stats"></div><div class="studio-section-heading"><h2>Une action, un résultat.</h2><span>Les outils du projet, à portée de main.</span></div><div id="studio-quick-actions" class="studio-quick-grid"></div><div class="studio-two-columns"><article class="studio-card"><h3>Documentation du projet</h3><div id="studio-docs" class="studio-link-list"></div></article><article class="studio-card"><h3>Repères dans le code</h3><p class="studio-muted">Marque une ligne dans l’éditeur avec Ctrl+F2 pour la retrouver ici.</p><div id="studio-bookmarks" class="studio-link-list"></div></article></div><div class="studio-section-heading"><h2>Dernières exécutions</h2><button type="button" id="studio-see-runs">Tout voir</button></div><div id="studio-recent-runs" class="studio-run-list"></div></section>
 <section data-studio-page="tasks" class="hidden"><div class="studio-section-heading"><div><h2>Les commandes de ton projet.</h2><p class="studio-muted">Détectées dans package.json, Cargo.toml et go.mod. Rien ne s’exécute sans un clic.</p></div><button type="button" id="studio-add-task" class="primary">+ Commande personnelle</button></div><div class="center-filters"><input type="search" id="studio-task-filter" placeholder="Filtrer : dev, test, build…" aria-label="Filtrer les commandes"><select id="studio-task-kind" aria-label="Type de commande"><option value="">Tous les types</option><option value="dev">Développement</option><option value="test">Tests</option><option value="build">Construction</option><option value="quality">Qualité</option><option value="custom">Personnelles</option></select></div><div id="studio-task-list" class="studio-task-grid"></div><div class="studio-section-heading"><h2>Exécutions de cette session</h2><button type="button" id="studio-clear-runs">Effacer les exécutions terminées</button></div><div id="studio-runs" class="studio-run-list"></div><article class="studio-card studio-log-card"><div class="studio-section-heading"><div><h3 id="studio-log-title">Sortie de la commande</h3><p id="studio-log-meta" class="studio-muted">Sélectionne une exécution pour lire sa sortie.</p></div><div class="studio-actions"><button type="button" id="studio-copy-log">Copier la sortie</button><label class="studio-muted"><input type="checkbox" id="studio-log-follow" checked> Suivre</label></div></div><pre id="studio-log" class="studio-log" tabindex="0"></pre></article></section>
 <section data-studio-page="quality" class="hidden"><div class="studio-section-heading"><h2>Un environnement prêt à travailler.</h2><button type="button" id="studio-diagnose">Vérifier l’environnement</button></div><div id="studio-environment" class="studio-stats"></div><div class="studio-section-heading"><h2>Problèmes signalés par l’éditeur</h2><span>Diagnostics JS/TS des fichiers ouverts</span></div><div id="studio-problems" class="studio-link-list"></div><div class="studio-section-heading"><h2>Améliorer le projet avec l’agent</h2></div><div id="studio-quality-actions" class="studio-quick-grid"></div></section>
 <section data-studio-page="tools" class="hidden"><div class="studio-section-heading"><h2>Petits outils, sans quitter ton projet.</h2><span>Traitement local · aucun envoi au modèle</span></div><article class="studio-card"><div class="center-filters"><select id="studio-transform" aria-label="Opération"><option value="json">Valider et formater JSON</option><option value="base64-encode">Texte → Base64</option><option value="base64-decode">Base64 → texte</option><option value="url-encode">Encoder une URL</option><option value="url-decode">Décoder une URL</option><option value="sha256">Empreinte SHA-256</option><option value="uuid">Générer un UUID</option><option value="sort">Trier les lignes</option><option value="unique">Supprimer les lignes identiques</option></select><button type="button" id="studio-transform-run" class="primary">Exécuter</button><button type="button" id="studio-transform-copy">Copier le résultat</button></div><div class="studio-two-columns"><label class="center-code-label">Entrée<textarea id="studio-tool-input" rows="12" maxlength="500000" spellcheck="false" placeholder="Colle ton texte ici…"></textarea></label><label class="center-code-label">Résultat<textarea id="studio-tool-output" rows="12" spellcheck="false" readonly></textarea></label></div><p id="studio-tool-status" class="studio-muted" role="status"></p></article><article class="studio-card"><h3>Raccourcis de création</h3><div id="studio-new-file-actions" class="studio-actions"></div></article></section>
 <section data-studio-page="shortcuts" class="hidden"><div class="studio-section-heading"><h2>Moins de clics, plus de fluidité.</h2></div><div id="studio-shortcuts" class="studio-shortcuts"></div><article class="studio-card"><h3>Construit avec l’open source</h3><p class="studio-muted">CodeMirror, Prettier, Marked, DOMPurify, Fuse.js, Lucide, xterm.js et node-pty participent aux outils de cette interface.</p><button type="button" id="studio-licenses">Lire les licences des composants intégrés</button></article></section>
</div>`);
document.body.insertAdjacentHTML("beforeend",`<dialog id="studio-task-dialog" class="center-dialog" aria-labelledby="studio-task-dialog-title"><form id="studio-task-form"><div class="center-dialog-head"><h2 id="studio-task-dialog-title">Ajouter une commande personnelle</h2><button type="button" id="studio-task-close" aria-label="Fermer">×</button></div><p class="studio-muted">La commande sera enregistrée dans ce projet, puis lancée uniquement quand tu cliqueras sur Exécuter. Sous Windows, elle s’exécute dans PowerShell avec les droits de ton compte.</p><label class="center-code-label">Nom<input id="studio-task-name" required maxlength="100" placeholder="Mes tests Python"></label><label class="center-code-label">Commande<textarea id="studio-task-command" required maxlength="8000" rows="4" placeholder="python -m pytest"></textarea></label><p id="studio-task-error" role="status" class="studio-message"></p><div class="center-dialog-actions"><button type="button" id="studio-task-cancel">Annuler</button><button type="submit" class="primary">Enregistrer</button></div></form></dialog><dialog id="studio-licenses-dialog" class="center-dialog" aria-labelledby="studio-licenses-title"><div class="center-dialog-head"><h2 id="studio-licenses-title">Licences open source</h2><button type="button" id="studio-licenses-close">Fermer</button></div><pre id="studio-licenses-content" class="studio-license-text"></pre></dialog>`);
function setStudioTab(tab) {
    projectStudioTab=tab;
    for(const panel of document.querySelectorAll("[data-studio-page]"))panel.classList.toggle("hidden",panel.dataset.studioPage!==tab);
    for(const button of document.querySelectorAll("[data-studio-tab]")){const selected=button.dataset.studioTab===tab;button.setAttribute("aria-selected",String(selected));button.tabIndex=selected?0:-1;}
    if(tab==="quality")renderStudioProblems();
    if(tab==="overview")renderProjectStudio();
}
for(const button of document.querySelectorAll("[data-studio-tab]")) {
    button.onclick=()=>setStudioTab(button.dataset.studioTab);
    button.onkeydown=event=>{
        if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
        event.preventDefault();const buttons=[...document.querySelectorAll("[data-studio-tab]")];
        const index=event.key==="Home"?0:event.key==="End"?buttons.length-1:(buttons.indexOf(button)+(event.key==="ArrowRight"?1:buttons.length-1))%buttons.length;
        buttons[index].click();buttons[index].focus();
    };
}
async function refreshProjectStudio() {
    const sequence=++studioSeq;
    $("studio-message").textContent="";
    try {
        const data=await api.projectStudio("overview");if(sequence!==studioSeq)return;
        projectStudioData=data;studioRuns=data.runs;renderProjectStudio();
    }catch(error){$("studio-message").textContent=error.message;}
}
function draftStudioPrompt(prompt) {input.value=prompt;input.dispatchEvent(new Event("input"));showSideView("explorer");input.focus();}
function studioStat(value,label,detail="") {const card=centerNode("article","studio-stat");card.append(centerNode("strong","",String(value)),centerNode("span","",label));if(detail)card.append(centerNode("small","",detail));return card;}
function studioQuick(title,description,icon,handler) {const button=studioAction("",icon,handler);button.classList.add("studio-quick");const text=centerNode("span","");text.append(centerNode("b","",title),centerNode("small","",description));button.append(text);return button;}
function renderProjectStudio() {
    const data=projectStudioData;if(!data)return;
    $("studio-project-name").textContent=data.name;
    $("studio-project-description").textContent=data.description||"Ton code, tes commandes et tes outils dans un seul espace.";
    $("studio-project-path").textContent=data.workspace||"Ouvre un dossier pour retrouver ses commandes et sa documentation.";
    $("studio-stack").replaceChildren(...data.stack.map(label=>centerNode("span","studio-pill",label)));
    $("studio-stats").replaceChildren(studioStat(data.tasks.length,"commandes disponibles",data.packageManager?`Gestionnaire : ${data.packageManager}`:"Scripts détectés dans le projet"),studioStat(studioRuns.filter(run=>run.status==="running").length,"en cours","Exécutions locales"),studioStat(studioRuns.filter(run=>run.status==="passed").length,"réussies","Pendant cette session"),studioStat(data.docs.length,"documents repérés","Guides à la racine du projet"));
    $("studio-quick-actions").replaceChildren(
        studioQuick("Lancer le projet","Choisir un script de développement","Play",()=>setStudioTab("tasks")),
        studioQuick("Comprendre le code","Préparer une exploration avec l’agent","Sparkles",()=>draftStudioPrompt("Explore ce projet et explique les points d’entrée, son architecture et les commandes utiles. Ne modifie aucun fichier.")),
        studioQuick("Terminal","Ouvrir un terminal dans ce dossier","Terminal",()=>{showSideView("explorer");selectPanel("terminal",true);}),
        studioQuick("Aperçu local","Voir un fichier HTML ou le Markdown actif","Eye",()=>{showSideView("explorer");openDocumentPreview();}),
        studioQuick("Vérifier l’environnement","Node.js, npm et Git","Activity",()=>{setStudioTab("quality");diagnoseStudio();}),
        studioQuick("Ouvrir un dossier","Changer de projet","FolderOpen",openProject));
    const docs=$("studio-docs");docs.replaceChildren();
    for(const file of data.docs)docs.append(studioAction(file,"BookOpen",async()=>{showSideView("explorer");await openFile(file);openDocumentPreview();}));
    if(!data.docs.length)docs.append(centerNode("p","studio-muted","Aucun README ou guide repéré à la racine du projet."));
    renderStudioBookmarks();renderStudioTasks();renderStudioRuns();
}
function renderStudioTasks() {
    if(!projectStudioData)return;
    const query=$("studio-task-filter").value.toLowerCase().trim(),kind=$("studio-task-kind").value;
    const list=$("studio-task-list");list.replaceChildren();
    for(const task of projectStudioData.tasks.filter(task=>(!kind||task.kind===kind)&&`${task.name} ${task.description}`.toLowerCase().includes(query))) {
        const card=centerNode("article","studio-card studio-task");card.dataset.taskId=task.id;
        card.append(centerNode("span","studio-pill",task.source),centerNode("h3","",task.name),centerNode("p","studio-muted",task.description),centerNode("code","studio-command",task.command));
        const running=studioRuns.find(run=>run.taskId===task.id&&run.status==="running");
        const button=studioAction(running?"Arrêter":"Exécuter",running?"Square":"Play",async()=>{
            if(running)await api.projectStudio("stop",{id:running.id});
            else {const run=await api.projectStudio("start",{id:task.id});studioSelectedRun=run.id;}
            studioRuns=await api.projectStudio("runs");renderStudioRuns();renderStudioTasks();
        },!running);
        card.append(button);list.append(card);
        if(task.id.startsWith("custom:"))card.append(centerButton("Retirer cette commande",async()=>{await api.projectStudio("remove",{id:task.id});await refreshProjectStudio();setStudioTab("tasks");}));
    }
    if(!list.children.length)list.append(centerNode("p","studio-empty",projectStudioData.tasks.length?"Aucune commande ne correspond à ces filtres.":"Aucun script détecté. Ajoute une commande personnelle pour lancer ton outil de test ou ton serveur."));
}
const studioRunLabels={running:"En cours",passed:"Réussie",failed:"Échec",stopped:"Arrêtée"};
function studioRunRow(run) {
    const row=centerNode("div","studio-run");row.dataset.status=run.status;
    const button=centerButton(run.name,()=>{studioSelectedRun=run.id;setStudioTab("tasks");renderStudioLog();});button.className="studio-run-name";
    row.append(centerNode("span","studio-status-dot"),button,centerNode("span","studio-run-status",studioRunLabels[run.status]),centerNode("span","studio-muted",`${Math.max(0,Math.floor(((run.endedAt||Date.now())-run.startedAt)/1000))} s`));
    if(run.status==="running")row.append(studioAction("Arrêter","Square",()=>api.projectStudio("stop",{id:run.id})));
    else row.append(studioAction("Relancer","Play",async()=>{const next=await api.projectStudio("start",{id:run.taskId});studioSelectedRun=next.id;studioRuns=await api.projectStudio("runs");renderStudioRuns();renderStudioTasks();}));
    return row;
}
function renderStudioRuns() {
    for(const [id,limit]of[["studio-runs",30],["studio-recent-runs",4]]) {
        const list=$(id);list.replaceChildren(...studioRuns.slice().reverse().slice(0,limit).map(studioRunRow));
        if(!list.children.length)list.append(centerNode("p","studio-empty","Aucune exécution pour l’instant."));
    }
    renderStudioLog();
    $("studio-task-badge").textContent=studioRuns.some(run=>run.status==="running")?`${studioRuns.filter(run=>run.status==="running").length} commande(s)` : "";
}
function renderStudioLog() {
    if(!studioSelectedRun&&studioRuns.length)studioSelectedRun=studioRuns.at(-1).id;
    const run=studioRuns.find(run=>run.id===studioSelectedRun);if(!run){$("studio-log").textContent="";return;}
    $("studio-log-title").textContent=run.name;
    $("studio-log-meta").textContent=`${run.command} · ${studioRunLabels[run.status]}${run.exitCode!=null?` · code ${run.exitCode}`:""}`;
    $("studio-log").textContent=(run.truncated?"[… début de la sortie tronqué …]\n":"")+run.output;
    if($("studio-log-follow").checked)$("studio-log").scrollTop=$("studio-log").scrollHeight;
}
async function diagnoseStudio() {
    $("studio-environment").replaceChildren(centerNode("p","studio-muted","Vérification des outils disponibles…"));
    try {const data=await api.environmentDiagnostics();$("studio-environment").replaceChildren(...data.map(item=>studioStat(item.available?"✓":"—",item.name,item.version)));}
    catch(error){$("studio-message").textContent=error.message;}
}
function renderStudioProblems() {
    const list=$("studio-problems");list.replaceChildren();let count=0;
    for(const [file,diagnostics]of lspDiagnosticsByPath)for(const diagnostic of diagnostics) {
        const line=(diagnostic.from?.line||0)+1;
        const button=centerButton(`${diagnostic.severity === "error"?"Erreur":"Diagnostic"} · ${file}:${line} — ${diagnostic.message}`,async()=>{showSideView("explorer");await openFile(file);goToLine(line);});
        list.append(button);count++;
    }
    if(!count)list.append(centerNode("p","studio-empty","Aucun problème signalé pour les fichiers JS/TS ouverts. Lance les tests ou le lint du projet pour une vérification plus large."));
}
function studioBookmarkKey(){return `frst-bookmarks:${ui.workspace||""}`;}
function readStudioBookmarks(){try{return JSON.parse(localStorage.getItem(studioBookmarkKey())||"[]").slice(0,200);}catch{return [];}}
function toggleStudioBookmark() {
    const tab=currentTab();if(!tab)return;
    const line=code.view.state.doc.lineAt(code.selectionStart).number;
    let items=readStudioBookmarks();const exists=items.some(item=>item.file===tab.path&&item.line===line);
    items=exists?items.filter(item=>item.file!==tab.path||item.line!==line):[...items,{file:tab.path,line,text:code.view.state.doc.line(line).text.trim().slice(0,100)}];
    try{localStorage.setItem(studioBookmarkKey(),JSON.stringify(items));}catch{/* stockage indisponible */}
    lspStatus(exists?"Repère retiré":"Ligne marquée dans le cockpit du projet");renderStudioBookmarks();
}
function renderStudioBookmarks() {
    const list=$("studio-bookmarks");if(!list)return;list.replaceChildren();
    for(const item of readStudioBookmarks())list.append(centerButton(`${item.file}:${item.line} ${item.text}`,async()=>{showSideView("explorer");await openFile(item.file);goToLine(item.line);}));
    if(!list.children.length)list.append(centerNode("p","studio-empty","Aucune ligne marquée."));
}
$("studio-refresh").onclick=refreshProjectStudio;$("studio-close").onclick=()=>showSideView("explorer");
$("studio-see-runs").onclick=()=>setStudioTab("tasks");$("studio-diagnose").onclick=diagnoseStudio;
$("studio-task-filter").oninput=renderStudioTasks;$("studio-task-kind").onchange=renderStudioTasks;
$("studio-copy-log").onclick=()=>api.copyText($("studio-log").textContent).catch(error=>{$("studio-message").textContent=error.message;});
$("studio-clear-runs").onclick=async()=>{await api.projectStudio("clear");studioRuns=await api.projectStudio("runs");studioSelectedRun=null;renderStudioRuns();};
$("studio-add-task").onclick=()=>{$("studio-task-form").reset();$("studio-task-error").textContent="";$("studio-task-dialog").showModal();};
for(const id of ["studio-task-close","studio-task-cancel"])$(id).onclick=()=>$("studio-task-dialog").close();
$("studio-task-form").onsubmit=async event=>{
    event.preventDefault();
    try{await api.projectStudio("add",{name:$("studio-task-name").value,command:$("studio-task-command").value});$("studio-task-dialog").close();await refreshProjectStudio();setStudioTab("tasks");}
    catch(error){$("studio-task-error").textContent=error.message;}
};
$("studio-licenses").onclick=async()=>{try{$("studio-licenses-content").textContent=await api.openSourceLicenses();$("studio-licenses-dialog").showModal();}catch(error){$("studio-message").textContent=error.message;}};
$("studio-licenses-close").onclick=()=>$("studio-licenses-dialog").close();
$("studio-quality-actions").append(studioQuick("Revue des changements","Préparer une demande de revue sans modification","GitCompare",()=>draftStudioPrompt("Relis les changements Git actuels. Cherche les régressions et les erreurs concrètes, avec les fichiers et les cas déclencheurs. Ne modifie rien.")),studioQuick("Renforcer les tests","Préparer une demande de tests utiles","Check",()=>draftStudioPrompt("Inspecte les tests de ce projet, identifie les comportements critiques mal couverts et ajoute des tests pertinents. Exécute les tests concernés.")),studioQuick("Examiner la sécurité","Préparer une revue ciblée des entrées et accès","Activity",()=>draftStudioPrompt("Examine les entrées, contrôles d’accès et manipulations de fichiers de ce projet. Identifie les problèmes vérifiables et propose des corrections ciblées. Commence en lecture seule.")));
$("studio-new-file-actions").append(studioAction("Nouveau fichier","FileCode",()=>newEntry("file",".")),studioAction("Nouveau dossier","FolderOpen",()=>newEntry("directory",".")),studioAction("Créer un skill","Sparkles",()=>{showSideView("extensions");setCenterTab("installed");openSkillEditor({kind:"new"});}));
const studioShortcuts=[["Ctrl+P","Rechercher un fichier"],["Ctrl+Maj+P","Palette des commandes"],["Ctrl+Maj+D","Cockpit du projet"],["Ctrl+S","Enregistrer"],["Ctrl+Maj+S","Enregistrer tous les onglets"],["Maj+Alt+F","Formater avec Prettier"],["Ctrl+F2","Ajouter ou retirer un repère"],["Ctrl+Maj+V","Aperçu du document"],["F12","Aller à la définition JS/TS"],["Maj+F12","Rechercher les références"],["F2","Renommer un symbole"],["Ctrl+K","Modifier une sélection avec l’IA"],["Ctrl+L","Écrire à l’agent"],["Ctrl+J","Afficher ou masquer le panneau"],["Ctrl+Maj+F","Rechercher dans le projet"],["Ctrl+O","Ouvrir un dossier"]];
for(const [keys,label]of studioShortcuts){const row=centerNode("div","studio-shortcut");row.append(centerNode("span","",label),centerNode("kbd","",keys));$("studio-shortcuts").append(row);}
const taskBadge=centerNode("button","studio-status-button","");taskBadge.id="studio-task-badge";taskBadge.type="button";taskBadge.onclick=()=>{showSideView("project");setStudioTab("tasks");};$("statusbar").append(taskBadge);
let studioEventFrame=0;
api.onEvent((channel,data)=>{
    if(channel==="projectTask"&&data?.workspace===ui.workspace){const index=studioRuns.findIndex(run=>run.id===data.id);if(index<0)studioRuns.push(data);else studioRuns[index]=data;if(!studioEventFrame)studioEventFrame=requestAnimationFrame(()=>{studioEventFrame=0;renderStudioRuns();renderStudioTasks();});}
    if(channel==="lspDiagnostics"&&projectStudioTab==="quality")renderStudioProblems();
});
$("studio-transform-run").onclick=async()=>{
    const text=$("studio-tool-input").value;let result="";
    try {
        switch($("studio-transform").value){
            case "json":result=JSON.stringify(JSON.parse(text),null,2);break;
            case "base64-encode": {const bytes=new TextEncoder().encode(text);let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));result=btoa(binary);break;}
            case "base64-decode":result=new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(atob(text.trim()),character=>character.charCodeAt(0)));break;
            case "url-encode":result=encodeURIComponent(text);break;
            case "url-decode":result=decodeURIComponent(text);break;
            case "uuid":result=crypto.randomUUID();break;
            case "sha256": {const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));result=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");break;}
            case "sort":result=text.split(/\r?\n/).sort((a,b)=>a.localeCompare(b,"fr")).join("\n");break;
            case "unique":result=[...new Set(text.split(/\r?\n/))].join("\n");break;
        }
        $("studio-tool-output").value=result;$("studio-tool-status").textContent=`${result.length.toLocaleString("fr-FR")} caractères · traitement local terminé.`;
    }catch(error){$("studio-tool-status").textContent=`Conversion impossible : ${error.message}`;}
};
$("studio-transform-copy").onclick=()=>api.copyText($("studio-tool-output").value).catch(error=>{$("studio-tool-status").textContent=error.message;});
/* ---------- Préférences de l’éditeur, aperçu isolé et comparaison ---------- */
let studioEditorPreferences={fontSize:13,tabSize:4,wordWrap:false,autoSave:false,formatOnSave:false,reducedMotion:false,theme:"original"};
let studioAutoSaveTimer=null;
let studioFormatting=false;
let studioPreviewVisible=false;
let studioPreviewMode="document";
let studioPreviewUrl="";
let studioPreviewSequence=0;
let studioPreviewTimer=null;
let studioMergeView=null;
const editorToolbar=centerNode("div","studio-editor-toolbar");editorToolbar.id="studio-editor-toolbar";
editorToolbar.append(studioAction("Projet","LayoutDashboard",()=>showSideView("project")),studioAction("Formater","FileCode",()=>formatEditorDocument()),studioAction("Comparer","GitCompare",()=>openStudioCompare()),studioAction("Aperçu","Eye",()=>openDocumentPreview()),studioAction("Marquer la ligne","BookOpen",toggleStudioBookmark));
$("center").insertBefore(editorToolbar,$("breadcrumbs"));
$("editor-area").insertAdjacentHTML("beforeend",`<section id="studio-preview" class="studio-preview hidden" aria-label="Aperçu du document"><div class="studio-preview-header"><b id="studio-preview-title">Aperçu</b><div><button type="button" id="studio-preview-refresh" aria-label="Actualiser l’aperçu">↻</button><button type="button" id="studio-preview-expand" aria-label="Agrandir ou réduire l’aperçu">⛶</button><button type="button" id="studio-preview-close" aria-label="Fermer l’aperçu">×</button></div></div><div class="studio-preview-address"><input id="studio-preview-url" type="url" aria-label="Adresse du serveur local" placeholder="http://localhost:5173"><button type="button" id="studio-preview-go">Ouvrir</button></div><p id="studio-preview-message" class="studio-muted" role="status"></p><article id="studio-markdown-preview" class="studio-markdown"></article><iframe id="studio-web-preview" title="Aperçu local isolé" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" class="hidden"></iframe></section>`);
document.body.insertAdjacentHTML("beforeend",`<dialog id="studio-compare-dialog" class="studio-compare-dialog" aria-labelledby="studio-compare-title"><div class="center-dialog-head"><div><h2 id="studio-compare-title">Comparer le document</h2><p id="studio-compare-file" class="studio-muted"></p></div><div class="studio-actions"><select id="studio-compare-base" aria-label="Version de référence"><option value="saved">Version enregistrée</option><option value="git">Dernier commit Git (HEAD)</option></select><button type="button" id="studio-compare-close">Fermer</button></div></div><div class="studio-compare-labels"><span>Version de référence</span><span>Document actuel · lecture seule</span></div><div id="studio-merge-host"></div></dialog>`);
const editorSettings=document.createElement("section");editorSettings.className="settings-card";
editorSettings.setAttribute("aria-labelledby","studio-editor-settings-title");
editorSettings.innerHTML=`<h3 id="studio-editor-settings-title">Éditeur et apparence</h3><p class="settings-help">Ces réglages sont appliqués immédiatement après enregistrement, sans redémarrage.</p><div class="settings-number-grid"><label>Taille du texte<input type="number" id="studio-font-size" min="10" max="24" value="13" required></label><label>Indentation<select id="studio-tab-size"><option value="2">2 espaces</option><option value="4" selected>4 espaces</option><option value="8">8 espaces</option></select></label></div><label class="center-code-label">Thème<select id="studio-theme"><option value="original">Sombre original</option><option value="midnight">Minuit</option></select></label><label class="setting-toggle"><span><b>Retour à la ligne visuel</b><small>Affiche les longues lignes sans défilement horizontal.</small></span><input type="checkbox" role="switch" id="studio-word-wrap"></label><label class="setting-toggle"><span><b>Enregistrement automatique</b><small>Enregistre le fichier actif deux secondes après la dernière modification.</small></span><input type="checkbox" role="switch" id="studio-auto-save"></label><label class="setting-toggle"><span><b>Formater à l’enregistrement</b><small>Prettier pour JS, TS, JSON, CSS, HTML, Vue, Markdown et YAML. Une erreur de syntaxe n’empêche pas de sauvegarder le texte.</small></span><input type="checkbox" role="switch" id="studio-format-save"></label><label class="setting-toggle"><span><b>Réduire les animations</b><small>Limite les transitions et mouvements dans l’interface.</small></span><input type="checkbox" role="switch" id="studio-reduced-motion"></label><button type="button" id="studio-editor-settings-save" class="primary">Enregistrer l’éditeur et l’apparence</button><p id="studio-editor-settings-message" class="settings-help" role="status"></p>`;
$("settings-view").insertBefore(editorSettings,$("settings-message"));
function applyStudioEditorPreferences(value) {
    studioEditorPreferences={...studioEditorPreferences,...value};
    code.configure(studioEditorPreferences);
    document.documentElement.dataset.studioTheme=studioEditorPreferences.theme;
    document.documentElement.classList.toggle("studio-reduced-motion",studioEditorPreferences.reducedMotion);
    $("studio-font-size").value=studioEditorPreferences.fontSize;
    $("studio-tab-size").value=String(studioEditorPreferences.tabSize);
    $("studio-theme").value=studioEditorPreferences.theme;
    for(const [id,key]of[["studio-word-wrap","wordWrap"],["studio-auto-save","autoSave"],["studio-format-save","formatOnSave"],["studio-reduced-motion","reducedMotion"]])$(id).checked=studioEditorPreferences[key];
}
api.editorPreferences().then(applyStudioEditorPreferences).catch(()=>{});
$("studio-editor-settings-save").onclick=async()=>{
    if(!$("studio-font-size").reportValidity())return;
    const value={fontSize:Number($("studio-font-size").value),tabSize:Number($("studio-tab-size").value),theme:$("studio-theme").value,wordWrap:$("studio-word-wrap").checked,autoSave:$("studio-auto-save").checked,formatOnSave:$("studio-format-save").checked,reducedMotion:$("studio-reduced-motion").checked};
    try{applyStudioEditorPreferences(await api.editorPreferences("save",value));$("studio-editor-settings-message").textContent="Éditeur et apparence enregistrés.";}
    catch(error){$("studio-editor-settings-message").textContent=error.message;}
};
async function formatEditorDocument() {
    const tab=currentTab();if(!tab||tab.kind==="asset"||studioFormatting)return false;
    const before=code.value;studioFormatting=true;
    try {
        const result=await api.formatDocument({file:tab.path,text:before,tabSize:studioEditorPreferences.tabSize});
        if(currentTab()!==tab||code.value!==before){lspStatus("Formatage annulé : le document a changé pendant la requête.");return false;}
        if(!result.changed){lspStatus("Document déjà formaté.");return true;}
        const selected=code.selectionStart;
        code.view.dispatch({changes:{from:0,to:code.view.state.doc.length,insert:result.text},selection:{anchor:Math.min(selected,result.text.length)},userEvent:"input.format"});
        lspSyncTabFromEditor(tab);renderTabs();lspScheduleSync();lspStatus("Document formaté avec Prettier · Ctrl+Z pour annuler.");return true;
    }catch(error){lspStatus(`Formatage : ${error.message}`);return false;}
    finally{studioFormatting=false;}
}
async function saveAllStudioFiles() {
    let count=0;
    for(const tab of ui.tabs.filter(tab=>tab.dirty&&tab.kind!=="asset")) {
        const snapshot=tab.content;
        try{await api.writeFile(tab.path,tab.eol==="\r\n"?snapshot.replace(/\n/g,"\r\n"):snapshot,{encoding:tab.encoding||"utf8",bom:tab.bom===true});tab.saved=snapshot;tab.dirty=tab.content!==snapshot;count++;}
        catch(error){lspStatus(`Enregistrement de ${tab.path} : ${error.message}`);}
    }
    renderTabs();scheduleGitRefresh();lspStatus(`${count} fichier(s) enregistré(s).`);
}
function closeDocumentPreview() {
    studioPreviewVisible=false;studioPreviewSequence++;
    $("studio-preview").classList.add("hidden");$("editor-area").classList.remove("studio-preview-open","studio-preview-wide");
    $("studio-web-preview").removeAttribute("src");
    api.localPreview("stop").catch(()=>{});
}
async function openDocumentPreview() {
    studioPreviewMode="document";
    studioPreviewVisible=true;$("studio-preview").classList.remove("hidden");$("editor-area").classList.add("studio-preview-open");
    await updateDocumentPreview();
}
async function updateDocumentPreview() {
    if(!studioPreviewVisible||studioPreviewMode!=="document")return;
    const sequence=++studioPreviewSequence;
    const tab=currentTab();
    $("studio-preview-message").textContent="";
    $("studio-preview-title").textContent=tab?.path.split("/").pop()||"Aperçu local";
    $("studio-markdown-preview").classList.add("hidden");$("studio-web-preview").classList.add("hidden");
    if(!tab){$("studio-preview-message").textContent="Ouvre un fichier Markdown ou HTML. Pour une application web, saisis l’adresse du serveur local ci-dessus.";return;}
    if(/\.(md|markdown)$/i.test(tab.path)) {
        $("studio-web-preview").removeAttribute("src");
        $("studio-markdown-preview").innerHTML=window.StudioVendor.markdown(tab.content);
        $("studio-markdown-preview").classList.remove("hidden");return;
    }
    if(/\.html?$/i.test(tab.path)) {
        if(tab.dirty){$("studio-preview-message").textContent="Enregistre le fichier HTML pour actualiser l’aperçu. Les chemins relatifs sont servis depuis ton projet.";return;}
        try{const result=await api.localPreview("start",{file:tab.path});if(sequence!==studioPreviewSequence)return;studioPreviewUrl=result.url;$("studio-preview-url").value=result.url;$("studio-web-preview").src=result.url;$("studio-web-preview").classList.remove("hidden");}
        catch(error){if(sequence===studioPreviewSequence)$("studio-preview-message").textContent=error.message;}
        return;
    }
    $("studio-preview-message").textContent="L’aperçu documentaire prend en charge Markdown et HTML. Pour Vite, React ou un autre serveur, lance le script de développement et saisis son adresse locale.";
}
$("studio-preview-close").onclick=closeDocumentPreview;
$("studio-preview-expand").onclick=()=>$("editor-area").classList.toggle("studio-preview-wide");
$("studio-preview-refresh").onclick=()=>{if(studioPreviewMode==="document")updateDocumentPreview();else if(studioPreviewUrl)$("studio-web-preview").src=studioPreviewUrl;};
$("studio-preview-go").onclick=()=>openLocalBrowser($("studio-preview-url").value);
$("studio-preview-url").onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();$("studio-preview-go").click();}};
$("studio-markdown-preview").onclick=async event=>{
    const link=event.target.closest("a");if(!link)return;event.preventDefault();
    const href=link.getAttribute("href")||"";
    if(/^https?:\/\//i.test(href)){await api.openExternal(href);return;}
    if(href.startsWith("#")){const heading=[...$("studio-markdown-preview").querySelectorAll("h1,h2,h3,h4")].find(node=>node.textContent.toLowerCase().replace(/\s+/g,"-")===href.slice(1));heading?.scrollIntoView({block:"nearest"});return;}
    const tab=currentTab();if(!tab)return;
    const segments=tab.path.split("/");segments.pop();
    for(const part of href.split("#")[0].split("/")){if(part==="..")segments.pop();else if(part&&part!==".")segments.push(part);}
    if(segments.length)await openFile(segments.join("/"));
};
async function openStudioCompare() {
    if(!currentTab())return;
    if(currentTab().kind==="asset"){lspStatus("La comparaison est disponible pour les documents texte.");return;}
    $("studio-compare-dialog").showModal();await renderStudioCompare();
}
async function renderStudioCompare() {
    const tab=currentTab();if(!tab)return;
    const before=$("studio-compare-base").value==="git"?String(await api.gitShowHead(tab.path)):tab.saved;
    if(studioMergeView)studioMergeView.destroy();$("studio-merge-host").replaceChildren();
    $("studio-compare-file").textContent=tab.path;
    const CM=window.CM;
    const extensions=[CM.basicSetup,CM.EditorView.editable.of(false),CM.EditorState.readOnly.of(true),CM.oneDark,CM.languageFor(extKind(tab.path))];
    studioMergeView=new CM.MergeView({a:{doc:before,extensions},b:{doc:tab.content,extensions},parent:$("studio-merge-host"),highlightChanges:true,gutter:true,collapseUnchanged:{margin:4,minSize:12}});
}
$("studio-compare-base").onchange=()=>renderStudioCompare().catch(error=>lspStatus(error.message));
$("studio-compare-close").onclick=()=>$("studio-compare-dialog").close();
$("studio-compare-dialog").addEventListener("close",()=>{studioMergeView?.destroy();studioMergeView=null;});
function studioWorkspaceChanged() {
    closeDocumentPreview();studioRuns=[];studioSelectedRun=null;
    if(ui.sideView==="project")refreshProjectStudio();
}
code.addEventListener("input",()=>{
    if(studioPreviewVisible&&studioPreviewMode==="document"){clearTimeout(studioPreviewTimer);studioPreviewTimer=setTimeout(updateDocumentPreview,220);}
    clearTimeout(studioAutoSaveTimer);
    if(studioEditorPreferences.autoSave){const tab=currentTab();studioAutoSaveTimer=setTimeout(()=>{if(tab&&currentTab()===tab&&tab.dirty)saveCurrent();},2000);}
});
window.addEventListener("keydown",event=>{
    if(document.querySelector("dialog[open]")||(!event.ctrlKey&&!event.metaKey))return;
    const key=event.key.toLowerCase();let action=null;
    if(event.shiftKey&&key==="d")action=()=>showSideView("project");
    else if(event.shiftKey&&key==="s")action=saveAllStudioFiles;
    else if(event.shiftKey&&key==="v")action=()=>studioPreviewVisible?closeDocumentPreview():openDocumentPreview();
    else if(key==="f2")action=toggleStudioBookmark;
    if(action){event.preventDefault();event.stopImmediatePropagation();Promise.resolve(action()).catch(error=>lspStatus(error.message));}
},true);
const welcomeCockpit=studioQuick("Cockpit du projet","Commandes, qualité, documentation et outils locaux","LayoutDashboard",()=>showSideView("project"));
$("editor-welcome").querySelector(".welcome-grid")?.prepend(welcomeCockpit);
/* Navigation dans le document : symboles LSP et titres Markdown. */
let studioSymbolItems=[];
let studioSymbolPath=null;
let studioSymbolSequence=0;
document.body.insertAdjacentHTML("beforeend",`<dialog id="studio-symbol-dialog" class="center-dialog" aria-labelledby="studio-symbol-title"><div class="center-dialog-head"><h2 id="studio-symbol-title">Naviguer dans le document</h2><button type="button" id="studio-symbol-close">Fermer</button></div><p id="studio-symbol-file" class="studio-muted"></p><input type="search" id="studio-symbol-search" class="studio-symbol-search" placeholder="Rechercher un symbole ou un titre…" aria-label="Filtrer les symboles"><p id="studio-symbol-status" class="studio-muted" role="status"></p><div id="studio-symbol-list" class="studio-symbol-list"></div></dialog>`);
editorToolbar.append(studioAction("Symboles","FileCode",openStudioSymbols));
function renderStudioSymbols() {
    const query=$("studio-symbol-search").value.toLocaleLowerCase("fr").trim();
    const items=studioSymbolItems.filter(item=>`${item.name} ${item.kind}`.toLocaleLowerCase("fr").includes(query));
    const list=$("studio-symbol-list");list.replaceChildren();
    for(const item of items) {
        const button=centerButton("",async()=>{$("studio-symbol-dialog").close();if(currentTab()?.path!==studioSymbolPath)await openFile(studioSymbolPath);goToLine(item.line+1);});
        button.className="studio-symbol-item";button.style.paddingLeft=`${12+Math.min(6,item.depth)*12}px`;
        const text=centerNode("span","");text.append(centerNode("b","",item.name),centerNode("small","",item.kind+(item.detail?` · ${item.detail}`:"")));
        button.append(text,centerNode("span","studio-muted",`L${item.line+1}`));list.append(button);
    }
    if(!items.length)list.append(centerNode("p","studio-muted","Aucun symbole ne correspond."));
}
async function openStudioSymbols() {
    const tab=currentTab();if(!tab){lspStatus("Ouvre un document pour afficher ses symboles.");return;}
    const sequence=++studioSymbolSequence;studioSymbolPath=tab.path;studioSymbolItems=[];
    $("studio-symbol-search").value="";$("studio-symbol-file").textContent=tab.path;$("studio-symbol-status").textContent="Lecture de la structure du document…";$("studio-symbol-list").replaceChildren();
    $("studio-symbol-dialog").showModal();$("studio-symbol-search").focus();
    try {
        let items=[];
        if(/\.(md|markdown)$/i.test(tab.path))tab.content.split("\n").forEach((line,index)=>{const match=/^(#{1,6})\s+(.+)/.exec(line);if(match)items.push({name:match[2],line:index,depth:match[1].length-1,kind:"titre",detail:""});});
        else if(lspEnabledFor(tab.path))items=await api.documentSymbols(tab.path,tab.content);
        else {$("studio-symbol-status").textContent="La navigation structurée est disponible pour JS, TS et Markdown.";return;}
        if(sequence!==studioSymbolSequence||!$("studio-symbol-dialog").open)return;
        studioSymbolItems=items.slice(0,800);$("studio-symbol-status").textContent=`${studioSymbolItems.length} symbole(s) repéré(s).`;renderStudioSymbols();
    }catch(error){if(sequence===studioSymbolSequence)$("studio-symbol-status").textContent=`Symboles indisponibles : ${error.message}`;}
}
$("studio-symbol-search").oninput=renderStudioSymbols;
$("studio-symbol-search").onkeydown=event=>{if(event.key==="ArrowDown"){event.preventDefault();$("studio-symbol-list").querySelector("button")?.focus();}if(event.key==="Enter"){$("studio-symbol-list").querySelector("button")?.click();}};
$("studio-symbol-list").onkeydown=event=>{if(!["ArrowDown","ArrowUp"].includes(event.key))return;const buttons=[...$("studio-symbol-list").querySelectorAll("button")];const index=buttons.indexOf(document.activeElement);if(index<0)return;event.preventDefault();buttons[(index+(event.key==="ArrowDown"?1:buttons.length-1))%buttons.length]?.focus();};
$("studio-symbol-close").onclick=()=>$("studio-symbol-dialog").close();
$("studio-symbol-dialog").addEventListener("close",()=>{studioSymbolSequence++;});
window.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==="o"&&!document.querySelector("dialog[open]")){event.preventDefault();event.stopImmediatePropagation();openStudioSymbols();}},true);
/* Fichiers non textuels : aperçu sans écriture et application associée. */
const studioAssetView=centerNode("section","studio-asset-view hidden");studioAssetView.id="studio-asset-view";$("editor-area").append(studioAssetView);
function showStudioAsset(tab) {
    const asset=tab?.kind==="asset"?tab.asset:null;
    studioAssetView.classList.toggle("hidden",!asset);studioAssetView.replaceChildren();
    if(!asset)return;
    $("editor").classList.add("hidden");$("editor-welcome").classList.add("hidden");
    const header=centerNode("div","studio-asset-header");header.append(centerNode("span","studio-pill","Aperçu · lecture seule"),centerNode("h2","",asset.name),centerNode("p","studio-muted",`${formatBytes(asset.size)} · ${asset.mime} · ${new Date(asset.modifiedAt).toLocaleString("fr-FR")}`));
    header.append(studioAction("Ouvrir dans l’application associée","ExternalLink",async()=>{const error=await api.openFileInApp(tab.path);if(error)lspStatus(error);}));studioAssetView.append(header);
    if(asset.dataUrl&&["image","audio","video"].includes(asset.kind)) {
        const media=document.createElement(asset.kind==="image"?"img":asset.kind);media.src=asset.dataUrl;if(asset.kind==="image")media.alt=asset.name;else media.controls=true;
        media.className="studio-asset-media";studioAssetView.append(media);
    }else {
        studioAssetView.append(centerNode("p","studio-muted",asset.kind==="text-preview"?"Extrait du fichier volumineux, non modifiable ici. Ouvre-le dans l’application associée pour accéder à son contenu complet.":"Ce format n’est pas édité comme du texte pour préserver ses données. Voici un aperçu des octets ; utilise son application associée pour le modifier."));
        studioAssetView.append(centerNode("pre","studio-asset-bytes",asset.preview));
        if(asset.truncated)studioAssetView.append(centerNode("p","studio-muted","Aperçu limité aux 16 premiers Ko."));
    }
}

/* Recherches et captures restent en arrière-plan, indépendamment de la saisie. */
const researchTab=centerNode("button","","Internet");researchTab.type="button";researchTab.dataset.studioTab="research";researchTab.setAttribute("role","tab");researchTab.setAttribute("aria-selected","false");researchTab.tabIndex=-1;$("project-studio").querySelector(".studio-tabs").append(researchTab);researchTab.onclick=()=>{setStudioTab("research");refreshStudioResearch();};
researchTab.onkeydown=event=>{if(!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();const buttons=[...document.querySelectorAll("[data-studio-tab]")];buttons[(buttons.indexOf(researchTab)+(event.key==="ArrowRight"?1:buttons.length-1))%buttons.length].click();};
const researchPage=centerNode("section","hidden");researchPage.dataset.studioPage="research";
researchPage.innerHTML=`<div class="studio-section-heading"><div><h2>Rechercher sans interrompre le travail.</h2><p class="studio-muted">Les résultats restent disponibles pendant que tu écris à l’agent ou modifies tes fichiers. Les extraits ne remplacent pas la consultation des sources.</p></div></div><form id="studio-research-form" class="center-filters"><input type="search" id="studio-research-query" required maxlength="1000" placeholder="Chercher une documentation ou une réponse sur le web…" aria-label="Recherche Internet"><button type="submit" class="primary">Rechercher en arrière-plan</button></form><div id="studio-research-jobs" class="studio-research-jobs"></div><article class="studio-card"><h3>Capturer une page web</h3><p class="studio-muted">Ouvre Chrome ou Edge sans fenêtre visible, relève le texte et les erreurs de console et enregistre un PNG dans .frst/screenshots. Une capture est distincte de son analyse par le modèle.</p><div class="center-filters"><input type="url" id="studio-capture-url" placeholder="http://localhost:5173" aria-label="Page à capturer"><button type="button" id="studio-capture-button">Prendre une capture</button></div><p id="studio-capture-status" class="studio-muted" role="status"></p><div id="studio-capture-results" class="studio-link-list"></div></article>`;
$("project-studio").append(researchPage);
async function refreshStudioResearch(){renderStudioResearch(await api.webResearch("list"));}
function renderStudioResearch(jobs) {
    const list=$("studio-research-jobs");list.replaceChildren();
    for(const job of jobs.slice().reverse()) {
        const card=centerNode("article","studio-card");card.append(centerNode("span","studio-pill",({running:"En cours",done:"Terminée",failed:"Échec",stopped:"Arrêtée",denied:"Désactivée"})[job.status]||job.status),centerNode("h3","",job.query));
        if(job.status==="running")card.append(centerButton("Arrêter la recherche",async()=>{await api.webResearch("cancel",{id:job.id});await refreshStudioResearch();}));
        if(job.error)card.append(centerNode("p","studio-muted",job.error));
        for(const source of job.result?.results||[]) {
            const row=centerNode("div","studio-research-source");row.append(centerButton(source.title||source.url,()=>api.openExternal(source.url)),centerNode("p","studio-muted",source.snippet));card.append(row);
        }
        if(job.status==="done"&&!job.result?.results?.length)card.append(centerNode("p","studio-muted",job.result?.message||"Aucun résultat exploitable."));
        list.append(card);
    }
    if(!jobs.length)list.append(centerNode("p","studio-empty","Aucune recherche pour l’instant."));
}
$("studio-research-form").onsubmit=async event=>{event.preventDefault();try{const result=await api.webResearch("start",{query:$("studio-research-query").value});if(result.denied)$("studio-message").textContent=result.message;await refreshStudioResearch();}catch(error){$("studio-message").textContent=error.message;}};
$("studio-capture-button").onclick=async()=>{
    $("studio-capture-button").disabled=true;$("studio-capture-status").textContent="Capture en cours. Si un accord est nécessaire, la demande apparaît dans le panneau Agent.";
    try {
        const result=await api.captureWebPage({url:$("studio-capture-url").value,full_page:false});
        $("studio-capture-status").textContent=result.message;
        if(result.screenshot)$("studio-capture-results").prepend(centerButton(`${result.title||"Capture"} · ${result.screenshot}`,async()=>{showSideView("explorer");await openFile(result.screenshot);}));
    }catch(error){$("studio-capture-status").textContent=error.message;}
    finally{$("studio-capture-button").disabled=false;}
};
api.onEvent(channel=>{if(channel==="webResearch")refreshStudioResearch().catch(()=>{});});

/* Paramètres de capture et mises à jour de la version installée. */
const captureSettings=document.createElement("section");captureSettings.className="settings-card";
captureSettings.innerHTML=`<h3>Captures et navigateur de l’agent</h3><p class="settings-help">Autorise l’outil browse à ouvrir une page en arrière-plan et à sauvegarder son rendu. L’outil view_image peut ensuite proposer de transmettre une image au modèle pour l’examiner. La prise en charge de la vision dépend du modèle et du fournisseur.</p><label class="center-code-label">Captures de pages<select id="studio-browser-permission"><option value="ask">Demander l’accord</option><option value="allow">Autoriser les captures de pages</option><option value="deny">Désactiver les captures</option></select></label><p id="studio-browser-permission-status" class="settings-help" role="status"></p>`;
$("settings-view").insertBefore(captureSettings,$("settings-message"));
api.browserPermission().then(value=>{$("studio-browser-permission").value=value;}).catch(()=>{});
$("studio-browser-permission").onchange=async()=>{try{await api.browserPermission("save",$("studio-browser-permission").value);$("studio-browser-permission-status").textContent="Permission de capture enregistrée.";}catch(error){$("studio-browser-permission-status").textContent=error.message;}};
const updateSettings=document.createElement("section");updateSettings.className="settings-card";
updateSettings.innerHTML=`<h3>Application et mises à jour</h3><p id="studio-app-version" class="settings-help"></p><label class="setting-toggle"><span><b>Mises à jour automatiques</b><small>Vérifier et télécharger les versions publiées. Dans la version installée, une mise à jour téléchargée est appliquée à la fermeture. Les projets et réglages restent dans leurs dossiers.</small></span><input type="checkbox" role="switch" id="studio-automatic-updates"></label><p id="studio-update-message" class="settings-help" role="status"></p><progress id="studio-update-progress" max="100" value="0" class="hidden"></progress><div class="studio-actions"><button type="button" id="studio-update-check">Vérifier maintenant</button><button type="button" id="studio-update-download" class="hidden">Télécharger la mise à jour</button><button type="button" id="studio-update-install" class="primary hidden">Enregistrer et redémarrer</button></div><p class="settings-help">Source prévue : versions GitHub de extraopaa/francestudents-ide. Les nouvelles versions doivent être publiées avec leur installateur et leurs métadonnées de mise à jour. Aucune version n’est publiée automatiquement par cette interface.</p>`;
$("settings-view").insertBefore(updateSettings,$("settings-message"));
function renderStudioUpdates(data){$("studio-app-version").textContent=`Version de l’application : ${data.version}`;$("studio-automatic-updates").checked=data.automatic;$("studio-update-message").textContent=data.message;$("studio-update-progress").value=data.progress;$("studio-update-progress").classList.toggle("hidden",data.status!=="downloading");$("studio-update-check").disabled=["unavailable","checking","downloading"].includes(data.status);$("studio-update-download").classList.toggle("hidden",(data.status!=="available"||data.canInstall===false));$("studio-update-install").classList.toggle("hidden",data.status!=="downloaded");}
api.updates().then(renderStudioUpdates).catch(()=>{});
$("studio-automatic-updates").onchange=()=>api.updates("automatic",{enabled:$("studio-automatic-updates").checked}).then(renderStudioUpdates).catch(error=>{$("studio-update-message").textContent=error.message;});
for(const action of ["check","download","install"])$("studio-update-"+action).onclick=async()=>{try{if(action==="install"){await saveAllStudioFiles();if(ui.tabs.some(tab=>tab.dirty))throw new Error("Certains fichiers n’ont pas pu être enregistrés. Enregistre-les avant de redémarrer.");}renderStudioUpdates(await api.updates(action));}catch(error){$("studio-update-message").textContent=error.message;}};
api.onEvent((channel,data)=>{if(channel==="appUpdate")renderStudioUpdates(data);});

/* Actions explicites pour gérer le contexte de l’agent. */
const contextActions=centerNode("section","starter-context");
contextActions.setAttribute("aria-label","Gérer la conversation");
contextActions.append(centerNode("h3","","Conversation"));
const contextButtons=centerNode("div","starter-context-actions");
for(const [label,description,icon,command] of [
    ["Voir le contexte","Consulter le résumé du projet","BookOpen","/resume"],
    ["Compacter","Alléger la conversation","Command","/compact"]
]){
    const button=studioAction("",icon,()=>{input.value=command;autosizeInput();input.focus();});
    button.setAttribute("aria-label",label);
    button.title=description;
    const text=centerNode("span","starter-context-text");
    text.append(centerNode("b","",label),centerNode("small","",description));
    button.append(text);contextButtons.append(button);
}
contextActions.append(contextButtons);
$("agent-starter")?.append(contextActions);
for(const [index,button] of [...document.querySelectorAll(".starter-prompts button")].entries()){
    const slot=button.querySelector("span"),icon=studioIcon(["Search","GitCompareArrows","Check"][index]);
    if(slot&&icon)slot.replaceChildren(icon);
}

/* A bounded startup check; downloads continue without blocking the editor. */
async function runStartupUpdateCheck() {
    const overlay=$("startup-loading"),message=$("startup-message"),appRoot=$("app");
    const primary=$("startup-update-now"),progress=$("startup-update-progress"),later=$("startup-continue"),openButton=$("startup-update-open");
    let finished=false,deadline=null,finishTimer=null,current=null,off=null;
    appRoot.inert=true;
    const close=()=>{if(finished)return;finished=true;clearTimeout(deadline);clearTimeout(finishTimer);overlay.hidden=true;appRoot.inert=false;if(overlay.contains(document.activeElement))input.focus();};
    const offer=data=>{
        current=data;
        const available=["available","downloading","downloaded"].includes(data.status);
        openButton.classList.toggle("hidden",!available);
        if(finished)return;
        overlay.querySelector(".startup-track").classList.toggle("hidden",data.status!=="checking");
        if(available){
            clearTimeout(deadline);clearTimeout(finishTimer);
            $("startup-heading").textContent=data.status==="downloaded"?"La mise à jour est prête.":`Nouvelle version ${data.availableVersion||"disponible"}`;
            later.textContent="Plus tard";
            primary.classList.remove("hidden");
            primary.textContent=data.canInstall===false?"Télécharger l’installateur":data.status==="downloaded"?"Redémarrer et installer":data.status==="downloading"?"Téléchargement en cours…":"Mettre à jour maintenant";
            primary.disabled=data.status==="downloading";
            progress.classList.toggle("hidden",data.status!=="downloading");progress.value=data.progress||0;
            message.textContent=data.status==="downloading"?`Téléchargement : ${Math.round(data.progress||0)} %`:
                data.status==="downloaded"?"Enregistre ton travail pour redémarrer et installer la nouvelle version.":data.canInstall===false?"Cette version portable ne s’installe pas automatiquement. Télécharge l’installateur Windows pour passer à la nouvelle version.":"La nouvelle version est disponible. Tu peux l’installer maintenant ou continuer dans l’IDE.";
        }else if(data.status==="error"){
            message.textContent=data.message;progress.classList.add("hidden");primary.classList.remove("hidden");primary.disabled=false;primary.textContent="Réessayer";later.textContent="Ouvrir l’IDE";
        }else if(["current","unavailable"].includes(data.status)){
            message.textContent=data.message;primary.classList.add("hidden");progress.classList.add("hidden");
            clearTimeout(finishTimer);finishTimer=setTimeout(close,650);
        }
    };
    later.onclick=close;later.focus();
    openButton.onclick=()=>{finished=false;overlay.hidden=false;appRoot.inert=true;offer(current);primary.focus();};
    off=api.onEvent((channel,data)=>{if(channel==="appUpdate")offer(data);});
    window.addEventListener("unload",()=>off?.(),{once:true});
    primary.onclick=async()=>{
        primary.disabled=true;
        try{
            if(current?.canInstall===false){await api.openExternal("https://github.com/extraopaa/francestudents-ide/releases/latest");close();return;}
            if(current?.status==="downloaded"){
                await saveAllStudioFiles();
                if(ui.tabs.some(tab=>tab.dirty))throw new Error("Enregistre tes fichiers avant de redémarrer.");
                await api.updates("install");return;
            }
            if(current?.status==="error"){offer(await api.updates("check",{startup:true}));return;}
            offer(await api.updates("download"));
        }catch(error){message.textContent=error.message;}
        finally{primary.disabled=current?.status==="downloading";}
    };
    const start=Date.now();
    try {
        const result=await Promise.race([
            api.updates("check",{startup:true}),
            new Promise(resolve=>{deadline=setTimeout(()=>resolve({status:"timeout",message:"La vérification continue en arrière-plan. Ouverture de l’IDE…"}),8000);})
        ]);
        if(finished)return;
        if(["available","downloading","downloaded"].includes(current?.status))return;
        if(["available","downloading","downloaded"].includes(result.status)){offer(result);return;}
        current=result;
        message.textContent=result.status==="unavailable"?"Mode développement : ouverture de l’IDE…":result.message;
    } catch {
        if(!finished)message.textContent="Vérification indisponible. Ouverture de l’IDE…";
    } finally {
        clearTimeout(deadline);
        if(!finished&&!["available","downloading","downloaded"].includes(current?.status))finishTimer=setTimeout(close,Math.max(650,1100-(Date.now()-start)));
    }
}
runStartupUpdateCheck().catch(()=>{$("startup-loading").hidden=true;$("app").inert=false;});
/* Real local browser, presented as an editor tab. */
let localBrowserState=null,localBrowserActive=false,localBrowserBoundsFrame=0;
const localBrowserPanel=document.createElement("section");
localBrowserPanel.id="local-browser-panel";localBrowserPanel.className="local-browser-panel hidden";
localBrowserPanel.innerHTML=`<div class="local-browser-toolbar"><button id="local-browser-back" title="Page précédente" aria-label="Page précédente">←</button><button id="local-browser-forward" title="Page suivante" aria-label="Page suivante">→</button><button id="local-browser-reload" title="Actualiser" aria-label="Actualiser">↻</button><form id="local-browser-form"><input id="local-browser-address" aria-label="Adresse du navigateur local" placeholder="http://localhost:5173" spellcheck="false"><button type="submit">Ouvrir</button></form><button id="local-browser-external" title="Ouvrir dans le navigateur système" aria-label="Ouvrir dans le navigateur système">↗</button><button id="local-browser-devtools" title="Outils de développement" aria-label="Outils de développement">⋯</button></div><div id="local-browser-status" role="status"></div><div id="local-browser-host"><div id="local-browser-error" class="hidden"><h2>Le site n’est pas accessible</h2><p></p><button id="local-browser-retry">Réessayer</button></div></div>`;
$("editor-area").append(localBrowserPanel);
function syncLocalBrowserBounds(){
    cancelAnimationFrame(localBrowserBoundsFrame);
    localBrowserBoundsFrame=requestAnimationFrame(()=>{
        const host=$("local-browser-host"),rect=host.getBoundingClientRect();
        const modal=Boolean(document.querySelector("dialog[open]"))||["connection-guide","palette","context-menu","model-menu"].some(id=>{const el=$(id);return el&&!el.classList.contains("hidden")&&el.checkVisibility();});
        const visible=localBrowserActive&&!localBrowserPanel.classList.contains("hidden")&&host.checkVisibility()&&!modal&&!$("app").inert&&!document.querySelector('#startup-loading:not([hidden])');
        api.localBrowser("bounds",{x:rect.x,y:rect.y,width:rect.width,height:rect.height,visible}).catch(()=>{});
    });
}
function renderLocalBrowserState(data){
    const changedUrl=localBrowserState?.url!==data.url;
    localBrowserState=data;
    if(changedUrl||document.activeElement!==$("local-browser-address"))$("local-browser-address").value=data.url;
    $("local-browser-back").disabled=!data.canGoBack;$("local-browser-forward").disabled=!data.canGoForward;
    $("local-browser-status").textContent=data.error?"Connexion impossible":data.loading?"Chargement du site…":"";
    $("local-browser-error").classList.toggle("hidden",!data.error);$("local-browser-error").querySelector("p").textContent=data.error||"";
    renderLocalBrowserTab();syncLocalBrowserBounds();
}
function renderLocalBrowserTab(){
    $("local-browser-tab")?.remove();if(!localBrowserState)return;
    const tab=document.createElement("div");tab.id="local-browser-tab";tab.className="tab"+(localBrowserActive?" active":"");tab.title=localBrowserState.url;tab.setAttribute("role","tab");tab.setAttribute("aria-selected",String(localBrowserActive));
    const title=document.createElement("span");title.textContent="◎ "+(localBrowserState.title||"Navigateur local");
    const close=document.createElement("button");close.className="close";close.textContent="×";close.title="Fermer le navigateur local";
    close.onclick=event=>{event.stopPropagation();closeLocalBrowser();};tab.onclick=showLocalBrowser;
    tab.append(title,close);$("tabs").append(tab);
    if(localBrowserActive)for(const fileTab of $("tabs").querySelectorAll(".tab:not(#local-browser-tab)"))fileTab.classList.remove("active");
}
function showLocalBrowser(){
    if(["project","settings","extensions"].includes(ui.sideView))showSideView("explorer");
    closeDocumentPreview();localBrowserActive=true;$("app").classList.add("local-browser-active");localBrowserPanel.classList.remove("hidden");api.localBrowser("show").catch(()=>{});renderLocalBrowserTab();syncLocalBrowserBounds();
}
function hideLocalBrowser(){localBrowserActive=false;$("app").classList.remove("local-browser-active");localBrowserPanel.classList.add("hidden");api.localBrowser("hide").catch(()=>{});renderLocalBrowserTab();}
function closeLocalBrowser(){hideLocalBrowser();localBrowserState=null;$("local-browser-tab")?.remove();api.localBrowser("close").catch(()=>{});renderTabs();}
async function openLocalBrowser(url){
    try{const checked=await api.localPreview("url",{url});showLocalBrowser();renderLocalBrowserState(await api.localBrowser("open",{url:checked.url}));}
    catch(error){studioFeedback(error.message);}
}
window.frstBrowserTab=renderLocalBrowserTab;window.frstBrowserHide=hideLocalBrowser;
$("local-browser-form").onsubmit=event=>{event.preventDefault();openLocalBrowser($("local-browser-address").value);};
for(const action of ["back","forward","reload","devtools"])$("local-browser-"+action).onclick=()=>api.localBrowser(action).catch(error=>studioFeedback(error.message));
$("local-browser-retry").onclick=()=>api.localBrowser("reload").catch(()=>{});
$("local-browser-external").onclick=()=>api.openExternal(localBrowserState?.url,true).catch(error=>studioFeedback(error.message));
api.onEvent((channel,data)=>{
    if(channel==="localBrowser"){
        if(data.command==="focus-address"){$("local-browser-address").focus();$("local-browser-address").select();return;}
        if(data.command==="close"){closeLocalBrowser();return;}
        if(localBrowserActive||localBrowserState)renderLocalBrowserState(data);
    }
    if(channel==="localBrowserOpen")openLocalBrowser(data.url);
});
new ResizeObserver(syncLocalBrowserBounds).observe($("editor-area"));
new MutationObserver(syncLocalBrowserBounds).observe($("app"),{attributes:true,attributeFilter:["class","inert"]});
new MutationObserver(syncLocalBrowserBounds).observe(document.body,{subtree:true,attributes:true,attributeFilter:["open"]});
for(const id of ["connection-guide","palette","context-menu","model-menu"]){const el=$(id);if(el)new MutationObserver(syncLocalBrowserBounds).observe(el,{attributes:true,attributeFilter:["class"]});}
window.addEventListener("resize",syncLocalBrowserBounds);
document.addEventListener("keydown",event=>{
    if(!localBrowserActive||!(event.ctrlKey||event.metaKey))return;
    if(event.key.toLowerCase()==="l"){event.preventDefault();event.stopImmediatePropagation();$("local-browser-address").focus();$("local-browser-address").select();}
    if(event.key.toLowerCase()==="w"){event.preventDefault();event.stopImmediatePropagation();closeLocalBrowser();}
},true);
document.addEventListener("click",event=>{
    const link=event.target.closest("a[href]");if(!link)return;
    try{const url=new URL(link.href);if(["http:","https:"].includes(url.protocol)&&["localhost","127.0.0.1"].includes(url.hostname)){event.preventDefault();event.stopImmediatePropagation();openLocalBrowser(url.href);}}catch{/* not a URL */}
},true);
/* ---------- Reprise d’une conversation Codex · Bêta ---------- */
const conversationImportButton = document.createElement("button");
conversationImportButton.type = "button";
conversationImportButton.id = "conversation-import";
conversationImportButton.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v12l4-4h5M17 3v10m-4-4 4 4 4-4M13 18h8"/></svg><span>Importer Codex</span><span class="composer-beta">Bêta</span>';
conversationImportButton.setAttribute("aria-label", "Importer une conversation Codex, bêta");
conversationImportButton.title = "Continuer une conversation Codex avec une IA FranceStudent";
$("composer-options").appendChild(conversationImportButton);

const conversationImportDialog = document.createElement("dialog");
conversationImportDialog.id = "conversation-import-dialog";
conversationImportDialog.className = "conversation-import-dialog";
conversationImportDialog.setAttribute("aria-labelledby", "conversation-import-title");
conversationImportDialog.innerHTML = `<h2 id="conversation-import-title">Continuer une conversation Codex <small>Bêta</small></h2>
<p>Ouvre le même projet dans FranceStudent, importe le contexte de ta conversation puis choisis l’IA avec laquelle continuer. Aucun fichier du projet n’est importé ou modifié.</p>
<p id="conversation-import-project" class="settings-help"></p><button type="button" id="conversation-import-open-project">Ouvrir le dossier du projet</button>
<label>Lien de partage Codex<input id="conversation-import-url" type="url" placeholder="https://chatgpt.com/s/cx_…" autocomplete="off"></label>
<p class="settings-help">Un lien privé peut être inaccessible. Tu peux aussi utiliser /export dans Codex, sélectionner un export Markdown, JSON ou JSONL, ou coller le texte.</p>
<div class="studio-actions"><button type="button" id="conversation-import-file">Choisir un export…</button><span id="conversation-import-source" class="settings-help"></span></div>
<label>Ou coller la conversation / l’export<textarea id="conversation-import-text" rows="5" placeholder="Colle ici le texte ou le JSON de la conversation…"></textarea></label>
<div class="studio-actions"><button type="button" id="conversation-import-preview">Analyser la conversation</button></div>
<p id="conversation-import-status" role="status"></p><ul id="conversation-import-warnings" class="settings-help"></ul>
<details id="conversation-import-result" class="hidden"><summary>Aperçu du début et de la fin de la conversation</summary><pre id="conversation-import-excerpt"></pre></details>
<div class="conversation-import-choices"><label>IA pour continuer<select id="conversation-import-model"></select></label><label>Mode<select id="conversation-import-mode"><option value="agent">Agent sur le projet ouvert</option><option value="chat">Discussion</option></select></label></div>
<p class="settings-help">Préparer la reprise crée une nouvelle conversation et joint le contexte au brouillon. Tu peux modifier ta demande avant de l’envoyer. Les images et pièces jointes d’origine ne sont pas transférées automatiquement.</p>
<div class="studio-actions"><button type="button" id="conversation-import-close">Annuler</button><button type="button" id="conversation-import-apply" class="primary" disabled>Préparer la reprise</button></div>`;
document.body.appendChild(conversationImportDialog);
let conversationImportPreview = null;
let conversationImportSequence = 0;
let conversationImportWorking = false;

function conversationImportControls(working) {
    conversationImportWorking = working;
    for (const id of ["url", "text", "file", "preview", "model", "mode", "open-project"]) $("conversation-import-" + id).disabled = working;
    $("conversation-import-apply").disabled = working || !conversationImportPreview || !$("conversation-import-model").value;
}
function invalidateConversationImport() {
    conversationImportPreview = null;
    $("conversation-import-result").classList.add("hidden");
    $("conversation-import-warnings").replaceChildren();
    $("conversation-import-status").textContent = "";
    conversationImportControls(false);
}
function renderConversationImportPreview(result) {
    conversationImportPreview = result;
    $("conversation-import-source").textContent = result.source;
    $("conversation-import-status").textContent = `${result.messageCount} message(s) · ${result.chars.toLocaleString("fr-FR")} caractères. Vérifie l’aperçu avant de préparer la reprise.`;
    const warnings = $("conversation-import-warnings"); warnings.replaceChildren();
    for (const warning of result.warnings) { const item = document.createElement("li"); item.textContent = warning; warnings.appendChild(item); }
    $("conversation-import-excerpt").textContent = result.excerpt.map(message => `${message.role === "user" ? "Vous" : message.role === "assistant" ? "Codex" : "Contexte"}\n${message.text}`).join("\n\n──────────\n\n");
    $("conversation-import-result").classList.remove("hidden");
    $("conversation-import-result").open = true;
}
async function analyzeConversationImport(action, payload) {
    if (conversationImportWorking) return;
    const sequence = ++conversationImportSequence;
    invalidateConversationImport(); conversationImportControls(true);
    $("conversation-import-status").textContent = "Lecture de la conversation…";
    try {
        const result = await api.importConversation(action, payload);
        if (sequence !== conversationImportSequence) return;
        if (result.canceled) { $("conversation-import-status").textContent = "Sélection annulée."; return; }
        if (action === "file") { $("conversation-import-url").value = ""; $("conversation-import-text").value = ""; }
        renderConversationImportPreview(result);
    } catch (error) {
        if (sequence === conversationImportSequence) $("conversation-import-status").textContent = error.message;
    } finally { if (sequence === conversationImportSequence) conversationImportControls(false); }
}

conversationImportButton.onclick = async () => {
    if (ui.status.busy) { studioFeedback("Attends la fin de la tâche avant d’importer une conversation."); return; }
    $("conversation-import-project").textContent = `Projet ouvert : ${ui.workspace || "aucun — ouvre le dossier correspondant pour poursuivre le code"}`;
    $("conversation-import-mode").value = ui.status.mode === "chat" ? "chat" : "agent";
    conversationImportDialog.showModal();
    const sequence = ++conversationImportSequence;
    conversationImportControls(true);
    try {
        const data = await api.models();
        if (sequence !== conversationImportSequence) return;
        const select = $("conversation-import-model"); select.replaceChildren();
        for (const model of data.agents || []) { const option = document.createElement("option"); option.value = model.id; option.textContent = model.name; select.appendChild(option); }
        select.value = String(ui.currentModelId ?? data.current);
        if (!select.value && select.options.length) select.selectedIndex = 0;
    } catch (error) { $("conversation-import-status").textContent = error.message; }
    finally { if (sequence === conversationImportSequence) conversationImportControls(false); }
};
$("conversation-import-url").addEventListener("input", invalidateConversationImport);
$("conversation-import-text").addEventListener("input", invalidateConversationImport);
$("conversation-import-file").onclick = () => analyzeConversationImport("file");
$("conversation-import-preview").onclick = () => {
    const url = $("conversation-import-url").value.trim(), content = $("conversation-import-text").value.trim();
    if (!url && !content) { $("conversation-import-status").textContent = "Colle un lien ou une conversation, ou choisis un export."; return; }
    analyzeConversationImport("preview", url ? { url } : { content });
};
$("conversation-import-open-project").onclick = async () => {
    try { const workspace = await api.openProject(); if (workspace) $("conversation-import-project").textContent = `Projet ouvert : ${workspace}`; }
    catch (error) { $("conversation-import-status").textContent = error.message; }
};
$("conversation-import-close").onclick = () => conversationImportDialog.close();
conversationImportDialog.addEventListener("close", () => { conversationImportSequence++; conversationImportControls(false); });
$("conversation-import-apply").onclick = async () => {
    if (!conversationImportPreview || conversationImportWorking) return;
    conversationImportControls(true);
    try {
        const result = await api.importConversation("apply", { token: conversationImportPreview.token,
            modelId: Number($("conversation-import-model").value), mode: $("conversation-import-mode").value });
        pendingAttachments.push(result.attachment);
        input.value = input.value.trim() ? input.value + "\n\n" + result.prompt : result.prompt;
        renderAttachments(); saveStudioDraft(); autosizeInput(); setAgentTab("conversation");
        conversationImportPreview = null;
        conversationImportDialog.close();
        input.focus();
        studioFeedback("Conversation Codex importée. Modifie ta demande si nécessaire, puis clique sur Envoyer pour continuer.");
    } catch (error) { $("conversation-import-status").textContent = error.message; }
    finally { conversationImportControls(false); }
};
/* ---------- Mode Éco ---------- */
const ecoModeButton = document.createElement("button");
ecoModeButton.id = "eco-mode-toggle";
ecoModeButton.type = "button";
ecoModeButton.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4c-6-1-13 1-13 7a6 6 0 0 0 6 6c6 0 8-7 7-13ZM4 21 15 10"/></svg><span class="eco-mode-label">Mode Éco</span><span class="eco-mode-indicator" aria-hidden="true"></span>';
ecoModeButton.setAttribute("aria-pressed", "false");
$("conversation-import").after(ecoModeButton);

const ecoModeDialog = document.createElement("dialog");
ecoModeDialog.id = "eco-mode-dialog";
ecoModeDialog.className = "history-delete-dialog";
ecoModeDialog.setAttribute("aria-labelledby", "eco-mode-title");
ecoModeDialog.innerHTML = `<h2 id="eco-mode-title">Activer le mode Éco ?</h2>
<p>Ce mode vise à réduire la consommation de quota, avec des capacités limitées :</p>
<ul><li>Agent limité à 4 tours par demande : les tâches longues peuvent rester incomplètes.</li>
<li>Contexte projet ajouté automatiquement limité à 20 000 caractères. L’IA peut manquer certains éléments et doit lire les fichiers nécessaires.</li>
<li>Pas de sous-agents ni de nouvelle tentative automatique en cas de réponse d’outil invalide.</li>
<li>Recherche web intégrée désactivée et réponses demandées plus concises.</li></ul>
<p>Le modèle sélectionné reste le même. Ce mode ne garantit pas un quota fixe : l’historique existant, les fichiers, leurs pages et les relances réseau peuvent toujours coûter cher. Aucune pièce jointe n’est supprimée.</p>
<p>Le choix est mémorisé pour les prochaines demandes. Tu peux le désactiver à tout moment hors exécution.</p>
<p id="eco-mode-error" role="status"></p>
<div class="studio-actions"><button type="button" id="eco-mode-cancel">Annuler</button><button type="button" id="eco-mode-enable">Activer avec ces limites</button></div>`;
document.body.appendChild(ecoModeDialog);
async function setEcoModeEnabled(enabled) {
    ecoModeButton.disabled = true;
    try { await api.setEcoMode(enabled); applyStatus(await api.status()); }
    finally { ecoModeButton.disabled = Boolean(ui.status.busy); }
}
ecoModeButton.onclick = async () => {
    if (ui.status.busy) return;
    if (ui.status.ecoMode) {
        try { await setEcoModeEnabled(false); }
        catch (error) { studioFeedback(error.message); }
        return;
    }
    $("eco-mode-error").textContent = "";
    ecoModeDialog.showModal();
    $("eco-mode-cancel").focus();
};
$("eco-mode-cancel").onclick = () => ecoModeDialog.close();
$("eco-mode-enable").onclick = async () => {
    $("eco-mode-enable").disabled = true;
    try { await setEcoModeEnabled(true); ecoModeDialog.close(); }
    catch (error) { $("eco-mode-error").textContent = error.message; }
    finally { $("eco-mode-enable").disabled = false; }
};
/* ---------- Serveurs locaux proposés dans les réponses ---------- */
async function attachServerControls(message, text) {
    if (message.dataset.serverChecked || !/https?:\/\/(?:localhost|127\.0\.0\.1)/i.test(text || "")) return;
    message.dataset.serverChecked = "1";
    const workspace = ui.workspace || ui.status.workspace || null;
    try {
        const hint = await api.serverHint(text);
        if (!hint || !message.isConnected) return;
        const card = document.createElement("section");
        card.className = "message-server-controls";
        card.dataset.serverKey = hint.key;
        card.serverWorkspace = workspace;
        const title = document.createElement("b"); title.textContent = "Serveur web local";
        const command = document.createElement("code"); command.textContent = `${hint.command} · dossier : ${hint.cwd}`;
        const address = document.createElement("span"); address.textContent = hint.url;
        const status = document.createElement("p"); status.className = "message-server-status"; status.setAttribute("role", "status");
        status.textContent = "Lance cette commande dans le projet ouvert avec Démarrer.";
        const actions = document.createElement("div"); actions.className = "studio-actions";
        const start = document.createElement("button"); start.type = "button"; start.textContent = "Démarrer";
        const stop = document.createElement("button"); stop.type = "button"; stop.textContent = "Arrêter"; stop.disabled = true;
        const open = document.createElement("button"); open.type = "button"; open.textContent = "Ouvrir le site";
        const details = document.createElement("details"), summary = document.createElement("summary"), output = document.createElement("pre");
        summary.textContent = "Sortie du serveur"; details.append(summary, output); details.hidden = true;
        card.updateServerRun = run => {
            // An initial IPC snapshot may arrive after a newer stop event.
            if (card.serverRun?.id === run.id && card.serverRun.status !== "running" && run.status === "running") return;
            card.serverRun = run;
            const running = run.status === "running";
            start.disabled = running; stop.disabled = !running;
            status.textContent = running ? "Processus en cours. Ouvre le site quand le serveur est prêt." : run.status === "stopped" ? "Serveur arrêté." : `Processus terminé${run.exitCode != null ? ` (code ${run.exitCode})` : ""}. Consulte la sortie si le site est inaccessible.`;
            output.textContent = String(run.output || "").slice(-8000); details.hidden = !output.textContent;
            if (run.status === "failed") details.open = true;
        };
        start.onclick = async () => {
            start.disabled = true; status.textContent = "Démarrage…";
            try { card.updateServerRun(await api.projectStudio("serverStart", { text, workspace })); }
            catch (error) { status.textContent = error.message; start.disabled = false; }
        };
        stop.onclick = async () => {
            stop.disabled = true;
            try { await api.projectStudio("stop", { id: card.serverRun.id }); }
            catch (error) { status.textContent = error.message; stop.disabled = false; }
        };
        open.onclick = () => openLocalBrowser(hint.url);
        actions.append(start, stop, open); card.append(title, command, address, status, actions, details); message.appendChild(card);
        const runs = await api.projectStudio("runs");
        const run = [...runs].reverse().find(item => item.server?.key === hint.key && item.workspace === workspace);
        if (run && card.isConnected) card.updateServerRun(run);
    } catch { /* Ordinary messages remain readable when task controls are unavailable. */ }
}

api.onEvent((channel, run) => {
    if (channel !== "projectTask" || !run.server) return;
    for (const card of document.querySelectorAll(".message-server-controls")) {
        if (card.dataset.serverKey === run.server.key && card.serverWorkspace === run.workspace) card.updateServerRun(run);
    }
});
/* ---------- Quota du compte et compteurs de cette session ---------- */
function usagePercent(value) {
    return value != null && Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
}
function usageTone(value) { return value >= 90 ? "critical" : value >= 75 ? "warning" : "normal"; }
function usageDate(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Non communiquée";
}
function usageNumber(value) { return Math.max(0, Number(value) || 0).toLocaleString("fr-FR"); }
function usageProgress(value, label, className = "usage-progress") {
    const bounded = Math.min(100, value ?? 0);
    return `<span class="${className} ${usageTone(value)}${value == null ? " unknown" : ""}" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" ${value == null ? 'aria-valuetext="Indisponible"' : `aria-valuenow="${bounded}"`} style="--usage:${bounded}%"><span></span></span>`;
}
function renderUsageMeter() {
    const el = $("st-usage"), quota = ui.quota, percent = usagePercent(quota?.percent);
    const label = percent == null ? "Usage" : `${quota.uncertain ? "≈ " : ""}${percent} %`;
    el.classList.remove("warn", "crit");
    el.innerHTML = usageProgress(percent, "Quota de chat utilisé", "usage-mini-meter") + `<span class="usage-meter-label">${label}</span>`;
    el.title = percent == null ? "Voir la consommation et les compteurs de session" : `${quota.uncertain ? "Environ " : ""}${percent} % du quota de chat utilisé · Cliquer pour les détails`;
    el.setAttribute("aria-label", el.title);
}

function renderUsageDashboard() {
    if ($("agent").dataset.tab !== "usage") return;
    const box = $("usage-dashboard"), quota = ui.quota, usage = ui.status.usage || {};
    const signature = JSON.stringify([quota, usage, ui.quotaLoading, ui.quotaError, ui.quotaUpdatedAt, ui.status.booted, ui.status.ecoMode]);
    if (box.usageSignature === signature) return;
    box.usageSignature = signature;
    const percent = usagePercent(quota?.percent), reported = Number(usage.reported) > 0;
    const total = reported ? Number(usage.inputTokens || 0) + Number(usage.outputTokens || 0) : null;
    const estimate = Math.round(Number(usage.chars || 0) / 3.5);
    const metric = (name, value, detail) => `<div class="usage-metric"><span>${name}</span><strong>${value}</strong><small>${detail}</small></div>`;
    const limits = (quota?.limits || []).map(limit => {
        const value = usagePercent(limit.usedPercent);
        const label = [limit.type, limit.bucket].filter(Boolean).join(" · ") || "Limite du compte";
        return `<div class="usage-limit"><div><b>${escapeHtml(label)}</b><span>${value == null ? "—" : Math.round(value) + " %"}</span></div>${usageProgress(value, label)}<small>${usageNumber(limit.used)}${limit.limit > 0 ? " / " + usageNumber(limit.limit) : " utilisé(s)"} · Réinitialisation : ${escapeHtml(usageDate(limit.resetAt))}</small></div>`;
    }).join("");
    $("usage-refresh").disabled = Boolean(ui.quotaLoading) || !ui.status.booted;
    box.innerHTML = `<div class="usage-quota-card ${usageTone(percent)}">
        <div class="usage-quota-top"><span>Quota de chat</span><span class="usage-badge">${ui.quotaLoading ? "Actualisation…" : quota?.uncertain ? "Estimation serveur" : percent == null ? "Indisponible" : "Compte FranceStudent"}</span></div>
        <div class="usage-quota-main"><div class="usage-ring${percent == null ? " unknown" : ""}" style="--usage:${Math.min(100, percent ?? 0)}%" role="img" aria-label="${percent == null ? "Quota inconnu" : percent + " % utilisés"}"><strong>${percent == null ? "—" : (quota?.uncertain ? "≈ " : "") + percent + "<small>%</small>"}</strong></div><div><b>${percent == null ? "Quota indisponible" : usageNumber(Math.max(0, 100 - percent)) + " % disponibles"}</b><p>${percent == null ? "Les compteurs de session restent accessibles." : "de votre budget de chat"}</p>${quota?.powerUp ? '<span class="usage-badge">Power-up actif</span>' : ""}</div></div>
        <div class="usage-reset"><span>Réinitialisation</span><b>${escapeHtml(usageDate(quota?.resetAt))}</b></div></div>
        ${ui.quotaError ? `<p class="usage-notice" role="status">${escapeHtml(ui.quotaError)}</p>` : !ui.status.booted ? '<p class="usage-notice">Connecte-toi pour consulter le quota du compte.</p>' : ""}
        <div class="usage-section-title"><h3>Cette session</h3><span>${ui.status.ecoMode ? "Mode Éco activé" : "Depuis l’ouverture"}</span></div>
        <div class="usage-metrics">${metric("Requêtes IA", usageNumber(usage.requests), "Relances comprises")}${metric(reported ? "Tokens comptabilisés" : "Tokens estimés", reported ? usageNumber(total) : estimate ? "≈ " + usageNumber(estimate) : "—", reported ? "Données reçues du service" : "Estimation du texte envoyé")}${metric("Entrée", reported ? usageNumber(usage.inputTokens) : "—", "Tokens envoyés au modèle")}${metric("Sortie", reported ? usageNumber(usage.outputTokens) : "—", "Tokens générés")}</div>
        ${reported ? `<p class="usage-cache">${usageNumber(usage.cachedTokens)} tokens en cache, déjà inclus dans l’entrée. Les compteurs couvrent les réponses qui transmettent un relevé.</p>` : '<p class="usage-cache">Sans relevé de tokens du service, l’estimation ne couvre pas les images, les réponses ni tout l’historique serveur.</p>'}
        ${limits ? `<div class="usage-section-title"><h3>Limites du compte</h3></div><div class="usage-limits">${limits}</div>` : ""}
        <p class="usage-updated">${ui.quotaUpdatedAt ? "Quota actualisé le " + escapeHtml(usageDate(ui.quotaUpdatedAt)) : "Le quota ne peut pas être déduit du nombre de tokens de cette session."}</p>`;
}
$("usage-refresh").onclick = () => refreshQuota();
/* ---------- Annulation d’une action sans interrompre l’agent ---------- */
const actionControlPanel = document.createElement("section");
actionControlPanel.id = "action-controls";
actionControlPanel.className = "action-controls hidden";
actionControlPanel.setAttribute("aria-label", "Actions en accès complet");
document.querySelector(".agent-context-bar")?.after(actionControlPanel);
if (!actionControlPanel.isConnected) $("agent-activity").before(actionControlPanel);
api.onEvent((channel, action) => {
    if (channel === "status") {
        for (const button of actionControlPanel.querySelectorAll("button[data-undo]")) { button.disabled = Boolean(action.busy); button.title = action.busy ? "Disponible après la tâche pour éviter les modifications concurrentes." : "Restaurer cette modification suivie"; }
        return;
    }
    if (channel !== "actionControl") return;
    let row = [...actionControlPanel.children].find(item => item.dataset.actionId === action.id);
    if (action.state === "running" && !row) {
        row = document.createElement("div"); row.className = "action-control-row"; row.dataset.actionId = action.id;
        row.dataset.actionName = action.name;
        const label = document.createElement("span"); label.textContent = toolLabel(action.name); label.title = action.description;
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Annuler l’action";
        cancel.title = "Écarter le résultat et arrêter l’opération si possible, sans arrêter l’agent. Les effets déjà produits ne sont pas automatiquement annulés.";
        cancel.onclick = async () => { cancel.disabled = true; try { await api.cancelAction(action.id); } catch (error) { studioFeedback(error.message); cancel.disabled = false; } };
        row.append(label, cancel); actionControlPanel.appendChild(row);
    }
    if (row && action.state === "canceling") { row.querySelector("button").disabled = true; row.querySelector("button").textContent = "Annulation…"; }
    if (row && ["done", "failed", "canceled"].includes(action.state)) {
        if (action.undo) {
            const button = row.querySelector("button"); button.dataset.undo = "1"; button.disabled = Boolean(ui.status.busy); button.textContent = "Annuler la modification";
            button.title = "Disponible après la tâche pour éviter les modifications concurrentes. Les commandes shell et publications distantes ne sont pas restaurées.";
            button.onclick = async () => { button.disabled = true; try { if (ui.workspace !== action.undo.workspace) throw new Error("Reviens au projet de cette modification."); await api.undoEntry(action.undo.index, action.undo.at); row.remove(); actionControlPanel.classList.toggle("hidden", !actionControlPanel.children.length); } catch (error) { studioFeedback(error.message); button.disabled = false; } };
        } else row.remove();
        if (action.state === "canceled") studioFeedback("Action annulée. L’agent continue ; les effets déjà produits restent à vérifier.");
    }
    actionControlPanel.classList.toggle("hidden", !actionControlPanel.children.length);
});
/* ---------- Connecteur natif GitHub ---------- */
const githubConnectorDialog = document.createElement("dialog");
githubConnectorDialog.id = "github-connector-dialog";
githubConnectorDialog.className = "conversation-import-dialog github-connector-dialog";
githubConnectorDialog.setAttribute("aria-labelledby", "github-connector-title");
githubConnectorDialog.innerHTML = `<div class="workspace-section-head"><h2 id="github-connector-title">GitHub <small>Bêta</small></h2><button type="button" id="github-connector-close" aria-label="Fermer le connecteur GitHub">×</button></div>
<p id="github-connector-account" class="settings-help"></p><p id="github-connector-repo"></p>
<div class="studio-actions github-connector-nav"><button type="button" data-github-view="releases">Releases</button><button type="button" data-github-view="pull_requests">Pull requests</button><button type="button" data-github-view="issues">Issues</button><button type="button" data-github-view="repositories">Mes dépôts</button><button type="button" id="github-connector-readme">Modifier le README avec l’IA</button></div>
<p id="github-connector-status" role="status"></p><div id="github-connector-list"></div>
<details id="github-connector-create"><summary>Préparer une release</summary><p class="settings-help">Un brouillon sera créé. Ajoute ses fichiers et vérifie ses notes avant de publier.</p><label>Tag<input id="github-release-tag" placeholder="v1.0.0"></label><label>Commit ou branche cible<input id="github-release-target" placeholder="SHA du commit ou main"></label><label>Titre<input id="github-release-title" placeholder="Version 1.0.0"></label><label>Notes<textarea id="github-release-body" rows="4"></textarea></label><button type="button" id="github-release-create">Créer le brouillon</button></details>
<p class="settings-help">Le dépôt vient du remote origin du projet ouvert. Les droits dépendent du token connecté. L’agent dispose de l’outil natif github ; les modifications demandent une confirmation en mode Demander, mais pas en Full accès. Une publication ou un push ne peut pas être annulé comme une lecture locale.</p>`;
document.body.appendChild(githubConnectorDialog);
let githubConnectorView = "releases", githubConnectorLoading = false;
async function githubConnectorWork(operation) {
    if (githubConnectorLoading) return;
    githubConnectorLoading = true;
    const buttons = [...githubConnectorDialog.querySelectorAll("button:not(#github-connector-close)")];
    buttons.forEach(button => { button.disabled = true; });
    $("github-connector-status").textContent = "Chargement…";
    try { await operation(); }
    catch (error) { $("github-connector-status").textContent = error.message; }
    finally { githubConnectorLoading = false; buttons.forEach(button => { if (button.isConnected) button.disabled = false; }); }
}
async function loadGithubConnector() {
    const result = await api.githubConnector({ action: githubConnectorView });
    const list = $("github-connector-list"); list.replaceChildren();
    for (const item of result.items || result.repositories || []) {
        const card = document.createElement("article"); card.className = "github-connector-card";
        const title = document.createElement("b"); title.textContent = item.title || item.name;
        const status = document.createElement("span"); status.textContent = item.draft ? "Brouillon" : item.state || (item.private === true ? "Privé" : item.private === false ? "Public" : "Publié");
        const actions = document.createElement("div"); actions.className = "studio-actions";
        const open = document.createElement("button"); open.textContent = "Voir sur GitHub"; open.onclick = () => api.openExternal(item.url, true).catch(error => { $("github-connector-status").textContent = error.message; });
        actions.append(open);
        if (item.draft && githubConnectorView === "releases") {
            const upload = document.createElement("button"); upload.textContent = "Ajouter un fichier"; upload.onclick = () => githubConnectorWork(async () => { await api.githubUploadAsset(item.id); await loadGithubConnector(); });
            const publish = document.createElement("button"); publish.textContent = "Publier la release"; publish.onclick = () => githubConnectorWork(async () => { await api.githubConnector({ action: "publish_release", id: item.id }); await loadGithubConnector(); });
            actions.append(upload, publish);
        }
        if (githubConnectorView === "repositories") {
            const link = document.createElement("button"); link.textContent = "Lier au projet"; link.onclick = () => githubConnectorWork(async () => { await api.githubSetRemote(item.name); $("github-connector-repo").textContent = item.name; $("github-connector-status").textContent = "Remote origin mis à jour."; }); actions.append(link);
        }
        card.append(title, status);
        if (item.body) { const details = document.createElement("details"), summary = document.createElement("summary"), body = document.createElement("pre"); summary.textContent = "Notes"; body.textContent = item.body; details.append(summary, body); card.append(details); }
        for (const asset of item.assets || []) { const line = document.createElement("small"); line.textContent = `${asset.name} · ${formatBytes(asset.size)}`; card.append(line); }
        card.append(actions); list.append(card);
    }
    $("github-connector-status").textContent = list.children.length ? `${list.children.length} élément(s)` : "Aucun élément.";
    for (const button of githubConnectorDialog.querySelectorAll("[data-github-view]")) button.setAttribute("aria-pressed", String(button.dataset.githubView === githubConnectorView));
}
$("gh-connector-open").onclick = () => {
    githubConnectorDialog.showModal();
    githubConnectorWork(async () => {
        const account = await api.githubStatus();
        $("github-connector-account").textContent = account.connected ? `Compte connecté : ${account.login || "GitHub"}` : "Connecte ton compte avec le champ sécurisé du panneau Git.";
        $("github-connector-repo").textContent = account.remote || "Aucun dépôt lié au projet.";
        if (!account.connected) { $("github-connector-list").replaceChildren(); $("github-connector-status").textContent = "Connexion GitHub nécessaire."; return; }
        try { const repo = await api.githubConnector({ action: "overview" }); $("github-connector-repo").textContent = `${repo.repository} · ${repo.branch}${repo.private ? " · Privé" : " · Public"}`; $("github-release-target").value = repo.branch; } catch { githubConnectorView = "repositories"; }
        await loadGithubConnector();
    });
};
$("github-connector-close").onclick = () => githubConnectorDialog.close();
for (const button of githubConnectorDialog.querySelectorAll("[data-github-view]")) button.onclick = () => githubConnectorWork(async () => { githubConnectorView = button.dataset.githubView; await loadGithubConnector(); });
$("github-release-create").onclick = () => githubConnectorWork(async () => {
    await api.githubConnector({ action: "create_release", tag: $("github-release-tag").value.trim(), target: $("github-release-target").value.trim(), title: $("github-release-title").value.trim(), body: $("github-release-body").value });
    githubConnectorView = "releases"; await loadGithubConnector();
});
$("github-connector-readme").onclick = () => { githubConnectorDialog.close(); setAgentTab("conversation"); input.value = "Examine le projet et son README, puis mets à jour le README pour expliquer simplement son utilisation. Utilise les outils de fichiers locaux ; prépare un commit et un push uniquement si je te le demande."; autosizeInput(); saveStudioDraft(); input.focus(); };
/* Organize settings without moving the controls or losing search results. */
const settingsNavigation = centerNode("nav", "settings-navigation");
settingsNavigation.setAttribute("aria-label", "Catégories des paramètres");
let settingsCategory = "all";
const settingsGroups = [
    ["all", "Tout"], ["general", "Général"], ["agent", "IA et contexte"],
    ["access", "Autorisations"], ["advanced", "Connexions et outils"]
];
const settingsGroupByTitle = {
    "settings-model-title": "general", "studio-editor-settings-title": "general",
    "settings-context-title": "agent", "settings-web-title": "agent",
    "settings-access-title": "access", "settings-tools-title": "advanced",
    "settings-marketplace-title": "advanced", "settings-help-title": "general"
};
captureSettings.dataset.settingsGroup = "access";
updateSettings.dataset.settingsGroup = "general";
function filterSettingsCards() {
    const normalize = value => value.toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const query = normalize($("settings-search").value).trim();
    let visible = 0;
    for (const card of $("settings-view").querySelectorAll(".settings-card")) {
        const group = card.dataset.settingsGroup || settingsGroupByTitle[card.getAttribute("aria-labelledby")] || "general";
        const matches = query ? normalize(card.textContent).includes(query) : settingsCategory === "all" || settingsCategory === group;
        card.classList.toggle("hidden", !matches);
        if (matches) visible++;
    }
    for (const button of settingsNavigation.children) {
        button.setAttribute("aria-pressed", String(!query && button.dataset.category === settingsCategory));
        button.disabled = !!query;
        button.title = query ? "Efface la recherche pour filtrer par catégorie" : "";
    }
    $("settings-search-empty").classList.toggle("hidden", visible > 0);
}
for (const [id, label] of settingsGroups) {
    const button = centerNode("button", "", label);
    button.type = "button"; button.dataset.category = id;
    button.onclick = () => { settingsCategory = id; filterSettingsCards(); };
    settingsNavigation.append(button);
}
$("settings-search").closest(".settings-search-wrap").after(settingsNavigation);
$("settings-search").oninput = filterSettingsCards;
filterSettingsCards();
// Expose icon-only navigation names to keyboard and assistive technology.
for (const button of document.querySelectorAll("#activity-bar button, .agent-actions button, .sidebar-actions button")) {
    if (!button.hasAttribute("aria-label") && button.title) button.setAttribute("aria-label", button.title);
}
/* Explicit progress and cancellation for community instruction downloads. */
async function uninstallCenterSkill(skill) {
    if (!skill || !window.confirm(`Désinstaller « ${skill.name} » ? Il ne sera plus disponible pour l’IA. Son dossier sera conservé dans .trash pour pouvoir le récupérer.`)) return;
    await changeExtension("remove", {key:skill.key}, `« ${skill.name} » désinstallé. Son dossier reste récupérable dans .trash.`);
}
const extensionDownloads = new Map();
const extensionDownloadList = centerNode("section", "extension-downloads hidden");
extensionDownloadList.setAttribute("aria-label", "Téléchargements des skills");
$("marketplace-status").after(extensionDownloadList);
function showSkillDownload(job) {
    const card = job.card;
    card.replaceChildren();
    const heading = centerNode("div");
    heading.append(centerNode("b", "", job.item.name));
    const button = centerNode("button", "", job.state === "loading" ? "Annuler" : job.state === "failed" || job.state === "canceled" ? "Réessayer" : "Fermer");
    button.type = "button";
    button.onclick = async () => {
        if (job.state === "loading") {
            button.disabled = true;
            try { await api.marketplace("cancel", {requestId:job.id}); }
            catch (error) { button.disabled = false; card.append(centerNode("p", "", error.message)); }
        } else if (job.state === "failed" || job.state === "canceled") { card.remove(); extensionDownloads.delete(job.id); downloadSkillPreview(job.item); }
        else { card.remove(); extensionDownloads.delete(job.id); extensionDownloadList.classList.toggle("hidden", !extensionDownloadList.children.length); }
    };
    heading.append(button); card.append(heading);
    if (job.state === "loading") {
        const progress = document.createElement("progress"); progress.setAttribute("aria-label", "Téléchargement du SKILL.md");
        if (job.total) { progress.max = job.total; progress.value = Math.min(job.received, job.total); }
        card.append(progress);
    }
    const bytes = count => `${(count / 1024).toLocaleString("fr-FR", {maximumFractionDigits:1})} Ko`;
    card.append(centerNode("p", "", job.message || `${bytes(job.received)} reçus${job.total ? ` sur ${bytes(job.total)}` : " · taille totale inconnue"}`));
}
async function downloadSkillPreview(item) {
    const job = {id:crypto.randomUUID(), item, received:0, total:null, state:"loading", card:centerNode("article", "download-card")};
    extensionDownloads.set(job.id, job); extensionDownloadList.classList.remove("hidden"); extensionDownloadList.append(job.card); showSkillDownload(job);
    // Keep only recent completed entries; in-flight downloads are always visible.
    for (const [id, old] of extensionDownloads) if (extensionDownloads.size > 8 && old.state !== "loading") { old.card.remove(); extensionDownloads.delete(id); }
    try {
        const preview = await api.marketplace("preview", {githubUrl:item.githubUrl, requestId:job.id});
        job.state = "ready"; job.message = "Téléchargé · lis les instructions avant de choisir Installer. Le skill sera désactivé.";
        showSkillDownload(job); openSkillEditor({kind:"remote", item:{...item, ...preview}});
    } catch (error) {
        job.state = error.message.includes("annulé") ? "canceled" : "failed"; job.message = error.message; showSkillDownload(job);
    }
}
api.onEvent((channel, data) => {
    if (channel !== "marketplaceDownload") return;
    const job = extensionDownloads.get(data.requestId);
    if (!job || job.state !== "loading") return;
    job.received = data.received; job.total = data.total; showSkillDownload(job);
});
/* The official EffectCraft editor, embedded next to its specialized agent chat. */
const motionNav=document.createElement("button");
motionNav.type="button";motionNav.className="activity";motionNav.dataset.view="motion";motionNav.id="btn-motion";
motionNav.title="Motion design · EffectCraft (Bêta)";motionNav.setAttribute("aria-label","Motion design · EffectCraft, Bêta");
motionNav.innerHTML='<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>';
$("activity-bar").insertBefore(motionNav,document.querySelector("#activity-bar .spacer"));
const motionView=document.createElement("section");motionView.id="motion-view";motionView.className="motion-page";motionView.setAttribute("aria-label","EffectCraft et agent motion design");
motionView.innerHTML=`<header class="motion-header"><div class="motion-brand"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17 8-13 8 13H4Zm4-1 4-7 4 7"/></svg><h1>EffectCraft</h1><span class="motion-pill">Bêta</span></div><div class="motion-actions"><button type="button" id="motion-local-save" title="Enregistrer dans le stockage local d’EffectCraft">Enregistrer</button><button type="button" id="motion-close">Retour au code</button></div></header>
<div class="motion-commandbar"><div role="group" aria-label="Contrôles de composition"><button type="button" id="motion-undo" title="Annuler la dernière modification">↶ Annuler</button><button type="button" id="motion-play">▶ Lecture</button><button type="button" id="motion-stop">■ Arrêter</button></div><span id="motion-engine-status" role="status">EffectCraft attend ton ouverture.</span><button type="button" id="motion-engine-reload" title="Recharger EffectCraft">Recharger</button></div>
<div class="motion-stage" aria-label="Chargement d’EffectCraft"><div><h2>Chargement d’EffectCraft…</h2><p>Le véritable éditeur se prépare. Le chat motion design reste à droite.</p><button type="button" id="motion-retry">Réessayer</button></div></div>
<div id="motion-engine" class="motion-engine" hidden><div id="motion-engine-frame" class="motion-engine-frame"></div></div>
<div id="motion-consent" class="motion-consent" role="alertdialog" aria-modal="true" aria-labelledby="motion-consent-title" tabindex="-1"><div class="motion-consent-card"><span class="motion-pill">Bêta</span><h2 id="motion-consent-title">Ton espace motion design</h2><p>EffectCraft à gauche, ton agent spécialisé à droite. Le chat peut modifier les compositions, les calques, les keyframes et les effets. Cette intégration reste expérimentale : conserve une copie des projets importants.</p><div class="motion-consent-actions"><button type="button" id="motion-consent-back">Retour au code</button><button type="button" id="motion-consent-ok" class="primary">J’ai compris, continuer</button></div></div></div>`;
$("app").append(motionView);
const motionEngine={frame:null,loading:false,accepted:false};
function isMotionOpen(){return $("app").classList.contains("view-motion");}
function setMotionEngineStatus(text){$("motion-engine-status").textContent=text;$("motion-engine-status").title=text;}
async function openMotionDesign(){
    if(!await selectMotionChat("motion"))return;
    setActivity(null);$("app").classList.add("view-motion");motionNav.classList.add("active");
    $("motion-consent").classList.toggle("hidden-consent",motionEngine.accepted);
    if(motionEngine.accepted)loadMotionEngine();else $("motion-consent-ok").focus({preventScroll:true});
    syncMotionChat();
}
async function closeMotionDesign(){
    if(!isMotionOpen() || !await selectMotionChat("code"))return;
    $("app").classList.remove("view-motion");motionNav.classList.remove("active");
    setActivity($("app").classList.contains("no-sidebar")?null:ui.sideView);syncMotionChat();
}
motionNav.onclick=()=>isMotionOpen()?closeMotionDesign():openMotionDesign();
$("motion-close").onclick=closeMotionDesign;$("motion-consent-back").onclick=closeMotionDesign;
$("motion-consent-ok").onclick=()=>{motionEngine.accepted=true;$("motion-consent").classList.add("hidden-consent");loadMotionEngine();input.focus({preventScroll:true});};
for(const button of document.querySelectorAll("#activity-bar .activity"))if(button!==motionNav)button.addEventListener("click",event=>{
    if(isMotionOpen() && ui.status.busy){event.preventDefault();event.stopImmediatePropagation();studioFeedback("Attends la fin de la tâche ou utilise Stop avant de changer de chat.");return;}
    closeMotionDesign();
},true);
function showMotionEngineFallback(message){$("motion-engine").hidden=true;motionView.querySelector(".motion-stage").hidden=false;motionView.querySelector(".motion-stage h2").textContent="EffectCraft indisponible";motionView.querySelector(".motion-stage p").textContent=message;setMotionEngineStatus(message);}
async function loadMotionEngine(force=false){
    if(motionEngine.loading || motionEngine.frame && !force)return;
    if(force && ui.status.busy){studioFeedback("Arrête d’abord la tâche pour recharger EffectCraft.");return;}
    motionEngine.loading=true;
    try{
        if(motionEngine.frame){motionEngine.frame.remove();motionEngine.frame=null;}
        const info=await api.effectCraft("start"),url=new URL(info.url);
        if(url.protocol!=="http:" || url.hostname!=="127.0.0.1")throw new Error("Adresse EffectCraft inattendue.");
        url.search="?nosw&frameworkers=0&webgl";
        const frame=document.createElement("iframe");frame.className="motion-engine-iframe";frame.title="EffectCraft · Motion design";
        frame.setAttribute("sandbox","allow-scripts allow-same-origin allow-downloads");frame.setAttribute("allow","fullscreen");frame.referrerPolicy="no-referrer";
        frame.addEventListener("load",async()=>{
            for(let attempt=0;attempt<60 && motionEngine.frame===frame;attempt++){
                try{await api.effectCraftControl({method:"host.info",params:{}});await api.effectCraftControl({method:"ui.set",params:{theme:"Dark"}});await applyMotionInterface(motionEngine.advanced,true);setMotionEngineStatus("Prêt · décris ton animation dans le chat");return;}
                catch(error){if(attempt===59){setMotionEngineStatus(error.message);return;}await new Promise(resolve=>setTimeout(resolve,200));}
            }
        });
        frame.src=url.toString();$("motion-engine-frame").replaceChildren(frame);motionEngine.frame=frame;
        $("motion-engine").hidden=false;motionView.querySelector(".motion-stage").hidden=true;setMotionEngineStatus(`EffectCraft ${info.version} · chargement…`);
    }catch(error){showMotionEngineFallback(error.message);}finally{motionEngine.loading=false;}
}
$("motion-engine-reload").onclick=()=>loadMotionEngine(true);$("motion-retry").onclick=()=>loadMotionEngine(true);
async function motionControl(request){
    if(ui.status.busy){studioFeedback("L’agent travaille sur la composition ; attends ou utilise Stop.");return;}
    try{await api.effectCraftControl(request);setMotionEngineStatus("EffectCraft · action effectuée");}catch(error){studioFeedback(error.message);}
}
$("motion-play").onclick=()=>motionControl({method:"ui.playback",params:{action:"play"}});
$("motion-stop").onclick=()=>motionControl({method:"ui.playback",params:{action:"stop"}});
$("motion-undo").onclick=()=>motionControl({method:"engine.execute",params:{command:"edit.undo",params:{}}});
$("motion-local-save").onclick=()=>motionControl({method:"host.save",params:{path:"FranceStudent.ecproj"}});
const motionChat={placeholder:null,badge:null};
function syncMotionChat(){
    const bar=document.querySelector("#agent .agent-context-bar");if(!bar)return;
    if(!motionChat.badge){const badge=document.createElement("span");badge.id="agent-motion-badge";badge.className="agent-motion-badge";badge.textContent="Motion design";bar.insertBefore(badge,$("agent-access"));motionChat.badge=badge;}
    const open=isMotionOpen();motionChat.badge.hidden=!open;
    if(open){if(motionChat.placeholder===null)motionChat.placeholder=input.placeholder;input.placeholder="Décris ton animation… l’agent agit dans EffectCraft.";}
    else if(motionChat.placeholder!==null){input.placeholder=motionChat.placeholder;motionChat.placeholder=null;}
}
new MutationObserver(syncMotionChat).observe($("app"),{attributes:true,attributeFilter:["class"]});syncMotionChat();
/* EffectCraft owns the editor. Reuse the agent UI with independent conversations. */
const motionChats = new Map();
let motionChatMode = "code", motionChatSwitch = false;
let motionChatWorkspace=ui.workspace;
const codeStarter = {title:$("agent-starter").querySelector("h2").textContent,description:$("agent-starter").querySelector("p").textContent,buttons:[...document.querySelectorAll("[data-starter]")].map(button=>({prompt:button.dataset.starter,title:button.querySelector("b").textContent,detail:button.querySelector("small").textContent}))};
function renderMotionStarter(){
    const motion=motionChatMode==="motion",starter=$("agent-starter");
    starter.querySelector("h2").textContent=motion?"Créons ton animation":codeStarter.title;
    starter.querySelector("p").textContent=motion?"Décris ton idée. L’agent agit directement dans EffectCraft.":codeStarter.description;
    const choices=motion?[
        {title:"Créer une animation",detail:"Composition, textes et mouvements",prompt:"Crée une animation de titre dans EffectCraft. Inspecte le projet, découvre les commandes nécessaires et réalise la composition avec des keyframes."},
        {title:"Améliorer la composition",detail:"Rythme, lisibilité et effets",prompt:"Inspecte la composition active dans EffectCraft, analyse son rythme et sa lisibilité, puis améliore-la avec les outils du moteur."},
        {title:"Préparer un export",detail:"Format, durée et rendu",prompt:"Inspecte la composition active et les formats d’export disponibles dans EffectCraft. Prépare un export adapté et vérifie le résultat sans annoncer de réussite avant sa fin."}
    ]:codeStarter.buttons;
    [...document.querySelectorAll("[data-starter]")].forEach((button,index)=>{const item=choices[index];if(!item)return;button.dataset.starter=item.prompt;button.querySelector("b").textContent=item.title;button.querySelector("small").textContent=item.detail;});
}
api.onEvent((channel,status)=>{
    if(channel==="signedOut" || channel==="status" && motionChatWorkspace!==(status.workspace || null)){
        if(channel==="status")motionChatWorkspace=status.workspace || null;
        motionChats.clear();motionChatMode="code";
        $("app").classList.remove("view-motion");motionNav.classList.remove("active");
        input.value=readStudioStorage(studioDraftKey(motionChatWorkspace,"code"),"");
        renderMotionStarter();syncMotionChat();
    }
});
async function selectMotionChat(mode) {
    if(motionChatSwitch) return false;
    if(mode===motionChatMode)return true;
    motionChatSwitch=true;
    try {
        await api.motionConversation(mode);
        const nodes=document.createDocumentFragment(), scroll=transcript.scrollTop;
        while(transcript.firstChild)nodes.append(transcript.firstChild);
        motionChats.set(motionChatMode,{nodes,draft:input.value,attachments:pendingAttachments,toolGroup,scroll,entries:studioEntries.slice(),history:ui.history,historyIndex:ui.historyIndex});
        const next=motionChats.get(mode);
        transcript.replaceChildren(next?.nodes || document.createDocumentFragment());
        input.value=next?.draft ?? readStudioStorage(studioDraftKey(studioWorkspace,mode),"");pendingAttachments=next?.attachments || [];toolGroup=next?.toolGroup || null;
        transcript.scrollTop=next?.scroll || 0;
        studioEntries.splice(0,studioEntries.length,...(next?.entries || []));ui.history=next?.history || [];ui.historyIndex=next?.historyIndex || 0;
        motionChatMode=mode;renderAttachments();autosizeInput();saveStudioDraft();
        document.querySelector(".agent-title > span").textContent=mode==="motion"?"Motion design":"Agent";
        $("agent-starter").classList.toggle("hidden",!!transcript.children.length);
        renderMotionStarter();
        return true;
    } catch(error){studioFeedback(error.message);return false;}
    finally {motionChatSwitch=false;}
}
/* ---------- Budget de chat épuisé : message lisible (HTTP 429) ---------- */

const BUDGET_TIME_ZONE = "Europe/Paris";

/** Détecte une erreur « Chat budget exhausted » et en extrait l'heure de reprise (UTC). */
function parseBudgetNotice(text) {
    const raw = String(text ?? "");
    if (!/budget\s+(?:de\s+chat\s+)?(?:exhausted|épuisé)/i.test(raw)) return null;
    const match = /Reset at\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z/i.exec(raw);
    const resetAt = match ? new Date(`${match[1]}Z`) : null;
    return { resetAt: resetAt && !Number.isNaN(resetAt.getTime()) ? resetAt : null };
}

function budgetDayKey(date) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: BUDGET_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function budgetRemainingLabel(ms) {
    const minutes = Math.ceil(ms / 60000);
    if (minutes <= 1) return "dans moins d'une minute";
    if (minutes < 60) return `dans ${minutes} min`;
    return `dans ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Textes affichés (heure de Paris). `now` est injectable pour les tests. */
function formatBudgetNotice(notice, now = new Date()) {
    const title = "Budget de chat épuisé";
    const at = notice && notice.resetAt;
    if (!at) {
        return { title, detail: "Le quota de conversation est atteint. Tu pourras reprendre dès qu'il sera renouvelé.", when: "", remaining: "" };
    }
    // Le renouvellement tombe à hh:59:59.999 : on affiche la minute pleine suivante.
    const shown = new Date(Math.ceil(at.getTime() / 60000) * 60000);
    const clock = new Intl.DateTimeFormat("fr-FR", { timeZone: BUDGET_TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(shown);
    const ms = at.getTime() - now.getTime();
    if (ms <= 0) {
        return { title, detail: "Le budget a dû être renouvelé : tu peux réessayer maintenant.", when: clock, remaining: "" };
    }
    const days = Math.round((Date.parse(`${budgetDayKey(shown)}T00:00:00Z`) - Date.parse(`${budgetDayKey(now)}T00:00:00Z`)) / 86400000);
    let day;
    if (days <= 0) day = "aujourd'hui";
    else if (days === 1) day = "demain";
    else day = `le ${new Intl.DateTimeFormat("fr-FR", { timeZone: BUDGET_TIME_ZONE, weekday: "long", day: "numeric", month: "long" }).format(shown)}`;
    return {
        title,
        detail: `Les échanges avec l'agent reprendront ${day} à ${clock} (heure de Paris).`,
        when: `${day} · ${clock}`,
        remaining: budgetRemainingLabel(ms)
    };
}

/** Carte intégrée au transcript, à la place du JSON brut. */
function renderBudgetEntry(notice, rawText) {
    const f = formatBudgetNotice(notice);
    const chips = [
        f.when ? `<span class="budget-chip"><b>Reprise</b> ${escapeHtml(f.when)}</span>` : "",
        f.remaining ? `<span class="budget-chip"><b>Dans</b> ${escapeHtml(f.remaining.replace(/^dans\s+/, ""))}</span>` : ""
    ].join("");
    const icon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    const el = addEntry("budget-notice",
        `<div class="budget-icon" aria-hidden="true">${icon}</div>` +
        `<div class="budget-body"><div class="budget-title">${escapeHtml(f.title)}</div>` +
        `<div class="budget-detail">${escapeHtml(f.detail)}</div>` +
        (chips ? `<div class="budget-chips">${chips}</div>` : "") +
        `<details class="budget-tech"><summary>Détails techniques</summary><pre>${escapeHtml(String(rawText ?? ""))}</pre></details></div>`);
    el.setAttribute("role", "status");
    return el;
}
/* A beginner workspace inside EffectCraft, with the full editor one click away. */
motionEngine.advanced=readStudioStorage("frst.motion.advanced",false)===true;
motionEngine.changingInterface=false;
const motionModes=centerNode("div","motion-mode-switch");motionModes.setAttribute("role","group");motionModes.setAttribute("aria-label","Niveau de l’interface EffectCraft");
motionModes.innerHTML='<button type="button" id="motion-simple" aria-pressed="true">Simple</button><button type="button" id="motion-advanced" aria-pressed="false">Avancé</button>';
document.querySelector(".motion-header").insertBefore(motionModes,document.querySelector(".motion-actions"));
const tutorialButton=centerNode("button","","Tutos");tutorialButton.type="button";tutorialButton.id="motion-tutorial-open";tutorialButton.title="Apprendre les bases du motion design";
document.querySelector(".motion-actions").prepend(tutorialButton);
const intro=centerNode("ol","motion-intro-steps");
for(const text of ["Décris ton idée dans le chat.","Regarde l’agent créer ton animation.","Teste la lecture, puis enregistre ton projet."])intro.append(centerNode("li","",text));
document.querySelector(".motion-consent-actions").before(intro);
async function applyMotionInterface(advanced,initial=false){
    if(motionEngine.changingInterface)return false;
    if(!initial && ui.status.busy){studioFeedback("Attends la fin de l’action de l’agent avant de changer l’interface.");return false;}
    motionEngine.changingInterface=true;$("motion-simple").disabled=true;$("motion-advanced").disabled=true;
    try{
        await api.effectCraftControl({method:"ui.set",params:{workspace:advanced?"Default":"FranceStudent",menuBar:advanced,viewer:{zoom:null},timeline:{graphEditor:false,showModes:advanced}}});
        for(const column of ["label","num","comment","switches","modes","parent","in","out","duration","stretch"]){
            await api.effectCraftControl({method:"engine.execute",params:{command:"timeline.column",params:{column,visible:advanced}}});
        }
        motionEngine.advanced=advanced;writeStudioStorage("frst.motion.advanced",advanced);
        $("motion-simple").setAttribute("aria-pressed",String(!advanced));$("motion-advanced").setAttribute("aria-pressed",String(advanced));
        motionView.dataset.interface=advanced?"advanced":"simple";
        return true;
    }catch(error){if(initial)throw error;studioFeedback(error.message);return false;}
    finally{motionEngine.changingInterface=false;$("motion-simple").disabled=false;$("motion-advanced").disabled=false;}
}
$("motion-simple").onclick=()=>applyMotionInterface(false);$("motion-advanced").onclick=()=>applyMotionInterface(true);
const motionTutorials=[
    {title:"Ton premier titre",steps:["Choisis le texte à afficher et son ambiance.","Décris-le à l’agent : il crée la composition et l’animation.","Appuie sur Lecture pour voir le résultat."],prompt:"Crée dans EffectCraft un titre « Mon premier projet » qui apparaît en douceur sur un fond sombre. Utilise une composition de 5 secondes au format 16:9. Réalise les modifications et vérifie le rendu."},
    {title:"Donner du mouvement",steps:["Sélectionne un texte ou une forme dans l’animation.","Décris le mouvement simplement : apparaître, glisser, tourner…", "L’agent règle les points de passage de l’animation (keyframes). Tu peux ensuite demander un mouvement plus lent ou plus rapide."],prompt:"Anime l’élément sélectionné dans EffectCraft : fais-le apparaître progressivement puis glisser légèrement vers la droite. Inspecte d’abord la sélection et vérifie le résultat."},
    {title:"Enregistrer et exporter",steps:["Enregistrer conserve ton projet modifiable dans le stockage local d’EffectCraft.","Exporter produit un fichier à partager. Demande à l’agent de vérifier les formats disponibles avant le rendu.","Garde aussi une copie du projet .ecproj et de tes médias avec les fonctions de fichier du mode Avancé."],prompt:"Inspecte mon animation EffectCraft. Vérifie les formats d’export réellement disponibles, prépare un export adapté et explique où retrouver le résultat. Ne déclare pas un export terminé tant qu’il n’a pas réussi."}
];
const motionTutorialPanel=centerNode("section","motion-tutorial hidden");motionTutorialPanel.id="motion-tutorial";motionTutorialPanel.setAttribute("aria-label","Petits tutoriels motion design");motionView.append(motionTutorialPanel);
let motionTutorialIndex=0;
function showMotionTutorial(index=motionTutorialIndex){
    motionTutorialIndex=Math.max(0,Math.min(motionTutorials.length-1,index));
    const tutorial=motionTutorials[motionTutorialIndex];motionTutorialPanel.replaceChildren();
    const header=centerNode("div","motion-tutorial-head");header.append(centerNode("span","",`LES BASES · ${motionTutorialIndex+1}/${motionTutorials.length}`));
    const close=centerNode("button","","Fermer");close.type="button";close.onclick=()=>{motionTutorialPanel.classList.add("hidden");tutorialButton.focus();};header.append(close);motionTutorialPanel.append(header,centerNode("h2","",tutorial.title));
    const list=centerNode("ol");for(const step of tutorial.steps)list.append(centerNode("li","",step));motionTutorialPanel.append(list);
    const actions=centerNode("div","motion-tutorial-actions");
    const prepare=centerNode("button","primary","Préparer la demande");prepare.type="button";prepare.onclick=()=>{
        input.value=input.value.trim()?`${input.value}\n\n${tutorial.prompt}`:tutorial.prompt;
        input.dispatchEvent(new Event("input",{bubbles:true}));autosizeInput();saveStudioDraft();
        motionTutorialPanel.classList.add("hidden");input.focus();studioFeedback("La demande est préparée. Tu peux la modifier puis cliquer sur Envoyer.");
    };
    const next=centerNode("button","",motionTutorialIndex===motionTutorials.length-1?"Revoir le début":"Suivant");next.type="button";next.onclick=()=>showMotionTutorial((motionTutorialIndex+1)%motionTutorials.length);
    actions.append(prepare,next);motionTutorialPanel.append(actions,centerNode("p","motion-tutorial-note","Les tutos sont gratuits à consulter. Une demande envoyée à l’agent utilise ton quota habituel."));
    motionTutorialPanel.classList.remove("hidden");close.focus();
}
tutorialButton.onclick=()=>showMotionTutorial();
motionView.addEventListener("keydown",event=>{if(event.key==="Escape" && !motionTutorialPanel.classList.contains("hidden")){event.preventDefault();event.stopPropagation();motionTutorialPanel.classList.add("hidden");tutorialButton.focus();}});
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
        const result = await api.bootstrap();
        if (result.origin) connectionOrigin = result.origin;
        if (!result.ok) {
            openConnectionGuide(1);
            if (!result.needsLogin) guideError(result.reason);
        }
    } catch (err) {
        openConnectionGuide(1);
        guideError(err);
    }
    refreshQuota();
    setInterval(refreshQuota, 120000);
})();
