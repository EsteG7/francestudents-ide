"use strict";

/**
 * Outil mcp_call : appelle un outil d'un serveur MCP configuré dans mcp.json.
 * Un outil MCP peut avoir des effets de bord : confirmation demandée à chaque appel.
 */

const { ui } = require("../ui-bridge");
const { requireString } = require("../tools/core/args");

function getManager() {
    return require("./manager").manager;
}

function short(value, max = 300) {
    const text = JSON.stringify(value ?? {});
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function run(args) {
    const manager = getManager();
    await manager.ensureStarted();

    const toolArgs = args.arguments ?? {};
    manager.findTool(args.server, args.tool);

    const ok = await ui.confirm(`Appeler l'outil MCP ${args.server}/${args.tool} avec ${short(toolArgs)} ?`);

    if (!ok) {
        return {
            server: args.server,
            tool: args.tool,
            denied: true,
            changed: false,
            message: "Appel MCP refusé par l'utilisateur."
        };
    }

    const { text, truncated, isError } = await manager.call(args.server, args.tool, toolArgs);

    return {
        server: args.server,
        tool: args.tool,
        is_error: isError,
        truncated,
        content: text,
        changed: false,
        message: isError
            ? `${args.server}/${args.tool} : erreur renvoyée par l'outil`
            : `${args.server}/${args.tool} : OK`
    };
}

function check(args) {
    requireString(args.server, "server");
    requireString(args.tool, "tool");
    if (
        args.arguments !== undefined &&
        (args.arguments === null || typeof args.arguments !== "object" || Array.isArray(args.arguments))
    ) {
        throw new Error("arguments doit être un objet.");
    }
}

function describe(a) {
    return `${a.server ?? "?"}/${a.tool ?? "?"}`;
}

module.exports = { name: "mcp_call", run, check, describe };
