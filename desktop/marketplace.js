"use strict";
const { setFrontmatterValue } = require("../src/skills");
async function boundedText(response, max = 250000, onProgress = () => {}) {
    if (!response.body) throw new Error("Réponse vide du serveur.");
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
        for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > max) throw new Error("Le téléchargement dépasse la taille autorisée.");
            chunks.push(Buffer.from(value));
            onProgress(size);
        }
        return Buffer.concat(chunks).toString("utf8");
    } finally { await reader.cancel().catch(() => {}); }
}
function rawSkillUrl(value) {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password) throw new Error("Seuls les dossiers publics github.com sont pris en charge.");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 5 || !["tree", "blob"].includes(parts[2]) || parts.some(part => [".", ".."].includes(decodeURIComponent(part)))) throw new Error("Lien GitHub attendu : /auteur/dépôt/tree/branche/dossier-du-skill.");
    const fileParts = [parts[0], parts[1], ...parts.slice(3)];
    if (!fileParts.at(-1).toLowerCase().endsWith("skill.md")) fileParts.push("SKILL.md");
    return `https://raw.githubusercontent.com/${fileParts.join("/")}`;
}
function createMarketplace({ fetchFn = (...args) => fetch(...args), getKey = async () => process.env.SKILLSMP_API_KEY || "", onProgress = () => {} } = {}) {
    const previews = new Map();
    const downloads = new Map();
    const bundles = new Map();
    return {
        async search({ query, page = 1, sort = "stars" }) {
            const q = String(query || "").trim();
            if (!q || q.length > 160 || !/[\p{L}\p{N}]/u.test(q)) throw new Error("Saisis un mot-clé de 1 à 160 caractères.");
            if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error("Page invalide.");
            const url = new URL("https://skillsmp.com/api/v1/skills/search");
            url.search = new URLSearchParams({q, page:String(page), limit:"20", sortBy:sort === "recent" ? "recent" : "stars"});
            const key = await getKey();
            const response = await fetchFn(url, { headers:{Accept:"application/json", ...(key ? {Authorization:`Bearer ${key}`} : {})}, redirect:"error", signal:AbortSignal.timeout(20000) });
            if (response.status === 429) throw new Error("Limite SkillsMP atteinte. Réessaie plus tard ou configure ta clé dans les paramètres.");
            if (response.status === 401) throw new Error("Clé SkillsMP refusée. Vérifie-la dans les paramètres.");
            if (!response.ok) throw new Error(`SkillsMP indisponible (HTTP ${response.status}).`);
            const data = JSON.parse(await boundedText(response, 500000));
            if (data.success === false || !Array.isArray(data.data?.skills)) throw new Error("SkillsMP a renvoyé un format inattendu.");
            const items = data.data.skills.slice(0, 20).map(item => ({
                id:String(item.id || "").slice(0, 500), name:String(item.name || "Skill").slice(0, 160), author:String(item.author || "Communauté").slice(0, 160),
                description:String(item.description || "").slice(0, 1800), githubUrl:String(item.githubUrl || ""), stars:Number(item.stars) || 0
            }));
            return {items, page, hasNext:data.data.pagination?.hasNext === true, remaining:response.headers.get("x-ratelimit-daily-remaining")};
        },
        cancel(requestId) { const controller = downloads.get(requestId); if (!controller) return false; controller.abort(); return true; },
        async preview({ githubUrl, curatedId, requestId = require("node:crypto").randomUUID() }) {
            const curated = curatedId ? require("./motion-marketplace").catalog.find(item=>item.id===curatedId) : null;
            if(curatedId && !curated)throw new Error("Skill motion inconnu.");
            const url = curated ? curated.githubUrl : rawSkillUrl(githubUrl);
            if (typeof requestId !== "string" || requestId.length > 100 || downloads.has(requestId) || downloads.size >= 8) throw new Error("Téléchargement déjà en cours ou limite de téléchargements atteinte.");
            const controller = new AbortController(); downloads.set(requestId, controller);
            try {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
            if(curated){
                const bundle=await require("./motion-marketplace").downloadBundle({id:curated.id,fetchFn,signal,onProgress:(received,total)=>onProgress({requestId,received,total})});
                bundles.set(url,bundle);if(bundles.size>8)bundles.delete(bundles.keys().next().value);
                return {url,content:bundle.content,resourceCount:bundle.files.length,resourceNames:bundle.files.map(file=>file.path)};
            }
            const response = await fetchFn(url, {redirect:"error", signal});
            if (!response.ok) throw new Error(`SKILL.md inaccessible sur GitHub (HTTP ${response.status}). Tu peux ouvrir le dépôt ou importer son contenu manuellement.`);
            const length = Number(response.headers.get("content-length"));
            const total = !response.headers.get("content-encoding") && Number.isFinite(length) && length > 0 ? length : null;
            const content = await boundedText(response, 250000, received => { signal.throwIfAborted(); onProgress({requestId, received, total}); });
            signal.throwIfAborted();
            if (!content.trim() || content.length > 90000 || /^\s*<!doctype html/i.test(content)) throw new Error("Le fichier reçu n’est pas un SKILL.md utilisable.");
            const disabledContent = setFrontmatterValue(content, "disabled", "true");
            previews.set(url, disabledContent);
            if (previews.size > 40) previews.delete(previews.keys().next().value);
            return {url, content:disabledContent};
            } catch (error) {
                if (controller.signal.aborted) throw new Error("Téléchargement annulé.", {cause:error});
                throw error;
            } finally { downloads.delete(requestId); }
        },
        takePreview(url) {
            const content = previews.get(url);
            if (!content) throw new Error("Ouvre les instructions avant d’installer ce skill.");
            return content;
        },
        takeBundle(url) {
            const bundle=bundles.get(url);
            return bundle || {content:this.takePreview(url),files:[]};
        }
    };
}
module.exports = { createMarketplace, rawSkillUrl, boundedText };
