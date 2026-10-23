"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = path.join(__dirname, "..", "desktop", "renderer");
const read = (...parts) => fs.readFileSync(path.join(renderer, ...parts), "utf8");

test("le motion design est un module séparé chargé avant le démarrage", () => {
    const modules = fs.readdirSync(path.join(renderer, "src")).filter((name) => /^\d{2}-[\w-]+\.js$/.test(name)).sort();
    assert.ok(modules.includes("36-motion-design.js"));
    assert.ok(modules.indexOf("36-motion-design.js") < modules.indexOf("99-boot.js"));
});

test("l'onglet motion design affiche un avertissement expérimental à l'ouverture", () => {
    const source = read("src", "36-motion-design.js");
    assert.match(source, /Bêta/);
    assert.match(source, /expérimentale/);
    assert.match(source, /J’ai compris, continuer/);
    assert.match(source, /role="alertdialog"/);
    assert.match(source, /function openMotionDesign[\s\S]*?hidden-consent/);
});

test("EffectCraft est chargé dans une iframe isolée depuis le serveur local, avec repli explicite", () => {
    const source = read("src", "36-motion-design.js");
    assert.match(source, /createElement\("iframe"\)/);
    assert.match(source, /api\.effectCraft\("start"\)/);
    assert.match(source, /url\.hostname!=="127\.0\.0\.1"/);
    assert.match(source, /sandbox","allow-scripts allow-same-origin allow-downloads"/);
    assert.match(source, /EffectCraft indisponible/);
    assert.doesNotMatch(source, /<webview|WebAssembly\.instantiate/);
});

test("le chat de l'agent est seulement adapté (placeholder et badge) pendant que l'onglet est ouvert", () => {
    const source = read("src", "36-motion-design.js");
    assert.match(source, /function syncMotionChat/);
    assert.match(source, /agent-motion-badge/);
    assert.doesNotMatch(source, /\bsend\(|\bsubmit\(/);
});

test("la feuille de style est liée et la CSP n'est pas élargie", () => {
    const html = read("index.html");
    assert.match(html, /href="motion\.css"/);
    assert.match(html, /frame-src http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\* https:\/\/localhost:\* https:\/\/127\.0\.0\.1:\*"/);
    assert.doesNotMatch(html, /wasm-unsafe-eval/);
    assert.match(read("motion.css"), /#app\.view-motion #motion-view/);
});

test("app.js généré contient le motion design", () => {
    assert.match(read("app.js"), /id="motion-view"/);
});
