"use strict";
/**
 * Télécharge le build web officiel d'EffectCraft (version épinglée), vérifie son SHA-256
 * puis l'extrait dans desktop/vendor-effectcraft/web (dossier non versionné, ~63 Mo de WASM).
 *
 * Source : https://github.com/storytold/effectcraft/releases (licence MIT OR Apache-2.0).
 * Usage : npm run vendor:effectcraft [-- --force]
 */
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const PINNED = Object.freeze({
    version: "0.16.0",
    url: "https://github.com/storytold/effectcraft/releases/download/v0.16.0/effectcraft-web-0.16.0.zip",
    sha256: "b6d08ea9168dbca3257c4f68b658e1ec37e4a83718312e420c1cb99f38868a74",
    root: "effectcraft-web-0.16.0/"
});
const TARGET = path.join(__dirname, "..", "desktop", "vendor-effectcraft");

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Lit le répertoire central d'une archive ZIP (sans ZIP64, suffisant pour ce build). */
function readZipEntries(buffer) {
    let eocd = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
 if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Archive ZIP invalide (fin de répertoire introuvable).");
    const count = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    if (offset === 0xffffffff || count === 0xffff) throw new Error("ZIP64 non pris en charge.");
    const entries = [];
    for (let i = 0; i < count; i++) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Archive ZIP invalide (entrée corrompue).");
 const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const size = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength).replace(/\\/g, "/");
        entries.push({ name, method, compressedSize, size, localOffset });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

function entryData(buffer, entry) {
    const at = entry.localOffset;
    if (buffer.readUInt32LE(at) !== 0x04034b50) throw new Error(`En-tête local invalide pour ${entry.name}.`);
    const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
    const raw = buffer.subarray(start, start + entry.compressedSize);
    let data;
    if (entry.method === 0) data = raw;
    else if (entry.method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`Méthode de compression ZIP ${entry.method} non prise en charge (${entry.name}).`);
    if (data.length !== entry.size) throw new Error(`Taille inattendue pour ${entry.name}.`);
    return data;
}

/** Extrait l'archive dans dest en retirant le préfixe racine ; refuse tout chemin qui sort de dest. */
function extractZip(buffer, dest, stripPrefix = "") {
    const base = path.resolve(dest);
    const written = [];
    for (const entry of readZipEntries(buffer)) {
        if (entry.name.endsWith("/")) continue;
 if (stripPrefix && !entry.name.startsWith(stripPrefix)) continue;
        const rel = entry.name.slice(stripPrefix.length);
 const target = path.resolve(base, rel);
 if (!rel || path.isAbsolute(rel) || (target !== base && !target.startsWith(base + path.sep))) {
     throw new Error(`Chemin refusé dans l'archive : ${entry.name}`);
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, entryData(buffer, entry));
 written.push(rel);
    }
    return written;
}

function downloadBuffer(url, redirects = 5) {
    return new Promise((resolve, reject) => {
 const target = new URL(url);
        if (target.protocol !== "https:") { reject(new Error("Seul HTTPS est autorisé pour le téléchargement.")); return; }
 const request = https.get(target, { headers: { "User-Agent": "francestudent-code-vendor" }, timeout: 60000 }, (response) => {
     const status = response.statusCode || 0;
     if (status >= 300 && status < 400 && response.headers.location) {
  response.resume();
  if (redirects <= 0) { reject(new Error("Trop de redirections.")); return; }
         resolve(downloadBuffer(new URL(response.headers.location, target).toString(), redirects - 1));
         return;
     }
            if (status !== 200) { response.resume(); reject(new Error(`Téléchargement impossible (HTTP ${status}).`)); return; }
     const chunks = [];
     response.on("data", (chunk) => chunks.push(chunk));
     response.on("end", () => resolve(Buffer.concat(chunks)));
     response.on("error", reject);
        });
        request.on("timeout", () => request.destroy(new Error("Délai de téléchargement dépassé.")));
        request.on("error", reject);
    });
}

function installedVersion(target = TARGET) {
    try {
        const info = JSON.parse(fs.readFileSync(path.join(target, "VERSION.json"), "utf8"));
        if (fs.existsSync(path.join(target, "web", "index.html"))) return info;
    } catch { /* non installé */ }
    return null;
}

async function install({ force = false, target = TARGET, pinned = PINNED, download = downloadBuffer, log = () => {} } = {}) {
    const current = installedVersion(target);
    if (!force && current && current.version === pinned.version && current.sha256 === pinned.sha256) {
 log(`EffectCraft ${current.version} déjà présent.`);
        return { installed: false, version: current.version };
    }
    log(`Téléchargement d'EffectCraft ${pinned.version}…`);
    const buffer = await download(pinned.url);
    const actual = sha256(buffer);
    if (actual !== pinned.sha256) throw new Error(`Empreinte SHA-256 inattendue (${actual}). Archive refusée.`);
    const staging = path.join(target, "web.tmp");
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    extractZip(buffer, staging, pinned.root);
    if (!fs.existsSync(path.join(staging, "index.html"))) throw new Error("Archive incomplète : index.html absent.");
    fs.rmSync(path.join(target, "web"), { recursive: true, force: true });
    fs.renameSync(staging, path.join(target, "web"));
    fs.writeFileSync(path.join(target, "VERSION.json"), JSON.stringify({ version: pinned.version, sha256: pinned.sha256, source: pinned.url, license: "MIT OR Apache-2.0" }, null, 2));
    log(`EffectCraft ${pinned.version} installé dans ${path.join(target, "web")}.`);
    return { installed: true, version: pinned.version };
}

module.exports = { PINNED, TARGET, sha256, readZipEntries, extractZip, installedVersion, install, downloadBuffer };

if (require.main === module) {
    install({ force: process.argv.includes("--force"), log: (line) => console.log(line) }).catch((error) => {
        console.error(`Échec : ${error.message}`);
        process.exitCode = 1;
    });
}
