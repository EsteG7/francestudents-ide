"use strict";

const path = require("node:path");
const { isPdf } = require("./pdf-text");
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 40;
const MAX_TEXT_CHARS = 2000000;
const MIME_EXTENSIONS = {
    "image/svg+xml": "svg", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/rtf": "rtf",
    "application/vnd.oasis.opendocument.text": "odt", "application/vnd.oasis.opendocument.spreadsheet": "ods",
    "application/vnd.oasis.opendocument.presentation": "odp", "message/rfc822": "eml", "application/epub+zip": "epub"
};
const { OFFICE_TYPES, SHEET_TYPES, officeInput, spreadsheetInput, legacyWordInput, legacyPresentationInput } = require("./document-input");

// All conversion is local. Original attachments are never modified.
async function convertAttachment(file, context = { depth: 0, budget: { bytes: 0 } }) {
    const name = String(file?.name || "fichier").replace(/[\r\n]/g, " ").slice(0, 200);
    const match = /^data:([^;,]*)(?:;[^,]*)?;base64,([\s\S]*)$/i.exec(String(file?.dataUrl || ""));
    if (!match) throw new Error(`Fichier joint invalide (${name}) : data URL base64 attendue.`);
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error(`Fichier vide ou trop volumineux : ${name} (25 Mo maximum).`);
    const type = match[1].toLowerCase();
    const ext = path.extname(name).slice(1).toLowerCase() || MIME_EXTENSIONS[type] || "";
    try {
        const result = await convertBytes(bytes, name, ext, type, context);
        if (result.text.length > MAX_TEXT_CHARS) throw new Error("Texte extrait trop volumineux (2 millions de caractères maximum).");
        return result;
    } catch (error) {
        return binaryFallback(name, bytes, type, error.message);
    }
}

async function convertBytes(bytes, name, ext, type, context) {
    const tarMagic = bytes.subarray(257, 262).toString() === "ustar";
    if (isPdf(bytes) || ext === "pdf" || type === "application/pdf") {
        const images = await renderPdf(bytes);
        return { images, text: `Fichier joint : ${name}. Les ${images.length} images suivantes correspondent à ses pages, dans l’ordre.` };
    }
    if (ext === "svg" || type === "image/svg+xml" || /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(bytes.subarray(0, 65536).toString("utf8"))) {
        const result = await require("./svg-input").svgInput(bytes);
        return { images: result.images, text: documentText(name, `${result.note}\n${result.source}`) };
    }
    if (SHEET_TYPES.has(ext)) return withMedia(name, await spreadsheetInput(bytes, ext), context);
    if (OFFICE_TYPES[ext]) return withMedia(name, await officeInput(bytes, ext), context);
    if (["doc", "dot"].includes(ext)) return withMedia(name, await legacyWordInput(bytes), context);
    if (["ppt", "pps", "pot"].includes(ext)) return withMedia(name, legacyPresentationInput(bytes), context);
    if (type.startsWith("audio/") || type.startsWith("video/") || /^(?:mp3|wav|flac|ogg|oga|opus|m4a|aac|aiff|mp4|m4v|mov|avi|webm|mkv|wmv|mpeg|mpg)$/i.test(ext)) {
        const result = await require("./media-input").mediaInput(bytes);
        return { ...result, text: documentText(name, result.text) };
    }
    if (ext === "msg") {
        const reader = new (require("@kenjiuno/msgreader").default)(bytes);
        const mail = reader.getFileData();
        if (mail.error) throw new Error(String(mail.error));
        const results = [];
        for (const item of mail.attachments || []) {
            const attachment = reader.getAttachment(item);
            const content = Buffer.from(attachment.content || []);
            if (content.length) results.push(await convertChild(attachment.fileName || "piece-jointe", content, "application/octet-stream", context));
        }
        return joinResults(name, [`De : ${mail.senderName || ""}`, `Objet : ${mail.subject || ""}`, mail.body || mail.bodyHtml || ""].join("\n"), results);
    }
    if (ext === "eml" || type === "message/rfc822") {
        const mail = await require("mailparser").simpleParser(bytes, { skipHtmlToText: false, skipImageLinks: true });
        const results = [];
        for (const attachment of mail.attachments) {
            if (attachment.content.length) results.push(await convertChild(attachment.filename || "piece-jointe", attachment.content, attachment.contentType, context));
        }
        const text = [`De : ${mail.from?.text || ""}`, `À : ${mail.to?.text || ""}`, `Objet : ${mail.subject || ""}`, `Date : ${mail.date?.toISOString() || ""}`, mail.text || ""].join("\n");
        return joinResults(name, text, results);
    }
    if (tarMagic || ["zip", "tar", "gz", "tgz", "7z", "rar", "xz", "bz2", "tbz2", "txz", "zst", "lzma", "cab", "iso", "ar", "deb", "rpm"].includes(ext) || bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
        let archive = bytes;
        let archiveExt = ext;
        if (["gz", "tgz"].includes(ext) || (bytes[0] === 0x1f && bytes[1] === 0x8b)) {
            archive = require("node:zlib").gunzipSync(bytes, { maxOutputLength: 100 * 1024 * 1024 });
            archiveExt = ext === "tgz" || name.toLowerCase().endsWith(".tar.gz") ? "tar" : path.extname(name.slice(0, -3)).slice(1).toLowerCase();
            if (archiveExt !== "tar") return joinResults(name, "Contenu décompressé :", [await convertChild(name.replace(/\.gz$/i, ""), archive, "application/octet-stream", context)]);
        }
        const { readZip, readTar, readSevenZip } = require("./archive-input");
        const entries = tarMagic || archiveExt === "tar" ? await readTar(archive) : archiveExt === "zip" || bytes.subarray(0, 2).toString() === "PK" ? await readZip(archive) : await readSevenZip(archive);
        const results = [];
        for (const entry of entries) if (!entry.directory) {
            results.push(entry.bytes?.length ? await convertChild(entry.name, entry.bytes, "application/octet-stream", context)
                : { images: [], text: `${entry.name} : ${entry.error || "fichier vide"}` });
        }
        return joinResults(name, "Archive :\n" + entries.map(e => `${e.name} (${e.size} octets)`).join("\n"), results);
    }
    if (type.startsWith("image/") || /\.(?:png|jpe?g|jfif|pjp|pjpeg|webp|gif|bmp|tiff?|svg|avif|heic|heif)$/i.test(name)) {
        const sharp = require("sharp");
        const metadata = await sharp(bytes, { limitInputPixels: 100000000 }).metadata();
        const pages = metadata.pages || 1;
        const count = metadata.format === "tiff" ? Math.min(pages, MAX_PAGES) : 1;
        const images = [];
        for (let page = 0; page < count; page++) {
            const pipeline = sharp(bytes, { page, pages: 1, limitInputPixels: 100000000 }).rotate().resize({ width: 6000, height: 6000, fit: "inside", withoutEnlargement: true });
            let encoded = await pipeline.clone().png().toBuffer();
            let mime = "image/png";
            if (encoded.length > 5 * 1024 * 1024) { encoded = await pipeline.flatten({ background: "white" }).jpeg({ quality: 80 }).toBuffer(); mime = "image/jpeg"; }
            const prepared = await require("./image-input").prepareImageInput(`data:${mime};base64,${encoded.toString("base64")}`);
            images.push(`data:${prepared.type};base64,${prepared.bytes.toString("base64")}`);
        }
        return { images, partial: count < pages, text: documentText(name, `${count} image(s) transmise(s), dans l’ordre.` +
            (count < pages ? ` Lecture partielle : ${pages} pages ou images au total, ${count} transmise(s). Les animations sont représentées par leur première image.` : "")) };
    }
    const text = decodeText(bytes, type.startsWith("text/") || /^(?:txt|md|csv|tsv|json|xml|html?|css|js|ts|jsx|tsx|py|ya?ml|log|sql|sh|c|cpp|h|java|rs|go|ini|toml|ics|vcf|tex|srt|vtt)$/i.test(ext));
    if (text !== null) return { images: [], text: documentText(name, text) };
    return binaryFallback(name, bytes, type, "Aucun décodeur complet pour ce format ; analyse limitée aux métadonnées et aux chaînes lisibles.");
}

function decodeText(bytes, knownText = false) {
    let encoding = "utf-8";
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
    let text;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch { if (!knownText) return null; text = new TextDecoder("windows-1252").decode(bytes); }
    if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)) return null;
    return text;
}

function binaryFallback(name, bytes, type, reason) {
    const strings = bytes.subarray(0, 1024 * 1024).toString("latin1").match(/[\x20-\x7e]{6,}/g) || [];
    return { images: [], partial: true, text: documentText(name, [
        "LECTURE PARTIELLE : le contenu de ce fichier n’a pas été décodé intégralement. Ne prétends pas l’avoir lu ou interprété entièrement.",
        `Motif : ${String(reason).slice(0, 500)}`, `Type : ${type || "inconnu"} ; taille : ${bytes.length} octets`,
        `SHA-256 : ${require("node:crypto").createHash("sha256").update(bytes).digest("hex")}`,
        `Signature hexadécimale : ${bytes.subarray(0, 64).toString("hex")}`,
        "Chaînes lisibles récupérées (échantillon, sans garantie de sens) :", strings.join("\n").slice(0, 32000)
    ].join("\n")) };
}

async function convertChild(name, bytes, type, context) {
    context.budget.bytes += bytes.length;
    if (context.depth >= 3 || context.budget.bytes > 100 * 1024 * 1024) return binaryFallback(name, bytes, type, "Limite d’imbrication ou de décompression atteinte.");
    return convertAttachment({ name, dataUrl: `data:${type};base64,${bytes.toString("base64")}` }, { depth: context.depth + 1, budget: context.budget });
}

async function withMedia(name, document, context) {
    const results = [];
    for (const media of document.media || []) {
        const match = /^data:([^;,]+);base64,(.*)$/s.exec(media.dataUrl);
        if (match) results.push(await convertChild(media.name || "image", Buffer.from(match[2], "base64"), match[1], context));
    }
    const result = joinResults(name, document.text, results);
    if (document.partial) result.partial = true;
    return result;
}

function joinResults(name, text, results) {
    return { images: results.flatMap(result => result.images), text: documentText(name, [text, ...results.map(result => result.text)].join("\n\n")), partial: results.some(result => result.partial) };
}

function documentText(name, text) {
    // Never silently discard the end of a document.
    if (text.length > MAX_TEXT_CHARS) throw new Error(`Le texte de ${name} dépasse la limite de ${MAX_TEXT_CHARS} caractères.`);
    return `--- Fichier joint : ${name} ---\n${text}\n--- Fin du fichier joint ---`;
}

async function renderPdf(bytes) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = require("@napi-rs/canvas");
    const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
    const task = getDocument({
        data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true,
        standardFontDataUrl: path.join(root, "standard_fonts") + "/",
        cMapUrl: path.join(root, "cmaps") + "/", cMapPacked: true,
        wasmUrl: path.join(root, "wasm") + "/", verbosity: 0
    });
    try {
        const pdf = await task.promise;
        if (pdf.numPages > MAX_PAGES) throw new Error(`PDF trop long : ${pdf.numPages} pages (maximum ${MAX_PAGES}).`);
        const images = [];
        let total = 0;
        for (let number = 1; number <= pdf.numPages; number++) {
            const page = await pdf.getPage(number);
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(2, 2400 / Math.max(base.width, base.height));
            const viewport = page.getViewport({ scale });
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            try {
                await page.render({ canvasContext: canvas.getContext("2d"), viewport, background: "white" }).promise;
                const png = canvas.toBuffer("image/png");
                total += png.length;
                if (total > 50 * 1024 * 1024) throw new Error("PDF trop volumineux après conversion (50 Mo maximum).");
                images.push(`data:image/png;base64,${png.toString("base64")}`);
            } finally {
                page.cleanup();
                canvas.width = canvas.height = 1;
            }
        }
        return images;
    } finally {
        await task.destroy();
    }
}

module.exports = { convertAttachment, renderPdf, MAX_PAGES };
