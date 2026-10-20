"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { assemble, moduleFiles, APP, SRC } = require("../scripts/build-renderer");

function loadPure(files, exportsExpr) {
    const source = files.map((f) => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n");
    const context = vm.createContext({});
    return vm.runInContext(`${source}\n;(${exportsExpr})`, context, { filename: "renderer-modules.js" });
}

test("renderer : app.js est à jour par rapport à desktop/renderer/src", () => {
    assert.equal(fs.readFileSync(APP, "utf8"), assemble(), "lance npm run build:renderer");
});

test("renderer : les modules sont nommés NN-nom.js, de 00-base.js à 99-boot.js", () => {
    const files = moduleFiles();
    assert.ok(files.length >= 10);
    assert.equal(files[0], "00-base.js");
    assert.equal(files[files.length - 1], "99-boot.js");
});

test("renderer : app.js assemblé est du JavaScript valide", () => {
    assert.doesNotThrow(() => new vm.Script(assemble(), { filename: "app.js" }));
});

test("renderer : escapeHtml, inline, renderMarkdown et toolLabel", () => {
    const r = loadPure(["01-render.js"], "{ escapeHtml, inline, renderMarkdown, toolLabel }");
    assert.equal(r.escapeHtml("<a href=\"x\">&</a>"), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    assert.equal(r.inline("un `code` et **gras**"), "un <code>code</code> et <b>gras</b>");
    const html = r.renderMarkdown("# Titre\n- a\n- b\n```\n<x>\n```");
    assert.match(html, /<h4>Titre<\/h4>/);
    assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
    assert.match(html, /<pre><code>&lt;x&gt;<\/code><\/pre>/);
    assert.equal(r.toolLabel("read_file"), "Lire");
    assert.equal(r.toolLabel("inconnu"), "inconnu");
});

test("renderer : diffLine classe les lignes ajoutées, retirées et les en-têtes", () => {
    const { diffLine } = loadPure(["01-render.js"], "{ diffLine }");
    assert.equal(diffLine("+ x").cls, "add");
    assert.equal(diffLine("- x").cls, "del");
    assert.equal(diffLine("@@ -1 +1 @@").cls, "hunk");
    assert.deepEqual({ ...diffLine({ type: "add", text: "y" }) }, { text: "+ y", cls: "add" });
});

test("renderer : highlightCode colore le JS et échappe le HTML", () => {
    const { highlightCode } = loadPure(["01-render.js", "02-highlight.js"], "{ highlightCode }");
    const out = highlightCode("const a = \"<b>\"; // note", "js");
    assert.match(out, /<span class="tok-keyword">const<\/span>/);
    assert.match(out, /<span class="tok-string">&quot;&lt;b&gt;&quot;<\/span>/);
    assert.match(out, /<span class="tok-comment">\/\/ note<\/span>/);
    assert.equal(highlightCode("<x>", "default"), "&lt;x&gt;");
});
