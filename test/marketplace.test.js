"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createMarketplace, rawSkillUrl} = require("../desktop/marketplace");
test("SkillsMP : recherche, pagination et clé limitée à la requête authentifiée", async () => {
    const seen = [];
    const market = createMarketplace({getKey:async () => "FAKE_KEY", fetchFn:async (url, options) => {
        seen.push({url:String(url), options});
        return new Response(JSON.stringify({data:{skills:[{id:"qa", name:"qa", author:"QA", stars:42, githubUrl:"https://github.com/a/b/tree/main/qa"}], pagination:{hasNext:true}}}), {headers:{"x-ratelimit-daily-remaining":"12"}});
    }});
    const result = await market.search({query:"web & tests", page:2});
    assert.equal(result.items[0].stars, 42);
    assert.equal(result.hasNext, true);
    assert.equal(result.remaining, "12");
    assert.equal(new URL(seen[0].url).searchParams.get("q"), "web & tests");
    assert.equal(seen[0].options.headers.Authorization, "Bearer FAKE_KEY");
    assert.doesNotMatch(JSON.stringify(result), /FAKE_KEY/);
    await assert.rejects(market.search({query:"*"}), /mot-clé/);
});
test("aperçu obligatoire et import communautaire désactivé, sans transmettre la clé à GitHub", async () => {
    let headers;
    const market = createMarketplace({getKey:async () => "SECRET", fetchFn:async (_url, options) => {headers = options.headers; return new Response("---\nname: qa\ndisabled: false\ndisabled: false\n---\n\nTest QA");}});
    assert.throws(() => market.takePreview("unknown"), /instructions/);
    const preview = await market.preview({githubUrl:"https://github.com/a/b/tree/main/qa"});
    assert.match(preview.content, /disabled: true/);
    assert.equal(require("../src/skills").parseFrontmatter(preview.content).meta.disabled, "true");
    assert.equal(headers, undefined);
    assert.equal(market.takePreview(preview.url), preview.content);
    assert.equal(preview.url, "https://raw.githubusercontent.com/a/b/main/qa/SKILL.md");
    assert.throws(() => rawSkillUrl("http://localhost/secret"), /publics/);
    assert.throws(() => rawSkillUrl("https://github.com.evil.test/a/b/tree/main/qa"), /publics/);
});
test("limites réseau : réponses trop grandes et quota donnent des erreurs utiles", async () => {
    const quota = createMarketplace({fetchFn:async () => new Response("", {status:429})});
    await assert.rejects(quota.search({query:"qa"}), /Limite SkillsMP/);
    const large = createMarketplace({fetchFn:async () => new Response("x".repeat(250001))});
    await assert.rejects(large.preview({githubUrl:"https://github.com/a/b/tree/main/qa"}), /taille/);
});
