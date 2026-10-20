"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

// Le dossier de données doit être fixé AVANT de charger la configuration.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-data-auto-"));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "fs-ws-auto-"));
const previousDataDir = process.env.FS_DATA_DIR;
process.env.FS_DATA_DIR = dataDir;

const { setUiBackend, getUiBackend } = require("../src/ui-bridge");
const { state } = require("../src/state");
const settings = require("../src/settings");
const memory = require("../src/project/memory");
const { runCommand } = require("../src/tools/command/index");

const saved = {
    workspace: state.workspace,
    autoApprove: state.autoApprove,
    autoApproveCommands: state.autoApproveCommands
};

let answers = [];
let questions = 0;
let infos = [];

test.before(async () => {
    fs.writeFileSync(path.join(workspace, "script.js"), "console.log('ok');\n");
    state.workspace = workspace;
    state.autoApprove = false;
    state.autoApproveCommands = false;
    await memory.open(workspace);
    const cli = getUiBackend();
    setUiBackend({
        ...cli,
        askCommand: async () => {
            questions += 1;
            return answers.shift() ?? "n";
        },
        info(message) {
            infos.push(String(message));
        },
        warn() {},
        commandLine() {},
        onInterrupt: () => () => {}
    });
});

test.after(() => {
    setUiBackend(null);
    state.workspace = saved.workspace;
    state.autoApprove = saved.autoApprove;
    state.autoApproveCommands = saved.autoApproveCommands;
    if (previousDataDir === undefined) delete process.env.FS_DATA_DIR;
    else process.env.FS_DATA_DIR = previousDataDir;
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test("réglage par défaut : auto-approbation des commandes désactivée", () => {
    assert.equal(settings.DEFAULTS.autoApproveCommandsAlways, false);
    assert.equal(settings.autoApproveCommandsAlways(), false);
    assert.equal(state.autoApproveCommands, false);
});

test("sans le mode : une commande non sûre pose la question", async () => {
    state.autoApproveCommands = false;
    questions = 0;
    answers = ["n"];
    const result = await runCommand({ command: "node script.js" });
    assert.equal(questions, 1);
    assert.equal(result.denied, true);
});

test("avec le mode : la commande est lancée sans question et signalée", async () => {
    state.autoApproveCommands = true;
    questions = 0;
    infos = [];
    try {
        const result = await runCommand({ command: "node script.js" });
        assert.equal(questions, 0);
        assert.equal(result.exit_code, 0);
        assert.ok(infos.some((line) => line.includes("auto-approuvée")), "la commande doit être signalée");
    } finally {
        state.autoApproveCommands = false;
    }
});

test("avec le mode : une commande interdite reste bloquée", async () => {
    state.autoApproveCommands = true;
    questions = 0;
    try {
        const rm = await runCommand({ command: "rm x" });
        assert.equal(rm.denied, true);
        const push = await runCommand({ command: "git push" });
        assert.equal(push.denied, true);
        assert.equal(questions, 0);
    } finally {
        state.autoApproveCommands = false;
    }
});

test("réglage permanent : enregistré puis retiré, sans toucher aux écritures", () => {
    settings.setAutoApproveCommandsAlways(true);
    assert.equal(settings.autoApproveCommandsAlways(), true);
    assert.equal(settings.autoApproveAlways(), false);
    const raw = JSON.parse(fs.readFileSync(settings.file(), "utf8"));
    assert.equal(raw.autoApproveCommandsAlways, true);

    settings.setAutoApproveCommandsAlways(false);
    assert.equal(settings.autoApproveCommandsAlways(), false);
});
