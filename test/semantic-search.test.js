"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const search = require("../src/tools/semantic-search");
const { state } = require("../src/state");

test("tokenize : identifiants découpés, accents et mots vides retirés", () => {
    const tokens = search.tokenize("function refreshAuthToken() { // rafraîchit le jeton");
    assert.ok(tokens.includes("refreshauthtoken"));
    assert.ok(tokens.includes("refresh"));
    assert.ok(tokens.includes("auth"));
    assert.ok(tokens.includes("token"));
    assert.ok(tokens.includes("rafraichit"));
    assert.ok(!tokens.includes("function"));
    assert.ok(!tokens.includes("le"));
});

test("tokenize : snake_case et pluriels simples", () => {
    const tokens = search.tokenize("load_user_settings users");
    assert.ok(tokens.includes("load"));
    assert.ok(tokens.includes("user"));
    assert.ok(tokens.includes("setting"));
    assert.ok(!tokens.includes("users"));
});

test("chunkFile : morceaux qui se chevauchent, lignes numérotées à partir de 1", () => {
    const text = Array.from({ length: 100 }, (_, i) => `ligne${i} valeur${i}`).join("\n");
    const chunks = search.chunkFile("src/a.js", text);
    assert.equal(chunks[0].start, 1);
    assert.equal(chunks[0].end, 40);
    assert.equal(chunks[1].start, 31);
    assert.equal(chunks[chunks.length - 1].end, 100);
});

test("rank : le passage pertinent passe en premier", () => {
    const chunks = [
        ...search.chunkFile("src/auth.js", "function refreshToken(session) {\n  return api.renew(session.token);\n}"),
        ...search.chunkFile("src/ui.js", "function drawButton(color) {\n  return paint(color);\n}"),
        ...search.chunkFile("src/math.js", "function add(a, b) { return a + b; }")
    ];
    const results = search.rank(chunks, "rafraîchir le token de session", { limit: 5 });
    assert.ok(results.length >= 1);
    assert.equal(results[0].file, "src/auth.js");
    assert.deepEqual(search.rank(chunks, "le la de", {}), []);
});

test("globFilter : nom de fichier ou chemin complet", () => {
    const ts = search.globFilter("*.ts");
    assert.equal(ts("src/a.ts"), true);
    assert.equal(ts("src/a.js"), false);
    const src = search.globFilter("src/*.js");
    assert.equal(src("src/a.js"), true);
    assert.equal(src("lib/a.js"), false);
    assert.equal(search.globFilter(""), null);
});

test("check : query obligatoire", () => {
    assert.throws(() => search.check({}), /query/);
    assert.throws(() => search.check({ query: "x", max_results: 2.5 }), /entier/);
    assert.doesNotThrow(() => search.check({ query: "x", glob: "*.js" }));
});

test("semanticSearch : index du projet, exclusions et mise à jour", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "frst-sem-")));
    fs.mkdirSync(path.join(dir, "src"));
    fs.mkdirSync(path.join(dir, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "auth.js"), "function refreshAuthToken() {\n  return renewSession();\n}\n");
    fs.writeFileSync(path.join(dir, "src", "colors.js"), "const palette = ['red', 'blue'];\n");
    fs.writeFileSync(path.join(dir, "node_modules", "pkg", "index.js"), "function refreshAuthToken() {}\n");

    const previous = state.workspace;
    state.workspace = dir;
    try {
        search.clearIndex();
        const first = await search.semanticSearch({ query: "refresh auth token" });
        assert.equal(first.results.length, 1);
        assert.equal(first.results[0].file, "src/auth.js");
        assert.match(first.results[0].preview, /refreshAuthToken/);
        assert.equal(first.indexed_files, 2);

        const again = await search.semanticSearch({ query: "palette couleurs" });
        assert.equal(again.reindexed, 0);
        assert.equal(again.results[0].file, "src/colors.js");

        const none = await search.semanticSearch({ query: "token", glob: "*.ts" });
        assert.equal(none.results.length, 0);
    } finally {
        state.workspace = previous;
        search.clearIndex();
    }
});
