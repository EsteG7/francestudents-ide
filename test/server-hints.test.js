"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { parseServerHint, validateServerHint } = require("../desktop/server-hints");
const example = "Le serveur de test est arrêté. Pour revoir le site, lancez `node serve.js` dans `f1-vision-site`, puis ouvrez [http://127.0.0.1:8091/](http://127.0.0.1:8091/).";
test("server hint extracts the example command, directory and local URL", () => {
    const hint = parseServerHint(example);
    assert.equal(hint.command, "node serve.js"); assert.equal(hint.cwd, "f1-vision-site"); assert.equal(hint.url, "http://127.0.0.1:8091/");
    assert.equal(parseServerHint("```bash\nnpm run dev\n```\nhttp://localhost:5173/").command, "npm run dev");
});
test("server hints reject unrelated commands, shell operators and ambiguous choices", () => {
    for (const text of ["`node -e evil` http://localhost:8000/", "`node serve.js && evil` http://localhost:8000/", "`node serve.js` https://example.com/", "`node serve.js` http://localhost.evil.test/", "`npm install` http://localhost:8000/", "`node a.js` ou `node b.js` http://localhost:8000/"]) assert.equal(parseServerHint(text), null);
});
test("server launch resolves nested or already opened directories and refuses escape", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frst-server-hint-"));
    try {
        const project = path.join(dir, "f1-vision-site"); await fs.mkdir(project); await fs.writeFile(path.join(project, "serve.js"), "");
        const hint = parseServerHint(example);
        assert.equal((await validateServerHint(dir, hint)).cwd, project);
        assert.equal((await validateServerHint(project, hint)).cwd, project);
        await assert.rejects(validateServerHint(project, { ...hint, cwd: "../" }));
        await assert.rejects(validateServerHint(project, { ...hint, command: "node ../outside.js" }));
        await assert.rejects(validateServerHint(project, { ...hint, command: "node missing.js" }));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
