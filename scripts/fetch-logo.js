"use strict";

/**
 * Télécharge le logo officiel FranceStudent (PNG transparent) et l'enregistre :
 * - desktop/renderer/assets/francestudent-logo.png (interface)
 * - desktop/icon.png (icône de la fenêtre et du build)
 * Essaie d'abord le fichier d'origine (pleine résolution), puis l'optimiseur Next.js.
 */

const fs = require("node:fs");
const path = require("node:path");

const BASE = "https://ia.francestudent.org";
const FILE = "/v4_logo_bleu_transparent.png";
const CANDIDATES = [
    `${BASE}${FILE}`,
    `${BASE}/_next/image?url=${encodeURIComponent(FILE)}&w=1080&q=100`,
    `${BASE}/_next/image?url=${encodeURIComponent(FILE)}&w=512&q=100`,
    `${BASE}/_next/image?url=${encodeURIComponent(FILE)}&w=256&q=100`,
    `${BASE}/_next/image?url=${encodeURIComponent(FILE)}&w=96&q=75`
];

function pngSize(buf) {
    if (buf.length < 24 || buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main() {
    const root = path.resolve(__dirname, "..");
    for (const url of CANDIDATES) {
        try {
            const res = await fetch(url, { headers: { Accept: "image/png,image/*" } });
            const type = res.headers.get("content-type") || "";
            if (!res.ok) {
                console.log(`ÉCHEC ${res.status} ${url}`);
                continue;
            }
            const buf = Buffer.from(await res.arrayBuffer());
            const size = pngSize(buf);
            if (!size) {
                console.log(`IGNORÉ (pas un PNG, ${type}, ${buf.length} octets) ${url}`);
                continue;
            }
            const targets = [
                path.join(root, "desktop", "renderer", "assets", "francestudent-logo.png"),
                path.join(root, "desktop", "icon.png")
            ];
            for (const target of targets) fs.writeFileSync(target, buf);
            console.log(`OK ${url}`);
            console.log(`PNG ${size.width}x${size.height}, ${buf.length} octets`);
            console.log(`Écrit : ${targets.map((t) => path.relative(root, t)).join(", ")}`);
            return;
        } catch (error) {
            console.log(`ERREUR ${url} : ${error.message}`);
        }
    }
    console.error("Aucun logo téléchargé.");
    process.exitCode = 1;
}

main();
