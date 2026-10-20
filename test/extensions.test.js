"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { mentions, filterMcpCatalog, filterSkillsCatalog, selectExtensions } = require("../src/agent/extensions");

const MCP = [
    "- server \"rea\", tool \"disasm\" : Désassemble un binaire.",
    "- server \"rea\", tool \"strings\" : Extrait les chaînes.",
    "- server \"fs\", tool \"read\" : Lit un fichier."
].join("\n");

const SKILLS = [
    "- \"pdf\" (utilisateur) : Manipuler des PDF.",
    "- \"git-flow\" (projet) : Conventions Git."
].join("\n");

test("mentions : mot entier, insensible à la casse, @ accepté", () => {
    assert.equal(mentions("utilise le skill PDF", "pdf"), true);
    assert.equal(mentions("analyse avec @rea", "rea"), true);
    assert.equal(mentions("lis le fichier pdfs.txt", "pdf"), false);
    assert.equal(mentions("area", "rea"), false);
    assert.equal(mentions("tâche", ""), false);
});

test("selectExtensions : mode auto garde les catalogues complets", () => {
    const out = selectExtensions({ mode: "auto", task: "corrige le test", mcpCatalog: MCP, skillsCatalog: SKILLS });
    assert.equal(out.mcpCatalog, MCP);
    assert.equal(out.skillsCatalog, SKILLS);
});

test("selectExtensions : mode manual ne garde que ce qui est nommé", () => {
    const none = selectExtensions({ mode: "manual", task: "corrige le test", mcpCatalog: MCP, skillsCatalog: SKILLS });
    assert.equal(none.mcpCatalog, "");
    assert.equal(none.skillsCatalog, "");

    const named = selectExtensions({
        mode: "manual",
        task: "avec @rea et le skill git-flow",
        mcpCatalog: MCP,
        skillsCatalog: SKILLS
    });
    assert.equal(named.mcpCatalog.split("\n").length, 2);
    assert.doesNotMatch(named.mcpCatalog, /"fs"/);
    assert.match(named.skillsCatalog, /git-flow/);
    assert.doesNotMatch(named.skillsCatalog, /"pdf"/);
});

test("filterMcpCatalog : un outil nommé seul suffit", () => {
    assert.match(filterMcpCatalog(MCP, "lance strings sur a.out"), /tool "strings"/);
    assert.equal(filterSkillsCatalog(SKILLS, "rien"), "");
});
