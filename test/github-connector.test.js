"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-connector-")); process.env.FS_DATA_DIR = dir;
const github = require("../src/github"), { execute } = require("../src/github-connector");
const originalToken = github.getToken; github.getToken = () => "fake-secret-token";
const git = (_, args, __, callback) => callback(null, args[0] === "remote" ? "https://github.com/example/project.git" : args[0] === "rev-parse" ? "main" : "", "");
test.after(() => { github.getToken = originalToken; fs.rmSync(dir, { recursive: true, force: true }); });
test("native connector reads README and updates it with an optimistic SHA and explicit branch", async () => {
    const calls = [], fetchImpl = async (url, init) => { calls.push({ url, init }); return Response.json(init.method === "GET" ? { type: "file", size: 5, encoding: "base64", content: Buffer.from("hello").toString("base64"), path: "README.md", sha: "old-sha" } : { commit: { sha: "new-sha" }, content: { html_url: "https://github.com/example/project/blob/main/README.md" } }); };
    const deps = { fetchImpl, execFileImpl: git };
    const read = await execute(dir, { action: "read_file", path: "README.md", branch: "main" }, deps);
    assert.equal(read.content, "hello");
    await execute(dir, { action: "update_file", path: "README.md", branch: "main", sha: read.sha, content: "new content", message: "docs: update" }, deps);
    const body = JSON.parse(calls[1].init.body); assert.equal(body.sha, "old-sha"); assert.equal(body.branch, "main"); assert.equal(Buffer.from(body.content, "base64").toString(), "new content");
    assert.equal(calls[1].init.redirect, "error");
    await assert.rejects(execute(dir, { action: "update_file", path: "README.md", content: "bad", message: "bad", branch: "main" }, deps), /SHA/);
});
test("releases are created as drafts and publication is a separate action", async () => {
    const bodies = [], fetchImpl = async (_, init) => { bodies.push(JSON.parse(init.body)); return Response.json({ id: 42, html_url: "https://github.com/example/project/releases/tag/v1" }); };
    const deps = { fetchImpl, execFileImpl: git };
    const draft = await execute(dir, { action: "create_release", tag: "v1", target: "commit-sha", title: "Version 1", body: "Notes", draft: false }, deps);
    assert.equal(draft.draft, true); assert.equal(bodies[0].draft, true); assert.equal(bodies[0].target_commitish, "commit-sha");
    await execute(dir, { action: "publish_release", id: 42 }, deps); assert.equal(bodies[1].draft, false);
});
test("commit requires explicit paths and refuses an existing staged selection", async () => {
    await assert.rejects(execute(dir, { action: "commit", message: "Update", paths: [] }, { execFileImpl: git }), /explicitement/);
    const staged = (_, args, __, callback) => callback(null, args[0] === "remote" ? "https://github.com/example/project.git" : "another.txt", "");
    await assert.rejects(execute(dir, { action: "commit", message: "Update", paths: ["README.md"] }, { execFileImpl: staged }), /déjà indexés/);
});
test("asset upload only accepts a file inside the project and a draft release", async () => {
    fs.writeFileSync(path.join(dir, "artifact.zip"), "test artifact");
    let uploaded = false;
    const fetchImpl = async (url, init) => {
        if (url.startsWith(github.API)) return Response.json({ draft: true });
        assert.match(url, /^https:\/\/uploads.github.com\/repos\/example\/project\/releases\/42\/assets\?name=artifact.zip$/);
        let size = 0; for await (const chunk of init.body) size += chunk.length;
        assert.equal(size, 13); uploaded = true;
        return Response.json({ id: 5, name: "artifact.zip", size });
    };
    await execute(dir, { action: "upload_asset", id: 42, path: "artifact.zip" }, { fetchImpl, execFileImpl: git }); assert.equal(uploaded, true);
    await assert.rejects(execute(dir, { action: "upload_asset", id: 42, path: "../outside" }, { fetchImpl, execFileImpl: git }));
});
