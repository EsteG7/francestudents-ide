"use strict";
/**
 * Extraction locale du texte d'un PDF, sans dépendance externe.
 *
 * Solution de secours quand le serveur refuse le fichier (ex. Files v2 non
 * activé pour le compte : HTTP 403) : le texte extrait est ajouté au message.
 *
 * Pris en charge : flux non compressés ou FlateDecode, opérateurs Tj, TJ, ', ",
 * positionnement Td, TD, Tm, T*, tables ToUnicode (bfchar, bfrange).
 * Non pris en charge (erreur explicite) : PDF chiffrés, PDF scannés sans
 * couche texte, filtres autres que FlateDecode.
 */
const zlib = require("zlib");

const MAX_PDF_TEXT_CHARS = 100_000;

// Flux sans texte affichable (polices, images, xref, métadonnées…).
const SKIP_STREAM_RE = /\/Length[123]\b|\/Subtype\s*\/(?:Image|Type1C|CIDFontType0C|OpenType|XML)\b|\/Type\s*\/(?:XRef|ObjStm|Metadata|EmbeddedFile)\b/;

// Octets WinAnsi 0x80–0x9F courants (latin1 les laisserait en caractères de contrôle).
const WIN_ANSI = {
    0x80: "€", 0x85: "…", 0x8c: "Œ", 0x91: "‘", 0x92: "’", 0x93: "“",
    0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x99: "™", 0x9c: "œ"
};

function isPdf(buffer) {
    return Buffer.isBuffer(buffer) && buffer.subarray(0, 1024).toString("latin1").includes("%PDF-");
}

function inflate(data) {
    try { return zlib.inflateSync(data); } catch { /* essai suivant */ }
    try { return zlib.inflateRawSync(data); } catch { /* essai suivant */ }
    // Flux tronqué : on garde ce qui a pu être décompressé.
    try { return zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { return null; }
}

/** Contenu (chaîne latin1) des flux utiles du PDF, décompressés. */
function readStreams(pdf) {
    const src = pdf.toString("latin1");
    const out = [];
    const re = /\bstream\r?\n/g;
    let m;
    while ((m = re.exec(src))) {
        const start = m.index + m[0].length;
        const end = src.indexOf("endstream", start);
        if (end < 0) break;
        re.lastIndex = end + "endstream".length;

        const objStart = src.lastIndexOf("obj", m.index);
        const dict = src.slice(Math.max(objStart, m.index - 4096, 0), m.index);
        if (SKIP_STREAM_RE.test(dict)) continue;

        let stop = end;
        if (src[stop - 1] === "\n") stop--;
        if (src[stop - 1] === "\r") stop--;
        let data = pdf.subarray(start, Math.max(start, stop));
        if (/\/FlateDecode\b/.test(dict)) {
            data = inflate(data);
            if (!data) continue;
        } else if (/\/Filter\b/.test(dict)) {
            continue; // DCT, LZW, JBIG2… : non pris en charge
        }
        out.push(data.toString("latin1"));
    }
    return out;
}

/** Hexadécimal UTF-16BE (destination ToUnicode) vers chaîne JS. */
function utf16(hex) {
    const clean = hex.length % 4 ? hex.padStart(Math.ceil(hex.length / 4) * 4, "0") : hex;
    return Buffer.from(clean, "hex").swap16().toString("utf16le");
}

function hexCode(n, width) {
    return n.toString(16).padStart(width, "0");
}

/** Ajoute à `map` (code hex minuscule -> texte) les entrées d'une CMap ToUnicode. */
function parseCMap(text, map) {
    for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const p of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
            map.set(p[1].toLowerCase(), utf16(p[2]));
        }
    }
    for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        const ranges = block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g);
        for (const p of ranges) {
            const lo = parseInt(p[1], 16);
            const hi = parseInt(p[2], 16);
            const width = p[1].length;
            if (!(hi >= lo) || hi - lo > 0xffff) continue;
            if (p[3].startsWith("[")) {
                [...p[3].matchAll(/<([0-9a-fA-F]*)>/g)].forEach((item, k) => {
                    map.set(hexCode(lo + k, width), utf16(item[1]));
                });
            } else {
                const base = utf16(p[3].slice(1, -1));
                if (!base) continue;
                const head = base.slice(0, -1);
                const last = base.charCodeAt(base.length - 1);
                for (let k = 0; k <= hi - lo; k++) {
                    map.set(hexCode(lo + k, width), head + String.fromCharCode(last + k));
                }
            }
        }
    }
}

function winAnsiChar(bytes, i) {
    return WIN_ANSI[bytes.charCodeAt(i)] ?? bytes[i];
}

function winAnsi(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += winAnsiChar(bytes, i);
    return out;
}

function byteHex(bytes, i) {
    return bytes.charCodeAt(i).toString(16).padStart(2, "0");
}

/** Décode une chaîne de texte PDF (octets en latin1), avec la table ToUnicode si présente. */
function decodeString(op, map) {
    const bytes = op.str;
    if (!map.size) {
        // Hexadécimal sur deux octets (police CID sans ToUnicode) : octets nuls retirés.
        if (op.hex && bytes.length % 2 === 0 && /^(?:\0[\s\S])+$/.test(bytes)) {
            return winAnsi(bytes.replace(/\0/g, ""));
        }
        return winAnsi(bytes);
    }
    // Hexadécimal : codes sur 2 octets d'abord (polices CID) ; littéral : 1 octet d'abord.
    const twoFirst = Boolean(op.hex) && bytes.length >= 2 && bytes.length % 2 === 0;
    let out = "";
    let i = 0;
    while (i < bytes.length) {
        const k1 = byteHex(bytes, i);
        const k2 = i + 1 < bytes.length ? k1 + byteHex(bytes, i + 1) : null;
        if (twoFirst && k2 && map.has(k2)) { out += map.get(k2); i += 2; continue; }
        if (map.has(k1)) { out += map.get(k1); i++; continue; }
        if (!twoFirst && k2 && map.has(k2)) { out += map.get(k2); i += 2; continue; }
        out += winAnsiChar(bytes, i);
        i++;
    }
    return out;
}

/** Lit une chaîne littérale « (…) » à partir de s[i] === "(". Renvoie [octets, index suivant]. */
function readLiteral(s, i) {
    let depth = 1;
    let out = "";
    i++;
    while (i < s.length) {
        const c = s[i];
        if (c === "\\") {
            const d = s[i + 1];
            i += 2;
            if (d === undefined) break;
            const esc = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[d];
            if (esc !== undefined) {
                out += esc;
            } else if (d >= "0" && d <= "7") {
                let oct = d;
                while (oct.length < 3 && s[i] >= "0" && s[i] <= "7") oct += s[i++];
                out += String.fromCharCode(parseInt(oct, 8) & 0xff);
            } else if (d === "\r") {
                if (s[i] === "\n") i++;
            } else if (d !== "\n") {
                out += d;
            }
            continue;
        }
        if (c === "(") depth++;
        else if (c === ")" && --depth === 0) { i++; break; }
        out += c;
        i++;
    }
    return [out, i];
}

function hexBytes(hex) {
    const clean = hex.length % 2 ? `${hex}0` : hex;
    let out = "";
    for (let i = 0; i < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16) || 0);
    return out;
}

const DELIM_RE = /[\s()<>[\]{}/%]/;

function isStringOp(o) {
    return Boolean(o) && typeof o === "object" && typeof o.str === "string";
}

/** Extrait le texte d'un flux de contenu (page ou XObject Form). */
function extractFromContent(content, map) {
    if (!/\bBT\b/.test(content)) return "";
    const n = content.length;
    const operands = [];
    let out = "";
    let lastY = null;
    let i = 0;

    const newline = () => { if (out && !out.endsWith("\n")) out += "\n"; };
    const space = () => { if (out && !/\s$/.test(out)) out += " "; };
    const lastString = () => {
        for (let k = operands.length - 1; k >= 0; k--) if (isStringOp(operands[k])) return operands[k];
        return null;
    };

    while (i < n) {
        const c = content[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "%") {
            while (i < n && content[i] !== "\n" && content[i] !== "\r") i++;
            continue;
        }
        if (c === "(") {
            const [str, next] = readLiteral(content, i);
            operands.push({ str });
            i = next;
            continue;
        }
        if ((c === "<" && content[i + 1] === "<") || (c === ">" && content[i + 1] === ">")) { i += 2; continue; }
        if (c === "<") {
            const close = content.indexOf(">", i);
            const end = close < 0 ? n : close;
            operands.push({ str: hexBytes(content.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, "")), hex: true });
            i = end + 1;
            continue;
        }
        if (c === "[") { operands.push("["); i++; continue; }
        if (c === "]") {
            const arr = [];
            while (operands.length && operands[operands.length - 1] !== "[") arr.unshift(operands.pop());
            operands.pop();
            operands.push({ arr });
            i++;
            continue;
        }
        if (c === "{" || c === "}" || c === ")" || c === ">") { i++; continue; }

        let j = i + 1;
        while (j < n && !DELIM_RE.test(content[j])) j++;
        const tok = content.slice(i, j);
        i = j;
        if (c === "/") { operands.push(tok); continue; }
        if (/^[-+.\d]/.test(tok)) { operands.push(Number(tok)); continue; }

        switch (tok) {
            case "Tj": {
                const s = lastString();
                if (s) out += decodeString(s, map);
                break;
            }
            case "'":
            case "\"": {
                newline();
                const s = lastString();
                if (s) out += decodeString(s, map);
                break;
            }
            case "TJ": {
                const arr = operands.find((o) => o && typeof o === "object" && Array.isArray(o.arr));
                for (const item of arr ? arr.arr : []) {
                    if (typeof item === "number") {
                        if (item < -200) space();
                    } else if (isStringOp(item)) {
                        out += decodeString(item, map);
                    }
                }
                break;
            }
            case "Td":
            case "TD": {
                const tx = operands[operands.length - 2];
                const ty = operands[operands.length - 1];
                if (typeof ty === "number" && Math.abs(ty) > 0.01) newline();
                else if (typeof tx === "number" && tx > 0) space();
                if (typeof ty === "number" && lastY !== null) lastY += ty;
                break;
            }
            case "Tm": {
                const y = operands[operands.length - 1];
                if (typeof y === "number") {
                    if (lastY !== null && Math.abs(y - lastY) > 1) newline();
                    else space();
                    lastY = y;
                }
                break;
            }
            case "T*":
                newline();
                break;
            case "ET":
                space();
                break;
            case "ID": {
                // Image en ligne : données binaires jusqu'à EI.
                const k = content.slice(i).search(/\sEI(?=\s|$)/);
                i = k < 0 ? n : i + k + 3;
                break;
            }
            default:
                break;
        }
        operands.length = 0;
    }
    return out;
}

function tidy(text) {
    return text
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
        .replace(/[ \t\u00a0]+/g, " ")
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * Extrait le texte d'un PDF (Buffer). Renvoie { text, truncated, pages }.
 * Lève une erreur sice n'est pas un PDF, s'il est chiffré ou sans texte lisible.
 */
function extractPdfText(buffer, { maxChars = MAX_PDF_TEXT_CHARS } = {}) {
    const pdf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (!isPdf(pdf)) throw new Error("ce fichier n'est pas un PDF valide");
    const src = pdf.toString("latin1");
    if (/\/Encrypt\b/.test(src)) throw new Error("le PDF est chiffré ou protégé, son texte ne peut pas être lu localement");

    const streams = readStreams(pdf);
    const map = new Map();
    for (const s of streams) if (s.includes("begincmap")) parseCMap(s, map);

    const parts = [];
    for (const s of streams) {
        if (s.includes("begincmap")) continue;
        const t = extractFromContent(s, map);
        if (t.trim()) parts.push(t);
    }
    let text = tidy(parts.join("\n\n"));
    if (!text) throw new Error("aucun texte lisible dans ce PDF (document scanné ou format non pris en charge)");
    const truncated = text.length > maxChars;
    if (truncated) text = `${text.slice(0, maxChars)}\n[… tronqué]`;
    const pages = (src.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
    return { text, truncated, pages };
}

module.exports = { extractPdfText, isPdf, MAX_PDF_TEXT_CHARS };
