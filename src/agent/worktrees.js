"use strict";

/**
 * Agents parallèles dans des worktrees Git (/worktree dans le CLI, panneau de l'application).
 *
 * Chaque agent travaille dans son propre worktree (branche frst/<nom>), placé à côté du
 * projet : <parent>/<projet>.frst-worktrees/<nom>. Il tourne dans un processus séparé en
 * mode non interactif (frst -p, demande envoyée sur stdin) : plusieurs agents peuvent
 * travailler en même temps sans toucher au dossier principal.
 * Sans yes, l'agent ne peut rien écrire (les confirmations sont refusées en mode non interactif).
 * Aucun merge ni push automatique : la branche reste à relire, puis à fusionner.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const OUTPUT_CHARS = 200000;
const LOG_CHARS = 20000;
const BIN = path.join(__dirname, "..", "..", "bin", "frst.js");

/** Agents connus, par chemin de worktree. */
const agents = new Map();

function checkName(name) {
    const value = String(name ?? "").trim();
    if (!NAME_RE.test(value) || value.includes("..")) {
        throw new Error("Nom de worktree invalide (lettres, chiffres, . _ -, 41 caractères au maximum).");
    }
    return value;
}

function worktreeRoot(workspace) {
    if (!workspace) throw new Error("Aucun projet ouvert.");
    return path.join(path.dirname(workspace), `${path.basename(workspace)}.frst-worktrees`);
}

function worktreePath(workspace, name) {
    return path.join(worktreeRoot(workspace), checkName(name));
}

function branchName(name) {
    return `frst/${checkName(name)}`;
}

/** Analyse la sortie de `git worktree list --porcelain`. */
function parseWorktreeList(text) {
    const list = [];
    let current = null;

    for (const raw of String(text ?? "").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) {
            current = null;
            continue;
        }
        const space = line.indexOf(" ");
        const key = space === -1 ? line : line.slice(0, space);
        const value = space === -1 ? "" : line.slice(space + 1);

        if (key === "worktree") {
            current = { path: value, head: null, branch: null, detached: false, locked: false };
            list.push(current);
        } else if (current) {
            if (key === "HEAD") current.head = value;
            else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
            else if (key === "detached") current.detached = true;
            else if (key === "locked") current.locked = true;
        }
    }

    return list;
}

function append(buffer, chunk, max) {
    const next = buffer + chunk;
    return next.length > max ? next.slice(-max) : next;
}

function publicAgent(agent) {
    if (!agent) return null;
    return {
        name: agent.name,
        path: agent.path,
        branch: agent.branch,
        prompt: agent.prompt,
        yes: agent.yes,
        readOnly: agent.readOnly,
        status: agent.status,
        exitCode: agent.exitCode,
        startedAt: agent.startedAt,
        endedAt: agent.endedAt,
        answer: agent.answer,
        log: agent.log
    };
}

async function listWorktrees(workspace, deps = {}) {
    const git = deps.runGit || require("../github").runGit;
    const rootName = path.basename(worktreeRoot(workspace));
    const list = parseWorktreeList(await git(workspace, ["worktree", "list", "--porcelain"]));

    return list.map(item => {
        const managed = path.basename(path.dirname(item.path)) === rootName;
        const name = managed ? path.basename(item.path) : null;
        const agent = managed ? publicAgent(agents.get(path.join(worktreeRoot(workspace), name))) : null;
        return { ...item, managed, name, agent };
    });
}

async function createWorktree(workspace, name, { base = "HEAD" } = {}, deps = {}) {
    const git = deps.runGit || require("../github").runGit;
    const dir = worktreePath(workspace, name);
    const ref = String(base || "HEAD");

    if (!REF_RE.test(ref)) throw new Error("Base invalide (branche, tag ou commit).");
    if (fs.existsSync(dir)) throw new Error(`Le worktree ${name} existe déjà : ${dir}`);

    await fs.promises.mkdir(worktreeRoot(workspace), { recursive: true });
    await git(workspace, ["worktree", "add", "-b", branchName(name), dir, ref]);

    return { name: checkName(name), path: dir, branch: branchName(name), base: ref };
}

/**
 * Lance un agent non interactif dans le worktree. Renvoie tout de suite son état ;
 * onUpdate(agent) est appelé à chaque nouvelle sortie et à la fin.
 */
function startAgent(workspace, name, prompt, { yes = false, readOnly = false, onUpdate } = {}, deps = {}) {
    const dir = worktreePath(workspace, name);
    const text = String(prompt ?? "").trim();

    if (!text) throw new Error("Demande vide.");
    if (!(deps.exists || fs.existsSync)(dir)) throw new Error(`Worktree ${name} introuvable : crée-le d'abord.`);

    const previous = agents.get(dir);
    if (previous && previous.status === "running") throw new Error(`Un agent tourne déjà dans ${name}.`);

    const args = [deps.bin || BIN, "-p", "--cwd", dir];
    if (yes) args.push("--yes");
    if (readOnly) args.push("--plan");

    // ELECTRON_RUN_AS_NODE : dans l'application, process.execPath est Electron, lancé ici comme Node.
    const child = (deps.spawn || spawn)(deps.execPath || process.execPath, args, {
        cwd: dir,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NO_COLOR: "1" },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
    });

    const agent = {
        name: checkName(name),
        path: dir,
        branch: branchName(name),
        prompt: text,
        yes: Boolean(yes),
        readOnly: Boolean(readOnly),
        status: "running",
        exitCode: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        answer: "",
        log: "",
        child
    };
    agents.set(dir, agent);

    const notify = () => {
        if (typeof onUpdate !== "function") return;
        try {
            onUpdate(publicAgent(agent));
        } catch {
            // une erreur d'affichage ne doit pas arrêter l'agent
        }
    };

    if (typeof child.stdout.setEncoding === "function") child.stdout.setEncoding("utf8");
    if (typeof child.stderr.setEncoding === "function") child.stderr.setEncoding("utf8");

    child.stdout.on("data", chunk => {
        agent.answer = append(agent.answer, String(chunk), OUTPUT_CHARS);
    });
    child.stderr.on("data", chunk => {
        agent.log = append(agent.log, String(chunk), LOG_CHARS);
        notify();
    });
    child.on("error", error => {
        agent.status = "failed";
        agent.log = append(agent.log, `\n${error.message}`, LOG_CHARS);
        agent.endedAt = new Date().toISOString();
        notify();
    });
    child.on("close", code => {
        if (agent.status === "running") agent.status = code === 0 ? "done" : "failed";
        agent.exitCode = code;
        agent.endedAt = agent.endedAt || new Date().toISOString();
        notify();
    });

    child.stdin.on("error", () => {});
    child.stdin.end(text);
    notify();

    return publicAgent(agent);
}

function stopAgent(workspace, name) {
    const agent = agents.get(worktreePath(workspace, name));
    if (!agent || agent.status !== "running") throw new Error(`Aucun agent en cours dans ${name}.`);
    agent.status = "stopped";
    agent.endedAt = new Date().toISOString();
    agent.child.kill();
    return publicAgent(agent);
}

function getAgent(workspace, name) {
    return publicAgent(agents.get(worktreePath(workspace, name)));
}

function listAgents(workspace) {
    const root = worktreeRoot(workspace) + path.sep;
    return [...agents.values()].filter(agent => agent.path.startsWith(root)).map(publicAgent);
}

/** Fichiers modifiés et diff du worktree par rapport à son dernier commit. */
async function worktreeChanges(workspace, name, deps = {}) {
    const git = deps.runGit || require("../github").runGit;
    const dir = worktreePath(workspace, name);

    if (!(deps.exists || fs.existsSync)(dir)) throw new Error(`Worktree ${name} introuvable.`);

    const status = await git(dir, ["status", "--porcelain"]);
    const diff = await git(dir, ["diff", "HEAD"]);

    return {
        name: checkName(name),
        path: dir,
        branch: branchName(name),
        status,
        diff: diff.length > OUTPUT_CHARS ? `${diff.slice(0, OUTPUT_CHARS)}\n… (diff tronqué)` : diff
    };
}

/** Supprime le worktree (la branche frst/<nom> est conservée). */
async function removeWorktree(workspace, name, { force = false } = {}, deps = {}) {
    const git = deps.runGit || require("../github").runGit;
    const dir = worktreePath(workspace, name);
    const agent = agents.get(dir);

    if (agent && agent.status === "running") throw new Error(`Arrête d'abord l'agent de ${name}.`);

    const args = ["worktree", "remove"];
    if (force) args.push("--force");
    args.push(dir);

    await git(workspace, args);
    agents.delete(dir);

    return { name: checkName(name), path: dir, branch: branchName(name), branchKept: true };
}

/** Arrête tous les agents en cours (fermeture de l'application ou du CLI). */
function stopAll() {
    for (const agent of agents.values()) {
        if (agent.status === "running") {
            agent.status = "stopped";
            agent.endedAt = new Date().toISOString();
            try {
                agent.child.kill();
            } catch {
                // déjà terminé
            }
        }
    }
}

module.exports = {
    checkName,
    worktreeRoot,
    worktreePath,
    branchName,
    parseWorktreeList,
    listWorktrees,
    createWorktree,
    startAgent,
    stopAgent,
    getAgent,
    listAgents,
    worktreeChanges,
    removeWorktree,
    stopAll
};
