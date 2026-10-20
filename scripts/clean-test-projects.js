"use strict";

// Retire de projects.json les projets temporaires créés par les tests (dossiers fscli-proj-*).
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(process.env.FS_STATE_DIR || path.resolve(__dirname, ".."), "projects.json");

if (!fs.existsSync(file)) {
    console.log(`Aucun fichier ${file}.`);
    process.exit(0);
}

const data = JSON.parse(fs.readFileSync(file, "utf8"));
let removed = 0;

for (const [key, project] of Object.entries(data)) {
    const p = String((project && project.path) || key);
    if (/fscli-proj-/i.test(p)) {
        delete data[key];
        removed++;
    }
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
console.log(`${removed} projet(s) de test retiré(s), ${Object.keys(data).length} restant(s).`);
