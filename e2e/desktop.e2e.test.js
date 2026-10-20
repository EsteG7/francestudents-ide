"use strict";

/**
 * Tests e2e de l'application de bureau (Electron piloté par playwright-core).
 * Lancement : npm run test:e2e (hors npm test, car il faut un affichage).
 * Le registre des projets est isolé dans un dossier temporaire (FS_STATE_DIR).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

let electronApi = null;
let electronPath = null;
try {
    electronApi = require("playwright-core")._electron;
    electronPath = require("electron");
} catch {
    // dépendances absentes : les tests sont ignorés
}

const skip = !electronApi || typeof electronPath !== "string" ? "playwright-core ou electron indisponible" : false;

async function launch() {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-e2e-state-"));
    const app = await electronApi.launch({
        executablePath: electronPath,
        args: [path.join(ROOT, "desktop", "main.js")],
        cwd: ROOT,
        env: { ...process.env, FS_STATE_DIR: stateDir, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
        timeout: 60000
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    return { app, page };
}

test("e2e : la fenêtre s'ouvre avec la zone de saisie, le transcript et la barre d'état", { skip, timeout: 120000 }, async () => {
    const { app, page } = await launch();
    try {
        const errors = [];
        page.on("pageerror", (err) => errors.push(err.message));
        await page.waitForSelector("#input", { timeout: 30000 });
        assert.ok(await page.isVisible("#transcript"));
        assert.ok(await page.isVisible("#statusbar"));
        assert.equal(await page.evaluate(() => typeof window.frst?.submit), "function");
        await page.waitForTimeout(500);
        assert.deepEqual(errors, []);
    } finally {
        await app.close();
    }
});

test("e2e : la saisie de / affiche les commandes slash", { skip, timeout: 120000 }, async () => {
    const { app, page } = await launch();
    try {
        await page.waitForSelector("#input", { timeout: 30000 });
        await page.fill("#input", "/");
        await page.dispatchEvent("#input", "input");
        await page.waitForTimeout(300);
        const text = await page.evaluate(() => document.body.innerText);
        assert.match(text, /\/help/);
    } finally {
        await app.close();
    }
});

test("e2e : le bouton Git ouvre la vue Git et affiche l'état du dépôt", { skip, timeout: 120000 }, async () => {
    const { app, page } = await launch();
    try {
        const errors = [];
        page.on("pageerror", (err) => errors.push(err.message));
        await page.waitForSelector("#input", { timeout: 30000 });
        await page.click('[data-view="git"]');
        await page.waitForSelector("#git-view", { state: "visible", timeout: 10000 });
        await page.waitForFunction(() => document.getElementById("git-branch")?.textContent.trim().length > 0, null, { timeout: 15000 });
        assert.ok(await page.evaluate(() => document.getElementById("app").classList.contains("view-git")));
        await page.keyboard.press("Control+Shift+G");
        await page.waitForTimeout(300);
        assert.ok(await page.evaluate(() => document.getElementById("app").classList.contains("no-sidebar")));
        assert.deepEqual(errors, []);
    } finally {
        await app.close();
    }
});

test("e2e : vrai terminal - xterm.js chargé et le PTY exécute une commande", { skip, timeout: 120000 }, async () => {
    const { app, page } = await launch();
    try {
        const errors = [];
        page.on("pageerror", (err) => errors.push(err.message));
        await page.waitForSelector("#input", { timeout: 30000 });
        assert.equal(await page.evaluate(() => typeof window.Terminal), "function");
        assert.equal(await page.evaluate(() => typeof window.FitAddon?.FitAddon), "function");
        assert.equal(await page.evaluate(() => window.frst.ptyAvailable()), true, "node-pty doit se charger dans Electron (npm run rebuild:native)");

        const output = await page.evaluate(async (root) => {
            await window.frst.openProject(root);
            let text = "";
            let ptyId = null;
            const off = window.frst.onEvent((channel, data) => {
                if (channel === "ptyData" && data && data.id === ptyId) text += data.data;
            });
            try {
                const res = await window.frst.ptyCreate(".", 100, 30);
                ptyId = res.id;
                await window.frst.ptyWrite(ptyId, "echo FRST_$((40+2))_PTY\r");
                const start = Date.now();
                while (!text.includes("FRST_42_PTY") && Date.now() - start < 15000) {
                    await new Promise((r) => setTimeout(r, 100));
                }
                await window.frst.ptyKill(ptyId);
                return text;
            } finally {
                off();
            }
        }, ROOT);
        // « FRST_42_PTY » n'apparaît que si le shell a réellement évalué $((40+2)).
        assert.match(output, /FRST_42_PTY/);

        await page.click("#tab-terminal");
        await page.waitForSelector("#terminal .xterm", { timeout: 10000 });
        assert.deepEqual(errors, []);
    } finally {
        await app.close();
    }
});
