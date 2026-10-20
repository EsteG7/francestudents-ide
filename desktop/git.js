"use strict";

/**
 * Accès Git en lecture pour l'application de bureau (vue Git, diffs inline).
 * Pas de shell : git est lancé avec execFile et des arguments fixes.
 */

const { execFile } = require("node:child_process");

const MAX_BUFFER = 8 * 1024 * 1024;

function runGit(cwd, args) {
    return new Promise((resolve, reject) => {
        execFile("git", args, { cwd, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
            if (error) {
                const message = String(stderr || error.message || "").trim();
                reject(new Error(message || "git a échoué."));
                return;
            }
            resolve(stdout);
        });
    });
}

const STATUS_LABELS = {
    M: "modifié", A: "ajouté", D: "supprimé", R: "renommé", C: "copié", U: "en conflit", "?": "non suivi"
};

/**
 * Analyse la sortie de `git status --porcelain=v1 -b -z`.
 * Renvoie { branch, ahead, behind, files: [{ path, from, index, worktree, staged, label }] }.
 */
function parseStatus(raw) {
    const parts = String(raw || "").split("\0");
    const result = { branch: null, ahead: 0, behind: 0, files: [] };
    for (let i = 0; i < parts.length; i++) {
        const entry = parts[i];
        if (!entry) continue;
        if (entry.startsWith("## ")) {
            const head = entry.slice(3);
            const m = /^(?:No commits yet on |Initial commit on )?([^.\s]+)(?:\.\.\.\S+)?(?: \[(.*)\])?/.exec(head);
            if (m) {
                result.branch = m[1];
                const info = m[2] || "";
                const ahead = /ahead (\d+)/.exec(info);
                const behind = /behind (\d+)/.exec(info);
                result.ahead = ahead ? Number(ahead[1]) : 0;
                result.behind = behind ? Number(behind[1]) : 0;
            }
            continue;
        }
        const index = entry[0];
        const worktree = entry[1];
        const file = { path: entry.slice(3), from: null, index, worktree };
        if (index === "R" || index === "C") {
            file.from = parts[i + 1] || null;
            i += 1;
        }
        const code = index === "?" ? "?" : (index === "U" || worktree === "U") ? "U" : (worktree !== " " ? worktree : index);
        file.staged = index !== " " && index !== "?";
        file.label = STATUS_LABELS[code] || code;
        result.files.push(file);
    }
    return result;
}

async function isRepo(cwd) {
    try {
        return (await runGit(cwd, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
    } catch {
        return false;
    }
}

async function status(cwd) {
    if (!cwd) throw new Error("Aucun projet ouvert.");
    if (!(await isRepo(cwd))) return { repo: false, branch: null, ahead: 0, behind: 0, files: [] };
    const raw = await runGit(cwd, ["status", "--porcelain=v1", "-b", "-z", "--untracked-files=all"]);
    return { repo: true, ...parseStatus(raw) };
}

function checkRel(rel) {
    const value = String(rel || "");
    if (!value || value.startsWith("-") || value.includes("\0")) throw new Error("Chemin refusé.");
    return value;
}

/** Diff unifié d'un fichier : modifications non indexées, ou indexées si staged. */
async function diff(cwd, rel, staged = false) {
    if (!cwd) throw new Error("Aucun projet ouvert.");
    const file = checkRel(rel);
    const args = ["diff", "--no-color", "--no-ext-diff"];
    if (staged) args.push("--cached");
    args.push("--", file);
    return runGit(cwd, args);
}

/** Contenu d'un fichier à HEAD (chaîne vide s'il n'existe pas à HEAD). */
async function showHead(cwd, rel) {
    if (!cwd) throw new Error("Aucun projet ouvert.");
    const file = checkRel(rel).replace(/\\/g, "/");
    try {
        return await runGit(cwd, ["show", `HEAD:${file}`]);
    } catch {
        return "";
    }
}

/** Derniers commits : [{ hash, short, author, date, subject }]. */
async function log(cwd, limit = 50) {
    if (!cwd) throw new Error("Aucun projet ouvert.");
    if (!(await isRepo(cwd))) return [];
    const n = Math.max(1, Math.min(500, Number(limit) || 50));
    let raw;
    try {
        raw = await runGit(cwd, ["log", `-n${n}`, "--date=iso-strict", "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e"]);
    } catch {
        return []; // dépôt sans commit
    }
    return parseLog(raw);
}

function parseLog(raw) {
    return String(raw || "").split("\x1e").map((r) => r.trim()).filter(Boolean).map((r) => {
        const [hash, short, author, date, subject] = r.split("\x1f");
        return { hash, short, author, date, subject };
    });
}

/** git add -A puis git commit -m <message>. Renvoie { output, files }. */
async function commit(cwd, message) {
    if (!cwd) throw new Error("Aucun projet ouvert.");
    const msg = String(message || "").trim();
    if (!msg) throw new Error("Message de commit vide.");
    if (msg.includes("\0")) throw new Error("Message de commit invalide.");
    if (!(await isRepo(cwd))) throw new Error("Ce projet n'est pas un dépôt Git.");
    await runGit(cwd, ["add", "-A"]);
    const staged = (await runGit(cwd, ["diff", "--cached", "--name-only", "-z"])).split("\0").filter(Boolean);
    if (!staged.length) throw new Error("Rien à valider.");
    const output = await runGit(cwd, ["commit", "-m", msg]);
    return { output: String(output || "").trim(), files: staged.length };
}

module.exports = { runGit, parseStatus, parseLog, isRepo, status, diff, showHead, log, commit };
