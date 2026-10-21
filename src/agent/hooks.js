"use strict";

/**
 * Hooks : scripts utilisateur lancés automatiquement autour des outils de l'agent.
 *
 * Fichiers lus (fusionnés dans cet ordre) :
 *   - <dataDir>/hooks.json          (utilisateur, toujours actif)
 *   - <projet>/.frst/hooks.json     (projet, confirmation demandée une fois par session)
 *
 * Format :
 *   {
 *     "hooks": {
 *       "preToolUse":  [{ "match": "run_command", "command": "./scripts/check.sh", "timeout": 30 }],
 *       "postToolUse": [{ "match": "edit_file|write_file", "command": "npx prettier --write {path}" }]
 *     }
 *   }
 *
 * - match : expression régulière ancrée sur le nom de l'outil (absenteou "*" = tous).
 * - {path} et {tool} sont remplacés par des valeurs échappées pour le shell.
 * - Environnement : FRST_EVENT, FRST_TOOL, FRST_TOOL_ARGS (JSON), FRST_FILE, FRST_WORKSPACE.
 * - Le JSON { event, tool, args } est aussi envoyé sur l'entrée standard.
 * - preToolUse : un code de sortie non nul BLOQUE l'outil (la sortie sert de raison).
 * - postToolUse : la sortie est jointe au résultat de l'outil (visible par l'agent).
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const EVENTS = ["preToolUse", "postToolUse"];
const DEFAULT_TIMEOUT_S = 60;
const MAX_OUTPUT = 8000;

const trustedProjectFiles = new Set();

/** Valide un hooks.json et renvoie { preToolUse: [...], postToolUse: [...] }. */
function parseHooksConfig(raw, source = "hooks.json") {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data || typeof data !== "object") throw new Error(`${source} : objet JSON attendu.`);
    const root = data.hooks && typeof data.hooks === "object" ? data.hooks : data;
    const result = { preToolUse: [], postToolUse: [] };

    for (const event of EVENTS) {
        const list = root[event];
        if (list === undefined) continue;
        if (!Array.isArray(list)) throw new Error(`${source} : "${event}" doit être une liste.`);

        for (const [index, entry] of list.entries()) {
            if (!entry || typeof entry.command !== "string" || !entry.command.trim()) {
                throw new Error(`${source} : ${event}[${index}] doit avoir une "command".`);
            }
            let matcher = null;
            if (entry.match !== undefined && entry.match !== "" && entry.match !== "*") {
                try {
                    matcher = new RegExp(`^(?:${String(entry.match)})$`);
                } catch (error) {
                    throw new Error(`${source} : ${event}[${index}].match invalide (${error.message}).`, { cause: error });
                }
            }
            const timeout = Number(entry.timeout);
            result[event].push({
                event,
                match: entry.match ?? "*",
                matcher,
                command: entry.command.trim(),
                timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_S,
                source
            });
        }
    }
    return result;
}

function readConfigFile(file) {
    let raw;
    try {
        raw = fs.readFileSync(file, "utf8");
    } catch {
        return null;
    }
    return { raw, config: parseHooksConfig(raw, file) };
}

/** Échappe une valeur pour le shell. */
function shellQuote(value, platform = process.platform) {
    const text = String(value ?? "");
    if (platform === "win32") return `"${text.replace(/"/g, "\"\"")}"`;
    return `'${text.replace(/'/g, "'\\''")}'`;
}

function expandCommand(command, { tool, file }, platform) {
    return command
        .replace(/\{path\}/g, () => shellQuote(file || "", platform))
        .replace(/\{tool\}/g, () => shellQuote(tool || "", platform));
}

function fileOfArgs(args) {
    if (!args || typeof args !== "object") return "";
    return String(args.path || args.file_path || args.file || "");
}

/** Hooks applicables à un événement et un outil. */
function matchingHooks(config, event, tool) {
    return ((config && config[event]) || []).filter(hook => !hook.matcher || hook.matcher.test(tool));
}

/** Lance une commande de hook. Renvoie { code, output, timedOut }. */
function runHookCommand(hook, { event, tool, args, workspace }) {
    const file = fileOfArgs(args);
    const absolute = file && workspace ? path.resolve(workspace, file) : file;
    const command = expandCommand(hook.command, { tool, file: absolute });

    return new Promise(resolve => {
        let output = "";
        let timedOut = false;
        const append = chunk => {
            if (output.length < MAX_OUTPUT) output += chunk.toString("utf8");
        };

        let child;
        try {
            child = spawn(command, {
                shell: true,
                cwd: workspace || process.cwd(),
                env: {
                    ...process.env,
                    FRST_EVENT: event,
                    FRST_TOOL: tool,
                    FRST_TOOL_ARGS: JSON.stringify(args ?? {}),
                    FRST_FILE: absolute || "",
                    FRST_WORKSPACE: workspace || ""
                },
                stdio: ["pipe", "pipe", "pipe"]
            });
        } catch (error) {
            resolve({ code: 1, output: error.message, timedOut: false });
            return;
        }

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
        }, hook.timeout * 1000);

        child.stdout.on("data", append);
        child.stderr.on("data", append);
        child.on("error", error => append(Buffer.from(`${error.message}\n`)));
        child.on("close", code => {
            clearTimeout(timer);
            resolve({
                code: timedOut ? 124 : (code ?? 1),
                output: output.slice(0, MAX_OUTPUT).trim(),
                timedOut
            });
        });

        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify({ event, tool, args: args ?? {} }));
    });
}

/**
 * Charge les hooks utilisateur et projet. Les hooks projet ne sont actifs
 * qu'après confirmation (une fois par session et par contenu du fichier).
 */
async function loadHooks({ workspace, dataDir, ui } = {}) {
    const merged = { preToolUse: [], postToolUse: [] };
    const add = config => {
        for (const event of EVENTS) merged[event].push(...config[event]);
    };

    const userDir = dataDir || require("../config").CONFIG.dataDir;
    try {
        const user = readConfigFile(path.join(userDir, "hooks.json"));
        if (user) add(user.config);
    } catch (error) {
        if (ui) ui.warn(`Hooks utilisateur ignorés : ${error.message}`);
    }

    if (workspace) {
        const file = path.join(workspace, ".frst", "hooks.json");
        try {
            const project = readConfigFile(file);
            if (project && (project.config.preToolUse.length || project.config.postToolUse.length)) {
                const key = `${file}:${crypto.createHash("sha256").update(project.raw).digest("hex")}`;
                if (!trustedProjectFiles.has(key) && ui) {
                    const count = project.config.preToolUse.length + project.config.postToolUse.length;
                    const ok = await ui.confirm(
                        `Activer ${count} hook(s) du projet (.frst/hooks.json) ? Ils lancent des commandes shell.`
                    );
                    if (ok) trustedProjectFiles.add(key);
                }
                if (trustedProjectFiles.has(key)) add(project.config);
            }
        } catch (error) {
            if (ui) ui.warn(`Hooks du projet ignorés : ${error.message}`);
        }
    }

    return merged;
}

/** Avant un outil. Renvoie { blocked: false } ou { blocked: true, message }. */
async function runPreToolHooks(config, { tool, args, workspace, ui }) {
    for (const hook of matchingHooks(config, "preToolUse", tool)) {
        if (ui) ui.info(`Hook preToolUse : ${hook.command}`);
        const res = await runHookCommand(hook, { event: "preToolUse", tool, args, workspace });
        if (res.code !== 0) {
            const why = res.timedOut ? "délai dépassé" : `code ${res.code}`;
            return {
                blocked: true,
                message: `Bloqué par un hook preToolUse (${hook.command}, ${why})` +
                    (res.output ? ` : ${res.output}` : ".")
            };
        }
    }
    return { blocked: false };
}

/** Après un outil réussi. Renvoie [{ command, code, output }] (vide si aucun hook). */
async function runPostToolHooks(config, { tool, args, workspace, ui }) {
    const reports = [];
    for (const hook of matchingHooks(config, "postToolUse", tool)) {
        if (ui) ui.info(`Hook postToolUse : ${hook.command}`);
        const res = await runHookCommand(hook, { event: "postToolUse", tool, args, workspace });
        if (res.code !== 0 && ui) ui.warn(`Hook en échec (code ${res.code}) : ${hook.command}`);
        reports.push({ command: hook.command, code: res.code, output: res.output });
    }
    return reports;
}

function hasHooks(config) {
    return Boolean(config && (config.preToolUse.length || config.postToolUse.length));
}

function resetTrust() {
    trustedProjectFiles.clear();
}

module.exports = {
    EVENTS,
    parseHooksConfig,
    expandCommand,
    shellQuote,
    matchingHooks,
    runHookCommand,
    loadHooks,
    runPreToolHooks,
    runPostToolHooks,
    hasHooks,
    resetTrust
};
