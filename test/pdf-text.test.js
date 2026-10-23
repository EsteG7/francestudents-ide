"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");

const { extractPdfText, isPdf } = require("../src/api/pdf-text");
const { state } = require("../src/state");
const { auth } = require("../src/api/auth");
const { requestModel, resolvePendingFiles } = require("../src/api/api");

/** Construit un PDF minimal avec un flux de contenu (compressé ou non). */
function makePdf(content, { compress = false, extra = "" } = {}) {
    const body = compress ? zlib.deflateSync(Buffer.from(content, "latin1")) : Buffer.from(content, "latin1");
    const dict = compress ? `<< /Length ${body.length} /Filter /FlateDecode >>` : `<< /Length ${body.length} >>`;
    return Buffer.concat([
        Buffer.from(
            "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
            "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
            "3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n" +
            `${extra}4 0 obj\n${dict}\nstream\n`,
            "latin1"
        ),
        body,
        Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1")
    ]);
}

const CONTENT = "BT /F1 12 Tf 72 720 Td (Bonjour le monde) Tj 0 -14 Td [(Deuxi) 10 (\\350me) -300 (ligne)] TJ ET";

const originalFetch = global.fetch;
test.after(() => {
    global.fetch = originalFetch;
    state.pendingFiles = [];
    state.pendingImages = [];
});

function prepareAuth() {
    auth.accessToken = "test-token";
    auth.expiresAt = Date.now() + 300_000;
    auth.deviceId = "test-device";
    state.chatIds.chat = "chat-1";
    state.model = -1002;
    state.pendingImages = [];
    state.pendingFiles = [];
}

function successfulResponse() {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(
                'event: response.output_text.delta\ndata: {"delta":"ok"}\n\ndata: [DONE]\n\n'
            ));
            controller.close();
        }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const forbidden = () => new Response(JSON.stringify({
    status: 403,
    message: "Missing required unleash toggle. Expected one of: 2026_06_storage"
}), { status: 403 });

const dataUrl = (buf) => `data:application/pdf;base64,${buf.toString("base64")}`;

test("extractPdfText lit un flux non compressé", () => {
    const { text, pages } = extractPdfText(makePdf(CONTENT));
    assert.match(text, /Bonjour le monde/);
    assert.match(text, /Deuxième ligne/);
    assert.match(text, /monde\nDeuxième/);
    assert.equal(pages, 1);
});

test("extractPdfText lit un flux FlateDecode", () => {
    const { text } = extractPdfText(makePdf(CONTENT, { compress: true }));
    assert.match(text, /Bonjour le monde/);
assert.match(text, /Deuxième ligne/);
});

test("extractPdfText applique une table ToUnicode", () => {
    const cmap = "/CIDInit /ProcSet findresource begin begincmap\n2 beginbfchar\n<0001> <0048>\n<0002> <00E9>\nendbfchar\n" +
        "1 beginbfrange\n<0003> <0004> <006C>\nendbfrange\nendcmap";
    const extra = `9 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream\nendobj\n`;
    const { text } = extractPdfText(makePdf("BT <0001000200030004> Tj ET", { extra }));
    assert.equal(text, "Hélm");
});

test("extractPdfText refuse les PDF chiffrés, vides ou invalides", () => {
    assert.throws(() => extractPdfText(Buffer.from("pas un pdf")), /pas un PDF/);
    assert.throws(() => extractPdfText(makePdf(CONTENT, { extra: "8 0 obj\n<< /Encrypt 7 0 R >>\nendobj\n" })), /chiffré/);
    assert.throws(() => extractPdfText(makePdf("q1 0 0 1 0 0 cm Q")), /aucun texte/);
    assert.equal(isPdf(makePdf(CONTENT)), true);
});

test("extractPdfText tronque les textes trop longs", () => {
    const result = extractPdfText(makePdf(CONTENT), { maxChars: 5 });
    assert.equal(result.truncated, true);
    assert.match(result.text, /^Bonjo\n\[… tronqué\]$/);
});

test("PDF converti en images sans appel Files v2", { concurrency: false }, async () => {
    prepareAuth();
    let streamBody = null;const bodies=[];
    global.fetch = async (url, init) => {
        if (String(url).endsWith("/files/upload")) return Response.json({uuid:"11111111-2222-3333-4444-555555555555"});
        streamBody = JSON.parse(init.body);
        bodies.push(streamBody);
        if(streamBody.images.length)return new Response('event: response.output_text.delta\ndata: '+JSON.stringify({chat_id:"pdf-receipt",delta:JSON.stringify({images:[{index:1,status:"seen",description:"A PDF course page containing readable text."}]})})+'\n\ndata: [DONE]\n\n');
        return successfulResponse();
    };
    state.pendingFiles = [{ name: "cours.pdf", dataUrl: dataUrl(makePdf(CONTENT, { compress: true })) }];

    assert.equal(await requestModel("résume ce PDF"), "ok");

    assert.deepEqual(streamBody.files, []);
    assert.match(streamBody.initialContent, /^résume ce PDF/);
    assert.match(bodies.map(item=>item.initialContent).join("\n"), /Fichier joint : cours\.pdf/);
    assert.deepEqual(bodies.flatMap(item=>item.images), ["11111111-2222-3333-4444-555555555555"]);
    assert.deepEqual(state.pendingFiles, []);
});

test("DOCX invalide : diagnostic partiel sans bloquer les autres pièces jointes", { concurrency: false }, async () => {
    prepareAuth();
    global.fetch = async () => forbidden();
    state.pendingFiles = [{ name: "cours.docx", dataUrl: "data:application/octet-stream;base64,UEsDBA==" }];

    const result = await resolvePendingFiles();
    assert.match(result, /LECTURE PARTIELLE/);
    assert.match(result, /cours\.docx/);
});

test("PDF sans texte : rendu en image", { concurrency: false }, async () => {
    prepareAuth();
    global.fetch = async () => Response.json({uuid:"11111111-2222-3333-4444-555555555555"});
    state.pendingFiles = [{ name: "scan.pdf", dataUrl: dataUrl(makePdf("q Q")) }];

    await resolvePendingFiles();
    assert.equal(state.pendingImages.length, 1);
});
