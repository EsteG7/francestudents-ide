#!/usr/bin/env node
"use strict";
// Génère desktop/icon.icns (icône macOS) à partir de desktop/icon.png.
// Utilise les outils macOS `sips` et `iconutil` : à lancer sur macOS uniquement.
// Remarque : icon.png fait 426x426 px ; les tailles 512 et 1024 sont agrandies
// (léger flou possible). Fournir un PNG 1024x1024 pour un rendu optimal.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "desktop", "icon.png");
const OUT = path.join(ROOT, "desktop", "icon.icns");

const SIZES = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

function main() {
  if (process.platform !== "darwin") {
    console.error("[icns] sips/iconutil ne sont disponibles que sur macOS.");
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(SRC)) {
    console.error("[icns] source introuvable : " + SRC);
    process.exitCode = 1;
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frst-icon-"));
  const iconset = path.join(tmp, "icon.iconset");
  fs.mkdirSync(iconset);
  try {
    for (const [name, size] of SIZES) {
      execFileSync("sips", ["-s", "format", "png", "-z", String(size), String(size), SRC, "--out", path.join(iconset, name)], { stdio: "ignore" });
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", OUT], { stdio: "inherit" });
    console.log("[icns] " + path.relative(ROOT, OUT) + " généré (" + fs.statSync(OUT).size + " octets)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) main();
module.exports = { SIZES, main };
