"use strict";
/**
 * Hébergement local (lecture seule) du build web d'EffectCraft pour l'onglet Motion design.
 * - écoute uniquement 127.0.0.1, port éphémère, préfixe secret dans l'URL ;
 * - refuse toute méthode autre que GET/HEAD et tout Host inattendu ;
 * - n'impose aucune CSP à la page (EffectCraft charge du WASM) : l'isolation vient du fait
 *   que la page tourne dans une iframe d'une autre origine que l'interface principale.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const DEFAULT_ROOT = path.join(__dirname, "vendor-effectcraft", "web");
const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".wasm": "application/wasm", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
    ".css": "text/css; charset=utf-8"
};

/** Convertit un chemin d'URL en chemin disque sous root, ou renvoie null s'il sort de root. */
function resolveStatic(root, relative) {
    let rel;
    try { rel = decodeURIComponent(relative); } catch { return null; }
    if (rel.includes("\0") || rel.includes("\\")) return null;
    if (!rel || rel.endsWith("/")) rel += "index.html";
    const base = path.resolve(root);
    const target = path.resolve(base, rel);
    if (target !== base && !target.startsWith(base + path.sep)) return null;
    return target;
}

function createEffectCraftHost({ root = DEFAULT_ROOT } = {}) {
    let active = null;
    const available = () => fs.existsSync(path.join(root, "index.html")) && fs.existsSync(path.join(root, "effectcraft_web_bg.wasm"));
    const version = () => {
        try { return JSON.parse(fs.readFileSync(path.join(root, "..", "VERSION.json"), "utf8")).version || ""; } catch { return ""; }
    };

    function status() {
        return { available: available(), version: version(), running: Boolean(active), url: active ? active.url : "" };
    }

    async function start() {
        if (!available()) throw new Error("Le build EffectCraft est absent. Lance « npm run vendor:effectcraft » puis relance l’application.");
        if (active) return status();
        const token = randomBytes(18).toString("hex");
 const prefix = `/${token}/`;
        const server = http.createServer((req, res) => {
     const fail = (code) => { res.writeHead(code, { "Cache-Control": "no-store" }); res.end(); };
     if (!["GET", "HEAD"].includes(req.method)) return fail(405);
     if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || "")) return fail(403);
     const url = new URL(req.url, "http://127.0.0.1");
            if (!url.pathname.startsWith(prefix)) return fail(404);
     const target = resolveStatic(root, url.pathname.slice(prefix.length));
     if (!target) return fail(403);
     fs.stat(target, (error, info) => {
         if (error || !info.isFile()) return fail(404);
         res.writeHead(200, {
      "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
         });
         if (req.method === "HEAD") { res.end(); return; }
  const stream = fs.createReadStream(target);
  stream.on("error", () => res.destroy());
         stream.pipe(res);
     });
        });
        await new Promise((resolve, reject) => {
     server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
 });
 const { port } = server.address();
        active = { server, url: `http://127.0.0.1:${port}${prefix}` };
        return status();
    }

    async function stop() {
        if (!active) return status();
        const previous = active;
 active = null;
        previous.server.closeAllConnections();
        await new Promise((resolve) => previous.server.close(resolve));
        return status();
    }

    return { start, stop, status };
}

module.exports = { createEffectCraftHost, resolveStatic, MIME, DEFAULT_ROOT };