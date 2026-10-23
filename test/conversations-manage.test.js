"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Historique isolé dans un dossier temporaire : ne touche jamais au vrai history.json.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-conv-manage-"));
process.env.FS_STATE_DIR = dataDir;
fs.writeFileSync(path.join(dataDir,"history.json"),JSON.stringify([{id:"legacy-manual",title:"Mon titre avant la mise à jour",mode:"agent"}]));

const conversations = require("../src/project/conversations");
const projects = require("../src/project/projects");

test.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

function readSaved() {
    const file = path.join(projects.STATE_DIR, "history.json");
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("rename change le titre, ignore un titre vide et renvoie null si inconnu", async () => {
    await conversations.touch({ id: "conv-a", firstMessage: "premier message", model: "m", workspace: null });

    const renamed = await conversations.rename("conv-a", "  Nouveau    titre  ");
    assert.equal(renamed.title, "Nouveau titre");

    const unchanged = await conversations.rename("conv-a", "   ");
    assert.equal(unchanged.title, "Nouveau titre");

    assert.equal(await conversations.rename("inconnue", "x"), null);

    const long = await conversations.rename("conv-a", "a".repeat(200));
    assert.ok(long.title.endsWith("..."));
    assert.ok(long.title.length < 200);

    const saved = readSaved().find((e) => e.id === "conv-a");
    assert.equal(saved.title, long.title);
});

test("remove retire la conversation et renvoie false si elle n'existe pas", async () => {
    await conversations.touch({ id: "conv-b", firstMessage: "deuxième", model: "m", workspace: null });
    await conversations.touch({ id: "conv-c", firstMessage: "troisième", model: "m", workspace: null });

    assert.equal(await conversations.remove("conv-b"), true);
    const ids = (await conversations.recent(50)).map((e) => e.id);
    assert.ok(!ids.includes("conv-b"));
    assert.ok(ids.includes("conv-c"));

    assert.equal(await conversations.remove("conv-b"), false);
    assert.ok(!readSaved().some((e) => e.id === "conv-b"));
});

test("AI titles are stored once and never overwrite a manual title",async()=>{
    await conversations.rename("legacy-manual","Proposition de l’IA","ai");
    assert.equal((await conversations.find("legacy-manual")).title,"Mon titre avant la mise à jour");
    await conversations.touch({id:"ai-title",firstMessage:"Fait une animation du site Apple.com pour la sortie de l’iPhone DUO",model:"m"});
    await conversations.rename("ai-title","Lancement animé de l’iPhone DUO","ai");
    assert.equal((await conversations.find("ai-title")).title,"Lancement animé de l’iPhone DUO");
    await conversations.rename("ai-title","Autre proposition","ai");
    assert.equal((await conversations.find("ai-title")).title,"Lancement animé de l’iPhone DUO");
    await conversations.rename("ai-title","Mon titre personnel");
    await conversations.rename("ai-title","Titre automatique","ai");
    assert.equal(readSaved().find(entry=>entry.id==="ai-title").title,"Mon titre personnel");
});
