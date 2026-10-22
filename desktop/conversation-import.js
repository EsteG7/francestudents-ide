"use strict";

const { randomUUID } = require("node:crypto");
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CHARS = 1500000;
const MAX_MESSAGES = 5000;
const LINK_HELP = "Utilise un lien de partage accessible, un export Codex (/export), un fichier JSONL de session, ou colle la conversation.";

function shareUrl(raw) {
    let url;
    try { url = new URL(String(raw).trim()); } catch { throw new Error("Lien Codex invalide."); }
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
        !["chatgpt.com", "chat.openai.com"].includes(url.hostname) ||
        !/^\/(?:share\/|codex\/(?:share|s)\/)[a-zA-Z0-9_-]{6,200}\/?$/.test(url.pathname)) {
        throw new Error("Ce lien n’est pas un lien de partage pris en charge. Les liens de conversation privés ne donnent pas accès à leur contenu. " + LINK_HELP);
    }
    url.hash = "";
    return url;
}

async function fetchShare(raw, fetcher = fetch) {
    let url = shareUrl(raw);
    const signal = AbortSignal.timeout(20000);
    for (let redirects = 0; redirects <= 4; redirects++) {
        const response = await fetcher(url.href, { redirect: "manual", credentials: "omit", signal,
            headers: { Accept: "text/html, application/json, text/plain" } });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (!location) throw new Error("Redirection de partage invalide.");
            url = shareUrl(new URL(location, url).href);
            continue;
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`Lien inaccessible (HTTP ${response.status}). ${LINK_HELP}`);
        }
        if (!response.body) throw new Error("Le lien ne contient aucun document lisible.");
        const reader = response.body.getReader(), chunks = [];
        let size = 0;
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                size += value.length;
                if (size > MAX_BYTES) throw new Error("Partage trop volumineux (8 Mo maximum). Utilise un export de cette conversation.");
                chunks.push(value);
            }
        } finally { await reader.cancel().catch(() => {}); }
        return { content: Buffer.concat(chunks).toString("utf8"), source: url.href };
    }
    throw new Error("Trop de redirections pour ce lien de partage.");
}

function contentText(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    if (value.type && !["text", "input_text", "output_text", "message"].includes(value.type)) return "";
    return contentText(value.text ?? value.parts ?? value.content ?? "");
}

function structuredMessages(data, warnings) {
    if (Array.isArray(data) && data.length > 1 && data.every(item => item?.mapping || (item?.title && item?.messages))) {
        throw new Error("Cet export contient plusieurs conversations. Exporte ou colle uniquement celle à reprendre.");
    }
    const messages = [], visited = new WeakSet();
    let scanned = 0;
    const add = (role, content) => {
        if (!["user", "assistant"].includes(role)) return;
        const text = contentText(content).trim();
        if (!text) return;
        const last = messages[messages.length - 1];
        if (last?.role !== role || last.text !== text) messages.push({ role, text });
    };
    function walk(value, depth = 0) {
        if (!value || typeof value !== "object" || visited.has(value)) return;
        if (depth > 60 || ++scanned > 200000) throw new Error("Structure de conversation trop complexe.");
        visited.add(value);
        if (value.mapping && typeof value.mapping === "object") {
            const nodes = value.mapping;
            let leaf = value.current_node ?? value.currentNode;
            if (!leaf || !nodes[leaf]) {
                const leaves = Object.keys(nodes).filter(key => !nodes[key]?.children?.length);
                leaf = leaves.sort((a, b) => (nodes[a]?.message?.create_time || 0) - (nodes[b]?.message?.create_time || 0)).pop();
                if (leaves.length > 1) warnings.push("Plusieurs branches détectées : la branche la plus récente a été retenue, faute de branche active indiquée.");
            }
            const branch = [], seen = new Set();
            while (leaf && nodes[leaf] && !seen.has(leaf)) {
                seen.add(leaf); branch.unshift(nodes[leaf].message); leaf = nodes[leaf].parent;
            }
            for (const message of branch) if (message) add(message.author?.role ?? message.role, message.content);
            return;
        }
        if (value.type === "event_msg") {
            if (value.payload?.type === "user_message") add("user", value.payload.message);
            if (value.payload?.type === "agent_message") add("assistant", value.payload.message);
            return;
        }
        const role = value.author?.role ?? value.role;
        if (role) { add(role, value.content ?? value.text ?? value.message); return; }
        if (Array.isArray(value)) for (const item of value) walk(item, depth + 1);
        else for (const item of Object.values(value)) walk(item, depth + 1);
    }
    walk(data);
    return messages;
}

// React Router shares may use a flattened reference table. Decode data only;
// scripts from the page are never evaluated or executed.
function unflatten(table) {
    const cache = new Map();
    let count = 0;
    function reference(index, depth) {
        if (depth > 60 || ++count > 200000) throw new Error("Données de partage trop complexes.");
        if (typeof index !== "number" || index < 0 || index >= table.length) return index;
        if (cache.has(index)) return cache.get(index);
        const value = table[index];
        if (!value || typeof value !== "object") return value;
        const result = Array.isArray(value) ? [] : Object.create(null);
        cache.set(index, result);
        if (Array.isArray(value)) for (const item of value) result.push(reference(item, depth + 1));
        else for (const [key, item] of Object.entries(value)) {
            const resolved = /^_\d+$/.test(key) ? reference(Number(key.slice(1)), depth + 1) : key;
            if (typeof resolved === "string" && !["__proto__", "constructor", "prototype"].includes(resolved)) result[resolved] = reference(item, depth + 1);
        }
        return result;
    }
    return reference(0, 0);
}

function htmlMessages(html, warnings) {
    const $ = require("cheerio").load(html);
    let messages = [];
    for (const element of $("script[type='application/json'], script#__NEXT_DATA__").toArray()) {
        try { messages = structuredMessages(JSON.parse($(element).text()), warnings); } catch { /* Other page metadata. */ }
        if (messages.length) return messages;
    }
    for (const script of $("script").toArray()) {
        const text = $(script).text();
        for (const match of text.matchAll(/streamController\.enqueue\(("(?:\\.|[^"\\])*")\)/g)) {
            try {
                const chunks = JSON.parse(match[1]).split("\n");
                for (const chunk of chunks) {
                    if (!chunk.trim().startsWith("[")) continue;
                    const decoded = JSON.parse(chunk);
                    messages = structuredMessages(unflatten(decoded), warnings);
                    if (messages.length) return messages;
                }
            } catch { /* An incomplete/unsupported streamed frame is not a transcript. */ }
        }
    }
    for (const element of $("[data-message-author-role]").toArray()) {
        const role = $(element).attr("data-message-author-role");
        if (!["user", "assistant"].includes(role)) continue;
        const copy = $(element).clone();
        copy.find("script,style,button").remove();
        copy.find("pre").each((_, node) => { $(node).replaceWith($("<span>").text("\n```\n" + $(node).text() + "\n```\n")); });
        copy.find("br").replaceWith("\n");
        copy.find("p,li,h1,h2,h3").append("\n");
        const text = copy.text().trim();
        if (text) messages.push({ role, text });
    }
    if (messages.length) warnings.push("Contenu extrait de la page visible ; vérifie l’aperçu, les pièces jointes et les éléments masqués peuvent manquer.");
    return messages;
}

function markdownMessages(text, warnings) {
    const messages = [];
    let role = null, lines = [], fenced = false;
    const flush = () => { const value = lines.join("\n").trim(); if (role && value) messages.push({ role, text: value }); lines = []; };
    for (const line of text.split(/\r?\n/)) {
        if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
        const heading = !fenced && /^(?:#{1,6}\s+|\*\*)(user|assistant|human|codex|vous|agent|utilisateur)\s*:?(?:\*\*)?\s*$/i.exec(line.trim());
        if (heading) { flush(); role = /^(user|human|vous|utilisateur)$/i.test(heading[1]) ? "user" : "assistant"; }
        else lines.push(line);
    }
    flush();
    if (!messages.length) {
        warnings.push("Rôles non reconnus : le texte est conservé comme contexte historique, sans reconstruction des messages.");
        messages.push({ role: "context", text: text.trim() });
    }
    return messages;
}

function parseConversation(raw, { source = "Texte collé", remote = false } = {}) {
    const text = String(raw).replace(/^\uFEFF/, "").trim();
    if (!text || Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("Conversation vide ou trop volumineuse (8 Mo maximum).");
    const warnings = ["Seul le contexte de conversation est importé. Le projet ouvert et ses fichiers restent inchangés."];
    let messages, title = "Conversation Codex";
    if (text.startsWith("<")) messages = htmlMessages(text, warnings);
    else if (/^[{[]/.test(text)) {
        let data;
        try { data = JSON.parse(text); }
        catch {
            try { data = text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)); }
            catch { throw new Error("Export JSON/JSONL invalide ou incomplet."); }
        }
        title = String(data?.title || data?.thread?.title || data?.conversation?.title || title).slice(0, 150);
        messages = structuredMessages(data, warnings);
        warnings.push("Les consignes système, appels d’outils et journaux internes ne sont pas importés comme instructions.");
    } else messages = markdownMessages(text, warnings);
    if (!messages?.length || (remote && messages.every(message => message.role === "context"))) {
        throw new Error("Aucune conversation accessible trouvée dans cette page. Elle peut être privée, protégée ou dans un format non pris en charge. " + LINK_HELP);
    }
    if (messages.length > MAX_MESSAGES || messages.reduce((sum, message) => sum + message.text.length, 0) > MAX_CHARS) {
        throw new Error("Conversation trop longue pour cette bêta (5 000 messages ou 1,5 million de caractères maximum). Exporte une partie ciblée.");
    }
    warnings.push("Les images et pièces jointes de la conversation ne sont pas transférées automatiquement.");
    if (remote) warnings.push("Un lien partagé est un instantané : des messages ultérieurs et les commandes/outils d’origine peuvent être absents.");
    const body = `# ${title}\n\nSource : ${source}\nImport bêta : contexte historique uniquement. Aucun appel d’outil, commande ou modification de fichier de cet historique ne doit être considéré comme exécuté dans le projet actuel.\n\n` +
        messages.map(message => `## ${message.role === "user" ? "Utilisateur" : message.role === "assistant" ? "Codex" : "Contexte"}\n\n${message.text}`).join("\n\n");
    return { title, source, messages, warnings, body };
}

function createConversationImporter({ fetcher = fetch, now = Date.now } = {}) {
    const previews = new Map();
    const prune = () => { for (const [id, value] of previews) if (now() - value.at > 30 * 60000) previews.delete(id); };
    async function preview(payload) {
        prune();
        let content = String(payload?.content || ""), source = String(payload?.name || "Texte collé"), remote = false;
        if (payload?.url) {
            const share = await fetchShare(payload.url, fetcher);
            content = share.content; source = share.source; remote = true;
        }
        const parsed = parseConversation(content, { source, remote });
        const token = randomUUID();
        if (previews.size >= 8) previews.delete(previews.keys().next().value);
        previews.set(token, { ...parsed, at: now() });
        const excerpt = parsed.messages.length <= 6 ? parsed.messages : [...parsed.messages.slice(0, 3), ...parsed.messages.slice(-3)];
        return { token, title: parsed.title, source, messageCount: parsed.messages.length, chars: parsed.body.length,
            warnings: parsed.warnings, excerpt: excerpt.map(message => ({ role: message.role, text: message.text.slice(0, 2000) })) };
    }
    function get(token) { prune(); const value = previews.get(token); if (!value) throw new Error("Aperçu expiré : analyse à nouveau la conversation."); return value; }
    function consume(token) {
        const value = get(token); previews.delete(token);
        return { name: "conversation-codex.md", kind: "file", size: Buffer.byteLength(value.body), mime: "text/markdown",
            data: `data:text/markdown;base64,${Buffer.from(value.body).toString("base64")}` };
    }
    return { preview, get, consume };
}

module.exports = { createConversationImporter, parseConversation, fetchShare, shareUrl, MAX_BYTES };
