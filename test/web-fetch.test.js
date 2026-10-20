"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    webFetch,
    checkUrl,
    isPrivateAddress,
    htmlToText,
    decodeEntities
} = require("../src/tools/web-fetch");
const { validateToolCall, describeCall } = require("../src/tools/registry");
const { TOOL_CATALOG } = require("../src/agent/prompt");

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const yes = async () => true;

function htmlResponse(body, init = {}) {
    return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        ...init
    });
}

test("isPrivateAddress reconnaît les adresses locales et privées", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.16.5.5", "169.254.1.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
        assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) {
        assert.equal(isPrivateAddress(ip), false, ip);
    }
});

test("checkUrl refuse les schémas non http, localhost et les IP privées", async () => {
    await assert.rejects(checkUrl("ftp://example.com/a", { lookup: publicLookup }), /http/);
    await assert.rejects(checkUrl("file:///etc/passwd", { lookup: publicLookup }), /http/);
    await assert.rejects(checkUrl("http://localhost:3000/", { lookup: publicLookup }), /locale/);
    await assert.rejects(checkUrl("http://192.168.1.1/", { lookup: publicLookup }), /privée/);
    await assert.rejects(checkUrl("http://[::1]/", { lookup: publicLookup }), /privée/);
    await assert.rejects(checkUrl("https://user:pw@example.com/", { lookup: publicLookup }), /identifiants/);
    await assert.rejects(
        checkUrl("https://interne.example/", { lookup: async () => [{ address: "10.0.0.5", family: 4 }] }),
        /privée/
    );

    const url = await checkUrl("https://example.com/page#ancre", { lookup: publicLookup });
    assert.equal(url.href, "https://example.com/page");
});

test("htmlToText retire scripts et balises, et décode les entités", () => {
    const html = "<html><head><title>T</title><style>p{}</style></head><body>" +
        "<script>alert(1)</script><h1>Titre &amp; sous-titre</h1><p>Caf&eacute; &#233;t&#xE9;</p>" +
        "<ul><li>un</li><li>deux</li></ul></body></html>";
    const text = htmlToText(html);

    assert.doesNotMatch(text, /alert|p\{\}|<|>/);
    assert.match(text, /Titre & sous-titre/);
    assert.match(text, /Café été/);
    assert.match(text, /- un\n- deux/);
    assert.equal(decodeEntities("&inconnu; &lt;b&gt;"), "&inconnu; <b>");
});

test("webFetch renvoie le titre et le texte d'une page HTML", async () => {
    let seen = null;
    const result = await webFetch(
        { url: "https://example.com/doc" },
        {
            lookup: publicLookup,
            confirm: yes,
            fetch: async (url, options) => {
                seen = { url, options };
                return htmlResponse("<title>Doc</title><p>Bonjour le monde</p>");
            }
        }
    );

    assert.equal(seen.url, "https://example.com/doc");
    assert.equal(seen.options.redirect, "manual");
    assert.equal(result.status, 200);
    assert.equal(result.title, "Doc");
    assert.match(result.content, /Bonjour le monde/);
    assert.equal(result.truncated, false);
    assert.equal(result.changed, false);
});

test("webFetch respecte le refus de l'utilisateur sans requête réseau", async () => {
    let called = false;
    const result = await webFetch(
        { url: "https://example.com/" },
        { lookup: publicLookup, confirm: async () => false, fetch: async () => { called = true; } }
    );

    assert.equal(result.denied, true);
    assert.equal(called, false);
});

test("webFetch suit les redirections mais refuse une cible privée", async () => {
    const ok = await webFetch(
        { url: "https://example.com/a" },
        {
            lookup: publicLookup,
            confirm: yes,
            fetch: async url => url.endsWith("/a")
                ? new Response(null, { status: 301, headers: { location: "/b" } })
                : new Response("texte final", { headers: { "content-type": "text/plain" } })
        }
    );
    assert.equal(ok.final_url, "https://example.com/b");
    assert.equal(ok.content, "texte final");

    await assert.rejects(
        webFetch(
            { url: "https://example.com/a" },
            {
                lookup: publicLookup,
                confirm: yes,
                fetch: async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } })
            }
        ),
        /privée/
    );
});

test("webFetch tronque selon max_chars et ignore les contenus non textuels", async () => {
    const long = await webFetch(
        { url: "https://example.com/long", max_chars: 500 },
        {
            lookup: publicLookup,
            confirm: yes,
            fetch: async () => new Response("x".repeat(2000), { headers: { "content-type": "text/plain" } })
        }
    );
    assert.equal(long.content.length, 500);
    assert.equal(long.truncated, true);

    const image = await webFetch(
        { url: "https://example.com/a.png" },
        {
            lookup: publicLookup,
            confirm: yes,
            fetch: async () => new Response(Buffer.from([137, 80, 78, 71]), { headers: { "content-type": "image/png" } })
        }
    );
    assert.equal(image.content, "");
    assert.match(image.message, /non textuel/);
});

test("web_fetch est enregistré, validé et décrit dans le catalogue", () => {
    assert.doesNotThrow(() => validateToolCall({ name: "web_fetch", args: { url: "https://example.com" } }));
    assert.throws(() => validateToolCall({ name: "web_fetch", args: {} }), /url/);
    assert.throws(() => validateToolCall({ name: "web_fetch", args: { url: "ftp://x" } }), /http/);
    assert.throws(() => validateToolCall({ name: "web_fetch", args: { url: "https://x.fr", max_chars: "10" } }), /entier/);
    assert.equal(describeCall({ name: "web_fetch", args: { url: "https://example.com" } }), "https://example.com");

    assert.ok(TOOL_CATALOG.indexOf("17. web_fetch") > TOOL_CATALOG.indexOf("14. final"));
    assert.match(TOOL_CATALOG, /"name":"web_fetch","args":\{"url"/);
});
