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
    let silent = false;
    const emit = (name) => events.dispatchEvent(new Event(name));
    const extensions = (kind) => [
        CM.basicSetup,
        CM.keymap.of([CM.indentWithTab]),
        CM.indentUnit.of("    "),
        CM.EditorState.tabSize.of(4),
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

