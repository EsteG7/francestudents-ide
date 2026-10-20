"use strict";

/**
 * Processus principal de l'application de bureau FranceStudent Code (Electron).
 *
 * Le cœur du CLI (session, agent, outils) tourne ici, dans Node. La fenêtre
 * (desktop/renderer) affiche l'interface façon VS Code et communique par IPC :
 * - fenêtre -> principal : ipcRenderer.invoke("frst:<action>", ...)
 * - principal -> fenêtre : webContents.send("frst:event", { channel, data })
 */

const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");

const { setUiBackend } = require("../src/ui-bridge");
const { createDesktopBackend } = require("./backend");

const MAX_EDITOR_BYTES = 2 * 1024 * 1024;
const IGNORED_DIRS = new Set(["node_modules", ".git"]);

let win = null;
let backend = null;
let session = null;
let booted = false;
let busy = false;

function send(channel, data) {
    if (win && !win.isDestroyed()) win.webContents.send("frst:event", { channel, data });
}

function pushStatus() {
    if (backend) send("status", { ...backend.status(), busy, booted });
}

/** Chemin absolu dans le projet ouvert ; refuse toute sortie du projet. */
function insideWorkspace(relOrAbs) {
    const { state } = require("../src/state");
    if (!state.workspace) throw new Error("Aucun projet ouvert.");
    const full = path.resolve(state.workspace, String(relOrAbs ?? "."));
    const rel = path.relative(state.workspace, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error("Chemin hors du projet.");
    }
    return full;
}

async function bootstrap() {
    if (booted) return { ok: true };
    backend.banner();
    const result = await session.bootstrap();
    booted = Boolean(result.ok);

    if (result.ok) {
        // L'agent doit toujours disposer d'un projet : on rouvre le dernier
        // dossier utilisé, sinon l'accès aux fichiers est perdu à chaque
        // redémarrage et l'agent ne peut plus lire ni modifier le code.
        await restoreLastProject();

        // En application de bureau, le mode par défaut est « agent » : toute
        // demande sur un projet ouvert passe par les outils fichiers.
        require("../src/state").state.mode = "agent";
    }

    if (!result.ok) backend.error(result.reason);
    pushStatus();
    return result;
}

/** Rouvre le dernier projet connu s'il existe encore sur le disque. */
async function restoreLastProject() {
    try {
        const { state } = require("../src/state");
        const projects = require("../src/project/projects");
        await projects.prune();
        const last = await projects.last();

        if (!last || !last.path) return null;
        if (!require("node:fs").existsSync(last.path)) return null;
        if (state.workspace === last.path) return last.path;

        await require("../src/tools/tools").setProject(last.path);
        return last.path;
    } catch {
        return null;
    }
}

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_TEXT_CHARS = 100_000;
const MAX_IMAGE_DATA_URL_CHARS = 8 * 1024 * 1024;
// 25 Mo de fichier encodés en base64 (+ en-tête de la data URL).
const MAX_FILE_DATA_URL_CHARS = Math.ceil((25 * 1024 * 1024 * 4) / 3) + 1024;

/**
 * Pièces jointes reçues de la fenêtre : [{ name, kind: "image"|"text"|"file", data }].
 * Images : data URL base64 (data:image/...). Texte : contenu du fichier.
 * Fichiers (PDF, Office, archives… tout type) : data URL base64, envoyés via Files v2.
 * Renvoie { images, files, textBlock, names } (entrées invalides ignorées).
 */
function normalizeAttachments(list) {
    const images = [];
    const files = [];
    const blocks = [];
    const names = [];
    if (!Array.isArray(list)) return { images, files, textBlock: "", names };

    for (const item of list.slice(0, MAX_ATTACHMENTS)) {
        if (!item || typeof item.data !== "string") continue;
        const name = String(item.name || "fichier").replace(/[\r\n]/g, " ").slice(0, 200);
        if (item.kind === "image") {
            if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(item.data)) continue;
            if (item.data.length > MAX_IMAGE_DATA_URL_CHARS) continue;
            images.push(item.data);
            names.push(name);
        } else if (item.kind === "file") {
            if (!/^data:[^,]*;base64,/i.test(item.data)) continue;
            if (item.data.length > MAX_FILE_DATA_URL_CHARS) continue;
            files.push({ name, dataUrl: item.data });
            names.push(name);
        } else {
            let content = item.data;
            if (content.length > MAX_ATTACHMENT_TEXT_CHARS) {
                content = `${content.slice(0, MAX_ATTACHMENT_TEXT_CHARS)}\n[… tronqué]`;
            }
            blocks.push(`--- Fichier joint : ${name} ---\n${content}\n--- Fin de ${name} ---`);
            names.push(name);
        }
    }
    return { images, files, textBlock: blocks.join("\n\n"), names };
}

async function submit(raw, attachments) {
    const { state } = require("../src/state");
    let text = String(raw ?? "");
    const files = normalizeAttachments(attachments);
    const hasFiles = files.images.length > 0 || files.files.length > 0 || files.textBlock.length > 0;
    if (!text.trim() && !hasFiles) return { exit: false };
    if (busy) {
        backend.warn("Une demande est déjà en cours : attends sa fin ou clique sur Stop.");
        return { exit: false };
    }

    let display = text;
    if (hasFiles && !text.trim().startsWith("/")) {
        if (!text.trim()) {
            text = files.images.length && !files.files.length && !files.textBlock
                ? "Analyse les images jointes."
                : "Analyse les fichiers joints.";
            display = "";
        }
        if (files.textBlock) text = `${text}\n\nFICHIERS JOINTS :\n${files.textBlock}`;
        if (files.images.length) text += `\n\n(${files.images.length} image(s) jointe(s) à ce message.)`;
        if (files.files.length) {
            text += `\n\n(Fichier(s) joint(s) à ce message : ${files.files.map((f) => f.name).join(", ")}.)`;
        }
        state.pendingImages = files.images;
        state.pendingFiles = files.files;
        display = `${display}${display ? "\n" : ""}Pièces jointes : ${files.names.join(", ")}`;
    }

    busy = true;
    pushStatus();
    send("entry", { type: "user", text: display });

    let stream = null;
    const onChatDelta = (delta) => {
        if (!stream) stream = backend.stream();
        stream.write(delta);
    };

    let result = null;
    try {
        const input = text.trim();
        if (/^\/(preprompt|profil)\b/i.test(input)) {
            await require("../src/cli/profile-commands").handleProfileCommand(input);
            result = { exit: false };
        } else {
            if (!input.startsWith("/")) {
                require("../src/project/profile").observe(input).catch(() => {});
            }
            result = await session.handleInput(text, { onChatDelta, preferAgent: true });
        }
    } catch (error) {
        backend.error(error && error.message ? error.message : String(error));
    } finally {
        if (stream) stream.end();
        // Images et fichiers non consommés (commande, erreur, interruption) : jamais réutilisés.
        state.pendingImages = [];
        state.pendingFiles = [];
        send("commandEnd");
        busy = false;
        pushStatus();
    }

    if (result && result.exit) {
        setTimeout(() => app.quit(), 200);
    }
    return { exit: Boolean(result && result.exit) };
}

async function openProject(directory) {
    let dir = directory;
    if (!dir) {
        const picked = await dialog.showOpenDialog(win, {
            title: "Ouvrir un dossier de projet",
            properties: ["openDirectory"]
        });
        if (picked.canceled || !picked.filePaths.length) return null;
        dir = picked.filePaths[0];
    }
    if (busy) throw new Error("Une demande est en cours : attends sa fin avant de changer de projet.");

    busy = true;
    pushStatus();
    try {
        await require("../src/tools/tools").setProject(dir);
    } finally {
        busy = false;
        pushStatus();
    }
    const { state } = require("../src/state");
    return state.workspace;
}

async function listDir(rel) {
    const full = insideWorkspace(rel);
    const entries = await fs.readdir(full, { withFileTypes: true });
    const { state } = require("../src/state");
    return entries
        .filter((e) => !(e.isDirectory() && IGNORED_DIRS.has(e.name)))
        .map((e) => ({
            name: e.name,
            path: path.relative(state.workspace, path.join(full, e.name)).split(path.sep).join("/"),
            type: e.isDirectory() ? "directory" : "file"
        }))
        .sort((a, b) =>
            a.type === b.type ? a.name.localeCompare(b.name, "fr") : a.type === "directory" ? -1 : 1
        );
}

async function readEditorFile(rel) {
    const full = insideWorkspace(rel);
    const info = await fs.stat(full);
    if (!info.isFile()) throw new Error("Ce n'est pas un fichier.");
    if (info.size > MAX_EDITOR_BYTES) throw new Error("Fichier trop volumineux pour l'éditeur (2 Mo max).");
    const buffer = await fs.readFile(full);
    if (buffer.includes(0)) throw new Error("Fichier binaire :ouverture impossible dans l'éditeur.");
    return { path: rel, content: buffer.toString("utf8"), mtimeMs: info.mtimeMs };
}

async function writeEditorFile(rel, content) {
    const full = insideWorkspace(rel);
    if (typeof content !== "string") throw new Error("Contenu invalide.");
    const tmp = `${full}.${process.pid}.tmp`;
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, full);
    const info = await fs.stat(full);
    return { path: rel, mtimeMs: info.mtimeMs };
}

const SEARCH_MAX_FILES = 8000;
const SEARCH_MAX_MATCHES = 500;
const SEARCH_MAX_BYTES = 1024 * 1024;

async function walkFiles(dir, out) {
    if (out.length >= SEARCH_MAX_FILES) return;
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        if (out.length >= SEARCH_MAX_FILES) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!IGNORED_DIRS.has(e.name)) await walkFiles(full, out);
        } else if (e.isFile()) {
            out.push(full);
        }
    }
}

function toRel(full) {
    const { state } = require("../src/state");
    return path.relative(state.workspace, full).split(path.sep).join("/");
}

async function listAllFiles() {
    const out = [];
    await walkFiles(insideWorkspace("."), out);
    return out.map(toRel).sort((a, b) => a.localeCompare(b, "fr"));
}

async function searchText(query, options = {}) {
    const text = String(query ?? "");
    if (!text) return { matches: [], truncated: false };
    let re;
    try {
        const source = options.regex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        re = new RegExp(source, options.caseSensitive ? "" : "i");
    } catch (error) {
        throw new Error(`Expression invalide : ${error.message}`, { cause: error });
    }
    const files = [];
    await walkFiles(insideWorkspace("."), files);
    const matches = [];
    for (const full of files) {
        let buffer;
        try {
            const info = await fs.stat(full);
            if (info.size > SEARCH_MAX_BYTES) continue;
            buffer = await fs.readFile(full);
        } catch {
            continue;
        }
        if (buffer.includes(0)) continue;
        const lines = buffer.toString("utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
                matches.push({ path: toRel(full), line: i + 1, text: lines[i].slice(0, 300) });
                if (matches.length >= SEARCH_MAX_MATCHES) return { matches, truncated: true };
            }
        }
    }
    return { matches, truncated: false };
}

async function assertMissing(full, message) {
    try {
        await fs.access(full);
    } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
    }
    throw new Error(message);
}

async function createEntry(rel, kind) {
    const full = insideWorkspace(rel);
    await assertMissing(full, "Ce chemin existe déjà.");
    if (kind === "directory") {
        await fs.mkdir(full, { recursive: true });
    } else {
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, "", { flag: "wx" });
    }
    return toRel(full);
}

async function renameEntry(fromRel, toRelPath) {
    const from = insideWorkspace(fromRel);
    const to = insideWorkspace(toRelPath);
    await assertMissing(to, "La destination existe déjà.");
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    return toRel(to);
}

async function trashEntry(rel) {
    const full = insideWorkspace(rel);
    if (full === insideWorkspace(".")) throw new Error("Impossible de supprimer la racine du projet.");
    await shell.trashItem(full);
    return true;
}

/* ---------- Terminal intégré ---------- */

const terminals = new Map();
let nextTerminalId = 1;

/**
 * Résout le dossier courant d'un terminal après « cd » : renvoie le chemin
 * relatif au projet (« . » pour la racine). Refuse toute sortie du projet.
 */
async function terminalCd(currentRel, target) {
    const { state } = require("../src/state");
    const base = insideWorkspace(String(currentRel || "."));
    const raw = String(target ?? "").trim().replace(/^["']|["']$/g, "");
    const full = !raw || raw === "~" ? insideWorkspace(".") : path.resolve(base, raw);
    const rel = path.relative(state.workspace, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Dossier hors du projet.");
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || !stat.isDirectory()) throw new Error(`Dossier introuvable : ${raw}`);
    return rel ? rel.split(path.sep).join("/") : ".";
}

function runTerminal(commandLine, cwdRel) {
    const line = String(commandLine ?? "").trim();
    if (!line) throw new Error("Commande vide.");
    const { spawn } = require("node:child_process");
    const id = nextTerminalId++;
    const env = { ...process.env, FORCE_COLOR: "1", CLICOLOR_FORCE: "1", TERM: "xterm-256color" };
    delete env.NO_COLOR;
    const child = spawn(line, {
        cwd: insideWorkspace(String(cwdRel || ".")),
        shell: process.platform === "win32" ? "powershell.exe" : true,
        windowsHide: true,
        env
    });
    terminals.set(id, child);
    const forward = (chunk) => send("terminalData", { id, text: chunk.toString("utf8") });
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.on("error", (error) => send("terminalData", { id, text: `${error.message}\n` }));
    child.on("close", (code, signal) => {
        terminals.delete(id);
        send("terminalExit", { id, code, signal });
    });
    return id;
}

function killTerminal(id) {
    const child = terminals.get(id);
    if (!child) return false;
    if (process.platform === "win32") {
        require("node:child_process").spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
        child.kill("SIGTERM");
    }
    return true;
}

/* ---------- Vrai terminal (pseudo-terminal node-pty) ---------- */

const ptys = new Map();
let nextPtyId = 1;
let ptyModule;

/** Charge node-pty au premier usage ; null s'il est absent ou non compilé pour Electron. */
function loadPty() {
    if (ptyModule !== undefined) return ptyModule;
    try {
        ptyModule = require("node-pty");
    } catch (error) {
        console.warn(`[pty] node-pty indisponible : ${error.message}`);
        ptyModule = null;
    }
    return ptyModule;
}

function ptyAvailable() {
    return Boolean(loadPty());
}

function defaultShell() {
    if (process.platform === "win32") return { file: "powershell.exe", args: ["-NoLogo"], name: "PowerShell" };
    const fsSync = require("node:fs");
    const file = process.env.SHELL && fsSync.existsSync(process.env.SHELL)
        ? process.env.SHELL
        : fsSync.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash";
    return { file, args: ["-l"], name: path.basename(file) };
}

function clampSize(value, fallback, max) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

function ptyCreate(cwdRel, cols, rows) {
    const pty = loadPty();
    if (!pty) throw new Error("node-pty indisponible : lancer « npm run rebuild:native ».");
    const shellInfo = defaultShell();
    const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "FranceStudentCode" };
    delete env.NO_COLOR;
    if (!env.LANG) env.LANG = "fr_FR.UTF-8";
    const id = nextPtyId++;
    const proc = pty.spawn(shellInfo.file, shellInfo.args, {
        name: "xterm-256color",
        cols: clampSize(cols, 80, 1000),
        rows: clampSize(rows, 24, 500),
        cwd: insideWorkspace(String(cwdRel || ".")),
        env
    });
    ptys.set(id, proc);
    proc.onData((data) => send("ptyData", { id, data }));
    proc.onExit(({ exitCode, signal }) => {
        ptys.delete(id);
        send("ptyExit", { id, code: exitCode, signal });
    });
    return { id, pid: proc.pid, shell: shellInfo.name };
}

function ptyWrite(id, data) {
    const proc = ptys.get(Number(id));
    if (!proc) return false;
    proc.write(String(data ?? ""));
    return true;
}

function ptyResize(id, cols, rows) {
    const proc = ptys.get(Number(id));
    if (!proc) return false;
    try {
        proc.resize(clampSize(cols, 80, 1000), clampSize(rows, 24, 500));
    } catch {
        return false;
    }
    return true;
}

function ptyKill(id) {
    const proc = ptys.get(Number(id));
    if (!proc) return false;
    ptys.delete(Number(id));
    try {
        proc.kill();
    } catch {
        // déjà terminé
    }
    return true;
}

function killAllTerminals() {
    for (const id of [...terminals.keys()]) killTerminal(id);
    for (const id of [...ptys.keys()]) ptyKill(id);
}

/**
 * Quota affiché en bas de l'IDE : budget général de chat (chatBudget), et non
 * la limite la plus consommée (souvent celle des images). Voir summarizeUserQuota.
 */
async function usage() {
    const { fetchUserUsage, summarizeUserQuota } = require("../src/api/account");
    return summarizeUserQuota(await fetchUserUsage());
}

function setAutoApprove(mode) {
    const { state } = require("../src/state");
    const settings = require("../src/settings");
    const value = String(mode || "");

    if (value.startsWith("commands-")) {
        // Commandes run_command sans question (les commandes interdites restent bloquées).
        const sub = value.slice("commands-".length);
        if (sub === "always" || sub === "never") {
            settings.setAutoApproveCommandsAlways(sub === "always");
            state.autoApproveCommands = sub === "always";
        } else if (sub === "on" || sub === "off") {
            state.autoApproveCommands = sub === "on";
        }
    } else if (value === "web-on" || value === "web-off") {
        // Recherche web côté serveur (même drapeau que la commande CLI /web on|off).
        state.webSearch = value === "web-on";
    } else if (value === "extensions-auto" || value === "extensions-manual") {
        // Skills et MCP : détection automatique par l'agent ou choix de l'utilisateur (/extensions).
        settings.setExtensionsMode(value.slice("extensions-".length));
    } else if (value === "always" || value === "never") {
        settings.setAutoApproveAlways(value === "always");
        state.autoApprove = value === "always";
    } else if (value === "on" || value === "off") {
        state.autoApprove = value === "on";
    }

    return {
        autoApprove: state.autoApprove,
        always: settings.autoApproveAlways(),
        autoApproveCommands: Boolean(state.autoApproveCommands),
        commandsAlways: settings.autoApproveCommandsAlways(),
        webSearch: Boolean(state.webSearch),
        extensionsMode: settings.extensionsMode()
    };
}

/* ---------- MCP et Skills (mêmes modules que le CLI : réellement utilisés par l'agent) ---------- */

async function mcpList(action) {
    const { manager, defaultConfigFile } = require("../src/mcp/manager");
    let servers;
    if (action === "stop") {
        manager.stopAll();
        servers = [];
    } else {
        servers = action === "restart" ? await manager.restart() : await manager.ensureStarted();
    }
    return { configFile: defaultConfigFile(), servers };
}

async function mcpOpenConfig() {
    const fsp = require("node:fs/promises");
    const { defaultConfigFile } = require("../src/mcp/manager");
    const file = defaultConfigFile();
    try {
        await fsp.access(file);
    } catch {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, JSON.stringify({ mcpServers: {} }, null, 2) + "\n", "utf8");
    }
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
    return file;
}

async function skillsList() {
    const { state } = require("../src/state");
    const skills = require("../src/skills");
    return {
        userDir: skills.userSkillsDir(),
        projectDir: skills.projectSkillsDir(state.workspace || null),
        skills: await skills.listSkills(state.workspace || null)
    };
}

async function skillsOpenDir(scope) {
    const fsp = require("node:fs/promises");
    const { state } = require("../src/state");
    const skills = require("../src/skills");
    const dir = scope === "projet" ? skills.projectSkillsDir(state.workspace || null) : skills.userSkillsDir();
    if (!dir) throw new Error("Aucun projet ouvert.");
    await fsp.mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
    return dir;
}

async function skillsCreate(name, scope) {
    const { state } = require("../src/state");
    const skills = require("../src/skills");
    const created = await skills.createSkill(String(name || ""), {
        workspace: state.workspace || null,
        scope: scope === "projet" ? "projet" : "utilisateur"
    });
    await shell.openPath(created.file);
    return created;
}

function handle(name, fn) {
    ipcMain.handle(`frst:${name}`, async (_event, ...args) => {
        try {
            return { ok: true, value: await fn(...args) };
        } catch (error) {
            return { ok: false, error: error && error.message ? error.message : String(error) };
        }
    });
}

function registerIpc() {
    handle("bootstrap", bootstrap);
    handle("submit", submit);
    handle("resolvePrompt", (id, value) => backend.resolvePrompt(id, value));
    handle("interrupt", () => backend.interrupt());
    handle("status", () => ({ ...backend.status(), busy, booted }));
    handle("models", () => backend.models());
    handle("setModel", async (id) => {
        if (busy) throw new Error("Une demande est en cours : attends sa fin avant de changer de modèle.");
        const result = await backend.setModel(id);
        pushStatus();
        return result;
    });
    handle("openProject", openProject);
    handle("setEditorContext", (files, active) => {
        const { state } = require("../src/state");
        state.openFiles = Array.isArray(files)
            ? files.map(String).filter(Boolean).slice(0, 40)
            : [];
        state.activeFile = active ? String(active) : null;
        return true;
    });
    handle("listDir", listDir);
    handle("readFile", readEditorFile);
    handle("writeFile", writeEditorFile);
    handle("revealInExplorer", (rel) => shell.showItemInFolder(insideWorkspace(rel)));
    handle("listAllFiles", listAllFiles);
    handle("searchText", searchText);
    handle("createEntry", createEntry);
    handle("renameEntry", renameEntry);
    handle("trashEntry", trashEntry);
    handle("runTerminal", runTerminal);
    handle("terminalCd", terminalCd);
    handle("killTerminal", killTerminal);
    handle("ptyAvailable", ptyAvailable);
    handle("ptyCreate", ptyCreate);
    handle("ptyWrite", ptyWrite);
    handle("ptyResize", ptyResize);
    handle("ptyKill", ptyKill);
    handle("usage", usage);
    handle("autoApprove", setAutoApprove);
    handle("mcpList", (action) => mcpList(String(action || "")));
    handle("mcpOpenConfig", mcpOpenConfig);
    handle("skillsList", skillsList);
    handle("skillsOpenDir", (scope) => skillsOpenDir(String(scope || "")));
    handle("skillsCreate", (name, scope) => skillsCreate(name, String(scope || "")));
    handle("gitStatus", () => require("./git").status(require("../src/state").state.workspace || null));
    handle("gitDiff", (rel, staged) => require("./git").diff(require("../src/state").state.workspace || null, rel, staged === true));
    handle("gitShowHead", (rel) => require("./git").showHead(require("../src/state").state.workspace || null, rel));
    handle("gitLog", (limit) => require("./git").log(require("../src/state").state.workspace || null, limit));
    handle("gitCommit", (message) => require("./git").commit(require("../src/state").state.workspace || null, message));

    // GitHub : le token n'est jamais renvoyé au renderer, et les erreurs sont filtrées par redact().
    const gh = () => require("../src/github");
    const ghWs = () => require("../src/state").state.workspace || null;
    const ghSafe = (fn) => async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            const g = gh();
            throw new Error(g.redact(error && error.message ? error.message : String(error), g.getToken()));
        }
    };
    handle("githubStatus", ghSafe(async () => {
        const g = gh();
        const cwd = ghWs();
        const info = await g.status({ check: true });
        const remote = cwd ? await g.remoteUrl(cwd, "origin") : null;
        return { connected: Boolean(info.connected), source: info.source || null, masked: info.masked || null, login: info.login || null, name: info.name || null, error: info.error || null, remote };
    }));
    handle("githubLoginToken", ghSafe(async (token) => {
        const user = await gh().loginWithToken(String(token || ""));
        return { login: (user && user.login) || null, name: (user && user.name) || null };
    }));
    handle("githubLogout", ghSafe(async () => {
        gh().clearAuth();
        return { ok: true };
    }));
    handle("githubSetRemote", ghSafe((spec) => gh().setRemote(ghWs(), String(spec || ""), "origin")));
    handle("githubCreateRepo", ghSafe((name, isPublic) => gh().createRepo(String(name || ""), { private: !isPublic })));
    handle("githubPush", ghSafe(() => gh().push(ghWs(), {})));
    handle("githubPull", ghSafe(() => gh().pull(ghWs(), {})));
    handle("githubFetch", ghSafe(() => gh().fetchRemote(ghWs(), {})));
    handle("undoList", () => require("../src/tools/core/journal").listUndoEntries());
    handle("undoEntry", async (index, at) => {
        if (busy) throw new Error("Une demande est en cours : attends sa fin avant d'annuler.");
        const message = await require("../src/tools/core/journal").undoEntry(Number(index), at ? String(at) : null);
        pushStatus();
        return message;
    });
    handle("undoDiff", (index, at) => require("../src/tools/core/journal").entryDiff(Number(index), at ? String(at) : null));
    handle("conversationsRecent", async (limit) => {
        const conversations = require("../src/project/conversations");
        const items = await conversations.recent(Math.max(1, Math.min(Number(limit) || 30, 100)));
        return items.map((entry, i) => ({
            number: i + 1,
            id: entry.id,
            title: entry.title || "(sans titre)",
            updatedAt: entry.updatedAt || null,
            model: entry.model || null,
            mode: entry.mode || "chat",
            workspace: entry.workspace || null,
            messages: Array.isArray(entry.messages) ? entry.messages.length : Number(entry.messages) || 0
        }));
    });
    handle("conversationsRename", async (id, title) => {
        const entry = await require("../src/project/conversations").rename(String(id || ""), String(title ?? ""));
        if (!entry) throw new Error("Conversation introuvable.");
        return { id: entry.id, title: entry.title || "(sans titre)" };
    });
    handle("conversationsRemove", async (id) => {
        const removed = await require("../src/project/conversations").remove(String(id || ""));
        if (!removed) throw new Error("Conversation introuvable.");
        return true;
    });
    handle("openExternal", (url) => {
        if (!/^https?:\/\//i.test(String(url))) throw new Error("URL refusée.");
        return shell.openExternal(String(url));
    });
}

function createWindow() {
    win = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: "#1f1f1f",
        title: "FranceStudent Code",
        titleBarStyle: "hidden",
        ...(process.platform === "darwin"
            ? { trafficLightPosition: { x: 12, y: 11 } }
            : { titleBarOverlay: { color: "#181818", symbolColor: "#cccccc", height: 36 } }),
        ...(require("node:fs").existsSync(path.join(__dirname, "icon.png"))
            ? { icon: path.join(__dirname, "icon.png") }
            : {}),
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    win.once("ready-to-show", () => win.show());
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.loadFile(path.join(__dirname, "renderer", "index.html"));
    win.on("closed", () => {
        win = null;
    });
}

function prepareDataPaths() {
    // En version empaquetée, le code est en lecture seule (app.asar) : projects.json
    // et history.json sont alors rangés dans le dossier de données de l'utilisateur.
    if (app.isPackaged && !process.env.FS_STATE_DIR) {
        process.env.FS_STATE_DIR = app.getPath("userData");
    }
    // Ctrl+C n'existe pas ici : le bouton Stop passe par backend.interrupt().
    process.env.FS_FORCE_INTERRUPT = "1";
    // Sur macOS, une app lancée depuis le Finder reçoit un PATH minimal
    // (/usr/bin:/bin:/usr/sbin:/sbin) : node, npm et git de Homebrew seraient introuvables.
    if (process.platform === "darwin") {
        const parts = String(process.env.PATH || "").split(":").filter(Boolean);
        for (const dir of ["/opt/homebrew/bin", "/usr/local/bin"]) {
            if (!parts.includes(dir)) parts.unshift(dir);
        }
        process.env.PATH = parts.join(":");
    }
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });

    app.whenReady().then(() => {
        prepareDataPaths();
        if (process.platform === "darwin") {
            // Sur macOS, sans menu d'application, Cmd+C / Cmd+V / Cmd+Q ne fonctionnent pas.
            Menu.setApplicationMenu(Menu.buildFromTemplate([
                { role: "appMenu" },
                { role: "editMenu" },
                { role: "windowMenu" }
            ]));
            // En mode dev (npm run desktop), le Dock affiche sinon l'icône Electron.
            // L'app empaquetée utilise desktop/icon.icns (build.mac.icon).
            if (!app.isPackaged && app.dock) {
                const dockIcon = path.join(__dirname, "icon.png");
                if (require("node:fs").existsSync(dockIcon)) {
                    try {
                        app.dock.setIcon(dockIcon);
                    } catch {
                        // icône facultative
                    }
                }
            }
        } else {
            Menu.setApplicationMenu(null);
        }

        backend = createDesktopBackend(send);
        setUiBackend(backend);
        session = require("../src/core/session");

        registerIpc();
        createWindow();

        setInterval(pushStatus, 2000).unref();
    });

    app.on("window-all-closed", () => {
        killAllTerminals();
        try {
            require("../src/tools/command/jobs").manager.stopAll?.();
        } catch {
            // ignoré
        }
        app.quit();
    });
}

module.exports = { insideWorkspace };
