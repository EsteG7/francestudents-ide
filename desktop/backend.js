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
    const interrupts = [];
    let nextPromptId = 1;
    let nextSpinnerId = 1;

    function emit(entry) {
        send("entry", entry);
    }

    function openPrompt(kind, question, extra = {}) {
        const id = nextPromptId++;
        return new Promise((resolve) => {
            resolvers.set(id, resolve);
            send("prompt", { id, kind, question: clean(question), ...extra });
        });
    }

    const backend = {
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
        },

        reason(text) {
            emit({ type: "reason", text: clean(text) });
        },

        tool(name, arg) {
            emit({ type: "tool", name: clean(name), arg: clean(arg) });
        },

        result(text, { tone } = {}) {
            emit({ type: "result", text: clean(text), tone: tone || null });
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
            if (!force && state.autoApprove) return true;

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
            return openPrompt("command", question, { prefix: clean(prefixText) });
        },

        ask(question) {
            return openPrompt("ask", question);
        },

        askSecret(question) {
            return openPrompt("secret", question, { secret: true });
        },

        onInterrupt(handler) {
            interrupts.push(handler);
            return () => {
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
                model: agentName(),
                modelId: state.model,
                workspace: state.workspace,
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
            send("promptResolved", { id });
            resolve(value);
            return true;
        },

        interrupt() {
            const handler = interrupts[interrupts.length - 1];
            if (!handler) return false;
            handler();
            return true;
        }
    };

    return backend;
}

module.exports = { createDesktopBackend, clean };
