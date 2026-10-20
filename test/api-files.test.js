"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state } = require("../src/state");
const { auth } = require("../src/api/auth");
const { requestModel, uploadFile, resolvePendingFiles } = require("../src/api/api");

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
                'event: response.output_text.delta\ndata: {"delta":"ok"}\n\n' +
                "data: [DONE]\n\n"
            ));
            controller.close();
        }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const PDF_BYTES = Buffer.from("%PDF-1.4\n\u0000\u0001binaire\n%%EOF", "latin1");
const PDF_DATA_URL = `data:application/pdf;base64,${PDF_BYTES.toString("base64")}`;

test("uploadFile envoie un PDF sur /filesv2 avec son nom et son type MIME", { concurrency: false }, async () => {
    prepareAuth();
    const calls = [];
    global.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ id: "file-abc123", object: "file" }), { status: 200 });
    };

    const id = await uploadFile({ name: "rapport.pdf", dataUrl: PDF_DATA_URL });

    assert.equal(id, "file-abc123");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/filesv2"));
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["Content-Type"], undefined);
    const sent = calls[0].init.body.get("file");
    assert.equal(sent.name, "rapport.pdf");
    assert.equal(sent.type, "application/pdf");
    assert.deepEqual(Buffer.from(await sent.arrayBuffer()), PDF_BYTES);
});

test("uploadFile accepte un document Office et renvoie l'erreur HTTP", { concurrency: false }, async () => {
    prepareAuth();
    const docx = "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBA==";
    global.fetch = async () => new Response("type non pris en charge", { status: 415 });

    await assert.rejects(
        uploadFile({ name: "cours.docx", dataUrl: docx }),
        (error) => error.status === 415 && /cours\.docx/.test(error.message)
    );
});

test("uploadFile refuse une data URL invalide sans appel réseau", { concurrency: false }, async () => {
    prepareAuth();
    let calls = 0;
    global.fetch = async () => { calls++; return new Response("{}", { status: 200 }); };

    await assert.rejects(uploadFile({ name: "x.pdf", dataUrl: "pas une data url" }), /data URL base64/);
    assert.equal(calls, 0);
});

test("uploadFile explique le 403 du feature flag Files v2", { concurrency: false }, async () => {
    prepareAuth();
    const body = JSON.stringify({
        status: 403,
        error: "Forbidden",
        message: "Missing required unleash toggle. Expected one of: 2026_06_storage",
        errorCode: "UNAUTHORIZED_ACCESS",
        path: "/filesv2"
    });
    global.fetch = async () => new Response(body, { status: 403 });

    await assert.rejects(
        uploadFile({ name: "cv.pdf", dataUrl: PDF_DATA_URL }),
        (error) => error.status === 403 &&
            error.featureToggle === "2026_06_storage" &&
            /cv\.pdf/.test(error.message) &&
            /pas activé pour ce compte/.test(error.message) &&
            /2026_06_storage/.test(error.message)
    );
});

test("resolvePendingFiles garde les ID déjà envoyés", { concurrency: false }, async () => {
    prepareAuth();
    let calls = 0;
    global.fetch = async () => { calls++; return new Response(JSON.stringify({ id: "file-new" }), { status: 200 }); };
    state.pendingFiles = ["file-old", { name: "a.pdf", dataUrl: PDF_DATA_URL }];

    await resolvePendingFiles();

    assert.deepEqual(state.pendingFiles, ["file-old", "file-new"]);
    assert.equal(calls, 1);
});

test("requestModel envoie les fichiers joints puis passe leurs ID dans files", { concurrency: false }, async () => {
    prepareAuth();
    const urls = [];
    let streamBody = null;
    global.fetch = async (url, init) => {
        urls.push(String(url));
        if (String(url).endsWith("/filesv2")) {
            return new Response(JSON.stringify({ id: "file-xyz" }), { status: 200 });
        }
        streamBody = JSON.parse(init.body);
        return successfulResponse();
    };
    state.pendingFiles = [{ name: "sujet.pdf", dataUrl: PDF_DATA_URL }];

    assert.equal(await requestModel("résume ce PDF"), "ok");

    assert.equal(urls.length, 2);
    assert.ok(urls[0].endsWith("/filesv2"));
    assert.ok(urls[1].endsWith("/chats/stream"));
    assert.deepEqual(streamBody.files, ["file-xyz"]);
    assert.deepEqual(streamBody.images, []);
    assert.deepEqual(state.pendingFiles, []);
});
