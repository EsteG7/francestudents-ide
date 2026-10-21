"use strict";

/**
 * Outil web_fetch : télécharge une page web (http/https) et renvoie son texte lisible.
 * Accès réseau sortant : confirmation demandée à chaque appel.
 * Les adresses locales et privées (localhost, 10.x, 192.168.x, ::1...) sont refusées,
 * y compris après une redirection.
 */

const dns = require("node:dns/promises");
const net = require("node:net");

const { ui } = require("../ui-bridge");
const { state } = require("../state");
const { requireString, optionalInt } = require("./core/args");

const DEFAULT_MAX_CHARS = 20000;
const MIN_CHARS = 500;
const MAX_CHARS_LIMIT = 100000;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

const ENTITIES = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
    eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç",
    ocirc: "ô", ucirc: "û", icirc: "î", euml: "ë", iuml: "ï", ugrave: "ù",
    hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»",
    rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", copy: "©", reg: "®", euro: "€"
};

/* ============================================================
    Sécurité des adresses
    ============================================================ */

function isPrivateAddress(address) {
    if (net.isIPv4(address)) {
        const [a, b] = address.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) ||
            a >= 224;
    }

    if (net.isIPv6(address)) {
        const lower = address.toLowerCase();
        if (lower === "::" || lower === "::1") return true;

        const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (dotted) return isPrivateAddress(dotted[1]);

        const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
        if (hex) {
            const hi = parseInt(hex[1], 16);
            const lo = parseInt(hex[2], 16);
            return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
        }

        return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
    }

    return true;
}

function parseUrl(raw) {
    let url;
    try {
        url = new URL(String(raw).trim());
    } catch {
        throw new Error(`URL invalide : ${raw}`);
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Seules les URL http:// et https:// sont acceptées.");
    }
    if (url.username || url.password) {
        throw new Error("Les URL avec identifiants (user:motdepasse@) sont refusées.");
    }

    url.hash = "";
    return url;
}

async function checkUrl(raw, { lookup = dns.lookup, allowPrivate = false } = {}) {
    const url = parseUrl(raw);
    if (allowPrivate) return url;

    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
        throw new Error(`Adresse locale refusée : ${host}.`);
    }

    let addresses;
    if (net.isIP(host)) {
        addresses = [host];
    } else {
        try {
            addresses = (await lookup(host, { all: true })).map(entry => entry.address);
        } catch {
            throw new Error(`Nom de domaine introuvable : ${host}.`);
        }
    }

    if (!addresses.length) throw new Error(`Nom de domaine introuvable : ${host}.`);

    const bad = addresses.find(isPrivateAddress);
    if (bad) throw new Error(`Adresse privée ou locale refusée : ${host} (${bad}).`);

    return url;
}

/* ============================================================
    Conversion en texte
    ============================================================ */

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
        if (code[0] === "#") {
            const n = code[1].toLowerCase() === "x"
                ? parseInt(code.slice(2), 16)
                : parseInt(code.slice(1), 10);
            try {
                return String.fromCodePoint(n);
            } catch {
                return match;
            }
        }
        const value = ENTITIES[code.toLowerCase()];
        return value === undefined ? match : value;
    });
}

function extractTitle(html) {
    const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
    return match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
}

function htmlToText(html) {
    const text = html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "\n- ")
        .replace(/<\/(p|div|section|article|header|footer|main|nav|aside|tr|h[1-6]|pre|blockquote|table|ul|ol|dl|dt|dd)\s*>/gi, "\n")
        .replace(/<[^>]+>/g, " ");

    return decodeEntities(text)
        .split("\n")
        .map(line => line.replace(/[ \t\f\v\u00a0]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function isTextual(mime) {
    return mime.startsWith("text/") || /(json|xml|javascript|ecmascript)/.test(mime);
}

function decodeBody(buffer, contentType) {
    const charset = (contentType.match(/charset="?([^;"\s]+)/i) || [])[1] || "utf-8";
    try {
        return new TextDecoder(charset).decode(buffer);
    } catch {
        return new TextDecoder("utf-8").decode(buffer);
    }
}

async function readLimited(response, maxBytes) {
    if (!response.body) return { buffer: Buffer.alloc(0), truncated: false };

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        if (total + value.length > maxBytes) {
            chunks.push(Buffer.from(value.subarray(0, maxBytes - total)));
            await reader.cancel().catch(() => {});
            return { buffer: Buffer.concat(chunks), truncated: true };
        }

        chunks.push(Buffer.from(value));
        total += value.length;
    }

    return { buffer: Buffer.concat(chunks), truncated: false };
}

/* ============================================================
    Outil
    ============================================================ */

function clampChars(value) {
    if (value === undefined) return DEFAULT_MAX_CHARS;
    return Math.min(MAX_CHARS_LIMIT, Math.max(MIN_CHARS, value));
}

/**
 * deps (tests) : fetch, lookup, confirm, allowPrivate, timeoutMs.
 */
async function webFetch(args, deps = {}) {
    const fetchImpl = deps.fetch ?? globalThis.fetch;
    const lookup = deps.lookup ?? dns.lookup;
    const confirm = deps.confirm ?? (question => state.automaticWeb ? Promise.resolve(true) : ui.confirm(question));
    const allowPrivate = deps.allowPrivate === true;
    const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
    const maxChars = clampChars(args.max_chars);

    const requested = await checkUrl(args.url, { lookup, allowPrivate });
    let url = requested;

    const ok = await confirm(`Télécharger la page web ${url.href} ?`);
    if (!ok) {
        return {
            url: url.href,
            denied: true,
            changed: false,
            message: "Accès web refusé par l'utilisateur."
        };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        let response;

        for (let hop = 0; ; hop++) {
            response = await fetchImpl(url.href, {
                redirect: "manual",
                signal: deps.signal?AbortSignal.any([controller.signal,deps.signal]):controller.signal,
                headers: {
                    "user-agent": "FranceStudentCode/1.0 (web_fetch)",
                    accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5"
                }
            });

            const location = response.headers.get("location");
            if (response.status >= 300 && response.status < 400 && location) {
                if (hop >= MAX_REDIRECTS) throw new Error(`Trop de redirections (plus de ${MAX_REDIRECTS}).`);
                await response.body?.cancel().catch(() => {});
                url = await checkUrl(new URL(location, url).href, { lookup, allowPrivate });
                continue;
            }
break;
        }

        const contentType = response.headers.get("content-type") || "";
        const mime = contentType.split(";")[0].trim().toLowerCase();
        const base = {
            url: requested.href,
            final_url: url.href,
            status: response.status,
            content_type: mime || null,
            changed: false
        };

        if (mime && !isTextual(mime)) {
            await response.body?.cancel().catch(() => {});
            return {
                ...base,
                title: "",
                content: "",
                truncated: false,
                message: `HTTP ${response.status} : contenu non textuel (${mime}), non affiché.`
            };
        }

        const { buffer, truncated: cut } = await readLimited(response, MAX_BYTES);

        if (buffer.includes(0)) {
            return {
                ...base,
                title: "",
                content: "",
                truncated: false,
                message: `HTTP ${response.status} : contenu binaire, non affiché.`
            };
        }

        const raw = decodeBody(buffer, contentType);
        const isHtml = mime.includes("html") || (!mime && /<html|<!doctype html/i.test(raw.slice(0, 1000)));
        const full = isHtml ? htmlToText(raw) : raw.trim();
        const truncated = cut || full.length > maxChars;
        const content = full.slice(0, maxChars);

        return {
            ...base,
            title: isHtml ? extractTitle(raw) : "",
            content,
            truncated,
            message: `HTTP ${response.status} : ${content.length} caractère(s)` + (truncated ? ", tronqué" : "") + "."
        };
    } catch (error) {
        if (error.name === "AbortError") {
                        throw new Error(`Délai dépassé (${timeoutMs} ms) pour ${url.href}.`, { cause: error });
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function check(args) {
    requireString(args.url, "url");
    parseUrl(args.url);
    optionalInt(args.max_chars, "max_chars");
}

function describe(a) {
    return a.url ?? "?";
}

module.exports = {
    name: "web_fetch",
    run: args => webFetch(args),
    check,
    describe,
    webFetch,
    checkUrl,
    isPrivateAddress,
    htmlToText,
    decodeEntities
};
