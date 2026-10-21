"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { webSearch, parseResults } = require("../src/tools/web-search");
const { validateToolCall } = require("../src/tools/registry");
const { state } = require("../src/state");
const xml = '<rss><channel><item><title>Docs &amp; API</title><link>https://example.org/docs?a=1&amp;b=2</link><description><![CDATA[<b>Extrait</b> utile]]></description></item><item><title>dup</title><link>https://example.org/docs?a=1&amp;b=2</link></item><item><title>unsafe</title><link>javascript:alert(1)</link></item></channel></rss>';
test("recherche : URLs, extraits, déduplication et validation", () => {
    assert.deepEqual(parseResults(xml), [{ title: "Docs & API", url: "https://example.org/docs?a=1&b=2", snippet: "Extrait utile" }]);
    assert.doesNotThrow(() => validateToolCall({ name: "web_search", args: { query: "documentation" } }));
    assert.throws(() => validateToolCall({ name: "web_search", args: { query: "" } }));
});
test("recherche : requête encodée, résultats structurés et erreur HTTP", async () => {
    const deps = { allowSearch: true, webFetch: async args => {
        const url = new URL(args.url);
        assert.equal(url.searchParams.get("q"), "documentation été & API");
        assert.equal(url.searchParams.get("format"), "rss");
        return { status: 200, content: xml };
    } };
    const result = await webSearch({ query: "documentation été & API", limit: 2 }, deps);
    assert.equal(result.results.length, 1);
    assert.ok(result.searched_at);
    await assert.rejects(webSearch({ query: "x" }, { allowSearch: true, webFetch: async () => ({ status: 503 }) }), /503/);
});
test("recherche : le réglage désactivé empêche tout accès réseau", async () => {
    const saved = { automaticWeb: state.automaticWeb, webSearch: state.webSearch };
    state.automaticWeb = false; state.webSearch = false;
    try {
        const result = await webSearch({ query: "test" }, { webFetch: () => { throw new Error("Ne doit pas être appelé"); } });
        assert.equal(result.denied, true);
    } finally { Object.assign(state, saved); }
});
