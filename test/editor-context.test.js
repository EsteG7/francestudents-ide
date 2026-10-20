"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Le registre des projets est lu depuis FS_STATE_DIR : dossier temporaire isolé.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-editor-ctx-"));
process.env.FS_STATE_DIR = dataDir;

const { buildAgentPrompt } = require("../src/agent/prompt");
const projects = require("../src/project/projects");

test.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test("le prompt agent décrit les fichiers ouverts dans l'éditeur", () => {
    const prompt = buildAgentPrompt({
        workspace: "C:/projet",
        env: {},
        task: "modifie ce fichier",
        history: [],
        memorySummary: "aucune note",
        projectContext: "",
        observations: [],
        turn: 1,
        maxTurns: 10,
        activeFile: "src/app.js",
        editorFiles: ["src/app.js", "README.md"]
    });

    assert.match(prompt, /ÉDITEUR DE L'UTILISATEUR/);
    assert.match(prompt, /Fichier affiché à l'écran : src\/app\.js/);
    assert.match(prompt, /Autres onglets ouverts : README\.md/);
    assert.match(prompt, /« ce fichier »/);
});

test("sans fichier ouvert, le prompt ne contient pas la section éditeur", () => {
    const prompt = buildAgentPrompt({
        workspace: "C:/projet",
        env: {},
        task: "bonjour",
        history: [],
        memorySummary: "",
        projectContext: "",
        observations: [],
        turn: 1,
        maxTurns: 10
    });

    assert.ok(!prompt.includes("ÉDITEUR DE L'UTILISATEUR"));
});

test("projects.last renvoie le projet le plus récemment ouvert", async () => {
    fs.writeFileSync(
        path.join(dataDir, "projects.json"),
        JSON.stringify({
            "c:/ancien": { path: "C:/ancien", lastOpenedAt: "2026-01-01T00:00:00.000Z" },
            "c:/recent": { path: "C:/recent", lastOpenedAt: "2026-06-01T00:00:00.000Z" }
        }),
        "utf8"
    );

    const last = await projects.last();
    assert.equal(last.path, "C:/recent");
});

test("projects.last renvoie null sans projet enregistré", async () => {
    fs.rmSync(path.join(dataDir, "projects.json"), { force: true });

    // Le module met le registre en cache : on repart d'une instance neuve.
    delete require.cache[require.resolve("../src/project/projects")];
    const fresh = require("../src/project/projects");

    assert.equal(await fresh.last(), null);
});
