"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state } = require("../src/state");
const { auth } = require("../src/api/auth");
const { requestModel, MAX_REQUEST_FAILURES } = require("../src/api/api");

const originalFetch = global.fetch;

test("images remain attached on later turns but do not leak into a new conversation", async () => {
    prepareAuth();
    const image = "11111111-2222-3333-4444-123456789012", bodies = [];
    state.chatIds.agent = null; state.pendingImages = [image]; state.pendingFiles = [];
    global.fetch = async (_, init) => {
        bodies.push(JSON.parse(init.body));
        return new Response('event: response.output_text.delta\ndata: {"chat_id":"visual-retention-chat","delta":"ok"}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    };
    try {
        await requestModel("Analyse le design", { conversationMode: "agent" });
        await requestModel("Suite après lecture des fichiers", { conversationMode: "agent" });
        assert.deepEqual(bodies[0].images, [image]); assert.deepEqual(bodies[1].images, [image]);
        state.chatIds.agent = null;
        await requestModel("Nouvelle tâche sans image", { conversationMode: "agent" });
        assert.deepEqual(bodies[2].images, []);
    } finally { global.fetch = originalFetch; state.pendingImages = []; state.pendingFiles = []; state.chatIds.agent = null; }
});

test.after(() => {
    global.fetch = originalFetch;
});

test("requestModel additionne les tokens fournis par response.completed", { concurrency: false }, async () => {
    prepareAuth();
    const { usage } = require("../src/api/api");
    const before = { ...usage };
    global.fetch = async () => new Response(
        new ReadableStream({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(
                        'event: response.output_text.delta\ndata: {"delta":"ok"}\n\n' +
                        'event: response.completed\ndata: {"response":{"usage":{"input_tokens":120,"output_tokens":7,"input_tokens_details":{"cached_tokens":100}}}}\n\n' +
                        "data: [DONE]\n\n",
                    ),
                );
                controller.close();
            },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
    );

    assert.equal(await requestModel("bonjour"), "ok");
    assert.equal(usage.inputTokens - before.inputTokens, 120);
    assert.equal(usage.outputTokens - before.outputTokens, 7);
    assert.equal(usage.cachedTokens - before.cachedTokens, 100);
    assert.equal(usage.reported - before.reported, 1);
});

test("sans champ usage, les compteurs de tokens ne bougent pas", { concurrency: false }, async () => {
    prepareAuth();
    const { usage } = require("../src/api/api");
    const before = { ...usage };
    global.fetch = async () => successfulResponse();

    assert.equal(await requestModel("bonjour"), "ok");
    assert.equal(usage.reported, before.reported);
    assert.equal(usage.inputTokens, before.inputTokens);
});

test("usage is counted once per stream and context excludes retry billing totals", async () => {
    prepareAuth();
    const { usage } = require("../src/api/api");
    const { AutoCompact } = require("../src/agent/auto-compact");
    requestModel.compactor = new AutoCompact();
    const before = { ...usage };
    let calls = 0;
    const metrics = { input_tokens: 12000, output_tokens: 500 };
    global.fetch = async () => {
        calls++;
        const events = 'event: response.output_text.delta\ndata: {"delta":"ok"}\n\n' +
            `event: response.completed\ndata: ${JSON.stringify({ response: { usage: metrics } })}\n\n`;
        if (calls === 1) return new Response(events + 'event: error\ndata: {"message":"temporary network failure"}\n\n');
        return new Response(events + `event: completed\ndata: ${JSON.stringify({ usage: metrics })}\n\n`);
    };
    assert.equal(await requestModel("continue"), "ok");
    assert.equal(calls, 2);
    assert.equal(usage.inputTokens - before.inputTokens, 24000);
    assert.equal(usage.reported - before.reported, 2);
    assert.equal(requestModel.compactor.get("chat", "chat-1").tokens, 12500);
    requestModel.compactor = new AutoCompact();
});

test("Anthropic cache reads and writes occupy context without accumulating past request counts", async () => {
    prepareAuth();
    const { AutoCompact } = require("../src/agent/auto-compact");
    requestModel.compactor = new AutoCompact();
    global.fetch = async () => new Response('event: response.output_text.delta\ndata: {"delta":"ok"}\n\n' +
        'event: completed\ndata: {"usage":{"input_tokens":100,"cache_read_input_tokens":20000,"cache_creation_input_tokens":3000,"output_tokens":500}}\n\n');
    await requestModel("continue");
    assert.equal(requestModel.compactor.get("chat", "chat-1").tokens, 23600);
    requestModel.compactor = new AutoCompact();
});

test("large-window model does not compact at the old 100k limit", async () => {
    prepareAuth();
    const { AutoCompact } = require("../src/agent/auto-compact");
    requestModel.compactor = new AutoCompact();
    requestModel.compactor.record("chat", "chat-1", "requirements", "answer", 150000);
    let calls = 0;
    global.fetch = async (url, init) => {
        calls++;
        assert.ok(String(url).endsWith("/chats/stream"));
        assert.equal(JSON.parse(init.body).chatId, "chat-1");
        return successfulResponse();
    };
    assert.equal(await requestModel("continue"), "ok");
    assert.equal(calls, 1);
    requestModel.compactor = new AutoCompact();
});

test("actual server occupancy cancels a premature estimated compaction", async () => {
    prepareAuth();
    const { AutoCompact } = require("../src/agent/auto-compact");
    requestModel.compactor = new AutoCompact();
    requestModel.compactor.record("chat", "chat-1", "requirements", "answer", 1000000);
    let streams = 0, lookups = 0;
    global.fetch = async (url, init) => {
        if (String(url).endsWith("/usage")) {
            lookups++;
            return Response.json({ contextUsagePercent: 12 });
        }
        streams++;
        assert.equal(JSON.parse(init.body).chatId, "chat-1");
        return successfulResponse();
    };
    assert.equal(await requestModel("continue"), "ok");
    assert.equal(lookups, 1);
    assert.equal(streams, 1);
    requestModel.compactor = new AutoCompact();
});

function successfulResponse() {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(
                new TextEncoder().encode(
                    'event: response.output_text.delta\ndata: {"delta":"ok"}\n\n' +
                    "data: [DONE]\n\n",
                ),
            );
            controller.close();
        },
    });

    return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
    });
}

function prepareAuth() {
    auth.accessToken = "test-token";
    auth.expiresAt = Date.now() + 300_000;
    auth.deviceId = "test-device";
    state.chatIds.chat = "chat-1";
    state.model = -1002;
}

test("oversized image in server history recovers once without repeating the poisoned conversation",async()=>{
    prepareAuth();
    requestModel.compactor=new (require("../src/agent/auto-compact").AutoCompact)();
    const bodies=[];
    global.fetch=async(_url,init)=>{
        bodies.push(JSON.parse(init.body));
        if(bodies.length===1)return new Response('event: error\ndata: {"message":"400 BAD_REQUEST image dimensions exceed max allowed size: 8000 pixels (got 1280x10993)"}\n\n',{headers:{"content-type":"text/event-stream"}});
        return successfulResponse();
    };
    assert.equal(await requestModel("Continue inspecting capture"),"ok");
    assert.equal(bodies.length,2);assert.equal(bodies[0].chatId,"chat-1");assert.equal(bodies[1].chatId,null);
    assert.match(bodies[1].initialContent,/Continue inspecting capture/);
});

test("permanent provider 400 in an SSE error is not retried repeatedly",async()=>{
    prepareAuth();let calls=0;
    global.fetch=async()=>{calls++;return new Response('event: error\ndata: {"message":"400 BAD_REQUEST invalid_request_error"}\n\n',{headers:{"content-type":"text/event-stream"}});};
    await assert.rejects(requestModel("Request"),error=>error.status===400);
    assert.equal(calls,1);
});

test("automatic compaction opens a fresh conversation and resumes the agent task", { concurrency: false }, async () => {
    prepareAuth();
    const { AutoCompact } = require("../src/agent/auto-compact");
    requestModel.compactor = new AutoCompact();
    requestModel.compactor.record("chat", "chat-1", "Original user requirements", "Work in progress", 1000000);
    const requests = [];
    global.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return successfulResponse();
    };
    assert.equal(await requestModel("Continue current task"), "ok");
    assert.equal(requests.length, 2);
    assert.equal(requests[0].chatId, null);
    assert.match(requests[0].initialContent, /Original user requirements/);
    assert.equal(requests[1].chatId, null);
    assert.match(requests[1].initialContent, /CONTEXTE CONSERVÉ/);
    assert.match(requests[1].initialContent, /Continue current task/);
    requestModel.compactor = new AutoCompact();
});

test("context overflow compacts once and resumes without repeating the failed request", { concurrency: false }, async () => {
    prepareAuth();
    const { AutoCompact } = require("../src/agent/auto-compact");
    requestModel.compactor = new AutoCompact();
    requestModel.compactor.record("chat", "chat-1", "Keep my requirements", "Earlier work");
    const requests = [];
    global.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        if (requests.length === 1) return new Response("context_length_exceeded", { status: 400 });
        return successfulResponse();
    };
    assert.equal(await requestModel("Finish"), "ok");
    assert.equal(requests.length, 3);
    assert.equal(requests[0].chatId, "chat-1");
    assert.equal(requests[2].chatId, null);
    assert.match(requests[2].initialContent, /Finish/);
    requestModel.compactor = new AutoCompact();
});

test("requestModel retente puis réussit après deux échecs", { concurrency: false }, async () => {
    prepareAuth();
    let calls = 0;
    global.fetch = async () => {
        calls++;
        if (calls <= 2) throw new Error(`échec ${calls}`);
        return successfulResponse();
    };

    assert.equal(await requestModel("bonjour"), "ok");
    assert.equal(calls, 3);
});

test("requestModel abandonne après deux échecs", { concurrency: false }, async () => {
    prepareAuth();
    let calls = 0;
    global.fetch = async () => {
        calls++;
        throw new Error("service indisponible");
    };

    await assert.rejects(requestModel("bonjour"), /service indisponible/);
    assert.equal(calls, MAX_REQUEST_FAILURES + 1);
});

test("requestModel ouvre une nouvelle conversation agent après un 409", { concurrency: false }, async () => {
    prepareAuth();
    state.chatId = "agent-1";
    state.chatIds.agent = "agent-1";
    const chatIds = [];
    let calls = 0;
    global.fetch = async (url, init) => {
        calls++;
        chatIds.push(JSON.parse(init.body).chatId);
        if (calls === 1) return new Response("A stream is already active for this chat", { status: 409 });
        return successfulResponse();
    };

    assert.equal(await requestModel("bonjour", { conversationMode: "agent" }), "ok");
    assert.equal(calls, 2);
    assert.equal(chatIds[0], "agent-1");
    assert.ok(chatIds[1] == null);
});

test("après un 409 agent, le message complet remplace le message « suite »", { concurrency: false }, async () => {
    prepareAuth();
    state.chatId = "agent-1";
    state.chatIds.agent = "agent-1";
    const sent = [];
    let calls = 0;
    global.fetch = async (url, init) => {
        calls++;
        sent.push(JSON.parse(init.body).initialContent);
        if (calls === 1) return new Response("A stream is already active for this chat", { status: 409 });
        return successfulResponse();
    };

    await requestModel("suite courte", { conversationMode: "agent", freshMessage: () => "message complet" });
    assert.deepEqual(sent, ["suite courte", "message complet"]);
});

test("un 429 « budget épuisé » n'est pas relancé et indique l'heure de reprise", { concurrency: false }, async () => {
    prepareAuth();
    let calls = 0;
    global.fetch = async () => {
        calls++;
        return new Response(
            '{"status":429,"message":"Chat budget exhausted. Reset at 2026-10-13T02:59:59.999087269Z."}',
            { status: 429 },
        );
    };

    await assert.rejects(requestModel("bonjour"), /Budget de chat épuisé jusqu'au/);
    assert.equal(calls, 1);
});

test("Ctrl+C coupe le flux, appelle stream/cancel et ne relance pas", { concurrency: false }, async () => {
    prepareAuth();
    const streamCalls = [];
    const cancelCalls = [];
    global.fetch = async (url, init) => {
        if (String(url).endsWith("/stream/cancel")) {
            cancelCalls.push({ url: String(url), method: init.method });
            return new Response(null, { status: 200 });
        }
        streamCalls.push(String(url));
        const body = new ReadableStream({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(
                        'event: stream.open\ndata: {"chat_id":"chat-9","first_response_timeout_ms":300000}\n\n',
                    ),
                );
                init.signal.addEventListener("abort", () => controller.error(new Error("aborted")));
            },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };

    let interrupt = null;
    let removed = false;
    const pending = requestModel("bonjour", {
        fresh: true,
        onInterrupt: handler => { interrupt = handler; return () => { removed = true; }; },
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(typeof interrupt, "function");
    interrupt();

    await assert.rejects(pending, /Génération annulée/);
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(streamCalls.length, 1);
    assert.equal(cancelCalls.length, 1);
    assert.ok(cancelCalls[0].url.endsWith("/chats/chat-9/stream/cancel"));
    assert.equal(cancelCalls[0].method, "POST");
    assert.equal(removed, true);
});

test("cancelStream sans chatId ne fait aucun appel", { concurrency: false }, async () => {
    const { cancelStream } = require("../src/api/api");
    let calls = 0;
    global.fetch = async () => { calls++; return new Response(null, { status: 200 }); };

    assert.equal(await cancelStream(null), false);
    assert.equal(calls, 0);
});
