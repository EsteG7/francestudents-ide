"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseConversation, createConversationImporter, fetchShare, shareUrl } = require("../desktop/conversation-import");

test("Codex JSONL keeps visible messages and excludes tools and system instructions", () => {
    const lines = [
        { type: "session_meta", payload: { instructions: "secret" } },
        { type: "response_item", payload: { role: "system", content: "secret" } },
        { type: "event_msg", payload: { type: "user_message", message: "Continue mon projet" } },
        { type: "response_item", payload: { role: "user", content: [{ type: "input_text", text: "Continue mon projet" }] } },
        { type: "response_item", payload: { type: "function_call", name: "write_file", arguments: "hidden" } },
        { type: "response_item", payload: { role: "assistant", content: [{ type: "output_text", text: "```js\nconst a = 1;\n```" }] } },
    ];
    const parsed = parseConversation(lines.map(v => JSON.stringify(v)).join("\n"));
    assert.equal(parsed.messages.length, 2);
    assert.match(parsed.body, /const a = 1/);
    assert.doesNotMatch(parsed.body, /secret|write_file|hidden/);
});

test("ChatGPT export follows the active branch", () => {
    const node = (role, text, parent, children = []) => ({ parent, children, message: { author: { role }, content: { parts: [text] } } });
    const parsed = parseConversation(JSON.stringify({ title: "Projet", current_node: "b", mapping: {
        root: node("user", "Début", null, ["a", "b"]), a: node("assistant", "ancienne branche", "root"), b: node("assistant", "branche active", "root"),
    } }));
    assert.equal(parsed.title, "Projet");
    assert.deepEqual(parsed.messages.map(m => m.text), ["Début", "branche active"]);
});

test("Markdown preserves code headings and accepts plain historical context", () => {
    const parsed = parseConversation("## User\nBonjour\n## Assistant\n```md\n## User\nfaux rôle\n```\nSuite");
    assert.equal(parsed.messages.length, 2);
    assert.match(parsed.messages[1].text, /## User/);
    assert.equal(parseConversation("Une conversation collée").messages[0].role, "context");
});

test("HTML data and streamed reference tables are parsed without executing scripts", () => {
    const data = { messages: [{ role: "user", content: "Question" }, { role: "assistant", content: "Réponse" }] };
    assert.equal(parseConversation(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`).messages.length, 2);
    const table = [{ _1: 2 }, "messages", [3, 8], { _4: 5, _6: 7 }, "role", "user", "content", "Question", { _4: 9, _6: 10 }, "assistant", "Réponse"];
    const html = `<script>throw new Error('must not run'); streamController.enqueue(${JSON.stringify(JSON.stringify(table))})</script>`;
    assert.deepEqual(parseConversation(html).messages.map(m => m.text), ["Question", "Réponse"]);
    assert.throws(() => parseConversation("<html>Connectez-vous pour continuer</html>", { remote: true }), /Aucune conversation/);
});

test("share fetching restricts destinations, excludes credentials and rejects inaccessible links", async () => {
    for (const url of ["http://chatgpt.com/share/abcdef", "https://localhost/share/abcdef", "https://chatgpt.com/c/abcdef", "https://user:pass@chatgpt.com/share/abcdef"]) assert.throws(() => shareUrl(url));
    let options;
    const result = await fetchShare("https://chatgpt.com/share/abcdef", async (_, opts) => { options = opts; return new Response("## User\nBonjour"); });
    assert.match(result.content, /Bonjour/);
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Authorization, undefined);
    await assert.rejects(fetchShare(result.source, async () => new Response(null, { status: 302, headers: { location: "https://localhost/private" } })), /pas un lien/);
    await assert.rejects(fetchShare(result.source, async () => new Response(null, { status: 403 })), /HTTP 403/);
});

test("preview tokens preserve full context, expire, and can only be applied once", async () => {
    let now = 0;
    const importer = createConversationImporter({ now: () => now });
    const preview = await importer.preview({ content: "## User\nBonjour\n## Assistant\nRéponse" });
    assert.equal(preview.messageCount, 2);
    const file = importer.consume(preview.token);
    assert.match(Buffer.from(file.data.split(",")[1], "base64").toString("utf8"), /Bonjour[\s\S]*Réponse/);
    assert.throws(() => importer.consume(preview.token), /expiré/);
    const expired = await importer.preview({ content: "Contexte" });
    now = 31 * 60000;
    assert.throws(() => importer.get(expired.token), /expiré/);
});
