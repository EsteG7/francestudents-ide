"use strict";

/**
 * Client MCP (Model Context Protocol) sur transport stdio : JSON-RPC 2.0,
 * un message JSON par ligne sur stdin/stdout du serveur.
 */

const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { resolveProgram, killTree } = require("../tools/command/program");

const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_STDERR_CHARS = 4000;
const MAX_LIST_PAGES = 20;

class McpError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "McpError";
        this.code = code;
    }
}

function createClient({
    name,
    command,
    args = [],
    env = process.env,
    cwd,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    spawnImpl = spawn,
    getRoot = null,
    onNotification = null
}) {
    let child = null;
    let nextId = 1;
    let buffer = "";
    let stderr = "";
    let closed = false;
    let serverInfo = null;
    const pending = new Map();

    function failAll(error) {
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(error);
        }
        pending.clear();
    }

    function send(message) {
        if (!child || closed) throw new McpError(`${name} : serveur arrêté.`);
        child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    function onLine(line) {
        if (!line.trim()) return;

        let message;
        try {
            message = JSON.parse(line);
        } catch {
            return; //ligne de journal du serveur, ignorée
        }
        if (!message || typeof message !== "object") return;

        if (message.id !== undefined && message.method === undefined) {
            const entry = pending.get(message.id);
            if (!entry) return;
            pending.delete(message.id);
            clearTimeout(entry.timer);

            if (message.error) {
                entry.reject(new McpError(`${name} : ${message.error.message || "erreur"}`, message.error.code));
            } else {
                entry.resolve(message.result ?? {});
            }
            return;
        }

        if (message.id !== undefined && message.method) {
            // Requêtes du serveur : ping et roots/list pris en charge ; sampling et elicitation non.
            let reply;
            if (message.method === "ping") {
                reply = { jsonrpc: "2.0", id: message.id, result: {} };
            } else if (message.method === "roots/list") {
                const root = typeof getRoot === "function" ? getRoot() : null;
                const roots = root ? [{ uri: pathToFileURL(root).href, name: path.basename(root) }] : [];
                reply = { jsonrpc: "2.0", id: message.id, result: { roots } };
            } else {
                reply = {
                    jsonrpc: "2.0",
                    id: message.id,
                    error: { code: -32601, message: "Méthode non prise en charge par le client." }
                };
            }
            try {
                send(reply);
            } catch {
                // serveur arrêté
            }
            return;
        }

        if (message.method && typeof onNotification === "function") {
            try {
                onNotification(message.method, message.params);
            } catch {
                // notification ignorée
            }
        }
    }

    function request(method, params, ms = timeoutMs) {
        return new Promise((resolve, reject) => {
            const id = nextId++;
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new McpError(`${name} : délai dépassé (${method}).`));
            }, ms);

            pending.set(id, { resolve, reject, timer });

            try {
                send({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
            } catch (error) {
                clearTimeout(timer);
                pending.delete(id);
                reject(error);
            }
        });
    }

    function notify(method, params) {
        send({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) });
    }

    async function start() {
        const program = resolveProgram(command, args, cwd || process.cwd(), env);

        child = spawnImpl(program.file, program.args, {
            cwd,
            env,
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
            windowsHide: true,
            windowsVerbatimArguments: program.verbatim
        });

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", chunk => {
            buffer += chunk;
            let index;
            while ((index = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                onLine(line);
            }
        });

        if (child.stderr) {
            child.stderr.setEncoding("utf8");
            child.stderr.on("data", chunk => {
                stderr = (stderr + chunk).slice(-MAX_STDERR_CHARS);
            });
        }

        child.on("error", error => {
            closed = true;
            failAll(new McpError(`${name} : lancement impossible (${error.message}).`));
        });

        child.on("exit", code => {
            closed = true;
            const detail = stderr.trim() ? ` ${stderr.trim().slice(-300)}` : "";
            failAll(new McpError(`${name} : serveur arrêté (code ${code}).${detail}`));
        });

        const result = await request("initialize", {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: typeof getRoot === "function" ? { roots: { listChanged: false } } : {},
            clientInfo: { name: "project-frstcli", version: "1.0.0" }
        });

        serverInfo = result.serverInfo || null;
        notify("notifications/initialized");
        return result;
    }

    async function listTools() {
        const tools = [];
        let cursor;

        for (let page = 0; page < MAX_LIST_PAGES; page++) {
            const result = await request("tools/list", cursor ? { cursor } : {});
            if (Array.isArray(result.tools)) tools.push(...result.tools);
            cursor = result.nextCursor;
            if (!cursor) break;
        }

        return tools;
    }

    function callTool(toolName, toolArgs, ms) {
        return request("tools/call", { name: toolName, arguments: toolArgs ?? {} }, ms);
    }

    function close() {
        if (!child || closed) return;
        closed = true;
        failAll(new McpError(`${name} : serveur arrêté.`));

        try {
            child.stdin.end();
        } catch {
            // déjà fermé
        }
        try {
            if (child.pid) killTree(child);
            else child.kill();
        } catch {
            // déjà terminé
        }
    }

    return {
        name,
        start,
        listTools,
        callTool,
        close,
        get running() {
            return Boolean(child) && !closed;
        },
        get stderr() {
            return stderr;
        },
        get serverInfo() {
            return serverInfo;
        }
    };
}

module.exports = { createClient, McpError, PROTOCOL_VERSION, DEFAULT_TIMEOUT_MS };
