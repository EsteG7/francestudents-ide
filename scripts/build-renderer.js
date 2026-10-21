"use strict";
/**
 * Assemble desktop/renderer/src/*.js (ordre alphabétique) en desktop/renderer/app.js.
 *
 * Les modules partagent la même portée, comme l'ancien app.js d'un seul bloc :
 * la concaténation garde exactement le même comportement (fonctions hissées,
 * "use strict" global), sans bundler ni changement de index.html.
 *
 * Usage : node scripts/build-renderer.js           -> écrit app.js
 *         node scripts/build-renderer.js --check   -> code 1 si app.js n'est pas à jour
 */
const fs = require("fs");
const path = require("path");

const RENDERER = path.join(__dirname, "..", "desktop", "renderer");
const SRC = path.join(RENDERER, "src");
const APP = path.join(RENDERER, "app.js");

function moduleFiles() {
    return fs.readdirSync(SRC).filter((f) => /^\d{2}-[\w-]+\.js$/.test(f)).sort();
}

function assemble() {
    return moduleFiles().map((f) => {
        const text = fs.readFileSync(path.join(SRC, f), "utf8");
        return text.endsWith("\n") ? text : `${text}\n`;
    }).join("");
}

function main(argv) {
    const built = assemble();
  new (require("node:vm").Script)(built, {filename:"desktop/renderer/app.js"});
    if (argv.includes("--check")) {
        const current = fs.existsSync(APP) ? fs.readFileSync(APP, "utf8") : "";
        if (current !== built) {
            console.error("desktop/renderer/app.js n'est pas à jour : lance npm run build:renderer");
            return 1;
        }
        console.log("desktop/renderer/app.js est à jour.");
        return 0;
    }
    fs.writeFileSync(APP, built);
    console.log(`desktop/renderer/app.js assemblé (${moduleFiles().length} modules).`);
    return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { assemble, moduleFiles, APP, SRC };
