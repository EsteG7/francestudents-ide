"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright-core");
const electron = require("electron");
const root = path.resolve(__dirname, "..");

test("e2e : tâches ajoutées, réordonnées, exécutées et suspendues sur blocage", { timeout: 60000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-queue-e2e-"));
    const project = path.join(dir, "project");
    fs.mkdirSync(project);
    const harness = path.join(dir, "launch.cjs");
    fs.writeFileSync(harness, `
        const path = require('node:path');
        const {app} = require('electron');
        app.setName('FRST queue integration test');
        app.setPath('userData', ${JSON.stringify(path.join(dir, "electron-data"))});
        const session = require(${JSON.stringify(path.join(root, "src/core/session"))});
        session.bootstrap = async () => ({ok:true});
        global.queueTestCalls = [];
        global.qaRequire = require;
        session.handleInput = async (prompt, options = {}) => {
            global.queueTestCalls.push(prompt);
            if (prompt === 'LONG_RUNNING') {
                global.longRunOptions = options;
                return new Promise(resolve => { global.finishLongRun = () => resolve({exit:false, completed:true}); });
            }
            await new Promise(resolve => setTimeout(resolve, 250));
            return {exit:false, completed: !prompt.includes('BLOCKED'), message: prompt.includes('BLOCKED') ? 'Information manquante' : 'Terminé'};
        };
        require(${JSON.stringify(path.join(root, "desktop/main.js"))});
    `);
    const env = { ...process.env, FS_DATA_DIR: dir, FS_STATE_DIR: dir, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: electron, args: [harness], cwd: root, env, timeout: 30000 });
    try {
        const page = await app.firstWindow();
        const errors = [];
        page.on("pageerror", e => errors.push(e.message));
        await page.waitForFunction(async () => (await window.frst.status()).booted);
        await page.evaluate(project => window.frst.openProject(project), project);
        assert.equal(await page.locator('#btn-queue, [data-agent-tab="tasks"], #task-queue').count(), 0);
        await page.evaluate(async () => {
            await window.frst.taskQueue("add", { prompt: "Première tâche" });
            await window.frst.taskQueue("add", { prompt: "Deuxième tâche" });
        });
        await page.waitForFunction(() => document.querySelectorAll(".pending-prompt").length === 2);
        await page.locator(".pending-menu > summary").nth(1).click();
        await page.locator(".pending-menu[open]").getByRole("button", { name: "Monter", exact: true }).click();
        await page.waitForFunction(() => document.querySelector(".pending-text").textContent === "Deuxième tâche");
        await page.locator(".pending-paused").getByRole("button", { name: "Reprendre", exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll(".pending-prompt").length === 0);
        await page.waitForFunction(() => document.getElementById("btn-stop").classList.contains("hidden"));
        const calls = await app.evaluate(() => global.queueTestCalls);
        assert.deepEqual(calls, ["Deuxième tâche", "Première tâche"]);
        await page.evaluate(async () => {
            await window.frst.taskQueue("add", { prompt: "BLOCKED" });
            await window.frst.taskQueue("add", { prompt: "Ne pas lancer" });
            await window.frst.taskQueue("start");
        });
        await page.waitForFunction(() => document.querySelector(".pending-paused") && document.querySelector(".pending-text")?.textContent === "Ne pas lancer");
        const queue = await page.evaluate(() => window.frst.taskQueue("list"));
        assert.equal(queue.enabled, false);
        assert.equal(queue.tasks.at(-1).status, "pending");
        assert.equal((await app.evaluate(() => global.queueTestCalls)).length, 3);
        await page.locator('[data-agent-tab="conversation"]').click();
        await page.locator("#input").fill("Mon prompt favori");
        await page.locator("#draft-save-favorite").click();
        await page.locator("#input").fill("");
        await page.locator("#favorite-open").click();
        await page.locator("#favorite-list").getByRole("button", { name: "Mon prompt favori", exact: true }).click();
        assert.equal(await page.locator("#input").inputValue(), "Mon prompt favori");
        await page.reload();
        await page.waitForFunction(() => document.getElementById("input").value === "Mon prompt favori");
        await app.evaluate(async (electronModule, root) => {
            if (!electronModule.app) throw new Error("Electron indisponible");
            const load = global.qaRequire;
            const { state } = load(load('node:path').join(root, "src/state"));
            const backend = load(load('node:path').join(root, "src/ui-bridge")).getUiBackend();
            backend.startRun("Vérifier le projet");
            state.agentPlan = [{ step: "Explorer", status: "completed" }, { step: "Tester", status: "in_progress" }];
            backend.plan(["Explorer", "Tester"]);
            backend.tool("web_fetch", "https://example.org/docs");
            backend.result("Source vérifiée", { sources: [{ url: "https://example.org/docs", title: "Documentation vérifiée", consulted: true }] });
            load(load('node:path').join(root, "src/project/checkpoints")).addCheckpoint({ task: "Point de reprise QA", workspace: state.workspace, historyLength: state.history.length });
            const previousAuto = state.autoApprove;
            state.autoApprove = true;
            try { await load(load('node:path').join(root, "src/tools/registry")).TOOLS.write_file.run({ path: "qa-created.txt", content: "Test restauration" }); }
            finally { state.autoApprove = previousAuto; }
            load(load('node:path').join(root, "src/tools/command/jobs")).manager.start({ command: "QA background", launch: ({ onLine, signalHandle }) => new Promise(resolve => {
                onLine("QA_BACKGROUND_OUTPUT");
                signalHandle.kill = () => resolve({ exit_code: 0 });
            }) });
            backend.endRun({ ok: true });
            backend.assistant("Résultat : [Documentation](https://example.org/docs)");
        }, root);
        await page.waitForSelector('#agent-live-plan progress', { state: "attached" });
        await page.locator('[data-agent-tab="activity"]').click();
        await page.waitForSelector(".activity-action");
        assert.match(await page.locator("#activity-sources").innerText(), /Source consultée/);
        assert.match(await page.locator("#activity-timeline").innerText(), /Lire une source/);
        await page.locator("#activity-jobs").getByRole("button", { name: "Sortie", exact: true }).click();
        assert.match(await page.locator("#activity-job-output").innerText(), /QA_BACKGROUND_OUTPUT/);
        await page.locator("#activity-jobs").getByRole("button", { name: "Arrêter", exact: true }).click();
        await page.waitForFunction(() => document.getElementById("activity-jobs").textContent.includes("stopped"));
        assert.equal(fs.existsSync(path.join(project, "qa-created.txt")), true);
        page.once("dialog", dialog => dialog.accept());
        await page.locator("#activity-checkpoints").getByRole("button", { name: "Restaurer", exact: true }).click();
        await page.waitForFunction(() => document.getElementById("composer-feedback").textContent.includes("restaurée"));
        assert.equal(fs.existsSync(path.join(project, "qa-created.txt")), false);
        if (process.env.FRST_QA_SCREENSHOT) await page.screenshot({ path: process.env.FRST_QA_SCREENSHOT.replace(/\.png$/, "-activity.png"), fullPage: true });
        await page.locator('[data-agent-tab="conversation"]').click();
        assert.equal(await page.locator('#transcript a[data-web-url]').getAttribute("href"), "https://example.org/docs");
        const markdown = await page.evaluate("exportStudioMarkdown()");
        assert.match(markdown, /Documentation/);
        await page.locator("#agent-focus").click();
        assert.ok(await page.locator("#app").evaluate(el => el.classList.contains("focus-agent")));
        await page.locator("#agent-focus").click();
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()), "#0078d4");
        await page.evaluate(async () => {
            const queue = await window.frst.taskQueue("list");
            for (const task of queue.tasks.filter(t => t.status === "pending")) await window.frst.taskQueue("remove", { id: task.id });
        });
        await page.locator("#input").fill("LONG_RUNNING");
        await page.locator("#input").press("Enter");
        await page.waitForFunction(async () => (await window.frst.status()).busy);
        for (const prompt of ["Comme sa", "Test", "Suite"]) {
            await page.locator("#input").fill(prompt);
            await page.locator("#input").press("Enter");
        }
        await page.waitForFunction(() => document.querySelectorAll(".pending-prompt").length === 3);
        assert.deepEqual(await page.locator(".pending-text").allTextContents(), ["Comme sa", "Test", "Suite"]);
        assert.equal(await page.locator("#input").inputValue(), "");
        assert.equal(await page.locator("#btn-send").isEnabled(), true);
        if (process.env.FRST_QA_SCREENSHOT) await page.screenshot({ path: process.env.FRST_QA_SCREENSHOT.replace(/\.png$/, "-stack.png"), fullPage: true });
        await page.locator(".pending-prompt").first().getByRole("button", { name: "Orienter", exact: true }).click();
        assert.deepEqual(await app.evaluate(() => global.longRunOptions.drainSteering()), ["Comme sa"]);
        await app.evaluate(() => global.finishLongRun());
        await page.waitForFunction(() => document.querySelectorAll(".pending-prompt").length === 0);
        await page.waitForFunction(() => document.getElementById("btn-stop").classList.contains("hidden"));
        const queuedCalls = await app.evaluate(() => global.queueTestCalls);
        assert.deepEqual(queuedCalls.slice(-3), ["LONG_RUNNING", "Test", "Suite"]);
        await page.locator("#agent-access").click();
        await page.locator('[data-access-mode="full"]').click();
        await page.waitForFunction(() => document.querySelector('[data-access-mode="full"]').getAttribute("aria-checked") === "true");
        assert.equal(await page.locator("#full-access-warning").isVisible(), true);
        assert.match(await page.locator("#full-access-warning").innerText(), /supprimer des fichiers/);
        assert.match(await page.locator("#full-access-warning").innerText(), /sans donner automatiquement les droits administrateur/);
        await page.locator("#set-remember-access").check();
        await page.waitForFunction(() => document.getElementById("settings-message").textContent.includes("enregistré"));
        const fullSettings = await page.evaluate(() => window.frst.setAutoApprove(""));
        assert.equal(fullSettings.fullAccessAlways, true);
        if (process.env.FRST_QA_SCREENSHOT) await page.screenshot({ path: process.env.FRST_QA_SCREENSHOT.replace(/\.png$/, "-settings.png"), fullPage: true });
        await page.locator('[data-access-mode="ask"]').click();
        await page.waitForFunction(() => document.getElementById("full-access-warning").classList.contains("hidden"));
        const askedSettings = await page.evaluate(() => window.frst.setAutoApprove(""));
        assert.equal(askedSettings.fullAccess, false);
        assert.equal(askedSettings.autoApprove, false);
        assert.equal(askedSettings.autoApproveCommands, false);
        assert.deepEqual(errors, []);
        if (process.env.FRST_QA_SCREENSHOT) await page.screenshot({ path: process.env.FRST_QA_SCREENSHOT, fullPage: true });
    } finally { await app.close(); }
});
