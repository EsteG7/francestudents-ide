"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const wt = require("../src/agent/worktrees");

const WS = path.join(path.sep, "tmp", "proj");

function fakeChild() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    child.stdin = { written: null, on() {}, end(text) { child.stdin.written = text; } };
    child.killed = false;
    child.kill = () => { child.killed = true; child.emit("close", null); };
    return child;
}

test("checkName et chemins : refuse les noms dangereux", () => {
    assert.equal(wt.checkName("fix-login"), "fix-login");
    assert.throws(() => wt.checkName("../x"));
    assert.throws(() => wt.checkName("-rf"));
    assert.throws(() => wt.checkName("a/b"));
    assert.equal(wt.worktreePath(WS, "a"), path.join(path.sep, "tmp", "proj.frst-worktrees", "a"));
    assert.equal(wt.branchName("a"), "frst/a");
});

test("parseWorktreeList : lit la sortie porcelain", () => {
    const list = wt.parseWorktreeList([
        "worktree /tmp/proj", "HEAD abc", "branch refs/heads/main", "",
        "worktree /tmp/proj.frst-worktrees/a", "HEAD def", "detached", "locked", ""
    ].join("\n"));
    assert.equal(list.length, 2);
    assert.equal(list[0].branch, "main");
    assert.equal(list[1].detached, true);
    assert.equal(list[1].locked, true);
});

test("createWorktree : git worktree add sur une branche frst/<nom>", async () => {
    const calls = [];
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "frst-wt-"));
    const runGit = async (cwd, args) => { calls.push({ cwd, args }); return ""; };
    try {
        const res = await wt.createWorktree(ws, "feat", { base: "main" }, { runGit });
        assert.equal(res.branch, "frst/feat");
        assert.deepEqual(calls[0].args, ["worktree", "add", "-b", "frst/feat", wt.worktreePath(ws, "feat"), "main"]);
        await assert.rejects(wt.createWorktree(ws, "x", { base: "--evil" }, { runGit }), /Base invalide/);
    } finally {
        fs.rmSync(wt.worktreeRoot(ws), { recursive: true, force: true });
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("startAgent : processus frst -p, demande sur stdin, état final", () => {
    const child = fakeChild();
    let spawned = null;
    const updates = [];
    const deps = {
        exists: () => true,
        bin: "frst.js",
        execPath: "node",
        spawn: (cmd, args, opts) => { spawned = { cmd, args, opts }; return child; }
    };
    const started = wt.startAgent(WS, "job1", "corrige le bug", { yes: true, onUpdate: a => updates.push(a.status) }, deps);
    assert.equal(started.status, "running");
    assert.deepEqual(spawned.args, ["frst.js", "-p", "--cwd", wt.worktreePath(WS, "job1"), "--yes"]);
    assert.equal(spawned.opts.env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(child.stdin.written, "corrige le bug");
    assert.throws(() => wt.startAgent(WS, "job1", "encore", {}, deps), /tourne déjà/);

    child.stdout.emit("data", "Réponse finale");
    child.stderr.emit("data", "lecture de src/a.js");
    child.emit("close", 0);

    const agent = wt.getAgent(WS, "job1");
    assert.equal(agent.status, "done");
    assert.equal(agent.exitCode, 0);
    assert.equal(agent.answer, "Réponse finale");
    assert.match(agent.log, /src\/a\.js/);
    assert.equal(updates.at(-1), "done");
    assert.ok(wt.listAgents(WS).some(a => a.name === "job1"));
});

test("stopAgent et removeWorktree : arrêt puis suppression, branche conservée", async () => {
    const child = fakeChild();
    const deps = { exists: () => true, bin: "frst.js", execPath: "node", spawn: () => child };
    wt.startAgent(WS, "job2", "tâche", {}, deps);
    const calls = [];
    const runGit = async (cwd, args) => { calls.push(args); return ""; };
    await assert.rejects(wt.removeWorktree(WS, "job2", {}, { runGit }), /Arrête d'abord/);
    assert.equal(wt.stopAgent(WS, "job2").status, "stopped");
    assert.equal(child.killed, true);
    assert.equal(wt.getAgent(WS, "job2").status, "stopped");
    const res = await wt.removeWorktree(WS, "job2", { force: true }, { runGit });
    assert.equal(res.branchKept, true);
    assert.deepEqual(calls[0], ["worktree", "remove", "--force", wt.worktreePath(WS, "job2")]);
    assert.equal(wt.getAgent(WS, "job2"), null);
});

test("startAgent : demande vide ou worktree absent refusés", () => {
    assert.throws(() => wt.startAgent(WS, "zz", "  ", {}, { exists: () => true }), /Demande vide/);
    assert.throws(() => wt.startAgent(WS, "zz", "x", {}, { exists: () => false }), /introuvable/);
});
