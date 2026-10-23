"use strict";

const { readZip, MAX_EXPANDED } = require("./archive-input");
const OFFICE_TYPES = {
    docx: "docx", docm: "docx", dotx: "docx", dotm: "docx",
    pptx: "pptx", pptm: "pptx", ppsx: "pptx", ppsm: "pptx", potx: "pptx", potm: "pptx",
    odt: "odt", ott: "odt", odp: "odp", otp: "odp", odg: "odg", otg: "odg", epub: "epub", rtf: "rtf"
};
const SHEET_TYPES = new Set(["xlsx", "xls", "xlsm", "xlsb", "xlt", "xltx", "xltm", "ods", "ots", "fods", "numbers", "dbf", "dif", "sylk", "slk", "wk1", "wk3", "wks", "123"]);

async function officeInput(bytes, extension) {
    const ast = await require("officeparser").parseOffice(bytes, {
        fileType: OFFICE_TYPES[extension], extractAttachments: true, ocr: false, ignoreNotes: false,
        decompressionLimits: { maxUncompressedBytes: MAX_EXPANDED, maxZipEntries: 10000, maxTableCells: 200000, maxRawContentLength: 2000000 }
    });
    const generated = await ast.to("text");
    let text = String(generated.value || "");
    const media = [];
    for (const attachment of ast.attachments || []) {
        if (attachment.type === "image" && attachment.data) {
            media.push({ name: attachment.name, dataUrl: `data:${attachment.mimeType || "image/png"};base64,${attachment.data}` });
        }
        if (attachment.chartData) text += `\nGraphique ${attachment.name} :\n${JSON.stringify(attachment.chartData)}`;
    }
    const issues = [...(ast.warnings || []), ...(generated.messages || [])];
    if (issues.length) text += "\nRemarques de lecture :\n" + issues.map(issue => String(issue.message || issue.code || issue.type || issue)).join("\n");
    if (!text.trim() && !media.length) text = "Document vide ou sans contenu textuel extractible.";
    return { text, media };
}

async function spreadsheetInput(bytes, extension) {
    if (["xlsx", "xlsm", "xlsb", "xltx", "xltm", "ods", "ots", "numbers"].includes(extension) && bytes.subarray(0, 2).toString() !== "PK") {
        throw new Error("Signature du classeur invalide ou fichier chiffré.");
    }
    if (["xls", "xlt"].includes(extension) && !bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")) &&
        !(bytes[0] === 9 && [0, 2, 4, 8].includes(bytes[1])) && !/^\s*(?:<\?xml|<html|<Workbook|<table)/i.test(bytes.subarray(0, 1000).toString("utf8"))) {
        throw new Error("Signature du classeur XLS invalide.");
    }
    if (bytes.subarray(0, 2).toString() === "PK") await readZip(bytes, { contents: false });
    const xlsx = require("xlsx");
    const workbook = xlsx.read(bytes, { type: "buffer", cellFormula: true, cellText: true, cellDates: true, bookVBA: false, cellHTML: false, sheetRows: 200001 });
    const lines = ["Classeur : valeurs enregistrées et formules, sans exécuter les macros ni recalculer les cellules."];
    let size = 0, cells = 0;
    for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        if (sheet["!fullref"]) throw new Error("Classeur trop volumineux : toutes les lignes ne peuvent pas être lues.");
        lines.push(`\nFeuille : ${name}`);
        if (workbook.Workbook?.Sheets?.find(s => s.name === name)?.Hidden) lines.push("Feuille masquée dans le classeur original.");
        // Iterate stored cells rather than trusting a potentially enormous !ref.
        for (const address of Object.keys(sheet).filter(key => !key.startsWith("!"))) {
            if (++cells > 200000 || size > 2000000) throw new Error("Classeur trop volumineux : limite de cellules ou de texte atteinte.");
            const cell = sheet[address];
            const value = cell.w ?? (cell.v instanceof Date ? cell.v.toISOString() : cell.v ?? "");
            let line = `${address}: ${JSON.stringify(value)}`;
            if (cell.f) line += ` ; formule =${cell.f}`;
            if (cell.c?.length) line += ` ; commentaires : ${cell.c.map(c => c.t).join(" | ")}`;
            if (cell.l?.Target) line += ` ; lien : ${cell.l.Target}`;
            lines.push(line); size += line.length;
        }
        if (sheet["!merges"]?.length) lines.push("Cellules fusionnées : " + sheet["!merges"].map(range => xlsx.utils.encode_range(range)).join(", "));
    }
    const media = [];
    if (bytes.subarray(0, 2).toString() === "PK") {
        for (const entry of await readZip(bytes)) {
            if (/^(?:xl\/media\/|Pictures\/)/i.test(entry.name) && entry.bytes?.length) {
                media.push({ name: entry.name, dataUrl: `data:image/${entry.name.split(".").pop()};base64,${entry.bytes.toString("base64")}` });
            }
            if (/^xl\/charts\/chart\d+\.xml$/i.test(entry.name) && entry.bytes) lines.push(`Graphique ${entry.name} (données XML) :\n${entry.bytes.toString("utf8")}`);
        }
    }
    return { text: lines.join("\n"), media };
}

async function legacyWordInput(bytes) {
    const document = await new (require("word-extractor"))().extract(bytes);
    return { text: [document.getBody(), document.getHeaders(), document.getFootnotes(), document.getEndnotes(), document.getAnnotations()].filter(Boolean).join("\n\n"), media: [] };
}

function legacyPresentationInput(bytes) {
    const compound = require("xlsx").CFB.read(bytes, { type: "buffer" });
    const stream = compound.FileIndex.find(entry => entry.name === "PowerPoint Document");
    if (!stream?.content) throw new Error("Flux PowerPoint introuvable.");
    const data = Buffer.from(stream.content), paragraphs = [];
    function walk(start, end, depth) {
        if (depth > 32) throw new Error("Imbrication PowerPoint excessive.");
        for (let offset = start; offset + 8 <= end;) {
            const version = data.readUInt16LE(offset) & 15;
            const type = data.readUInt16LE(offset + 2), length = data.readUInt32LE(offset + 4);
            const next = offset + 8 + length;
            if (next > end) break;
            if (type === 4000 && length % 2 === 0) paragraphs.push(data.subarray(offset + 8, next).toString("utf16le"));
            else if (type === 4008) paragraphs.push(data.subarray(offset + 8, next).toString("latin1"));
            else if (version === 15) walk(offset + 8, next, depth + 1);
            offset = next;
        }
    }
    walk(0, data.length, 0);
    if (!paragraphs.length) throw new Error("Aucun texte extractible du PowerPoint binaire.");
    return { text: "Lecture partielle du PPT historique : textes des enregistrements, sans rendu ni garantie d’ordre des diapositives.\n" + paragraphs.join("\n"), media: [], partial: true };
}

module.exports = { OFFICE_TYPES, SHEET_TYPES, officeInput, spreadsheetInput, legacyWordInput, legacyPresentationInput };
