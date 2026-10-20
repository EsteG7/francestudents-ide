"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { auth } = require("../src/api/auth");
const account = require("../src/api/account");

const originalFetch = global.fetch;

test.after(() => {
    global.fetch = originalFetch;
});

function prepareAuth() {
    auth.accessToken = "test-token";
    auth.expiresAt = Date.now() + 300_000;
    auth.deviceId = "test-device";
}

test("describeSession : tokens réels si fournis, sinon estimation", () => {
    assert.match(account.describeSession({ requests: 0 })[0], /aucune requête/);

    const real = account.describeSession({ requests: 2, chars: 700, inputTokens: 120, outputTokens: 7, cachedTokens: 100, reported: 2 })[0];
    assert.match(real, /2 requête\(s\)/);
    assert.match(real, /120 tokens en entrée dont 100 en cache, 7 en sortie/);

    const estimated = account.describeSession({ requests: 1, chars: 700, inputTokens: 0, outputTokens: 0, cachedTokens: 0, reported: 0 })[0];
    assert.match(estimated, /≈ 200 tokens \(estimation\)/);
});

test("describeChatUsage lit ChatUsageDto", () => {
    const [line] = account.describeChatUsage("Conversation agent", {
        tokenUsage: { promptTokenCount: 50, candidatesTokenCount: 10, totalTokenCount: 65, reasoningTokenCount: 5 },
        contextUsagePercent: 12,
    });
    assert.match(line, /^Conversation agent : 65 tokens au total/);
    assert.match(line, /prompt 50, réponse 10, raisonnement 5/);
    assert.match(line, /contexte utilisé 12 %/);
    assert.match(account.describeChatUsage("Chat", null)[0], /indisponible/);
});

test("describeUserUsage liste les limites et le power-up", () => {
    const lines = account.describeUserUsage({
        rateLimits: [{ type: "chat", bucket: "daily", limit: 100, used: 25, remaining: 75, usedPercent: 25, remainingPercent: 75, resetAt: "2026-10-15T08:00:00Z" }],
        rateLimitPowerUpActive: true,
        chatBudget: null,
    });
    assert.match(lines[0], /Limite chat\/daily : 25\/100 \(25 % utilisés, 75 restants\), remise à zéro 2026-10-15 08:00/);
    assert.match(lines[1], /Power-up actif/);
    assert.match(account.describeUserUsage({ rateLimits: [] })[0], /aucune limite/);
});

test("getJson appelle l'URL avec le token et lit le JSON", { concurrency: false }, async () => {
    prepareAuth();
    let seen;
    global.fetch = async (url, init) => {
        seen = { url, init };
        return new Response(JSON.stringify({ tokenUsage: { totalTokenCount: 3 }, contextUsagePercent: 1 }), { status: 200 });
    };

    const dto = await account.fetchChatUsage("chat 1");
    assert.match(seen.url, /\/chats\/chat%201\/usage$/);
    assert.equal(seen.init.headers.Authorization, "Bearer test-token");
    assert.equal(dto.tokenUsage.totalTokenCount, 3);
});

test("getJson signale le statut HTTP en cas d'erreur", { concurrency: false }, async () => {
    prepareAuth();
    global.fetch = async () => new Response("non", { status: 500 });
    await assert.rejects(account.fetchUserUsage(), (error) => error.status === 500 && /\/user\/usage/.test(error.message));
});

const IMAGE_LIMIT = { type: "image", bucket: "daily", limit: 10, used: 9, remaining: 1, usedPercent: 90, resetAt: "2026-10-15T08:00:00Z" };
const CHAT_LIMIT = { type: "chat", bucket: "daily", limit: 100, used: 20, remaining: 80, usedPercent: 20, resetAt: "2026-10-15T08:00:00Z" };

test("summarizeUserQuota préfère chatBudget à la limite image la plus consommée", () => {
    const q = account.summarizeUserQuota({
        rateLimits: [IMAGE_LIMIT, CHAT_LIMIT],
        rateLimitPowerUpActive: false,
        chatBudget: { usedPercent: 42.4, remainingPercent: 57.6, resetAt: "2026-10-16T00:00:00Z", accountingUncertain: true },
    });
    assert.equal(q.percent, 42);
    assert.equal(q.source, "chatBudget");
    assert.equal(q.bucket, "chat");
    assert.equal(q.uncertain, true);
    assert.equal(q.resetAt, "2026-10-16T00:00:00Z");
    assert.equal(q.limits.length, 2);
});

test("summarizeUserQuota sans chatBudget : limite chat, jamais la limite image", () => {
    const q = account.summarizeUserQuota({ rateLimits: [IMAGE_LIMIT, CHAT_LIMIT], chatBudget: null });
    assert.equal(q.percent, 20);
    assert.equal(q.source, "rateLimit");

    const onlyImage = account.summarizeUserQuota({ rateLimits: [IMAGE_LIMIT] });
    assert.equal(onlyImage.percent, null);
    assert.equal(onlyImage.limits.length, 1);

    assert.equal(account.summarizeUserQuota(null).percent, null);
    assert.equal(account.isImageLimit(IMAGE_LIMIT), true);
    assert.equal(account.isImageLimit(CHAT_LIMIT), false);
});

test("describeUserUsage affiche d'abord le quota général de chat", () => {
    const lines = account.describeUserUsage({
        rateLimits: [IMAGE_LIMIT],
        chatBudget: { usedPercent: 30, remainingPercent: 70, resetAt: "2026-10-16T00:00:00Z", accountingUncertain: false },
    });
    assert.match(lines[0], /^Quota général de chat : 30 % utilisés \(70 % restants\), remise à zéro 2026-10-16 00:00/);
    assert.match(lines[1], /Limite image\/daily/);
});
