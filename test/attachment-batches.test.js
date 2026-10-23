"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAttachmentBatches, sendAttachmentBatches } = require("../src/api/attachment-batches");
const { requestModel } = require("../src/api/api");
const { state } = require("../src/state");
const { auth } = require("../src/api/auth");

test("mixed attachments share a limit of four, text is preserved", () => {
    const text = "abc😀".repeat(1800);
    const plan = createAttachmentBatches(["i1", "i2", "i3"], ["f1", "f2", "f3"], text, 2000);
    assert.deepEqual(plan.batches[0].images, ["i1", "i2", "i3"]);
    assert.deepEqual(plan.batches[0].files, ["f1"]);
    assert.deepEqual(plan.batches[1].files, ["f2", "f3"]);
    assert.equal(plan.batches.map(b => b.text).join(""), text);
    assert.ok(plan.batches.every(b => b.images.length + b.files.length <= 4 && b.text.length <= 1000));
});

test("successful lots survive retry; replacing the chat resends them", async () => {
    const plan = createAttachmentBatches(Array.from({ length: 13 }, (_, i) => `image-${i}`), [], "", 2000);
    let chat = "chat-1", fail = true;
    const received = [];
    const send = async (_, batch) => {
        if (batch.images[0] === "image-4" && fail) { fail = false; throw Error("network"); }
        received.push(batch.images[0]);
    };
    await assert.rejects(sendAttachmentBatches(plan, () => chat, send), /network/);
    await sendAttachmentBatches(plan, () => chat, send);
    assert.deepEqual(received, ["image-0", "image-4", "image-8", "image-12"]);
    chat = "chat-2";
    await sendAttachmentBatches(plan, () => chat, send);
    assert.deepEqual(received.slice(4), received.slice(0, 4));
});

test("missing conversation ID stops delivery instead of losing earlier files", async () => {
    const plan = createAttachmentBatches(["i"], [], "", 2000);
    await assert.rejects(sendAttachmentBatches(plan, () => null, async () => {}), /conversation/);
    assert.equal(plan.next, 0);
});

function response(text, chatId = "batch-chat", usage = null) {
    const metrics = usage ? `event: response.completed\ndata: ${JSON.stringify({ response: { usage } })}\n\n` : "";
    return new Response(`event: response.output_text.delta\ndata: ${JSON.stringify({ chat_id: chatId, delta: text })}\n\n${metrics}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

test("13 files produce hidden lots of four and one visible final response, with retry", async () => {
    const fetch = global.fetch;
    auth.accessToken = "test-token";
    auth.expiresAt = Date.now() + 300000;
    state.chatIds.chat = null;
    state.pendingImages = Array.from({ length: 11 }, (_, i) => `11111111-2222-3333-4444-${String(i).padStart(12, "0")}`);
    state.pendingFiles = ["legacy-1", "legacy-2"];
    const expectedImages = [...state.pendingImages];
    const requests = [], visible = [];
    let finalAttempts = 0;
    global.fetch = async (url, init) => {
        assert.ok(String(url).endsWith("/chats/stream"));
        const body = JSON.parse(init.body);
        requests.push(body);
        assert.ok(body.images.length + body.files.length <= 4);
        if(body.images.length)return response(JSON.stringify({images:body.images.map((_,index)=>({index:index+1,status:"seen",description:"A document image with a visible title and text."}))}),"batch-chat",{input_tokens:requests.length*10000,output_tokens:10});
        if (/^Réception des pièces jointes/.test(body.initialContent)) return response("Reçu", "batch-chat", { input_tokens: requests.length * 10000, output_tokens: 10 });
        if (++finalAttempts === 1) return new Response("temporary", { status: 500 });
        return response("Réponse finale", "batch-chat", { input_tokens: 60000, output_tokens: 500 });
    };
    try {
        const answer = await requestModel("Compare tous ces fichiers", { onDelta: delta => visible.push(delta) });
        assert.equal(answer, "Réponse finale");
        assert.deepEqual(visible, ["Réponse finale"]);
        assert.equal(requests.length, 6);
        assert.equal(requests[0].chatId, null);
        assert.ok(requests.slice(1).every(r => r.chatId === "batch-chat"));
        assert.deepEqual(requests.slice(0, 4).flatMap(r => r.images), expectedImages);
        assert.deepEqual(requests[4].images, []);
        assert.deepEqual(requests.flatMap(r => r.files), ["legacy-1", "legacy-2"]);
        assert.ok(requests.slice(0, 4).every(r => r.enableWebSearch === false));
        assert.match(requests[4].initialContent, /Compare tous ces fichiers/);
        assert.deepEqual(state.pendingImages, []);
        assert.deepEqual(state.pendingFiles, []);
        assert.equal(requestModel.compactor.get("chat", "batch-chat").tokens, 60500, "le contexte n’additionne pas les entrées de tous les lots");
    } finally {
        global.fetch = fetch;
        state.pendingImages = [];
        state.pendingFiles = [];
    }
});

test("queue attachment store accepts more than ten files", () => {
    const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
    const { createAttachmentStore } = require("../desktop/queue-attachments");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-many-files-"));
    try {
        const store = createAttachmentStore(path.join(dir, "queue.json"));
        const id = "11111111-2222-3333-4444-555555555555";
        const files = Array.from({ length: 101 }, (_, i) => ({ kind: "text", name: `${i}.txt`, data: "notes" }));
        const metadata = store.write(id, files);
        assert.equal(metadata.length, 101);
        assert.equal(store.read({ id, attachments: metadata }).length, 101);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("desktop normalization retains all selected images", () => {
    const fs = require("node:fs"), vm = require("node:vm");
    const source = fs.readFileSync(require.resolve("../desktop/main.js"), "utf8");
    const start = source.indexOf("const MAX_ATTACHMENT_TEXT_CHARS");
    const end = source.indexOf("async function submit(", start);
    const context = vm.createContext({});
    vm.runInContext(source.slice(start, end) + "; globalThis.normalize = normalizeAttachments;", context);
    const files = Array.from({ length: 101 }, (_, i) => ({ kind: "image", name: `${i}.png`, data: "data:image/png;base64,YWJj" }));
    const result = context.normalize(files);
    assert.equal(result.images.length, 101);
    assert.equal(result.names[100], "100.png");
});

test("cancelling a receiving lot stops before the final request", async () => {
    const fetch = global.fetch;
    state.chatIds.chat = "batch-chat";
    state.pendingImages = Array.from({ length: 5 }, (_, i) => `11111111-2222-3333-4444-${String(i).padStart(12, "0")}`);
    state.pendingFiles = [];
    let requests = 0;
    global.fetch = async url => {
        if (String(url).endsWith("/stream/cancel")) return Response.json({});
        if (String(url).endsWith("/usage")) return Response.json({contextUsagePercent:10});
        requests++;
        throw new Error("aborted");
    };
    try {
        await assert.rejects(requestModel("Compare", { onInterrupt: handler => { handler(); return () => {}; } }), error => error.cancelled === true);
        assert.equal(requests, 1);
        assert.equal(state.pendingImages.length, 5);
    } finally {
        global.fetch = fetch;
        state.pendingImages = [];
    }
});
