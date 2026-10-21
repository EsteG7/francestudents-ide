"use strict";

/**
 * Outil semantic_search : recherche locale « par sens » dans le code du projet.
 *
 * Aucun service externe : index BM25 sur des morceaux de fichiers (fenêtres de lignes),
 * identifiants découpés (camelCase, snake_case), accents retirés, pluriels simples réduits,
 * chemin du fichier pris en compte. L'index est gardé en mémoire par projet et mis à jour
 * seulement pour les fichiers modifiés. Mêmes exclusions que l'indexation du projet
 * (node_modules, .git, dist, .env, clés...).
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../config");
const { state } = require("../state");
const { normalizeRelative } = require("./security");
const { requireString, optionalInt, optionalString } = require("./core/args");

const MAX_FILES = 3000;
const CHUNK_LINES = 40;
const CHUNK_STEP = 30;
const DEFAULT_RESULTS = 8;
const MAX_RESULTS = 30;
const PREVIEW_LINES = 12;
const K1 = 1.2;
const B = 0.75;
const PATH_WEIGHT = 2;

const STOPWORDS = new Set([
    "the", "of", "to", "in", "and", "or", "is", "are", "for", "on", "with", "by", "be", "it", "this", "that",
    "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "en", "dans", "pour", "par", "sur", "avec", "est",
    "qui", "que", "au", "aux", "ce", "ces", "se", "sa", "son", "ses", "ne", "pas",
    "const", "let", "var", "return", "function", "new", "if", "else"
]);

const TEXT_EXT = /\.(c|cc|cpp|cs|css|go|h|hpp|html?|java|jsx?|cjs|mjs|json|kt|lua|md|php|py|rb|rs|scss|sh|sql|svelte|swift|toml|tsx?|txt|vue|xml|ya?ml)$/i;

const indexes = new Map();

function stem(word) {
    if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
    if (word.length > 3 && /[^s]s$/.test(word)) return word.slice(0, -1);
    return word;
}

/** Texte -> jetons : identifiants découpés, minuscules, sans accents ni mots vides. */
function tokenize(text) {
    const tokens = [];
    const plain = String(text ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
    for (const word of plain.match(/[\p{L}\p{N}_$]+/gu) || []) {
        const parts = word
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
            .split(/[\s_$]+/)
            .filter(Boolean);
        const pieces = parts.length > 1 ? [word, ...parts] : parts;
        for (const piece of pieces) {
            const lower = piece.toLowerCase();
            if (lower.length < 2 || lower.length > 40 || /^\d+$/.test(lower) || STOPWORDS.has(lower)) continue;
            tokens.push(stem(lower));
        }
    }
    return tokens;
}

function countTerms(tokens, weight = 1, into = new Map()) {
    for (const token of tokens) into.set(token, (into.get(token) || 0) + weight);
    return into;
}

/** Découpe un fichier en morceaux de lignes qui se chevauchent. */
function chunkFile(rel, text) {
    const lines = String(text).split(/\r?\n/);
    const pathTerms = tokenize(rel.replace(/[/.\\-]/g, " "));
    const chunks = [];
    for (let start = 0; start < lines.length; start += CHUNK_STEP) {
        const end = Math.min(lines.length, start + CHUNK_LINES);
        const terms = countTerms(tokenize(lines.slice(start, end).join("\n")));
        const contentTerms = terms.size;
        countTerms(pathTerms, PATH_WEIGHT, terms);
        let length = 0;
        for (const n of terms.values()) length += n;
        if (contentTerms > 0) chunks.push({ file: rel, start: start + 1, end, terms, length });
        if (end >= lines.length) break;
    }
    return chunks;
}

async function listFiles(workspace) {
    const files = [];

    async function visit(absDir, rel) {
        let entries;
        try {
            entries = await fs.readdir(absDir, { withFileTypes: true });
        } catch {
            return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (files.length >= MAX_FILES) return;
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory() && (CONFIG.contextIgnoredDirs.includes(entry.name) || entry.name === ".frst")) continue;
            if (entry.isFile() && (CONFIG.contextIgnoredFiles.includes(entry.name) || !TEXT_EXT.test(entry.name))) continue;
            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            try {
                normalizeRelative(childRel); // exclut .env, .git, node_modules, clés...
            } catch {
                continue;
            }
            const abs = path.join(absDir, entry.name);
            if (entry.isDirectory()) await visit(abs, childRel);
            else if (entry.isFile()) files.push({ rel: childRel, abs });
        }
    }

    await visit(workspace, "");
    return files;
}

/** Met à jour l'index du projet : seuls les fichiers nouveaux ou modifiés sont relus. */
async function updateIndex(workspace) {
    let index = indexes.get(workspace);
    if (!index) {
        index = { files: new Map() };
        indexes.set(workspace, index);
    }

    const seen = new Set();
    let reindexed = 0;

    for (const file of await listFiles(workspace)) {
        seen.add(file.rel);
        let info;
        try {
            info = await fs.stat(file.abs);
        } catch {
            continue;
        }
        const cached = index.files.get(file.rel);
        if (cached && cached.mtime === info.mtimeMs && cached.size === info.size) continue;

        let chunks = [];
        if (info.size <= CONFIG.maxReadBytes) {
            try {
                const bytes = await fs.readFile(file.abs);
                if (!bytes.includes(0)) {
                    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
                    chunks = chunkFile(file.rel, text);
                }
            } catch {
                chunks = [];
            }
        }
        index.files.set(file.rel, { mtime: info.mtimeMs, size: info.size, chunks });
        reindexed++;
    }

    for (const rel of [...index.files.keys()]) {
        if (!seen.has(rel)) index.files.delete(rel);
    }

    return { index, reindexed, files: seen.size, capped: seen.size >= MAX_FILES };
}

/** Classement BM25 des morceaux pour une requête ; un seul résultat par zone d'un fichier. */
function rank(chunks, query, { limit = DEFAULT_RESULTS, filter = null } = {}) {
    const queryTerms = [...new Set(tokenize(query))];
    if (!queryTerms.length || !chunks.length) return [];

    const total = chunks.length;
    let sumLength = 0;
    const df = new Map(queryTerms.map(term => [term, 0]));
    for (const chunk of chunks) {
        sumLength += chunk.length;
        for (const term of queryTerms) {
            if (chunk.terms.has(term)) df.set(term, df.get(term) + 1);
        }
    }
    const avg = sumLength / total || 1;

    const scored = [];
    for (const chunk of chunks) {
        if (filter && !filter(chunk.file)) continue;
        let score = 0;
        let matched = 0;
        for (const term of queryTerms) {
            const tf = chunk.terms.get(term);
            if (!tf) continue;
            matched++;
            const n = df.get(term);
            const idf = Math.log(1 + (total - n + 0.5) / (n + 0.5));
            score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * chunk.length / avg));
        }
        // Bonus aux passages qui couvrent davantage de mots de la requête.
        if (score > 0) scored.push({ chunk, score: score * (1 + matched / queryTerms.length), matched });
    }
    scored.sort((a, b) => b.score - a.score);

    const picked = [];
    for (const item of scored) {
        const overlaps = picked.some(p => p.chunk.file === item.chunk.file &&
            item.chunk.start <= p.chunk.end && item.chunk.end >= p.chunk.start);
        if (!overlaps) picked.push(item);
        if (picked.length >= limit) break;
    }

    return picked.map(({ chunk, score, matched }) => ({
        file: chunk.file,
        start_line: chunk.start,
        end_line: chunk.end,
        score: Math.round(score * 100) / 100,
        matched_terms: matched,
        query_terms: queryTerms.length
    }));
}

/** Filtre simple : "*.ts" (nom de fichier) ou "src/*.js" (chemin complet). */
function globFilter(glob) {
    if (!glob) return null;
    const source = String(glob).split("*").map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    const regex = new RegExp(glob.includes("/") ? `^${source}$` : `(^|/)${source}$`);
    return file => regex.test(file);
}

function pathPrefix(raw) {
    if (!raw || raw === ".") return "";
    normalizeRelative(raw); // refuse les chemins hors du projet ou sensibles
    return String(raw).replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

function checkArgs(args) {
    requireString(args.query, "query");
    optionalInt(args.max_results, "max_results");
    optionalString(args.path, "path");
    optionalString(args.glob, "glob");
}

async function semanticSearch(args = {}) {
    const workspace = state.workspace;
    if (!workspace) throw new Error("Aucun projet sélectionné.");
    checkArgs(args);

    const prefix = pathPrefix(args.path);
    const byGlob = globFilter(args.glob);
    const filter = prefix || byGlob
        ? file => (!prefix || file === prefix || file.startsWith(`${prefix}/`)) && (!byGlob || byGlob(file))
        : null;

    const { index, reindexed, files, capped } = await updateIndex(workspace);
    const chunks = [];
    for (const entry of index.files.values()) chunks.push(...entry.chunks);

    const limit = Math.min(MAX_RESULTS, Math.max(1, args.max_results ?? DEFAULT_RESULTS));
    const results = rank(chunks, args.query, { limit, filter });

    for (const result of results) {
        try {
            const text = await fs.readFile(path.join(workspace, result.file), "utf8");
            result.preview = text.split(/\r?\n/)
                .slice(result.start_line - 1, Math.min(result.end_line, result.start_line - 1 + PREVIEW_LINES))
                .join("\n");
        } catch {
            result.preview = "";
        }
    }

    return {
        query: args.query,
        results,
        indexed_files: files,
        reindexed,
        capped,
        message: results.length
            ? `${results.length} passage(s) pertinent(s) sur ${files} fichier(s) indexé(s).`
            : `Aucun passage pertinent (${files} fichier(s) indexé(s)). Essaie d'autres mots ou search_files.`
    };
}

function clearIndex(workspace) {
    if (workspace) indexes.delete(workspace);
    else indexes.clear();
}

module.exports = {
    name: "semantic_search",
    run: semanticSearch,
    check: checkArgs,
    describe: a => `« ${a.query ?? "?"} »${a.path ? ` dans ${a.path}` : ""}`,
    semanticSearch,
    tokenize,
    chunkFile,
    rank,
    globFilter,
    pathPrefix,
    clearIndex
};
