"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process"), { _electron } = require("playwright-core");
test("native GitHub dialog previews drafts, creates and publishes through mocked API", { timeout: 45000 }, async () => {
    const root = path.resolve(__dirname, ".."), dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-gh-ui-")), project = path.join(dir, "project"); fs.mkdirSync(project);
    execFileSync("git", ["init", "-b", "main", project], { windowsHide: true }); execFileSync("git", ["remote", "add", "origin", "https://github.com/example/project.git"], { cwd: project, windowsHide: true });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial"], { cwd: project, windowsHide: true });
    const harness = path.join(dir, "launch.cjs");
    fs.writeFileSync(harness, `require(${JSON.stringify(path.join(root, "src/core/session"))}).bootstrap=async()=>({ok:true});const gh=require(${JSON.stringify(path.join(root, "src/github"))});gh.saveAuth({token:'fake-native-token',login:'tester'});globalThis.connectorCalls=[];globalThis.connectorReleases=[];globalThis.fetch=async(url,init={})=>{globalThis.connectorCalls.push({url,method:init.method||'GET',body:init.body});if(url.endsWith('/user'))return Response.json({login:'tester'});if(url.endsWith('/repos/example/project'))return Response.json({full_name:'example/project',html_url:'https://github.com/example/project',permissions:{push:true}});if(url.includes('/releases?'))return Response.json(globalThis.connectorReleases);if(url.endsWith('/releases')&&init.method==='POST'){const b=JSON.parse(init.body);const release={id:42,name:b.name,body:b.body,tag_name:b.tag_name,draft:b.draft,html_url:'https://github.com/example/project/releases/tag/vtest',assets:[]};globalThis.connectorReleases=[release];return Response.json(release);}if(url.endsWith('/releases/42')&&init.method==='PATCH'){globalThis.connectorReleases[0].draft=false;return Response.json(globalThis.connectorReleases[0]);}return Response.json({message:'Unexpected test request'},{status:400});};require(${JSON.stringify(path.join(root, "desktop/main.js"))});`);
    const env = { ...process.env, FS_DATA_DIR: dir, FS_STATE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: require("electron"), args: [harness, "--user-data-dir=" + path.join(dir, "electron")], env, cwd: root });
    try {
        const page = await app.firstWindow(); await page.locator("#startup-loading").waitFor({ state: "hidden" });
        await page.evaluate(p => window.frst.openProject(p), project);
        await page.evaluate(() => document.querySelector("#gh-connector-open").click());
        await page.waitForFunction(() => document.querySelector("#github-connector-status").textContent === "Aucun élément.", null, { timeout: 10000 }).catch(async error => { console.log(await page.locator("#github-connector-dialog").innerText()); throw error; });
        assert.match(await page.locator("#github-connector-account").innerText(), /tester/);
        await page.locator("#github-connector-create summary").click();
        await page.locator("#github-release-tag").fill("vtest"); await page.locator("#github-release-target").fill("main"); await page.locator("#github-release-title").fill("Test release"); await page.locator("#github-release-body").fill("Release notes for review");
        await page.locator("#github-release-create").click();
        await page.getByRole("button", { name: "Publier la release", exact: true }).waitFor();
        assert.match(await page.locator(".github-connector-card").innerText(), /Brouillon/);
        await page.getByRole("button", { name: "Publier la release", exact: true }).click();
        await page.waitForFunction(() => document.querySelector(".github-connector-card")?.textContent.includes("Publié"));
        const calls = await app.evaluate(() => globalThis.connectorCalls);
        assert.equal(calls.filter(call => call.method === "POST").length, 1);
        assert.equal(calls.filter(call => call.method === "PATCH").length, 1);
        assert.doesNotMatch(await page.locator("#github-connector-dialog").innerText(), /fake-native-token/);
    } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
