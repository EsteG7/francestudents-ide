"use strict";

/**
 * Test manuel de l'outil browse avec un vrai navigateur.
 * Usage : node scripts/smoke-browse.js [url]
 * La capture est enregistrée dans .frst/screenshots/ à la racine du projet.
 */

const path = require("node:path");
const { browse } = require("../src/tools/browse");

async function main() {
    const url = process.argv[2] || "https://example.com";
    const workspace = path.resolve(__dirname, "..");
    const result = await browse(
        { url, max_chars: 500 },
        { workspace, confirm: async () => true }
    );

    console.log(JSON.stringify({
        status: result.status,
        title: result.title,
        screenshot: result.screenshot,
        console: result.console,
        content: result.content.slice(0, 200)
    }, null, 2));
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
