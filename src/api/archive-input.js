"use strict";

const MAX_EXPANDED = 100 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const MAX_ENTRY = 25 * 1024 * 1024;

function validName(name) {
    return !name.includes("\0") && !/^(?:\/|\\|[a-z]:)/i.test(name) && !name.replace(/\\/g, "/").split("/").includes("..");
}

// Never extract attachments onto the filesystem or follow archive links.
function readZip(bytes, { contents = true } = {}) {
    return new Promise((resolve, reject) => {
        require("yauzl").fromBuffer(bytes, { lazyEntries: true, autoClose: true }, (error, zip) => {
            if (error) return reject(error);
            const entries = [];
            let total = 0, settled = false;
            const fail = error => { if (!settled) { settled = true; zip.close(); reject(error); } };
            zip.on("error", fail);
            zip.on("end", () => { if (!settled) { settled = true; resolve(entries); } });
            zip.on("entry", entry => {
                if (!validName(entry.fileName)) return fail(new Error("Chemin non autorisé dans l’archive."));
                if (entries.length >= MAX_ENTRIES || total + entry.uncompressedSize > MAX_EXPANDED || entry.uncompressedSize > MAX_ENTRY) {
                    return fail(new Error("Archive trop volumineuse après décompression."));
                }
                total += entry.uncompressedSize;
                const item = { name: entry.fileName, size: entry.uncompressedSize, directory: entry.fileName.endsWith("/") };
                entries.push(item);
                if (!contents || item.directory) return zip.readEntry();
                if (entry.generalPurposeBitFlag & 1) {
                    item.error = "Fichier chiffré : contenu non lu.";
                    return zip.readEntry();
                }
                zip.openReadStream(entry, (error, stream) => {
                    if (error) return fail(error);
                    const chunks = [];
                    let size = 0;
                    stream.on("error", fail);
                    stream.on("data", chunk => {
                        size += chunk.length;
                        if (size > MAX_ENTRY || size > entry.uncompressedSize) {
                            stream.destroy(new Error("Taille décompressée invalide."));
                            return;
                        }
                        chunks.push(chunk);
                    });
                    stream.on("end", () => { if (!settled) { item.bytes = Buffer.concat(chunks); zip.readEntry(); } });
                });
            });
            zip.readEntry();
        });
    });
}

function readTar(bytes) {
    return new Promise((resolve, reject) => {
        const extract = require("tar-stream").extract();
        const entries = [];
        let total = 0;
        extract.on("error", reject);
        extract.on("finish", () => resolve(entries));
        extract.on("entry", (header, stream, next) => {
            if (!validName(header.name) || entries.length >= MAX_ENTRIES || header.size > MAX_ENTRY || total + header.size > MAX_EXPANDED) {
                stream.resume(); extract.destroy(new Error("Archive TAR invalide ou trop volumineuse.")); return;
            }
            total += header.size;
            const item = { name: header.name, size: header.size, directory: header.type === "directory" };
            entries.push(item);
            const chunks = [];
            let size = 0;
            stream.on("error", reject);
            stream.on("data", chunk => {
                size += chunk.length;
                if (size > MAX_ENTRY) extract.destroy(new Error("Entrée TAR trop volumineuse."));
                else chunks.push(chunk);
            });
            stream.on("end", () => {
                if (header.type === "file") item.bytes = Buffer.concat(chunks);
                else if (!item.directory) item.error = "Lien ou entrée spéciale non suivi.";
                next();
            });
            stream.resume();
        });
        extract.end(bytes);
    });
}

async function readSevenZip(bytes) {
    const lines = [];
    const seven = await require("7z-wasm")({ print: line => lines.push(line), printErr: () => {}, stdin: () => null });
    const memory = seven.FS;
    memory.writeFile("/input.archive", bytes);
    memory.mkdir("/output");
    try {
        if (seven.callMain(["l", "-slt", "-ba", "-bsp0", "-p-", "/input.archive"]) !== 0) throw new Error("Archive illisible ou protégée par mot de passe.");
        const entries = lines.join("\n").split(/\n\s*\n/).filter(block => /^Path = /m.test(block)).map(block => {
            const fields = Object.fromEntries(block.split("\n").map(line => { const i = line.indexOf(" = "); return [line.slice(0, i), line.slice(i + 3)]; }));
            return { name: fields.Path, size: Number(fields.Size) || 0, directory: fields.Folder === "+" || fields.Attributes?.startsWith("D"),
                error: fields["Symbolic Link"] || fields["Hard Link"] ? "Lien non suivi." : fields.Encrypted === "+" ? "Fichier chiffré : contenu non lu." : undefined };
        });
        if (!entries.length || entries.length > MAX_ENTRIES || entries.some(e => !validName(e.name) || !Number.isSafeInteger(e.size) || e.size < 0 || e.size > MAX_ENTRY) ||
            entries.reduce((sum, e) => sum + e.size, 0) > MAX_EXPANDED) throw new Error("Archive invalide ou trop volumineuse après décompression.");
        const files = entries.filter(e => !e.directory && !e.error);
        if (files.length && seven.callMain(["x", "-y", "-p-", "-spd", "-o/output", "/input.archive", "--", ...files.map(e => e.name)]) !== 0) {
            throw new Error("Extraction de l’archive impossible.");
        }
        for (const entry of files) {
            const target = "/output/" + entry.name;
            const stat = memory.lstat(target);
            if (!memory.isFile(stat.mode) || stat.size > MAX_ENTRY || stat.size > entry.size) entry.error = "Entrée spéciale ou taille invalide.";
            else entry.bytes = Buffer.from(memory.readFile(target));
        }
        return entries;
    } finally {
        // MEMFS only: no host filesystem is mounted, including for archive links.
        function remove(target) {
            const stat = memory.lstat(target);
            if (memory.isDir(stat.mode)) {
                for (const name of memory.readdir(target)) if (name !== "." && name !== "..") remove(target + "/" + name);
                memory.rmdir(target);
            } else memory.unlink(target);
        }
        remove("/output"); memory.unlink("/input.archive");
    }
}

module.exports = { readZip, readTar, readSevenZip, MAX_EXPANDED };
