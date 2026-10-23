"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { zipSync } = require("fflate");
const sharp = require("sharp");
const { convertAttachment } = require("../src/api/file-conversion");
const file = (name, bytes, type = "application/octet-stream") => ({ name, dataUrl: `data:${type};base64,${Buffer.from(bytes).toString("base64")}` });
const zip = entries => Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [name, typeof bytes === "string" ? Buffer.from(bytes) : bytes]))));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/><text x="1" y="8">Test SVG</text></svg>';

test("SVG source and PNG rendering are transmitted together; external resources never load", async () => {
    const result = await convertAttachment(file("logo.svg", svg, "image/svg+xml"));
    assert.match(result.text, /<rect/);
    assert.equal(result.images.length, 1);
    assert.equal((await sharp(Buffer.from(result.images[0].split(",")[1], "base64")).metadata()).width, 20);
    const external = svg.replace('</svg>', '<script>alert(1)</script><image href="http://127.0.0.1:1/private"/></svg>');
    const sanitized = await convertAttachment(file("external.svg", external));
    assert.equal(sanitized.images.length, 1);
    assert.match(sanitized.text, /sans scripts ni ressources externes/);
    assert.ok(sanitized.text.includes(external), "the original source stays intact");
});

for (const [extension, bookType] of [["xlsx", "xlsx"], ["xls", "biff8"], ["ods", "ods"], ["xlsb", "xlsb"]]) {
    test(`${extension}: sheets, stored values and available formulas survive conversion`, async () => {
        const xlsx = require("xlsx");
        const workbook = xlsx.utils.book_new();
        const sheet = xlsx.utils.aoa_to_sheet([["Produit", "Prix"], ["Café", 10], ["Thé", 20]]);
        sheet.B4 = { t: "n", f: "SUM(B2:B3)", v: 30 };
        sheet["!ref"] = "A1:B4";
        xlsx.utils.book_append_sheet(workbook, sheet, "Ventes");
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([["Fin du classeur"]]), "Archives");
        const bytes = xlsx.write(workbook, { type: "buffer", bookType });
        const result = await convertAttachment(file(`prix.${extension}`, bytes));
        assert.equal(result.partial, false, result.text);
        assert.match(result.text, /Feuille : Ventes/);
        assert.match(result.text, /Café/);
        assert.match(result.text, /B4:.*30/);
        // CE's legacy writers save cached values but do not compile formula
        // strings into BIFF tokens. Assert formulas when present in the file.
        if (xlsx.read(bytes, { type: "buffer", cellFormula: true }).Sheets.Ventes.B4.f) assert.match(result.text, /SUM\(B2:B3\)/);
        assert.match(result.text, /Fin du classeur/);
    });
}

test("PPTX includes slides in presentation order, speaker notes and embedded images", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).png().toBuffer();
    const slide = text => `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="rImg"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`;
    const bytes = zip({
        "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
        "ppt/presentation.xml": '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="r2"/><p:sldId id="257" r:id="r1"/></p:sldIdLst></p:presentation>',
        "ppt/_rels/presentation.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>',
        "ppt/slides/slide1.xml": slide("Seconde diapositive"),
        "ppt/slides/slide2.xml": slide("Première diapositive"),
        "ppt/slides/_rels/slide2.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rNote" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="rImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
        "ppt/notesSlides/notesSlide1.xml": slide("Notes du présentateur"),
        "ppt/media/image1.png": png
    });
    const result = await convertAttachment(file("présentation.pptx", bytes));
    assert.equal(result.partial, false, result.text);
    assert.match(result.text, /Première diapositive/);
    assert.match(result.text, /Seconde diapositive/);
    assert.ok(result.text.indexOf("Première diapositive") < result.text.indexOf("Seconde diapositive"));
    assert.match(result.text, /Notes du présentateur/);
    assert.ok(result.images.length >= 1);
});

test("ODT, RTF and UTF-16 documents keep accented text", async () => {
    const odt = zip({ mimetype: "application/vnd.oasis.opendocument.text", "content.xml": '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>École et élèves</text:p></office:text></office:body></office:document-content>' });
    assert.match((await convertAttachment(file("cours.odt", odt))).text, /École et élèves/);
    assert.match((await convertAttachment(file("cours.rtf", String.raw`{\rtf1\ansi Bonjour \'e9cole\par Fin}`))).text, /école/);
    const unicode = Buffer.concat([Buffer.from([255, 254]), Buffer.from("École UTF-16", "utf16le")]);
    assert.match((await convertAttachment(file("cours.txt", unicode))).text, /École UTF-16/);
    assert.match((await convertAttachment(file("notes.txt", Buffer.from([0x43, 0x61, 0x66, 0xe9])))).text, /Café/);
});

test("ZIP and TAR.GZ recursively expose contents without writing files", async () => {
    const archive = zip({ "notes.txt": "Texte dans l’archive", "logo.svg": svg, "nested/data.json.gz": require("node:zlib").gzipSync('{"total":42}') });
    const result = await convertAttachment(file("documents.zip", archive));
    assert.match(result.text, /Texte dans l’archive/);
    assert.match(result.text, /"total":42/);
    assert.equal(result.images.length, 1);
    const pack = require("tar-stream").pack();
    const chunks = [];
    const ended = new Promise(resolve => pack.on("end", resolve));
    pack.on("data", chunk => chunks.push(chunk));
    pack.entry({ name: "notes.txt" }, "Texte TAR"); pack.finalize(); await ended;
    assert.match((await convertAttachment(file("documents.tar.gz", require("node:zlib").gzipSync(Buffer.concat(chunks))))).text, /Texte TAR/);
    const traversal = await convertAttachment(file("bad.zip", zip({ "../outside.txt": "NO_WRITE" })));
    assert.equal(traversal.partial, true);
    assert.match(traversal.text, /LECTURE PARTIELLE/);
});

test("email body and attached documents are both exposed", async () => {
    const eml = 'From: test@example.org\r\nTo: user@example.org\r\nSubject: Documents\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="parts"\r\n\r\n--parts\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nCorps du message\r\n--parts\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="notes.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nTm90ZXMgZGUgbGEgcGllY2Ugam9pbnRl\r\n--parts--\r\n';
    const result = await convertAttachment(file("courrier.eml", eml));
    assert.match(result.text, /Corps du message/);
    assert.match(result.text, /Notes de la piece jointe/);
});

test("unknown binaries and malformed office files produce explicit partial reports", async () => {
    for (const name of ["module.bin", "broken.xlsx", "broken.pptx", "broken.msg"]) {
        const result = await convertAttachment(file(name, Buffer.from([0, 1, 2, 3, 4, 5, 255])));
        assert.equal(result.partial, true);
        assert.match(result.text, /LECTURE PARTIELLE/);
        assert.match(result.text, /SHA-256/);
    }
});

test("WAV files expose duration and codec, without claiming transcription", async () => {
    const wav = Buffer.alloc(44 + 16000);
    wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36); wav.writeUInt32LE(16000, 40);
    const result = await convertAttachment(file("audio.wav", wav, "audio/wav"));
    assert.equal(result.partial, true);
    assert.match(result.text, /PCM/);
    assert.match(result.text, /n’est pas transcrit/);
});

test("Outlook MSG and old PPT preserve readable content", async () => {
    const cfb = require("xlsx").CFB;
    const mail = cfb.utils.cfb_new();
    cfb.utils.cfb_add(mail, "__substg1.0_0037001F", Buffer.from("Sujet Outlook\0", "utf16le"));
    cfb.utils.cfb_add(mail, "__substg1.0_1000001F", Buffer.from("Corps Outlook\0", "utf16le"));
    const msg = await convertAttachment(file("courrier.msg", cfb.write(mail, { type: "buffer" })));
    assert.match(msg.text, /Sujet Outlook/);
    assert.match(msg.text, /Corps Outlook/);
    const presentation = cfb.utils.cfb_new();
    const text = Buffer.from("Texte PowerPoint historique", "utf16le");
    const header = Buffer.alloc(8);
    header.writeUInt16LE(4000, 2); header.writeUInt32LE(text.length, 4);
    cfb.utils.cfb_add(presentation, "PowerPoint Document", Buffer.concat([header, text]));
    const ppt = await convertAttachment(file("ancien.ppt", cfb.write(presentation, { type: "buffer" })));
    assert.match(ppt.text, /Texte PowerPoint historique/);
    assert.equal(ppt.partial, true);
});

test("EPUB chapters follow reading order", async () => {
    const bytes = zip({
        mimetype: "application/epub+zip",
        "META-INF/container.xml": '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        "OEBPS/content.opf": '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="two"/><itemref idref="one"/></spine></package>',
        "OEBPS/one.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Dernier chapitre</p></body></html>',
        "OEBPS/two.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Premier chapitre</p></body></html>'
    });
    const result = await convertAttachment(file("livre.epub", bytes));
    assert.match(result.text, /Premier chapitre/);
    assert.match(result.text, /Dernier chapitre/);
    assert.ok(result.text.indexOf("Premier chapitre") < result.text.indexOf("Dernier chapitre"));
});

test("7z archives are read in memory and their contents use the normal conversion path", async () => {
    const seven = await require("7z-wasm")({ print: () => {}, printErr: () => {}, stdin: () => null });
    seven.FS.writeFile("/notes.txt", Buffer.from("Contenu du fichier 7z"));
    assert.equal(seven.callMain(["a", "-bsp0", "/test.7z", "/notes.txt"]), 0);
    const result = await convertAttachment(file("documents.7z", Buffer.from(seven.FS.readFile("/test.7z"))));
    assert.equal(result.partial, false, result.text);
    assert.match(result.text, /Contenu du fichier 7z/);
});

test("multipage TIFF transmits each page", async () => {
    const pixels = Buffer.concat([Buffer.from([255, 0, 0]), Buffer.from([0, 0, 255])]);
    const bytes = await sharp(pixels, { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).tiff({ compression: "lzw" }).toBuffer();
    const result = await convertAttachment(file("pages.tiff", bytes, "image/tiff"));
    assert.equal(result.images.length, 2);
    for (const [i, image] of result.images.entries()) {
        const data = await sharp(Buffer.from(image.split(",")[1], "base64")).removeAlpha().raw().toBuffer();
        assert.deepEqual([...data], i === 0 ? [255, 0, 0] : [0, 0, 255]);
    }
});

test("converted Excel and SVG reach the model as text and image instead of raw unsupported files", async () => {
    const { state } = require("../src/state");
    const { auth } = require("../src/api/auth");
    const { requestModel } = require("../src/api/api");
    const xlsx = require("xlsx");
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([["Bilan", 42]]), "Synthèse");
    auth.accessToken = "test-token"; auth.expiresAt = Date.now() + 300000;
    state.pendingImages = [];
    state.pendingFiles = [file("bilan.xlsx", xlsx.write(workbook, { type: "buffer", bookType: "xlsx" })), file("logo.svg", svg, "image/svg+xml")];
    const original = global.fetch;
    let uploads = 0, body;const bodies=[];
    global.fetch = async (url, init) => {
        if (String(url).endsWith("/files/upload")) { uploads++; return Response.json({ uuid: "11111111-2222-3333-4444-555555555555" }); }
        assert.ok(String(url).endsWith("/chats/stream"));
        body = JSON.parse(init.body);
        bodies.push(body);
        const answer=body.images.length?JSON.stringify({images:[{index:1,status:"seen",description:"An SVG logo with its shapes and colors visible."}]}):"ok";
        return new Response('event: response.output_text.delta\ndata: '+JSON.stringify({chat_id:"converted-docs",delta:answer})+'\n\ndata: [DONE]\n\n');
    };
    try {
        assert.equal(await requestModel("Lis les fichiers"), "ok");
        const content=bodies.map(item=>item.initialContent).join("\n");
        assert.match(content, /Feuille : Synthèse/);
        assert.match(content, /Bilan/);
        assert.match(content, /<svg/);
        assert.equal(bodies.flatMap(item=>item.images).length, 1);
        assert.deepEqual(body.files, []);
        assert.equal(uploads, 1);
    } finally { global.fetch = original; state.pendingImages = []; state.pendingFiles = []; }
});
