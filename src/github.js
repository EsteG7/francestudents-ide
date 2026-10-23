"use strict";

/**
 * Connexion à un compte GitHub (CLI et application de bureau).
 *
 * - Authentification : token personnel (PAT, scope "repo") ou Device Flow OAuth
 *   si FS_GITHUB_CLIENT_ID est défini (OAuth App avec Device Flow activé).
 * - Le token est stocké dans CONFIG.dataDir/github.json (mode 0o600, écriture
 *   atomique). Il n'est jamais affiché ni passé en argument de commande :
 *   git le reçoit par variables d'environnement (GIT_CONFIG_*), en en-tête HTTP.
 * - Repli : variables GITHUB_TOKEN / GH_TOKEN si aucun token n'est enregistré.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { CONFIG } = require("./config");

const API = "https://api.github.com";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const FILE_NAME = "github.json";
const SCOPES = "repo";
const MAX_BUFFER = 8 * 1024 * 1024;

/* ---------- Stockage du token ---------- */

function file() {
    return path.join(CONFIG.dataDir, FILE_NAME);
}

function loadAuth() {
    try {
        const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
        if (raw && typeof raw.token === "string" && raw.token) return raw;
    } catch {
        // absent ou illisible
    }
    return null;
}

function saveAuth(auth) {
    const target = file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, target);
    try {
        fs.chmodSync(target, 0o600);
    } catch {
        // Windows : sans effet
    }
    return auth;
}

function clearAuth() {
    try {
        fs.unlinkSync(file());
        return true;
    } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
}

/** Token à utiliser : enregistré, sinon GITHUB_TOKEN / GH_TOKEN. */
function getToken() {
    const saved = loadAuth();
    if (saved) return saved.token;
    return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

function maskToken(token) {
    const t = String(token || "");
    if (t.length <= 8) return "****";
    return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function basicHeader(token) {
    return Buffer.from(`x-access-token:${token}`).toString("base64");
}

/** Retire le token (brut ou encodé) d'un texte avant affichage. */
function redact(text, token) {
    let out = String(text ?? "");
    if (token) {
        out = out.split(token).join("****");
        out = out.split(basicHeader(token)).join("****");
    }
    return out;
}

/* ---------- API REST ---------- */

function apiHeaders(token) {
    const h = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "francestudent-cli"
    };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
}

async function request(method, url, { token, body, fetchImpl, signal = require("./tools/action-control").signal() } = {}) {
    const f = fetchImpl || globalThis.fetch;
    const headers = apiHeaders(token);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await f(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: signal || AbortSignal.timeout(30000), redirect: "error" });
    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    if (!res.ok) {
        const detail = data && typeof data === "object" && data.message ? data.message : `HTTP ${res.status}`;
        const hint = res.status === 401 ? " Token invalide ou expiré : /github login." : "";
        const error = new Error(redact(`GitHub : ${detail} (HTTP ${res.status}).${hint}`, token));
        error.status = res.status;
        throw error;
    }
    return { data, headers: res.headers };
}

/** Vérifie un token : { login, name, scopes }. */
async function verifyToken(token, { fetchImpl } = {}) {
    if (!token) throw new Error("Token GitHub manquant.");
    const { data, headers } = await request("GET", `${API}/user`, { token, fetchImpl });
    const rawScopes = headers && typeof headers.get === "function" ? headers.get("x-oauth-scopes") : "";
    return {
        login: data && data.login,
        name: (data && data.name) || null,
        scopes: String(rawScopes || "").split(",").map((s) => s.trim()).filter(Boolean)
    };
}

function storeToken(token, user) {
    saveAuth({ token, login: user.login, name: user.name, scopes: user.scopes, savedAt: new Date().toISOString() });
    return user;
}

/** Enregistre un token personnel après vérification. */
async function loginWithToken(token, { fetchImpl } = {}) {
    const clean = String(token || "").trim();
    if (!/^[A-Za-z0-9_]{20,255}$/.test(clean)) {
        throw new Error("Token GitHub invalide (attendu : ghp_…, github_pat_… ou gho_…).");
    }
    return storeToken(clean, await verifyToken(clean, { fetchImpl }));
}

/** État de la connexion (ne renvoie jamais le token). */
async function status({ fetchImpl, check = true } = {}) {
    const saved = loadAuth();
    const token = getToken();
    if (!token) return { connected: false };
    const source = saved ? "enregistré" : "variable d'environnement";
    if (!check) return { connected: true, source, login: (saved && saved.login) || null, masked: maskToken(token) };
    try {
        const user = await verifyToken(token, { fetchImpl });
        return { connected: true, source, masked: maskToken(token), ...user };
    } catch (error) {
        return { connected: false, source, masked: maskToken(token), error: error.message };
    }
}

/* ---------- Device Flow OAuth ---------- */

async function postForm(url, params, fetchImpl) {
    const f = fetchImpl || globalThis.fetch;
    const res = await f(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "francestudent-cli" },
        body: new URLSearchParams(params).toString()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`GitHub : ${data.error_description || data.error || `HTTP ${res.status}`}.`);
    return data;
}

function deviceClientId(clientId) {
    const id = clientId || process.env.FS_GITHUB_CLIENT_ID;
    if (!id) {
        throw new Error("Device Flow indisponible : définis FS_GITHUB_CLIENT_ID (OAuth App GitHub avec Device Flow activé) ou utilise /github token <PAT>.");
    }
    return id;
}

/** Démarre le Device Flow : { device_code, user_code, verification_uri, interval, expires_in }. */
async function startDeviceFlow({ clientId, fetchImpl } = {}) {
    const data = await postForm(DEVICE_CODE_URL, { client_id: deviceClientId(clientId), scope: SCOPES }, fetchImpl);
    if (!data.device_code || !data.user_code) throw new Error("GitHub : réponse Device Flow inattendue.");
    return data;
}

/** Attend la validation dans le navigateur, puis enregistre le token. */
async function pollDeviceFlow(flow, { clientId, fetchImpl, sleep, now = Date.now } = {}) {
    const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const id = deviceClientId(clientId);
    let interval = Math.max(1, Number(flow.interval) || 5);
    const deadline = now() + (Number(flow.expires_in) || 900) * 1000;
    while (now() < deadline) {
        await wait(interval * 1000);
        const data = await postForm(ACCESS_TOKEN_URL, {
            client_id: id,
            device_code: flow.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        }, fetchImpl);
        if (data.access_token) return storeToken(data.access_token, await verifyToken(data.access_token, { fetchImpl }));
        if (data.error === "authorization_pending") continue;
        if (data.error === "slow_down") {
            interval += 5;
            continue;
        }
        throw new Error(`GitHub : ${data.error_description || data.error || "autorisation refusée"}.`);
    }
    throw new Error("GitHub : code expiré, relance /github login.");
}

/* ---------- Dépôts ---------- */

/** Crée un dépôt sur le compte connecté : { full_name, html_url, clone_url, private }. */
async function createRepo(name, { private: isPrivate = true, description = "", token, fetchImpl } = {}) {
    const repoName = String(name || "").trim();
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(repoName)) throw new Error("Nom de dépôt invalide.");
    const t = token || getToken();
    if (!t) throw new Error("Non connecté à GitHub : /github login.");
    const { data } = await request("POST", `${API}/user/repos`, {
        token: t,
        fetchImpl,
        body: { name: repoName, private: isPrivate !== false, description: String(description || "") }
    });
    return { full_name: data.full_name, html_url: data.html_url, clone_url: data.clone_url, private: data.private };
}

/* ---------- Git authentifié ---------- */

/** { owner, repo, https } pour une URL GitHub (HTTPS ou SSH), sinon null. */
function parseGithubRemote(url) {
    const value = String(url || "").trim();
    const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(value);
    if (!m) return null;
    return { owner: m[1], repo: m[2], https: /^https:/i.test(value) };
}

/** Environnement de git : le token passe en en-tête HTTP, jamais dans argv. */
function authEnv(token) {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    if (token) {
        env.GIT_CONFIG_COUNT = "1";
        env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
        env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basicHeader(token)}`;
    }
    return env;
}

function runGit(cwd, args, { token, execFileImpl, signal = require("./tools/action-control").signal() } = {}) {
    if (!cwd) return Promise.reject(new Error("Aucun projet ouvert."));
    const run = execFileImpl || execFile;
    return new Promise((resolve, reject) => {
        run("git", args, { cwd, env: authEnv(token), maxBuffer: MAX_BUFFER, windowsHide: true, encoding: "utf8", signal, timeout: 120000 }, (error, stdout, stderr) => {
            const output = redact(`${stdout || ""}${stderr || ""}`.trim(), token);
            if (error) {
                reject(new Error(output || redact(error.message, token) || "git a échoué."));
                return;
            }
            resolve(output);
        });
    });
}

function checkName(value, label) {
    const v = String(value || "");
    if (!v || v.startsWith("-") || !/^[A-Za-z0-9._/-]+$/.test(v)) throw new Error(`${label} invalide.`);
    return v;
}

async function remoteUrl(cwd, remote = "origin", opts = {}) {
    const name = checkName(remote, "Remote");
    try {
        return (await runGit(cwd, ["remote", "get-url", name], opts)).trim() || null;
    } catch {
        return null;
    }
}

/** Ajoute ou met à jour un remote GitHub. Accepte aussi « owner/repo ». */
async function setRemote(cwd, url, remote = "origin", opts = {}) {
    let value = String(url || "").trim();
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) value = `https://github.com/${value}.git`;
    if (!parseGithubRemote(value)) throw new Error("URL GitHub invalide (ex. https://github.com/owner/repo.git ou owner/repo).");
    const name = checkName(remote, "Remote");
    const existing = await remoteUrl(cwd, name, opts);
    await runGit(cwd, existing ? ["remote", "set-url", name, value] : ["remote", "add", name, value], opts);
    return { remote: name, url: value, updated: Boolean(existing) };
}

async function currentBranch(cwd, opts = {}) {
    const name = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], opts)).trim();
    if (!name || name === "HEAD") throw new Error("HEAD détachée : précise la branche.");
    return name;
}

/** Vérifie le remote et choisit le token (aucun pour un remote SSH ou non GitHub). */
async function networkContext(cwd, remote, opts) {
    const name = checkName(remote || "origin", "Remote");
    const url = await remoteUrl(cwd, name, opts);
    if (!url) throw new Error(`Aucun remote « ${name} » : /github remote owner/repo.`);
    const gh = parseGithubRemote(url);
    if (!gh || !gh.https) return { name, token: null };
    const token = opts.token || getToken();
    if (!token) throw new Error("Non connecté à GitHub : /github login.");
    return { name, token };
}

/** git push [-u] <remote> <branche>, authentifié avec le token GitHub. */
async function push(cwd, { remote = "origin", branch, setUpstream = true, ...opts } = {}) {
    const ctx = await networkContext(cwd, remote, opts);
    const b = checkName(branch || await currentBranch(cwd, opts), "Branche");
    const args = ["push"];
    if (setUpstream) args.push("-u");
    args.push(ctx.name, b);
    const output = await runGit(cwd, args, { ...opts, token: ctx.token });
    return { remote: ctx.name, branch: b, output };
}

/** git pull --ff-only <remote> <branche>. */
async function pull(cwd, { remote = "origin", branch, ...opts } = {}) {
    const ctx = await networkContext(cwd, remote, opts);
    const b = checkName(branch || await currentBranch(cwd, opts), "Branche");
    const output = await runGit(cwd, ["pull", "--ff-only", ctx.name, b], { ...opts, token: ctx.token });
    return { remote: ctx.name, branch: b, output };
}

/** git fetch --prune <remote>. */
async function fetchRemote(cwd, { remote = "origin", ...opts } = {}) {
    const ctx = await networkContext(cwd, remote, opts);
    const output = await runGit(cwd, ["fetch", "--prune", ctx.name], { ...opts, token: ctx.token });
    return { remote: ctx.name, output };
}

module.exports = {
    API,
    FILE_NAME,
    SCOPES,
    file,
    loadAuth,
    saveAuth,
    clearAuth,
    getToken,
    maskToken,
    redact,
    authEnv,
    verifyToken,
    loginWithToken,
    status,
    startDeviceFlow,
    pollDeviceFlow,
    createRepo,
    parseGithubRemote,
    request,
    runGit,
    remoteUrl,
    setRemote,
    currentBranch,
    push,
    pull,
    fetchRemote
};
