"use strict";

// Faux serveur MCP stdio pour les tests : initialize, tools/list, tools/call (echo),
// requêtes serveur -> client (ping, roots/list, sampling) et notification tools/list_changed.

const readline = require("node:readline");

const rl = readline.createInterface({ input: process.stdin });

let nextServerId = 1;
let extraTool = false;
const waiting = new Map();

function reply(id, result) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id, code, message) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function askClient(method) {
    const id = `srv-${nextServerId++}`;
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, method })}\n`);
    return new Promise(resolve => waiting.set(id, resolve));
}

process.stdout.write("ligne de journal non JSON\n");

rl.on("line", line => {
    let message;
    try {
        message = JSON.parse(line);
    } catch {
        return;
    }
    if (message.id === undefined) return;

    if (message.method === undefined) {
        const resolve = waiting.get(message.id);
        if (resolve) {
            waiting.delete(message.id);
            resolve(message);
        }
        return;
    }

    switch (message.method) {
        case "initialize":
            reply(message.id, {
                protocolVersion: message.params.protocolVersion,
                capabilities: { tools: { listChanged: true } },
                serverInfo: { name: "fake", version: "0.0.1" }
            });
            break;
        case "tools/list":
            if (!message.params || !message.params.cursor) {
                reply(message.id, {
                    tools: [{
                        name: "echo",
                        description: "Renvoie le texte reçu",
                        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
                    }],
                    nextCursor: "page2"
                });
            } else {
                const tools = [{ name: "boom", description: "Échoue toujours", inputSchema: { type: "object" } }];
                if (extraTool) tools.push({ name: "extra", description: "Ajouté dynamiquement", inputSchema: { type: "object" } });
                reply(message.id, { tools });
            }
            break;
        case "tools/call": {
            const name = message.params.name;
            if (name === "echo") {
                reply(message.id, { content: [{ type: "text", text: `echo: ${message.params.arguments.text}` }] });
            } else if (name === "boom") {
                reply(message.id, { content: [{ type: "text", text: "boom" }], isError: true });
            } else if (name === "roots" || name === "ping" || name === "sampling") {
                const method = name === "roots" ? "roots/list" : name === "ping" ? "ping" : "sampling/createMessage";
                askClient(method).then(answer => {
                    const payload = answer.error ? { error: answer.error } : answer.result;
                    reply(message.id, { content: [{ type: "text", text: JSON.stringify(payload) }] });
                });
            } else if (name === "grow") {
                extraTool = true;
                process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n`);
                reply(message.id, { content: [{ type: "text", text: "ok" }] });
            } else {
                fail(message.id, -32602, "outil inconnu");
            }
            break;
        }
        default:
            fail(message.id, -32601, "méthode inconnue");
    }
});
