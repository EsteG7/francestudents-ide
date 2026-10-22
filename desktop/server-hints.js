"use strict";
const path = require("node:path");
const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");
const { parseCommand } = require("../src/tools/command/parse");
const { resolveInWorkspace } = require("../src/tools/security");
const { localPreviewUrl } = require("./preview-server");

function serverCommand(command) {
    const parsed = parseCommand(command);
    const { file, args } = parsed;
    const node = file === "node" && args.length >= 1 && /\.(?:c|m)?js$/i.test(args[0]) && !args[0].startsWith("-");
    const npm = ["npm", "pnpm", "yarn"].includes(file) && /^(?:run )?(?:dev|start|serve|preview)(?: |$)/.test(args.join(" "));
    const python = ["python", "python3"].includes(file) && args[0] === "-m" && args[1] === "http.server";
    if (!node && !npm && !python) throw new Error("Commande de serveur non reconnue.");
    return parsed;
}
function parseServerHint(text) {
    if (typeof text !== "string" || text.length > 2000000) return null;
    const urls = [];
    for (const match of text.matchAll(/https?:\/\/[^\s<>\])`"']+/gi)) {
        try { urls.push(localPreviewUrl(match[0].replace(/[.,;]+$/, ""))); } catch { /* Invalid address. */ }
    }
    if (!urls.length) return null;
    const commands = [];
    for (const match of text.matchAll(/`([^`\r\n]+)`|```(?:\w+)?\r?\n([\s\S]*?)```/g)) {
        for (const line of (match[1] || match[2] || "").split(/\r?\n/)) {
            const command = line.trim().replace(/^\$\s+/, "");
            try { serverCommand(command); commands.push(command); } catch { /* Not a server command. */ }
        }
    }
    const unique = [...new Set(commands)];
    if (unique.length !== 1 || new Set(urls).size !== 1) return null;
    const cwd = /\b(?:dans(?: le (?:dossier|répertoire))?|in(?: the (?:directory|folder))?)\s+`([^`\r\n]+)`/i.exec(text)?.[1] || ".";
    const hint = { command: unique[0], cwd, url: urls[0] };
    return { ...hint, key: createHash("sha256").update(JSON.stringify(hint)).digest("hex").slice(0, 24) };
}
async function validateServerHint(workspace, hint) {
    if (!workspace) throw new Error("Ouvre le projet du site avant de démarrer le serveur.");
    const { file, args } = serverCommand(String(hint.command || ""));
    const url = localPreviewUrl(hint.url);
    const rel = hint.cwd === path.basename(workspace) ? "." : String(hint.cwd || ".");
    const { target: cwd } = await resolveInWorkspace(workspace, rel);
    if (!(await fs.stat(cwd)).isDirectory()) throw new Error("Le dossier du serveur est introuvable.");
    if (file === "node") {
        const script = await resolveInWorkspace(workspace, path.relative(workspace, path.resolve(cwd, args[0])));
        if (!(await fs.stat(script.target)).isFile()) throw new Error("Le script du serveur est introuvable.");
    }
    return { program: file, args, cwd, command: hint.command, url };
}
module.exports = { parseServerHint, validateServerHint };
