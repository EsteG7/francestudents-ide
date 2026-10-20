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

