"use strict";

/**
 * Outil diagnostics : lance les vérificateurs installés dans le projet (ESLint, TypeScript)
 * et renvoie une liste structurée d'erreurs { file, line, column, severity, source, code, message }.
 *
 * - Seuls les binaires locaux (node_modules/.bin) sont utilisés : aucun téléchargement via npx.
 * - ESLint : --format json. TypeScript : tsc --noEmit --pretty false (codes ANSI retirés,
 *   formats file(l,c): et file:l:c - acceptés).
 * - Un code de sortie non nul sans diagnostic lisible n'est JAMAIS présenté comme un succès.
 * - Les vérificateurs exécutent la configuration du projet : confirmation une fois par projet et par session.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const { state } = require("../state");
const { ui } = require("../ui-bridge");
const { optionalInt } = require("./core/args");

const TOOL_NAMES = ["auto", "eslint", "tsc"];
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_DIAGNOSTICS = 200;
const MAX_RAW = 2000;
const ESLINT_CONFIGS = [
    "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts",
    ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml"
];

const trustedWorkspaces = new Set();

const stripAnsi = text => String(text ?? "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");

function relative(workspace, file) {
    if (!file) return "";
    const abs = path.resolve(workspace, file);
    const rel = path.relative(workspace, abs);
    return (rel && !rel.startsWith("..") ? rel : abs).split(path.sep).join("/");
}

/** Sortie JSON d'ESLint -> diagnostics. Lève une erreur si le JSON est illisible. */
function parseEslintJson(stdout, workspace = process.cwd()) {
    const text = stripAnsi(stdout).trim();
    const start = text.indexOf("[");
    if (start === -1) throw new Error("Sortie ESLint sans JSON.");
    const data = JSON.parse(text.slice(start));
    if (!Array.isArray(data)) throw new Error("Sortie ESLint inattendue.");

    const list = [];
    for (const entry of data) {
        for (const msg of entry.messages || []) {
            list.push({
                file: relative(workspace, entry.filePath),
                line: msg.line ?? 0,
                column: msg.column ?? 0,
                severity: msg.severity === 2 || msg.fatal ? "error" : "warning",
                source: "eslint",
                code: msg.ruleId || null,
                message: String(msg.message || "").trim()
            });
        }
    }
    return list;
}

const TSC_PAREN = /^(.+?)\((\d+),(\d+)\):\s+(error|warning|message)\s+(TS\d+):\s*(.*)$/;
const TSC_COLON = /^(.+?):(\d+):(\d+)\s+-\s+(error|warning|message)\s+(TS\d+):\s*(.*)$/;
const TSC_GLOBAL = /^(error|warning)\s+(TS\d+):\s*(.*)$/;

/** Sortie texte de tsc -> diagnostics (lignes de suite rattachées au message précédent). */
function parseTscOutput(output, workspace = process.cwd()) {
    const list = [];
    let last = null;

    for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
        const line = rawLine.replace(/\s+$/, "");
        if (!line) continue;
        const match = TSC_PAREN.exec(line) || TSC_COLON.exec(line);
        if (match) {
            last = {
                file: relative(workspace, match[1].trim()),
                line: Number(match[2]),
                column: Number(match[3]),
                severity: match[4] === "error" ? "error" : "warning",
                source: "tsc",
                code: match[5],
                message: match[6].trim()
            };
            list.push(last);
            continue;
        }
        const global = TSC_GLOBAL.exec(line.trim());
        if (global) {
            last = {
                file: "",
                line: 0,
                column: 0,
                severity: global[1],
                source: "tsc",
                code: global[2],
                message: global[3].trim()
            };
            list.push(last);
            continue;
        }
        if (last && /^\s/.test(rawLine) && last.message.length < 1000) {
            last.message += ` ${line.trim()}`;
        }
    }
    return list;
}

function localBin(workspace, name, platform = process.platform) {
    const file = path.join(workspace, "node_modules", ".bin", platform === "win32" ? `${name}.cmd` : name);
    return fs.existsSync(file) ? file : null;
}

function hasEslintConfig(workspace) {
    if (ESLINT_CONFIGS.some(name => fs.existsSync(path.join(workspace, name)))) return true;
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8"));
        return Boolean(pkg && pkg.eslintConfig);
    } catch {
        return false;
    }
}

/** Fichiers demandés, relatifs au projet ; refuse ceux qui en sortent. */
function resolveFiles(workspace, files = []) {
    return files.map(file => {
        const abs = path.resolve(workspace, file);
        const rel = path.relative(workspace, abs);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
            throw new Error(`Chemin hors du projet : ${file}`);
        }
        return rel || ".";
    });
}

function runBinary(bin, args, { cwd, timeoutMs }) {
    return new Promise(resolve => {
        execFile(bin, args, {
            cwd,
            timeout: timeoutMs,
            maxBuffer: 32 * 1024 * 1024,
            shell: process.platform === "win32",
            env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
        }, (error, stdout, stderr) => {
            const timedOut = Boolean(error && error.killed);
            let code = 0;
            if (error) code = typeof error.code === "number" ? error.code : 1;
            resolve({ code, stdout: String(stdout || ""), stderr: String(stderr || ""), timedOut });
        });
    });
}

/** Choisit les vérificateurs à lancer. Renvoie [{ tool, bin }] et les remarques (outil absent). */
function planCheckers(workspace, wanted = "auto") {
    const plan = [];
    const notes = [];
    const eslint = localBin(workspace, "eslint");
    const tsc = localBin(workspace, "tsc");

    if (wanted === "eslint" || (wanted === "auto" && eslint && hasEslintConfig(workspace))) {
        if (eslint) plan.push({ tool: "eslint", bin: eslint });
        else notes.push("eslint absent de node_modules/.bin (npm install -D eslint).");
    }
    if (wanted === "tsc" || (wanted === "auto" && tsc && fs.existsSync(path.join(workspace, "tsconfig.json")))) {
        if (!tsc) notes.push("tsc absent de node_modules/.bin (npm install -D typescript).");
        else if (!fs.existsSync(path.join(workspace, "tsconfig.json"))) notes.push("tsconfig.json absent : tsc ignoré.");
        else plan.push({ tool: "tsc", bin: tsc });
    }
    if (wanted === "auto" && plan.length === 0 && notes.length === 0) {
        notes.push("Aucun vérificateur détecté (niESLint configuré, ni tsconfig.json avec typescript installé).");
    }
    return { plan, notes };
}

async function runChecker({ tool, bin }, { workspace, files, timeoutMs }) {
    if (tool === "eslint") {
        const res = await runBinary(bin, ["--format", "json", ...(files.length ? files : ["."])], { cwd: workspace, timeoutMs });
        if (res.timedOut) return { tool, status: "timeout", exit_code: null, diagnostics: [] };
        try {
            const diagnostics = parseEslintJson(res.stdout, workspace);
            return { tool, status: res.code === 2 ? "failed" : "ok", exit_code: res.code, diagnostics };
        } catch {
            return {
                tool,
                status: "failed",
                exit_code: res.code,
                diagnostics: [],
                output: stripAnsi(res.stderr || res.stdout).trim().slice(0, MAX_RAW)
            };
        }
    }

    const res = await runBinary(bin, ["--noEmit", "--pretty", "false", "-p", "tsconfig.json"], { cwd: workspace, timeoutMs });
    if (res.timedOut) return { tool, status: "timeout", exit_code: null, diagnostics: [] };
    let diagnostics = parseTscOutput(`${res.stdout}\n${res.stderr}`, workspace);
    if (files.length) {
        const wantedFiles = new Set(files.map(f => f.split(path.sep).join("/")));
        diagnostics = diagnostics.filter(d => !d.file || wantedFiles.has(d.file));
    }
    const result = { tool, status: "ok", exit_code: res.code, diagnostics };
    // tsc a échoué sans rien de lisible : ne pas faire croire à un succès.
    if (res.code !== 0 && parseTscOutput(`${res.stdout}\n${res.stderr}`, workspace).length === 0) {
        result.status = "failed";
        result.output = stripAnsi(res.stderr || res.stdout).trim().slice(0, MAX_RAW);
    }
    return result;
}

function checkArgs(args) {
    if (args.files !== undefined) {
        if (!Array.isArray(args.files) || args.files.some(f => typeof f !== "string" || !f.trim())) {
            throw new Error("files doit être une liste de chemins (chaînes non vides).");
        }
        if (args.files.length > 100) throw new Error("files :100 chemins au maximum.");
    }
    if (args.tool !== undefined && !TOOL_NAMES.includes(args.tool)) {
        throw new Error(`tool doit valoir ${TOOL_NAMES.join(", ")}.`);
    }
    optionalInt(args.timeout_ms, "timeout_ms");
}

async function runDiagnostics(args = {}) {
    const workspace = state.workspace;
    if (!workspace) throw new Error("Aucun projet sélectionné.");
checkArgs(args);

    const files = resolveFiles(workspace, args.files || []);
    const timeoutMs = Math.min(600000, Math.max(5000, args.timeout_ms ?? DEFAULT_TIMEOUT_MS));
    const { plan, notes } = planCheckers(workspace, args.tool || "auto");

    if (plan.length && !trustedWorkspaces.has(workspace)) {
        const names = plan.map(p => p.tool).join(" et ");
        const ok = await ui.confirm(`Lancer ${names} du projet (node_modules/.bin) ? Ils exécutent la configuration du projet.`);
        if (!ok) return { denied: true, message: "Diagnostics refusés par l'utilisateur." };
        trustedWorkspaces.add(workspace);
    }

    const checkers = [];
    let all = [];
    for (const item of plan) {
        const res = await runChecker(item, { workspace, files, timeoutMs });
        all = all.concat(res.diagnostics);
        const entry = { tool: res.tool, status: res.status, exit_code: res.exit_code, count: res.diagnostics.length };
        if (res.output) entry.output = res.output;
        checkers.push(entry);
    }

    all.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
    const errors = all.filter(d => d.severity === "error").length;
    const warnings = all.length - errors;
    const failed = checkers.filter(c => c.status !== "ok").map(c => c.tool);

    let message;
    if (!checkers.length) message = notes.join(" ") || "Aucun vérificateur lancé.";
    else if (failed.length) message = `${failed.join(", ")} en échec (voir output) ; ${errors} erreur(s), ${warnings} avertissement(s).`;
    else message = errors || warnings ? `${errors} erreur(s), ${warnings} avertissement(s).` : "Aucune erreur ni avertissement.";

    return {
        checkers,
        notes,
        errors,
        warnings,
        diagnostics: all.slice(0, MAX_DIAGNOSTICS),
        truncated: all.length > MAX_DIAGNOSTICS,
        message
    };
}

function resetTrust() {
    trustedWorkspaces.clear();
}

module.exports = {
    name: "diagnostics",
    run: runDiagnostics,
    check: checkArgs,
    describe(a) {
        const files = Array.isArray(a.files) && a.files.length ? a.files.join(" ") : "projet";
        return `${a.tool || "auto"} : ${files}`;
    },
    runDiagnostics,
    parseEslintJson,
    parseTscOutput,
    planCheckers,
    resolveFiles,
    stripAnsi,
    resetTrust
};
