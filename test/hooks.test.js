"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const hooks = require("../src/agent/hooks");

const isWin = process.platform === "win32";

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "frst-hooks-"));
}

function fakeUi(answer = true) {
    const log = { confirms: 0, warns: [] };
    return {
        log,
        info() {},
        warn(message) { log.warns.push(message); },
        async confirm() { log.confirms++; return answer; }
    };
}

test("parseHooksConfig : format avec et sans clé hooks", () => {
    const a = hooks.parseHooksConfig({ hooks: { postToolUse: [{ match: "edit_file|write_file", command: "echo ok" }] } });
    assert.equal(a.postToolUse.length, 1);
    assert.equal(a.preToolUse.length, 0);
    assert.equal(a.postToolUse[0].timeout, 60);

    const b = hooks.parseHooksConfig('{"preToolUse":[{"command":"true","timeout":5}]}');
    assert.equal(b.preToolUse[0].matcher, null);
    assert.equal(b.preToolUse[0].timeout, 5);
});

test("parseHooksConfig : erreurs de format", () => {
    assert.throws(() => hooks.parseHooksConfig({ preToolUse: {} }), /doit être une liste/);
    assert.throws(() => hooks.parseHooksConfig({ preToolUse: [{}] }), /command/);
    assert.throws(() => hooks.parseHooksConfig({ preToolUse: [{ command: "x", match: "(" }] }), /match invalide/);
});

test("matchingHooks : expression ancrée sur le nom de l'outil", () => {
    const config = hooks.parseHooksConfig({ postToolUse: [{ match: "edit_file|write_file", command: "x" }, { command: "y" }] });
    assert.equal(hooks.matchingHooks(config, "postToolUse", "edit_file").length, 2);
    assert.equal(hooks.matchingHooks(config, "postToolUse", "edit_file_extra").length, 1);
    assert.equal(hooks.matchingHooks(config, "postToolUse", "read_file").length, 1);
});

test("expandCommand : {path} et {tool} échappés", () => {
    const cmd = hooks.expandCommand("fmt {path} --tool {tool}", { tool: "edit_file", file: "/a/b c'd.js" }, "linux");
    assert.equal(cmd, "fmt '/a/b c'\\''d.js' --tool 'edit_file'");
    assert.equal(hooks.shellQuote('a"b', "win32"), '"a""b"');
});

test("runPreToolHooks : code non nul bloque l'outil", { skip: isWin }, async () => {
    const config = hooks.parseHooksConfig({ preToolUse: [{ match: "run_command", command: "echo interdit; exit 3" }] });
    const blocked = await hooks.runPreToolHooks(config, { tool: "run_command", args: {}, workspace: tmpDir() });
    assert.equal(blocked.blocked, true);
    assert.match(blocked.message, /code 3/);
    assert.match(blocked.message, /interdit/);

    const free = await hooks.runPreToolHooks(config, { tool: "read_file", args: {}, workspace: tmpDir() });
    assert.equal(free.blocked, false);
});

test("runPostToolHooks : sortie jointe et variables d'environnement", { skip: isWin }, async () => {
    const dir = tmpDir();
    const config = hooks.parseHooksConfig({ postToolUse: [{ command: "echo $FRST_TOOL $(basename \"$FRST_FILE\")" }] });
    const reports = await hooks.runPostToolHooks(config, { tool: "edit_file", args: { path: "src/a.js" }, workspace: dir });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].code, 0);
    assert.equal(reports[0].output, "edit_file a.js");
});

test("runHookCommand : délai dépassé → code 124", { skip: isWin }, async () => {
    const [hook] = hooks.parseHooksConfig({ preToolUse: [{ command: "sleep 5", timeout: 0.2 }] }).preToolUse;
    const res = await hooks.runHookCommand(hook, { event: "preToolUse", tool: "x", args: {}, workspace: tmpDir() });
    assert.equal(res.timedOut, true);
    assert.equal(res.code, 124);
});

test("loadHooks : hooks utilisateur actifs, hooks projet après confirmation", async () => {
    hooks.resetTrust();
    const dataDir = tmpDir();
    const workspace = tmpDir();
    fs.writeFileSync(path.join(dataDir, "hooks.json"), JSON.stringify({ hooks: { preToolUse: [{ command: "u" }] } }));
    fs.mkdirSync(path.join(workspace, ".frst"));
    fs.writeFileSync(path.join(workspace, ".frst", "hooks.json"), JSON.stringify({ hooks: { postToolUse: [{ command: "p" }] } }));

    const refused = await hooks.loadHooks({ workspace, dataDir, ui: fakeUi(false) });
    assert.equal(refused.preToolUse.length, 1);
    assert.equal(refused.postToolUse.length, 0);

    const ui = fakeUi(true);
    const accepted = await hooks.loadHooks({ workspace, dataDir, ui });
    assert.equal(accepted.postToolUse.length, 1);
    await hooks.loadHooks({ workspace, dataDir, ui });
    assert.equal(ui.log.confirms, 1);
    hooks.resetTrust();
});

test("loadHooks : fichier invalide ignoré avec avertissement", async () => {
    const dataDir = tmpDir();
    fs.writeFileSync(path.join(dataDir, "hooks.json"), "{pas du json");
    const ui = fakeUi();
    const config = await hooks.loadHooks({ workspace: null, dataDir, ui });
    assert.equal(hooks.hasHooks(config), false);
    assert.equal(ui.log.warns.length, 1);
});
