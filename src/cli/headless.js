"use strict";

/**
 * Mode non interactif (équivalent de `claude -p` / `codex exec`) pour les scripts et la CI.
 *
 *   frst -p "demande" [--yes] [--plan] [--cwd <dossier>]
 *   frst exec "demande" [...]
 *   echo "demande" | frst -p
 *
 * La réponse finale de l'agent est écrite sur stdout ; tout le reste (outils,
 * infos, diffs) part sur stderr, pour pouvoir rediriger proprement la réponse.
 * Avec --output-format json (ou --json), stdout ne reçoit qu'un objet JSON :
 *   { type: "result", is_error, exit_code, result, messages, error, duration_ms }
 * Sans --yes, toute confirmation (écriture de fichier, commande) est refusée.
 * Les confirmations « forcées » (actions sensibles) restent refusées même avec --yes.
 * Codes de sortie : 0 = l'agent a répondu, 1 = échec, 2 = arguments invalides.
 */

const USAGE = "Usage : frst -p \"demande\" [--yes] [--plan] [--cwd <dossier>] [--output-format text|json | --json] (ou : frst exec \"demande\")";

/**
 * Analyse argv (sans "node" ni le script). Renvoie null si le mode non interactif
 * n'est pas demandé, sinon { prompt, yes, readOnly, cwd, error }.
 */
function parseHeadlessArgs(argv = []) {
    const args = Array.from(argv, String);
    let headless = false;
    let yes = false;
    let readOnly = false;
    let cwd = null;
    let outputFormat = "text";
    let error = null;
    const parts = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (i === 0 && arg === "exec") {
            headless = true;
            continue;
        }
        if (arg === "-p" || arg === "--print") {
            headless = true;
            const next = args[i + 1];
            if (next !== undefined && !next.startsWith("-")) {
                parts.push(next);
                i++;
            }
            continue;
        }
        if (arg === "-y" || arg === "--yes") {
            yes = true;
            continue;
        }
        if (arg === "--plan" || arg === "--read-only") {
            readOnly = true;
            continue;
        }
        if (arg === "-C" || arg === "--cwd") {
            const next = args[i + 1];
            if (next === undefined) {
                if (!error) error = `${arg} attend un dossier.`;
            } else {
                cwd = next;
                i++;
            }
            continue;
        }
        if (arg === "--json") {
            outputFormat = "json";
            continue;
        }
        if (arg === "--output-format" || arg.startsWith("--output-format=")) {
            let value;
            if (arg.includes("=")) {
                value = arg.slice(arg.indexOf("=") + 1);
            } else {
                value = args[i + 1];
                if (value !== undefined) i++;
            }
            if (value === "text" || value === "json") outputFormat = value;
            else if (!error) error = `--output-format attend "text" ou "json"${value === undefined ? "" : ` (reçu : ${value})`}.`;
            continue;
        }
        if (arg === "--classic" || arg === "-") continue;
        if (arg.startsWith("-")) {
            if (!error) error = `Option inconnue : ${arg}`;
            continue;
        }
        parts.push(arg);
    }

    if (!headless) return null;
    return { prompt: parts.join(" ").trim(), yes, readOnly, cwd, outputFormat, error };
}

function isHeadlessArgv(argv = []) {
    return parseHeadlessArgs(argv) !== null;
}

/** Lit toute l'entrée standard si elle n'est pas un terminal (sinon ""). */
function readStdin(stream = process.stdin) {
    if (!stream || stream.isTTY) return Promise.resolve("");
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        stream.on("error", reject);
    });
}

/**
 * Backend d'interface non interactif. Les affichages du backend CLI (base) sont
 * redirigés vers stderr ; la réponse de l'assistant va sur out (stdout).
 * Renvoie { ui, output } ; output.messages contient les réponses de l'assistant.
 */
function createHeadlessUi(base, { yes = false, out = process.stdout, err = process.stderr, json = false } = {}) {
    const output = { messages: [] };
    const noop = () => {};
    const quiet = new Proxy({}, { get: () => noop });

    const toStderr = name => (...args) => {
        if (!base || typeof base[name] !== "function") return undefined;
        const log = console.log;
        console.log = (...items) => console.error(...items);
        try {
            return base[name](...args);
        } finally {
            console.log = log;
        }
    };

    const writeAnswer = text => {
        if (json) return;
        out.write(text.endsWith("\n") ? text : `${text}\n`);
    };

    const ui = {
        info: toStderr("info"),
        warn: toStderr("warn"),
        error: toStderr("error"),
        debug: toStderr("debug"),
        print: toStderr("print"),
        plan: toStderr("plan"),
        reason: toStderr("reason"),
        tool: toStderr("tool"),
        result: toStderr("result"),
        diff: toStderr("diff"),
        commandLine: toStderr("commandLine"),

        assistant(message) {
            const text = String(message ?? "");
            output.messages.push(text);
            writeAnswer(text);
        },

        stream() {
            let buffer = "";
            return {
                write(chunk) {
                    const text = String(chunk ?? "");
                    buffer += text;
                    if (!json) out.write(text);
                },
                end() {
                    if (buffer) {
                        output.messages.push(buffer);
                        if (!json && !buffer.endsWith("\n")) out.write("\n");
                    }
                    buffer = "";
                }
            };
        },

        spinner: () => quiet,

        async confirm(question, { force = false } = {}) {
            const accepted = Boolean(yes) && !force;
            err.write(`${question} -> ${accepted ? "oui (--yes)" : "non (mode non interactif)"}\n`);
            return accepted;
        },

        async askCommand(question) {
            err.write(`${question} -> ${yes ? "oui (--yes)" : "non (mode non interactif, ajoute --yes)"}\n`);
            return yes ? "o" : "n";
        },

        async ask() {
            return null;
        },

        async askSecret() {
            return null;
        },

        onInterrupt: () => noop,
        banner: noop,
        prompt: () => "",
        clear: noop
    };

    return { ui, output };
}

/**
 * Lance une demande unique avec l'agent dans le dossier courant (ou --cwd).
 * Renvoie le code de sortie. deps permet d'injecter les modules dans les tests.
 */
async function runHeadless(options, deps = {}) {
    const {
        session = require("../core/session"),
        tools = require("../tools/tools"),
        agent = require("../agent/agent"),
        bridge = require("../ui-bridge"),
        base = require("./ui").ui,
        stdin = process.stdin,
        out = process.stdout,
        err = process.stderr,
        cwd = process.cwd()
    } = deps;

    const json = Boolean(options && options.outputFormat === "json");
    const started = Date.now();
    let output = { messages: [] };

    /** En mode JSON, écrit sur stdout un unique objet résultat (y compris en cas d'erreur). */
    const finish = (code, errorMessage = null) => {
        if (json) {
            const messages = output.messages.slice();
            out.write(`${JSON.stringify({
                type: "result",
                is_error: code !== 0,
                exit_code: code,
                result: messages.length > 0 ? messages[messages.length - 1] : "",
                messages,
                error: errorMessage,
                duration_ms: Date.now() - started
            })}\n`);
        }
        return code;
    };

    if (!options || options.error) {
        const message = options && options.error ? options.error : "Arguments invalides.";
        err.write(`${message}\n${USAGE}\n`);
        return finish(2, message);
    }

    let prompt = String(options.prompt || "").trim();
    if (!prompt) prompt = String(await readStdin(stdin)).trim();
    if (!prompt) {
        err.write(`Demande vide.\n${USAGE}\n`);
        return finish(2, "Demande vide.");
    }

    const headless = createHeadlessUi(base, { yes: options.yes, out, err, json });
    output = headless.output;
    bridge.setUiBackend(headless.ui);

    try {
        const boot = await session.bootstrap();
        if (!boot || !boot.ok) {
            const reason = boot && boot.reason ? boot.reason : "Connexion impossible.";
            err.write(`${reason}\n`);
            return finish(1, reason);
        }

        await tools.setProject(options.cwd || cwd);
        await agent.runAgent(prompt, { readOnly: Boolean(options.readOnly) });

        return output.messages.length > 0 ? finish(0) : finish(1, "Aucune réponse de l'agent.");
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        err.write(`Erreur : ${message}\n`);
        return finish(1, message);
    } finally {
        bridge.setUiBackend(null);
    }
}

/** Point d'entrée CLI : fixe le code de sortie et force la fin (serveurs MCP encore ouverts). */
async function runHeadlessCli(options) {
    const code = await runHeadless(options);
    process.exitCode = code;
    setTimeout(() => process.exit(code), 500).unref();
    return code;
}

module.exports = {
    USAGE,
    parseHeadlessArgs,
    isHeadlessArgv,
    readStdin,
    createHeadlessUi,
    runHeadless,
    runHeadlessCli
};
