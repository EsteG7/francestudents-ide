#!/usr/bin/env node
"use strict";
// Vérifie que le serveur de langage TypeScript (LSP de l'éditeur) est utilisable.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function pkgInfo(name) {
  try {
    const file = require.resolve(name + "/package.json", { paths: [ROOT] });
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    return { dir: path.dirname(file), version: pkg.version, bin: pkg.bin || null };
  } catch (err) {
    return { error: err.message };
  }
}

const ts = pkgInfo("typescript");
const tls = pkgInfo("typescript-language-server");
const tsserver = ts.dir ? path.join(ts.dir, "lib", "tsserver.js") : null;

console.log("typescript :", ts.version || ts.error);
console.log("tsserver.js :", tsserver && fs.existsSync(tsserver) ? "présent" : "absent");
console.log("typescript-language-server :", tls.version || tls.error);
console.log("bin :", JSON.stringify(tls.bin));
if (tls.dir && tls.bin) {
  const entry = typeof tls.bin === "string" ? tls.bin : Object.values(tls.bin)[0];
  const full = path.join(tls.dir, entry);
  console.log("entrée :", path.relative(ROOT, full), fs.existsSync(full) ? "présente" : "absente");
}
console.log("engines :", JSON.stringify(tls.dir ? JSON.parse(fs.readFileSync(path.join(tls.dir, "package.json"), "utf8")).engines || null : null));
