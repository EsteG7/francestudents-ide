"use strict";

/**
 * Backend d'interface pour l'application de bureau (Electron).
 *
 * Il implémente le port ui-bridge : chaque appel ui.xxx() du cœur du CLI est
 * transformé en message envoyé à la fenêtre via send(canal, données).
 * confirm, askCommand, ask et askSecret renvoient une promesse, résolue quand
 * la fenêtre répond avec resolvePrompt(id, valeur).
 */

const { state, resetConversation } = require("../src/state");
const { CONFIG } = require("../src/config");

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

function clean(value) {
    return String(value ?? "").replace(ANSI_RE, "");
}

function agentName() {
    try {
        return require("../src/api/agents").agentName(state.model);
    } catch {
        return String(state.model);
    }
}

function createDesktopBackend(send) {
    if (typeof send !== "function") {
        throw new TypeError("Backend bureau : une fonction send est requise.");
    }

    const resolvers = new Map();
    const promptKinds = new Map();
    const interrupts = [];
    let nextPromptId = 1;
    let nextSpinnerId = 1;
    let nextActionId = 0;
    let run = null;
    let runTracking = false;
    let pendingTools = [];

    function publishActivity() {
        if (run) send("agentActivity", structuredClone(run));
    }

    function emit(entry) {
        send("entry", entry);
    }

    function openPrompt(kind, question, extra = {}) {
        const id = nextPromptId++;
        return new Promise((resolve) => {
            resolvers.set(id, resolve);
            promptKinds.set(id, kind);
            send("prompt", { id, kind, question: clean(question), ...extra });
        });
    }

    const backend = {
        startRun(prompt) {
            pendingTools = [];
            runTracking = true;
            run = { prompt: clean(prompt).slice(0, 500), workspace: require("../src/motion-workspace").toolWorkspace(), motionDesign:!!state.motionDesign, startedAt: Date.now(), endedAt: null, status: "running", actions: [], sources: [], steps: [], commands: 0, reads: 0, writes: 0 };
            publishActivity();
        },

        endRun({ ok, interrupted } = {}) {
            if (!run) return;
            runTracking = false;
            run.status = interrupted ? "interrupted" : ok ? "done" : "failed";
            run.endedAt = Date.now();
            for (const action of pendingTools) { action.status = interrupted ? "interrupted" : "failed"; action.endedAt = run.endedAt; }
            pendingTools = [];
            publishActivity();
        },

        activity() { return run ? structuredClone(run) : null; },
        actionControl(data) { send("actionControl", data); },
        banner() {
            // Pas d'encadré d'accueil dans le panneau agent : le modèle, le projet et le mode
            // sont déjà affichés dans la barre d'état.
        },

        prompt() {
            return "> ";
        },

        info(text) {
            emit({ type: "info", text: clean(text) });
        },

        debug(text) {
            if (CONFIG.debug) emit({ type: "info", text: clean(text), debug: true });
        },

        warn(text) {
            emit({ type: "warn", text: clean(text) });
        },

        error(text) {
            emit({ type: "error", text: clean(text) });
        },

        assistant(text) {
            emit({ type: "assistant", text: clean(text) });
        },

        print(lines) {
            const list = Array.isArray(lines) ? lines : [lines];
            emit({ type: "print", lines: list.map(clean) });
        },

        plan(items) {
            emit({ type: "plan", items: Array.isArray(items) ? items.map(clean) : [] });
            if (run && runTracking) {
                run.steps = state.agentPlan?.length ? state.agentPlan.map(s => ({ ...s })) : (items || []).map(step => ({ step: clean(step), status: "pending" }));
                publishActivity();
            }
        },

        reason(text) {
            emit({ type: "reason", text: clean(text) });
        },

        tool(name, arg) {
            emit({ type: "tool", name: clean(name), arg: clean(arg) });
            if (run && runTracking) {
                const action = { id: ++nextActionId, name: clean(name), argument: clean(arg).slice(0, 1800), startedAt: Date.now(), endedAt: null, status: "running" };
                run.actions.push(action);
                if (run.actions.length > 300) run.actions.shift();
                pendingTools.push(action);
                if (name === "run_command") run.commands++;
                if (["read_file", "search_files", "list_directory", "semantic_search"].includes(name)) run.reads++;
                if (["edit_file", "write_file", "delete_path", "move_path", "copy_path", "create_directory"].includes(name)) run.writes++;
                publishActivity();
            }
        },

        result(text, { tone, sources = [] } = {}) {
            emit({ type: "result", text: clean(text), tone: tone || null });
            if (run && runTracking) {
                const action = pendingTools.shift();
                if (action) {
                    action.status = tone === "error" || tone === "err" ? "failed" : "done";
                    action.endedAt = Date.now();
                    action.result = clean(text).slice(0, 1800);
                }
                for (const source of sources) {
                    if (typeof source.url !== "string" || !/^https?:\/\//i.test(source.url)) continue;
                    const previous = run.sources.find(s => s.url === source.url);
                    if (previous) { if (source.consulted) previous.consulted = true; }
                    else if (run.sources.length < 100) run.sources.push({ url: source.url, title: clean(source.title || source.url), consulted: Boolean(source.consulted) });
                }
                publishActivity();
            }
        },

        commandLine(text) {
            send("commandLine", clean(text));
        },

        diff(data) {
            const added = data?.added ?? 0;
            const removed = data?.removed ?? 0;
            const lines = (Array.isArray(data?.lines) ? data.lines : []).map((line) =>
                typeof line === "string" ? clean(line) : JSON.parse(JSON.stringify(line))
            );
            emit({ type: "diff", lines, added, removed, path: data?.path ? clean(data.path) : null });
            return { added, removed };
        },

        spinner(label) {
            const id = nextSpinnerId++;
            let active = true;
            send("spinner", { id, label: clean(label) });
            return {
                update(next) {
                    if (active) send("spinner", { id, label: clean(next) });
                },
                stop() {
                    if (!active) return;
                    active = false;
                    send("spinner", { id, stop: true });
                }
            };
        },

        /** o/oui = oui, t = session, tt = toujours (enregistré) (sauf force), sinon refus. */
        async confirm(question, { force = false } = {}) {
            if (state.fullAccess || (!force && state.autoApprove)) return true;

            const raw = await openPrompt("confirm", question, { force: Boolean(force) });
            const answer = String(raw ?? "").trim().toLowerCase();

            if (!force && ["tt", "toujours", "always"].includes(answer)) {
                state.autoApprove = true;
                try {
                    require("../src/settings").setAutoApproveAlways(true);
                    backend.warn("Auto-approbation permanente activée (/auto never pour la retirer).");
                } catch (err) {
                    backend.warn(`Auto-approbation activée pour cette session (réglage non enregistré : ${err.message}).`);
                }
                return true;
            }

            if (!force && ["t", "tout", "a", "all"].includes(answer)) {
                state.autoApprove = true;
                backend.warn("Auto-approbation activée pour cette session (/auto off pour la couper).");
                return true;
            }

            return ["o", "oui", "y", "yes"].includes(answer);
        },

        askCommand(question, prefixText) {
            if (state.fullAccess) return Promise.resolve("o");
            return openPrompt("command", question, { prefix: clean(prefixText) });
        },

        ask(question) {
            return openPrompt("ask", question);
        },

        askSecret(question) {
            return openPrompt("secret", question, { secret: true });
        },

        onInterrupt(handler) {
            const detachAction = require("../src/tools/action-control").onCancel(handler);
            interrupts.push(handler);
            return () => {
                detachAction();
                const index = interrupts.lastIndexOf(handler);
                if (index !== -1) interrupts.splice(index, 1);
            };
        },

        stream() {
            let ended = false;
            send("liveStart");
            return {
                write(chunk) {
                    if (ended) return;
                    const text = clean(chunk);
                    if (text) send("liveAppend", text);
                },
                end() {
                    if (ended) return;
                    ended = true;
                    send("liveEnd");
                }
            };
        },

        clear() {
            send("clear");
            backend.banner();
        },

        // ---- Appelées par le processus principal (hors port) ----

        /** Liste des agents (modèles) disponibles. Ne lève jamais. */
        async models() {
            const agentsApi = require("../src/api/agents");
            const { agents, source, error } = await agentsApi.listAgents({ refresh: true });
            return {
                agents: agents.map((agent) => ({
                    id: agent.id,
                    name: agent.name,
                    provider: agent.provider || "",
                    model: agent.model || "",
                    description: agent.description || "",
                    isDefault: Boolean(agent.isDefault)
                })),
                source,
                error: error ? String(error.message || error) : null,
                current: state.model
            };
        },

        /** Change l'agent courant et démarre une conversation neuve (comme /model). */
        async setModel(id) {
            const agentsApi = require("../src/api/agents");
            const { agents } = await agentsApi.listAgents();
            const agent = agents.find((item) => item.id === Number(id));
            if (!agent) throw new Error("Agent inconnu.");
            state.model = agent.id;
            resetConversation(state.mode === "agent" ? "agent" : "chat");
            emit({ type: "info", text: `Agent sélectionné : ${agent.name}` });
            return { id: agent.id, name: agent.name };
        },

        status() {
            let jobs;
            let usage;
            try {
                jobs = require("../src/tools/command/jobs").manager.runningCount();
            } catch {
                jobs = 0;
            }
            try {
                usage = { ...require("../src/api/api").usage };
            } catch {
                usage = null;
            }
            return {
                mode: state.mode,
                ecoMode: Boolean(state.ecoMode),
                model: agentName(),
                modelId: state.model,
                workspace: state.workspace,
                fullAccess: Boolean(state.fullAccess),
                autoApprove: Boolean(state.autoApprove),
                autoApproveCommands: Boolean(state.autoApproveCommands),
                webSearch: Boolean(state.webSearch),
                jobs,
                usage
            };
        },

        resolvePrompt(id, value) {
            const resolve = resolvers.get(id);
            if (!resolve) return false;
            resolvers.delete(id);
            promptKinds.delete(id);
            send("promptResolved", { id });
            resolve(value);
            return true;
        },

        approvePendingActions() {
            if (!state.fullAccess) return;
            for (const [id, kind] of promptKinds) {
                if (kind === "confirm" || kind === "command") backend.resolvePrompt(id, "o");
            }
        },

        interrupt() {
            const handler = interrupts[interrupts.length - 1];
            const pending = promptKinds.size > 0;
            for (const [id, kind] of promptKinds) backend.resolvePrompt(id, kind === "confirm" || kind === "command" ? "n" : null);
            if (handler) handler();
            return Boolean(handler) || pending;
        }
    };

    return backend;
}

module.exports = { createDesktopBackend, clean };
