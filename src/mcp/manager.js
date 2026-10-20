"use strict";

/**
 * Serveurs MCP configurés dans <dataDir>/mcp.json (même format que Claude Desktop / Claude Code) :
 * { "mcpServers": { "nom": { "command": "npx", "args": [], "env": {}, "cwd": "...", "disabled": false, "timeoutMs": 60000 } } }
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../config");
const { createClient, DEFAULT_TIMEOUT_MS } = require("./client");
const { filterEnv } = require("../tools/command/program");

const CONFIG_NAME = "mcp.json";
const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_RESULT_CHARS = 20_000;
const MAX_SCHEMA_CHARS = 1_500;

function defaultConfigFile() {
    return process.env.FS_MCP_CONFIG || path.join(CONFIG.dataDir, CONFIG_NAME);
}

/** Valide le contenu de mcp.json et renvoie la liste des serveurs. */
function parseConfig(raw) {
    const data = typeof raw === "string" ? JSON.parse(raw.replace(/^\uFEFF/, "")) : raw;
    const servers = data && typeof data === "object" ? data.mcpServers : null;

    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
        throw new Error("mcp.json doit contenir un objet \"mcpServers\".");
    }

    return Object.entries(servers).map(([name, def]) => {
        if (!NAME_PATTERN.test(name)) {
            throw new Error(`Nom de serveur MCP invalide : « ${name} » (lettres, chiffres, _ . -).`);
        }
        if (!def || typeof def !== "object") {
            throw new Error(`Serveur MCP « ${name} » : définition invalide.`);
        }
        if (def.url !== undefined && def.command === undefined) {
            throw new Error(`Serveur MCP « ${name} » : seul le transport stdio (command) est pris en charge.`);
        }
        if (typeof def.command !== "string" || !def.command.trim()) {
            throw new Error(`Serveur MCP « ${name} » : "command" est obligatoire.`);
        }
        if (def.args !== undefined && (!Array.isArray(def.args) || def.args.some(a => typeof a !== "string"))) {
            throw new Error(`Serveur MCP « ${name} » : "args" doit être une liste de chaînes.`);
        }
        if (def.env !== undefined && (def.env === null || typeof def.env !== "object" || Array.isArray(def.env))) {
            throw new Error(`Serveur MCP « ${name} » : "env" doit être un objet.`);
        }

        return {
            name,
            command: def.command,
            args: def.args || [],
            env: Object.fromEntries(Object.entries(def.env || {}).map(([k, v]) => [k, String(v)])),
            cwd: typeof def.cwd === "string" ? def.cwd : undefined,
            disabled: def.disabled === true,
            timeoutMs: Number.isInteger(def.timeoutMs) && def.timeoutMs > 0 ? def.timeoutMs : DEFAULT_TIMEOUT_MS
        };
    });
}

/** Texte lisible d'un résultat tools/call (content: [{ type: "text", text }, ...]). */
function formatToolResult(result) {
    const parts = [];

    for (const item of Array.isArray(result?.content) ? result.content : []) {
        if (item?.type === "text") parts.push(String(item.text ?? ""));
        else if (item?.type === "resource" && typeof item.resource?.text === "string") parts.push(item.resource.text);
        else if (item?.type === "resource_link") parts.push(`[ressource] ${item.uri ?? ""}`);
        else if (item?.type) parts.push(`[contenu ${item.type} non affiché]`);
    }

    if (!parts.length && result?.structuredContent !== undefined) {
        parts.push(JSON.stringify(result.structuredContent));
    }

    let text = parts.join("\n");
    const truncated = text.length > MAX_RESULT_CHARS;
    if (truncated) text = `${text.slice(0, MAX_RESULT_CHARS)}\n...[tronqué]`;

    return { text, truncated, isError: result?.isError === true };
}

function compactSchema(schema) {
    const text = JSON.stringify(schema?.properties
        ? { properties: schema.properties, ...(schema.required ? { required: schema.required } : {}) }
        : {});
    return text.length > MAX_SCHEMA_CHARS ? `${text.slice(0, MAX_SCHEMA_CHARS)}…` : text;
}

function createManager({ configFile = defaultConfigFile, clientFactory = createClient } = {}) {
    const servers = new Map(); // nom -> { def, client, tools, status, error }
    let starting = null;
    let loaded;
    let reloads = 0;

    function currentFile() {
        return typeof configFile === "function" ? configFile() : configFile;
    }

    async function readRaw(file) {
        try {
            return await fs.readFile(file, "utf8");
        } catch (error) {
            if (error.code === "ENOENT") return null;
            throw error;
        }
    }

    async function readConfig() {
        const file = currentFile();
        const raw = await readRaw(file);

        return { file, raw, defs: raw === null ? [] : parseConfig(raw) };
    }

    async function configChanged() {
        if (!loaded) return false;

        const file = currentFile();
        if (file !== loaded.file) return true;

        let raw;
        try {
            raw = await readRaw(file);
        } catch {
            return false;
        }

        return raw !== loaded.raw;
    }

    async function startServer(def) {
        const entry = { def, client: null, tools: [], status: "starting", error: null };
        servers.set(def.name, entry);

        if (def.disabled) {
            entry.status = "disabled";
            return entry;
        }

        try {
            entry.client = clientFactory({
                name: def.name,
                command: def.command,
                args: def.args,
                env: { ...filterEnv(process.env), ...def.env },
                cwd: def.cwd,
                timeoutMs: def.timeoutMs,
                getRoot: () => {
                    try {
                        return require("../state").state.workspace || null;
                    } catch {
                        return null;
                    }
                },
                onNotification: (method) => {
                    if (method !== "notifications/tools/list_changed" || entry.status !== "running") return;
                    entry.client.listTools()
                        .then(tools => {
                            entry.tools = tools.filter(tool => tool && typeof tool.name === "string");
                        })
                        .catch(() => {});
                }
            });
            await entry.client.start();
            entry.tools = (await entry.client.listTools()).filter(tool => tool && typeof tool.name === "string");
            entry.status = "running";
        } catch (error) {
            entry.status = "failed";
            entry.error = error.message;
            try {
                entry.client?.close();
            } catch {
                // ignoré
            }
        }

        return entry;
    }

    /**
     * Démarre une seule fois tous les serveurs configurés.
     * Si mcp.json a changé depuis le dernier chargement, tous les serveurs sont redémarrés.
     */
    async function ensureStarted() {
        if (starting && loaded) {
            const current = starting;
            if (await configChanged() && starting === current) {
                stopAll();
                reloads++;
            }
        }

        if (!starting) {
            starting = (async () => {
                const { file, raw, defs } = await readConfig();
                loaded = { file, raw };
                await Promise.all(defs.map(startServer));
                return list();
            })().catch(error => {
                starting = null;
                loaded = undefined;
                throw error;
            });
        }

        return starting;
    }

    function stopAll() {
        for (const entry of servers.values()) {
            try {
                entry.client?.close();
            } catch {
                // ignoré
            }
        }
        servers.clear();
        starting = null;
        loaded = undefined;
    }

    async function restart() {
        stopAll();
        return ensureStarted();
    }

    function list() {
        return [...servers.values()].map(entry => ({
            name: entry.def.name,
            status: entry.status,
            error: entry.error,
            tools: entry.tools.map(tool => tool.name)
        }));
    }

    function running() {
        return [...servers.values()].filter(entry => entry.status === "running");
    }

    /** Catalogue texte des outils MCP pour le prompt de l'agent ("" si aucun). */
    function catalog() {
        const lines = [];

        for (const entry of running()) {
            for (const tool of entry.tools) {
                const description = String(tool.description || "").replace(/\s+/g, " ").slice(0, 300);
                lines.push(
                    `- server "${entry.def.name}", tool "${tool.name}" : ${description}\n` +
                    `  arguments : ${compactSchema(tool.inputSchema)}`
                );
            }
        }

        return lines.join("\n");
    }

    function findTool(serverName, toolName) {
        const entry = servers.get(serverName);

        if (!entry || entry.status !== "running") {
            const names = running().map(e => e.def.name);
            throw new Error(
                `Serveur MCP inconnu ou arrêté : ${serverName}. ` +
                `Serveurs actifs : ${names.length ? names.join(", ") : "aucun"}.`
            );
        }

        const tool = entry.tools.find(t => t.name === toolName);
        if (!tool) {
            throw new Error(
                `Outil MCP inconnu : ${serverName}/${toolName}. Outils : ${entry.tools.map(t => t.name).join(", ")}.`
            );
        }

        return { entry, tool };
    }

    async function call(serverName, toolName, args = {}) {
        const { entry } = findTool(serverName, toolName);
        const result = await entry.client.callTool(toolName, args, entry.def.timeoutMs);
        return formatToolResult(result);
    }

    /** Liste lisible des arguments d'un inputSchema JSON. */
    function describeArguments(schema) {
        const properties = schema && typeof schema.properties === "object" && schema.properties
            ? schema.properties
            : {};
        const required = new Set(Array.isArray(schema?.required) ? schema.required : []);

        return Object.entries(properties).map(([name, prop]) => {
            let type = prop?.type;
            if (Array.isArray(type)) type = type.join("|");
            else if (typeof type !== "string") type = Array.isArray(prop?.enum) ? "enum" : "any";

            return {
                name,
                type,
                required: required.has(name),
                description: String(prop?.description || "").replace(/\s+/g, " ").trim()
            };
        });
    }

    /** Détail des outils d'un serveur actif (pour /mcp tools). */
    function toolDetails(serverName) {
        const entry = servers.get(serverName);

        if (!entry) {
            const names = [...servers.keys()];
            throw new Error(
                `Serveur MCP inconnu : ${serverName}. ` +
                `Serveurs configurés : ${names.length ? names.join(", ") : "aucun"}.`
            );
        }
        if (entry.status !== "running") {
            throw new Error(
                `Serveur MCP « ${serverName} » non actif (${entry.status})` +
                `${entry.error ? ` : ${entry.error}` : ""}.`
            );
        }

        return entry.tools.map(tool => ({
            name: tool.name,
            description: String(tool.description || "").replace(/\s+/g, " ").trim(),
            arguments: describeArguments(tool.inputSchema)
        }));
    }

    function reloadCount() {
        return reloads;
    }

    return {
        readConfig,
        ensureStarted,
        stopAll,
        killAll: stopAll,
        restart,
        list,
        catalog,
        findTool,
        call,
        toolDetails,
        reloadCount
    };
}

const manager = createManager();

// À la sortie du CLI, aucun serveur MCP ne doit survivre.
process.once("exit", () => manager.killAll());

module.exports = {
    CONFIG_NAME,
    MAX_RESULT_CHARS,
    defaultConfigFile,
    parseConfig,
    formatToolResult,
    createManager,
    manager
};
