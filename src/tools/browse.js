"use strict";

/**
 * Outil browse : ouvre une page web dans un navigateur SANS INTERFACE (en arrière-plan),
 * attend son rendu (JavaScript compris), enregistre une capture d'écran PNG dans le projet
 * (.frst/screenshots/) et renvoie le titre, le texte visible et les erreurs de la console.
 *
 * Utilise playwright-core avec le navigateur déjà installé sur la machine
 * (Chrome, Edge ou Chromium), ou celui indiqué par la variable FS_BROWSER_PATH.
 * Confirmation demandée à chaque appel. Contrairement à web_fetch, localhost est accepté :
 * c'est le moyen de vérifier visuellement un serveur de développement lancé en arrière-plan.
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const { ui } = require("../ui-bridge");
const { requireString, optionalInt } = require("./core/args");

const SCREENSHOT_DIR = path.join(".frst", "screenshots");
const DEFAULT_MAX_CHARS = 10000;
const MIN_CHARS = 200;
const MAX_CHARS_LIMIT = 100000;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const NAV_TIMEOUT_MS = 30000;
const IDLE_TIMEOUT_MS = 5000;
const MAX_WAIT_MS = 30000;
const MAX_CONSOLE = 20;
const CHANNELS = ["chrome", "msedge", "chromium"];

function clamp(value, min, max, fallback) {
    if (value === undefined) return fallback;
    return Math.min(max, Math.max(min, value));
}

function firstLine(text) {
    return String(text ?? "").split("\n")[0].trim();
}

function parseUrl(raw) {
    let url;
    try {
        url = new URL(String(raw).trim());
    } catch {
        throw new Error(`URL invalide : ${raw}`);
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Seules les URL http:// et https:// sont acceptées.");
    }
    if (url.username || url.password) {
        throw new Error("Les URL avec identifiants (user:motdepasse@) sont refusées.");
    }

    return url;
}

/** Nom de fichier horodaté, ex. 2026-10-21_14-03-05-localhost.png */
function screenshotName(url, now = new Date()) {
    const stamp = now.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    const host = url.hostname.replace(/[^a-z0-9.-]/gi, "_") || "page";
    return `${stamp}-${host}.png`;
}

function cleanText(text) {
    return String(text ?? "")
        .split("\n")
        .map(line => line.replace(/[ \t\f\v\u00a0]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** Lance le premier navigateur disponible (FS_BROWSER_PATH, sinon Chrome, Edge, Chromium). */
async function launchBrowser(chromium, env = process.env) {
    const custom = env.FS_BROWSER_PATH;
    const attempts = custom
        ? [{ executablePath: custom }]
        : CHANNELS.map(channel => ({ channel }));
    const errors = [];

    for (const options of attempts) {
        try {
            return await chromium.launch({ headless: true, ...options });
        } catch (error) {
            errors.push(`- ${options.channel || options.executablePath} : ${firstLine(error.message)}`);
        }
    }

    throw new Error(
        "Aucun navigateur utilisable (Chrome, Edge ou Chromium). " +
        "Installe Google Chrome ou indique le chemin de l'exécutable dans FS_BROWSER_PATH.\n" +
        errors.join("\n")
    );
}

/**
 * deps (tests) : confirm, launch (renvoie un navigateur Playwright), workspace.
 */
async function browse(args, deps = {}) {
    const workspace = deps.workspace ?? require("../state").state.workspace;
    if (!workspace) throw new Error("Aucun projet sélectionné.");

    const url = parseUrl(args.url);
    const fullPage = args.full_page === true;
    const width = clamp(args.width, 320, 3840, DEFAULT_WIDTH);
    const height = clamp(args.height, 240, 2160, DEFAULT_HEIGHT);
    const waitMs = clamp(args.wait_ms, 0, MAX_WAIT_MS, 0);
    const maxChars = clamp(args.max_chars, MIN_CHARS, MAX_CHARS_LIMIT, DEFAULT_MAX_CHARS);

    const confirm = deps.confirm ?? (question => ui.confirm(question));
    const ok = await confirm(
        `Ouvrir ${url.href} dans un navigateur en arrière-plan et enregistrer une capture d'écran ?`
    );

    if (!ok) {
        return {
            url: url.href,
            denied: true,
            changed: false,
            message: "Navigation refusée par l'utilisateur."
        };
    }

    const launch = deps.launch ?? (() => launchBrowser(require("playwright-core").chromium));
    const browser = await launch();
    const consoleMessages = [];

    const note = text => {
        if (consoleMessages.length < MAX_CONSOLE) consoleMessages.push(String(text).slice(0, 500));
    };

    try {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
        const page = await context.newPage();

        page.on("console", message => {
            const type = message.type();
            if (type === "error" || type === "warning") note(`[${type}] ${message.text()}`);
        });
        page.on("pageerror", error => note(`[exception] ${firstLine(error.message)}`));

        let response;
        try {
            response = await page.goto(url.href, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
        } catch (error) {
            throw new Error(`Impossible d'ouvrir ${url.href} : ${firstLine(error.message)}`, { cause: error });
        }

        await page.waitForLoadState("networkidle", { timeout: IDLE_TIMEOUT_MS }).catch(() => {});
        if (waitMs) await page.waitForTimeout(waitMs);

        const relative = path.join(SCREENSHOT_DIR, screenshotName(url));
        const absolute = path.join(workspace, relative);
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await page.screenshot({ path: absolute, fullPage });

        const title = await page.title();
        const text = cleanText(await page.evaluate("document.body ? document.body.innerText : ''"));
        const truncated = text.length > maxChars;
        const content = text.slice(0, maxChars);
        const status = response ? response.status() : null;
        const shot = relative.split(path.sep).join("/");

        return {
            url: url.href,
            final_url: page.url(),
            status,
            title,
            screenshot: shot,
            viewport: { width, height },
            full_page: fullPage,
            content,
            truncated,
            console: consoleMessages,
            changed: false,
            files_changed: [shot],
            message: `Capture enregistrée : ${shot}` +
                (status !== null ? ` (HTTP ${status})` : "") +
                (consoleMessages.length ? `, ${consoleMessages.length} message(s) d'erreur en console` : "") +
                "."
        };
    } finally {
        await browser.close().catch(() => {});
    }
}

function check(args) {
    requireString(args.url, "url");
    parseUrl(args.url);
    optionalInt(args.max_chars, "max_chars");
    optionalInt(args.wait_ms, "wait_ms");
    optionalInt(args.width, "width");
    optionalInt(args.height, "height");
    if (args.full_page !== undefined && typeof args.full_page !== "boolean") {
        throw new Error("full_page doit être true ou false.");
    }
}

function describe(a) {
    return `${a.url ?? "?"}` + (a.full_page === true ? " (page entière)" : "");
}

module.exports = {
    name: "browse",
    run: args => browse(args),
    check,
    describe,
    browse,
    launchBrowser,
    screenshotName,
    parseUrl,
    cleanText
};
