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

const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF", "latin1");
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
    global.fetch = async () => { calls++; return new Response(JSON.stringify({ uuid: "11111111-2222-3333-4444-555555555555" }), { status: 200 }); };
    state.pendingFiles = ["file-old", { name: "a.pdf", dataUrl: PDF_DATA_URL }];

    await resolvePendingFiles();

    assert.equal(state.pendingFiles[0], "file-old");
    assert.deepEqual(state.pendingImages, ["11111111-2222-3333-4444-555555555555"]);
    assert.equal(calls, 1);
});

test("requestModel transmet le PDF via les images natives", { concurrency: false }, async () => {
    prepareAuth();
    const urls = [];
    let streamBody = null;
    global.fetch = async (url, init) => {
        urls.push(String(url));
        if (String(url).endsWith("/files/upload")) {
            return new Response(JSON.stringify({ uuid: "11111111-2222-3333-4444-555555555555" }), { status: 200 });
        }
        streamBody = JSON.parse(init.body);
        return successfulResponse();
    };
    state.pendingFiles = [{ name: "sujet.pdf", dataUrl: PDF_DATA_URL }];

    assert.equal(await requestModel("résume ce PDF"), "ok");

    assert.equal(urls.length, 2);
    assert.ok(urls[0].endsWith("/files/upload"));
    assert.ok(urls[1].endsWith("/chats/stream"));
    assert.deepEqual(streamBody.files, []);
    assert.deepEqual(streamBody.images, ["11111111-2222-3333-4444-555555555555"]);
    assert.deepEqual(state.pendingFiles, []);
});

const IMAGE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const IMAGE_ID = "11111111-2222-3333-4444-555555555555";

test("image uploaded as multipart then attached to agent request, reused on retry", async () => {
    prepareAuth();
    state.pendingImages = [IMAGE_DATA_URL];
    let uploads = 0, streams = 0;
    global.fetch = async (url, init) => {
        if (String(url).endsWith("/files/upload")) {
            uploads++;
            const file = init.body.get("file");
            assert.equal(file.type, "image/png");
            assert.ok(file.size > 0);
            assert.equal(init.headers["Content-Type"], undefined);
            return Response.json({ uuid: IMAGE_ID });
        }
        streams++;
        const body = JSON.parse(init.body);
        assert.deepEqual(body.images, [IMAGE_ID]);
        assert.match(body.initialContent, /PIÈCES JOINTES VISUELLES/);
        if (streams === 1) return new Response("temporary", { status: 500 });
        return successfulResponse();
    };
    assert.equal(await requestModel("Examine cette capture", { conversationMode: "agent" }), "ok");
    assert.equal(uploads, 1);
    assert.equal(streams, 2);
    assert.deepEqual(state.pendingImages, []);
});

test("fresh background requests do not consume or upload pending images", async () => {
    prepareAuth();
    state.pendingImages = [IMAGE_DATA_URL];
    global.fetch = async (url, init) => {
        assert.ok(String(url).endsWith("/chats/stream"));
        assert.deepEqual(JSON.parse(init.body).images, []);
        return successfulResponse();
    };
    await requestModel("Summarize context", { fresh: true });
    assert.deepEqual(state.pendingImages, [IMAGE_DATA_URL]);
});

test("invalid upload response fails visibly before requesting model", async () => {
    prepareAuth();
    state.pendingImages = [IMAGE_DATA_URL];
    let requests = 0;
    global.fetch = async url => {
        requests++;
        assert.ok(String(url).endsWith("/files/upload"));
        return Response.json({ id: "not-an-image-uuid" });
    };
    await assert.rejects(requestModel("Look"), /UUID image valide/);
    assert.equal(requests, 1);
    assert.deepEqual(state.pendingImages, [IMAGE_DATA_URL]);
});

test("agent prompt permits attached vision without claiming unavailable pixels", () => {
    const prompt = require("../src/agent/prompt").buildAgentPrompt({ task: "Examine image", history: [], observations: [], turn: 1, maxTurns: 0 });
    assert.match(prompt, /ne désactive pas la vision/);
    assert.doesNotMatch(prompt, /recherche, images, canvas/);
});
