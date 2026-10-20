"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const git = require("../desktop/git");

let hasGit = true;
try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
    hasGit = false;
}

test("git.parseStatus : branche, avance, retard et fichiers", () => {
    const raw = [
        "## main...origin/main [ahead 2, behind 1]",
        " M src/a.js",
        "A  src/b.js",
        "R  new.js",
        "old.js",
        "?? notes.txt",
        ""
    ].join("\0");
    const s = git.parseStatus(raw);
    assert.equal(s.branch, "main");
    assert.equal(s.ahead, 2);
    assert.equal(s.behind, 1);
    assert.equal(s.files.length, 4);
    assert.deepEqual(s.files.map((f) => [f.path, f.label, f.staged]), [
        ["src/a.js", "modifié", false],
        ["src/b.js", "ajouté", true],
        ["new.js", "renommé", true],
        ["notes.txt", "non suivi", false]
    ]);
    assert.equal(s.files[2].from, "old.js");
});

test("git.parseStatus : dépôt sans commit", () => {
    const s = git.parseStatus("## No commits yet on main\0?? a.txt\0");
    assert.equal(s.branch, "main");
    assert.equal(s.files.length, 1);
});

test("git.parseLog : champs séparés", () => {
    const raw = "abc\x1fab\x1fAlice\x1f2026-01-01T00:00:00+00:00\x1fPremier\x1e\n";
    assert.deepEqual(git.parseLog(raw), [{ hash: "abc", short: "ab", author: "Alice", date: "2026-01-01T00:00:00+00:00", subject: "Premier" }]);
});

test("git.diff refuse un chemin qui ressemble à une option", async () => {
    await assert.rejects(git.diff(os.tmpdir(), "--output=/tmp/x"), /Chemin refusé/);
});

test("git : statut, diff, HEAD et journal sur un vrai dépôt", { skip: !hasGit && "git indisponible" }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-git-"));
    const run = (...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "pipe" });
    run("init", "-q");
    fs.writeFileSync(path.join(dir, "a.txt"), "un\n");
    run("add", "a.txt");
    run("commit", "-q", "-m", "Premier commit");
    fs.writeFileSync(path.join(dir, "a.txt"), "un\ndeux\n");
    fs.writeFileSync(path.join(dir, "b.txt"), "neuf\n");

    const s = await git.status(dir);
    assert.equal(s.repo, true);
    assert.deepEqual(s.files.map((f) => [f.path, f.label]).sort(), [["a.txt", "modifié"], ["b.txt", "non suivi"]]);
    assert.match(await git.diff(dir, "a.txt"), /^\+deux$/m);
    assert.equal((await git.showHead(dir, "a.txt")).replace(/\r\n/g, "\n"), "un\n");
    assert.equal(await git.showHead(dir, "b.txt"), "");
    const commits = await git.log(dir, 5);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].subject, "Premier commit");

    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-nogit-"));
    assert.equal((await git.status(plain)).repo, false);
    assert.deepEqual(await git.log(plain), []);
});

test("git.commit : add -A puis commit, refus si message vide ou rien à valider", { skip: !hasGit && "git indisponible" }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-commit-"));
    const run = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    run("init", "-q");
    run("config", "user.name", "Test");
    run("config", "user.email", "t@example.com");
    run("config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(dir, "a.txt"), "un\n");
    fs.writeFileSync(path.join(dir, "b.txt"), "deux\n");

    await assert.rejects(git.commit(dir, "   "), /Message de commit vide/);
    await assert.rejects(git.commit(null, "x"), /Aucun projet ouvert/);

    const r = await git.commit(dir, "Premier commit");
    assert.equal(r.files, 2);
    const s = await git.status(dir);
    assert.equal(s.files.length, 0);
    const commits = await git.log(dir, 5);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].subject, "Premier commit");

    await assert.rejects(git.commit(dir, "Encore"), /Rien à valider/);

    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-nogit-"));
    await assert.rejects(git.commit(plain, "x"), /pas un dépôt Git/);
});
