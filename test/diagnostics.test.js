"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const diag = require("../src/tools/diagnostics");

const ws = path.join(os.tmpdir(), "frst-diag-ws");

test("parseEslintJson : messages convertis et chemins relatifs", () => {
    const json = JSON.stringify([
        {
            filePath: path.join(ws, "src", "a.js"),
            messages: [
                { line: 3, column: 7, severity: 2, ruleId: "no-undef", message: "'x' is not defined." },
                { line: 5, column: 1, severity: 1, ruleId: "no-unused-vars", message: "'y' unused." }
            ]
        },
        { filePath: path.join(ws, "src", "b.js"), messages: [] }
    ]);
    const list = diag.parseEslintJson(json, ws);
    assert.equal(list.length, 2);
    assert.deepEqual(list[0], {
        file: "src/a.js", line: 3, column: 7, severity: "error",
        source: "eslint", code: "no-undef", message: "'x' is not defined."
    });
    assert.equal(list[1].severity, "warning");
});

test("parseEslintJson : sortie sans JSON → erreur", () => {
    assert.throws(() => diag.parseEslintJson("Oops! Something went wrong", ws), /sans JSON/);
});

test("parseTscOutput : deux formats,ANSI retiré, lignes de suite", () => {
    const out = [
        "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
        "\u001b[96msrc/b.ts\u001b[0m:10:2 - error TS2304: Cannot find name 'foo'.",
        "src/c.ts(1,1): error TS2345: Argument invalide.",
        "  Le type X manque de propriétés.",
        "error TS5058: The specified path does not exist."
    ].join("\n");
    const list = diag.parseTscOutput(out, ws);
    assert.equal(list.length, 4);
    assert.equal(list[0].file, "src/a.ts");
    assert.equal(list[0].line, 3);
    assert.equal(list[0].code, "TS2322");
    assert.equal(list[1].file, "src/b.ts");
    assert.equal(list[1].column, 2);
    assert.match(list[2].message, /manque de propriétés/);
    assert.equal(list[3].file, "");
    assert.equal(list[3].code, "TS5058");
});

test("resolveFiles : refuse les chemins hors du projet", () => {
    assert.deepEqual(diag.resolveFiles(ws, ["src/a.ts"]), [path.join("src", "a.ts")]);
    assert.throws(() => diag.resolveFiles(ws, ["../x.js"]), /hors du projet/);
});

test("planCheckers : rien d'installé → note explicite", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-diag-"));
    const auto = diag.planCheckers(dir, "auto");
    assert.equal(auto.plan.length, 0);
    assert.match(auto.notes[0], /Aucun vérificateur/);

    const tsc = diag.planCheckers(dir, "tsc");
    assert.equal(tsc.plan.length, 0);
    assert.match(tsc.notes[0], /tsc absent/);
});

test("check : arguments invalides refusés", () => {
    assert.throws(() => diag.check({ files: "a.js" }), /liste/);
    assert.throws(() => diag.check({ tool: "prettier" }), /tool doit valoir/);
    assert.throws(() => diag.check({ timeout_ms: 1.5 }), /entier/);
    assert.doesNotThrow(() => diag.check({ files: ["a.js"], tool: "eslint" }));
});
