"use strict";

const { webFetch, decodeEntities, htmlToText } = require("./web-fetch");
const { requireString, optionalInt } = require("./core/args");
const { state } = require("../state");

function parseResults(xml, limit = 5) {
    const results = [];
    const seen = new Set();
    const field = (item, name) => {
        const value = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i").exec(item)?.[1] || "";
        return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
    };
    for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
        const url = field(match[1], "link");
        let parsed;
        try { parsed = new URL(url); } catch { continue; }
        if (!["http:", "https:"].includes(parsed.protocol) || seen.has(url)) continue;
        seen.add(url);
        results.push({ title: htmlToText(field(match[1], "title")), url, snippet: htmlToText(field(match[1], "description")).slice(0, 1600) });
        if (results.length >= limit) break;
    }
    return results;
}

async function webSearch(args, deps = {}) {
    check(args);
    if (!state.automaticWeb && !state.webSearch && !deps.allowSearch) {
        return { query: args.query, results: [], denied: true, changed: false, message: "Recherche web désactivée dans les paramètres." };
    }
    if(args.background===true)return require("./web-research").manager.start(args);
    const url = new URL("https://www.bing.com/search");
    url.searchParams.set("q", args.query);
    url.searchParams.set("format", "rss");
    const page = await (deps.webFetch || webFetch)({ url: url.href, max_chars: 100000 }, { confirm: async () => true,signal:deps.signal });
    if (page.status !== 200) throw new Error(`Recherche indisponible : HTTP ${page.status}.`);
    const results = parseResults(page.content || "", Math.min(10, Math.max(1, args.limit || 5)));
    return {
        query: args.query, provider: "Bing RSS", searched_at: new Date().toISOString(), results, changed: false,
        message: results.length ? `${results.length} résultat(s). Ouvre les liens utiles avec web_fetch pour vérifier et citer les sources.` : "Aucun résultat exploitable. Essaie une autre requête ou ouvre directement la documentation avec web_fetch."
    };
}

function check(args) {
    requireString(args.query, "query");
    if (args.query.length > 1000) throw new Error("Requête trop longue (1000 caractères maximum).");
    optionalInt(args.limit, "limit");
    if(args.background!==undefined&&typeof args.background!=="boolean")throw new Error("background doit être un booléen.");
}

module.exports = { name: "web_search", run: webSearch, check, describe: a => a.query, webSearch, parseResults };
