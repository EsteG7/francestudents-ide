"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PINNED, sha256, readZipEntries, extractZip, installedVersion, install } = require("../scripts/fetch-effectcraft");

/** Construit une archive ZIP minimale (entrées non compressées) pour les tests. */
function buildZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name);
        const data = Buffer.from(entry.data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, name, data);
        centrals.push(central, name);
        offset += local.length + name.length + data.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `ec-fetch-${label}-`));

test("la version épinglée est cohérente (HTTPS GitHub, SHA-256 hexadécimal)", () => {
    assert.match(PINNED.url, /^https:\/\/github\.com\/storytold\/effectcraft\/releases\/download\/v/);
    assert.match(PINNED.url, new RegExp(PINNED.version.replace(/\./g, "\\.")));
    assert.match(PINNED.sha256, /^[0-9a-f]{64}$/);
    assert.equal(sha256(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("extractZip extrait en retirant le préfixe racine", () => {
    const zip = buildZip([{ name: "pkg/index.html", data: "<html>" }, { name: "pkg/sub/a.js", data: "1" }]);
    assert.deepEqual(readZipEntries(zip).map((entry) => entry.name), ["pkg/index.html", "pkg/sub/a.js"]);
    const dest = tmp("extract");
    try {
        extractZip(zip, dest, "pkg/");
        assert.equal(fs.readFileSync(path.join(dest, "index.html"), "utf8"), "<html>");
        assert.equal(fs.readFileSync(path.join(dest, "sub", "a.js"), "utf8"), "1");
    } finally { fs.rmSync(dest, { recursive: true, force: true }); }
});

test("extractZip refuse les chemins qui sortent du dossier", () => {
    const zip = buildZip([{ name: "pkg/../../evil.txt", data: "x" }]);
    const dest = tmp("evil");
    try {
        assert.throws(() => extractZip(zip, dest, "pkg/"), /Chemin refusé/);
        assert.equal(fs.existsSync(path.join(dest, "..", "evil.txt")), false);
    } finally { fs.rmSync(dest, { recursive: true, force: true }); }
});

test("install refuse une archive dont l'empreinte SHA-256 diffère", async () => {
    const target = tmp("badhash");
    const good = buildZip([{ name: "pkg/index.html", data: "ok" }]);
    const pinned = { version: "9.9.9", url: "https://example.invalid/x.zip", sha256: sha256(good), root: "pkg/" };
    try {
        await assert.rejects(() => install({ target, pinned, download: async () => Buffer.from("autre contenu") }), /SHA-256/);
        assert.equal(fs.existsSync(path.join(target, "web")), false);
        assert.equal(installedVersion(target), null);
    } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("install extrait une archive valide puis ne retélécharge pas", async () => {
    const target = tmp("good");
    const zip = buildZip([{ name: "pkg/index.html", data: "ok" }, { name: "pkg/effectcraft_web_bg.wasm", data: "wasm" }]);
    const pinned = { version: "9.9.9", url: "https://example.invalid/x.zip", sha256: sha256(zip), root: "pkg/" };
    let downloads = 0;
    const download = async () => { downloads++; return zip; };
    try {
        assert.deepEqual(await install({ target, pinned, download }), { installed: true, version: "9.9.9" });
        assert.equal(fs.readFileSync(path.join(target, "web", "index.html"), "utf8"), "ok");
        assert.equal(installedVersion(target).version, "9.9.9");
        assert.deepEqual(await install({ target, pinned, download }), { installed: false, version: "9.9.9" });
        assert.equal(downloads, 1);
    } finally { fs.rmSync(target, { recursive: true, force: true }); }
});