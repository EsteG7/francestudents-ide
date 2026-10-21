"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { inlineEdit, buildEditPrompt, cleanEdit } = require("../src/agent/inline-edit");
const { applyTextEdits, simplifyWorkspaceEdit, simplifySignature, simplifyLocation } = require("../desktop/lsp");

test("symboles LSP : hiérarchie, positions et libellés",()=>{
    const {simplifyDocumentSymbols}=require("../desktop/lsp");
    const symbols=simplifyDocumentSymbols([{name:"Service",kind:5,range:{start:{line:0,character:0}},children:[{name:"run",kind:6,selectionRange:{start:{line:2,character:4}}}]}]);
    assert.deepEqual(symbols.map(item=>[item.name,item.kind,item.line,item.depth]),[["Service","classe",0,0],["run","méthode",2,1]]);
});

test("buildEditPrompt : sélection balisée, consigne et contenu traité comme donnée", () => {
    const prompt = buildEditPrompt({
        path: "a.js",
        language: "js",
        instruction: "renomme x en y",
        selection: "const x = 1;",
        prefix: "// avant\n",
        suffix: "\n// après"
    });
    assert.match(prompt, /CONTEXTE D'EXÉCUTION/);
    assert.match(prompt, /<SELECTION>const x = 1;<\/SELECTION>/);
    assert.match(prompt, /DONNÉE/);
    assert.match(prompt, /renomme x en y$/);
});

test("cleanEdit : retire clôtures Markdown et balises, garde la fin de ligne de la sélection", () => {
    assert.equal(cleanEdit("```js\nconst y = 1;\n```", "const x = 1;\n"), "const y = 1;\n");
    assert.equal(cleanEdit("<SELECTION>a</SELECTION>", "b"), "a");
    assert.equal(cleanEdit("\n\nz\n\n", "w"), "z");
});

test("inlineEdit : appelle le modèle en conversation neuve et nettoie la réponse", async () => {
    const calls = [];
    const api = {
        requestModel: async (prompt, options) => {
            calls.push({ prompt, options });
            return "```\nconst y = 2;\n```";
        }
    };
    const result = await inlineEdit({ path: "a.js", instruction: "change", selection: "const x = 1;" }, { api });
    assert.equal(result, "const y = 2;");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].options, { conversationMode: "chat", fresh: true });
});

test("inlineEdit : consigne vide refusée sans appel au modèle", async () => {
    let called = false;
    const api = { requestModel: async () => { called = true; return ""; } };
    await assert.rejects(inlineEdit({ instruction: "  ", selection: "x" }, { api }), /Consigne vide/);
    assert.equal(called, false);
});

test("lsp applyTextEdits : modifications multiples appliquées de la fin vers le début", () => {
    const text = "const a = 1;\nconsole.log(a);\n";
    const edits = [
        { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, newText: "b" },
        { range: { start: { line: 1, character: 12 }, end: { line: 1, character: 13 } }, newText: "b" }
    ];
    assert.equal(applyTextEdits(text, edits), "const b = 1;\nconsole.log(b);\n");
});

test("lsp simplifyWorkspaceEdit / simplifyLocation : chemins hors projet ignorés", () => {
    const relFor = (uri) => (uri.startsWith("file:///p/") ? uri.slice("file:///p/".length) : null);
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    const fromChanges = simplifyWorkspaceEdit({ changes: { "file:///p/a.js": [{ range, newText: "x" }], "file:///ailleurs.js": [] } }, relFor);
    assert.deepEqual(fromChanges.files, [{ rel: "a.js", edits: [{ range, newText: "x" }] }]);
    assert.equal(fromChanges.skipped, 1);
    const fromDoc = simplifyWorkspaceEdit({ documentChanges: [{ textDocument: { uri: "file:///p/b.ts" }, edits: [{ range, newText: "y" }] }] }, relFor);
    assert.equal(fromDoc.files[0].rel, "b.ts");
    assert.deepEqual(simplifyLocation({ uri: "file:///p/a.js", range }, relFor), { rel: "a.js", line: 0, character: 0, endLine: 0, endCharacter: 1 });
    assert.equal(simplifyLocation({ uri: "file:///ailleurs.js", range }, relFor), null);
});

test("lsp simplifySignature : paramètre actif repéré dans le libellé", () => {
    const sig = simplifySignature({
        signatures: [{ label: "f(a: number, b: string): void", parameters: [{ label: "a: number" }, { label: "b: string" }] }],
        activeSignature: 0,
        activeParameter: 1
    });
    assert.equal(sig.label.slice(sig.parameters[1].from, sig.parameters[1].to), "b: string");
    assert.equal(sig.activeParameter, 1);
    assert.equal(simplifySignature({ signatures: [] }), null);
});
