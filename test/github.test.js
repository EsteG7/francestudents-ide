"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.FS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-gh-"));
delete process.env.GITHUB_TOKEN;
delete process.env.GH_TOKEN;

const github = require("../src/github");

const TOKEN = "ghp_" + "a".repeat(36);

function fakeResponse(status, body, headers = {}) {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        text: async () => text,
        json: async () => JSON.parse(text)
    };
}

test("parseGithubRemote : HTTPS, SSH et refus des autres hôtes", () => {
    assert.deepEqual(github.parseGithubRemote("https://github.com/alice/projet.git"), { owner: "alice", repo: "projet", https: true });
    assert.deepEqual(github.parseGithubRemote("git@github.com:alice/projet.git"), { owner: "alice", repo: "projet", https: false });
    assert.equal(github.parseGithubRemote("https://gitlab.com/alice/projet.git"), null);
});

test("maskToken et redact ne laissent pas fuir le token", () => {
    assert.equal(github.maskToken(TOKEN), "ghp_…aaaa");
    const basic = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
    const out = github.redact(`erreur ${TOKEN} et ${basic}`, TOKEN);
    assert.ok(!out.includes(TOKEN));
    assert.ok(!out.includes(basic));
});

test("authEnv passe le token en en-tête HTTP via GIT_CONFIG_*", () => {
    const env = github.authEnv(TOKEN);
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.GIT_CONFIG_KEY_0, "http.https://github.com/.extraheader");
    assert.match(env.GIT_CONFIG_VALUE_0, /^AUTHORIZATION: basic /);
});

test("loginWithToken vérifie, enregistre en 0600 ; status masque ; logout efface", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return fakeResponse(200, { login: "alice", name: "Alice" }, { "x-oauth-scopes": "repo, workflow" });
    };
    await assert.rejects(github.loginWithToken("pas un token", { fetchImpl }), /invalide/);
    const user = await github.loginWithToken(TOKEN, { fetchImpl });
    assert.equal(user.login, "alice");
    assert.deepEqual(user.scopes, ["repo", "workflow"]);
    assert.equal(calls[0].url, "https://api.github.com/user");
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
    if (process.platform !== "win32") assert.equal(fs.statSync(github.file()).mode & 0o777, 0o600);
    assert.equal(github.getToken(), TOKEN);

    const s = await github.status({ fetchImpl });
    assert.equal(s.connected, true);
    assert.equal(s.login, "alice");
    assert.ok(!JSON.stringify(s).includes(TOKEN));

    assert.equal(github.clearAuth(), true);
    assert.equal(github.getToken(), null);
    assert.deepEqual(await github.status({ fetchImpl }), { connected: false });
});

test("verifyToken : 401 donne un message sans le token", async () => {
    const fetchImpl = async () => fakeResponse(401, { message: `Bad credentials ${TOKEN}` });
    await assert.rejects(github.verifyToken(TOKEN, { fetchImpl }), (error) => {
        assert.equal(error.status, 401);
        assert.ok(!error.message.includes(TOKEN));
        assert.match(error.message, /\/github login/);
        return true;
    });
});

test("pollDeviceFlow : attente, ralentissement puis token enregistré", async () => {
    const answers = [{ error: "authorization_pending" }, { error: "slow_down" }, { access_token: TOKEN }];
    const fetchImpl = async (url) => {
        if (url.includes("/login/oauth/access_token")) return fakeResponse(200, answers.shift());
        return fakeResponse(200, { login: "bob" }, { "x-oauth-scopes": "repo" });
    };
    const waits = [];
    const user = await github.pollDeviceFlow(
        { device_code: "dc", interval: 1, expires_in: 60 },
        { clientId: "cid", fetchImpl, sleep: async (ms) => { waits.push(ms); } }
    );
    assert.equal(user.login, "bob");
    assert.deepEqual(waits, [1000, 1000, 6000]);
    assert.equal(github.loadAuth().login, "bob");
    github.clearAuth();
});

test("startDeviceFlow sans client id : message explicite", async () => {
    delete process.env.FS_GITHUB_CLIENT_ID;
    await assert.rejects(github.startDeviceFlow({ fetchImpl: async () => fakeResponse(200, {}) }), /FS_GITHUB_CLIENT_ID/);
});

test("push : token jamais dans argv, en-tête dans l'environnement de git", async () => {
    const calls = [];
    const execFileImpl = (cmd, args, options, cb) => {
        calls.push({ cmd, args, env: options.env });
        if (args[0] === "remote") return cb(null, "https://github.com/alice/projet.git\n", "");
        if (args[0] === "rev-parse") return cb(null, "main\n", "");
        return cb(null, "", `To https://github.com/alice/projet.git ${TOKEN}\n`);
    };
    const res = await github.push(os.tmpdir(), { token: TOKEN, execFileImpl });
    assert.equal(res.branch, "main");
    assert.equal(res.remote, "origin");
    assert.ok(!res.output.includes(TOKEN));
    const pushCall = calls.find((c) => c.args[0] === "push");
    assert.deepEqual(pushCall.args, ["push", "-u", "origin", "main"]);
    assert.ok(calls.every((c) => !c.args.join(" ").includes(TOKEN)));
    assert.match(pushCall.env.GIT_CONFIG_VALUE_0, /^AUTHORIZATION: basic /);
});

test("push sans connexion ni remote : erreurs claires", async () => {
    const noRemote = (cmd, args, options, cb) => cb(new Error("no remote"), "", "error: No such remote");
    await assert.rejects(github.push(os.tmpdir(), { execFileImpl: noRemote }), /Aucun remote/);
    const withRemote = (cmd, args, options, cb) => cb(null, "https://github.com/alice/projet.git\n", "");
    await assert.rejects(github.push(os.tmpdir(), { execFileImpl: withRemote }), /Non connecté/);
    await assert.rejects(github.push(os.tmpdir(), { branch: "--force", token: TOKEN, execFileImpl: withRemote }), /Branche invalide/);
});

test("setRemote accepte owner/repo et refuse les URL non GitHub", async () => {
    const calls = [];
    const execFileImpl = (cmd, args, options, cb) => {
        calls.push(args);
        if (args[1] === "get-url") return cb(new Error("absent"), "", "");
        return cb(null, "", "");
    };
    const r = await github.setRemote(os.tmpdir(), "alice/projet", "origin", { execFileImpl });
    assert.deepEqual(r, { remote: "origin", url: "https://github.com/alice/projet.git", updated: false });
    assert.deepEqual(calls.at(-1), ["remote", "add", "origin", "https://github.com/alice/projet.git"]);
    await assert.rejects(github.setRemote(os.tmpdir(), "https://exemple.com/x.git", "origin", { execFileImpl }), /URL GitHub invalide/);
});
