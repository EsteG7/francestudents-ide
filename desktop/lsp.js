"use strict";

/**
 * Client LSP (Language Server Protocol) pour l'éditeur de l'application.
 *
 * Lance typescript-language-server (--stdio) pour le projet ouvert et traduit
 * les demandes de l'éditeur : synchronisation des fichiers, complétion, survol.
 * Les diagnostics publiés par le serveur sont transmis via onDiagnostics(rel, liste).
 */

const path = require("node:path");
const childProcess = require("node:child_process");
const { pathToFileURL, fileURLToPath } = require("node:url");

const LANGUAGES = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascriptreact",
    ts: "typescript",
    mts: "typescript",
    cts: "typescript",
    tsx: "typescriptreact"
};

const SEVERITIES = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

const KINDS = {
    2: "method", 3: "function", 4: "function", 5: "property", 6: "variable",
    7: "class", 8: "interface", 9: "namespace", 10: "property", 13: "enum",
    14: "keyword", 20: "enum", 21: "constant", 22: "class", 25: "type"
};

const MAX_COMPLETIONS = 200;

function languageIdFor(rel) {
    const ext = path.extname(String(rel || "")).slice(1).toLowerCase();
    return LANGUAGES[ext] || null;
}

function serverEntry() {
    const pkgFile = require.resolve("typescript-language-server/package.json");
    const pkg = require(pkgFile);
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin["typescript-language-server"];
    return path.join(path.dirname(pkgFile), bin);
}

function tsserverPath() {
    try {
        return path.join(path.dirname(require.resolve("typescript/package.json")), "lib", "tsserver.js");
    } catch {
        return null;
    }
}

/** Dans Electron, process.execPath est l'exécutable de l'app : ELECTRON_RUN_AS_NODE le fait agir comme node. */
function defaultSpawn(root) {
    return childProcess.spawn(process.execPath, [serverEntry(), "--stdio"], {
        cwd: root,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
    });
}

function encodeMessage(message) {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/** Découpe le flux stdout du serveur en messages JSON-RPC (en-tête Content-Length). */
function createMessageReader(onMessage) {
    let buffer = Buffer.alloc(0);
    return (chunk) => {
        buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8")]);
        for (;;) {
            const headerEnd = buffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) return;
            const header = buffer.subarray(0, headerEnd).toString("ascii");
            const match = /Content-Length:\s*(\d+)/i.exec(header);
            const start = headerEnd + 4;
            if (!match) {
                buffer = buffer.subarray(start);
                continue;
            }
            const length = Number(match[1]);
            if (buffer.length < start + length) return;
            const body = buffer.subarray(start, start + length).toString("utf8");
            buffer = buffer.subarray(start + length);
            let message;
            try {
                message = JSON.parse(body);
            } catch {
                continue;
            }
            onMessage(message);
        }
    };
}

function simplifyDiagnostic(d) {
    const range = d && d.range ? d.range : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    return {
        from: { line: range.start.line, character: range.start.character },
        to: { line: range.end.line, character: range.end.character },
        severity: SEVERITIES[d && d.severity] || "error",
        message: String((d && d.message) || ""),
        source: d && d.source ? String(d.source) : "",
        code: d && d.code != null ? String(d.code) : ""
    };
}

function simplifyCompletion(item) {
    const edit = item.textEdit && (item.textEdit.range || item.textEdit.replace) ? item.textEdit : null;
    const doc = item.documentation;
    return {
        label: String(item.label || ""),
        type: KINDS[item.kind] || "text",
        detail: item.detail ? String(item.detail) : "",
        documentation: typeof doc === "string" ? doc : doc && doc.value ? String(doc.value) : "",
        insertText: String((edit && edit.newText) ?? item.insertText ?? item.label ?? ""),
        range: edit ? (edit.range || edit.replace) : null,
        sortText: String(item.sortText || item.label || "")
    };
}

function hoverText(contents) {
    if (!contents) return "";
    if (typeof contents === "string") return contents;
    if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join("\n\n");
    if (contents.kind === "markdown" || contents.kind === "plaintext") return String(contents.value || "");
    if (contents.language) return "```" + contents.language + "\n" + String(contents.value || "") + "\n```";
    return String(contents.value || "");
}

/** Location ou LocationLink → { rel, line, character, endLine, endCharacter } (null hors du projet). */
function simplifyLocation(loc, relFor) {
    if (!loc || typeof loc !== "object") return null;
    const uri = loc.targetUri || loc.uri;
    const range = loc.targetSelectionRange || loc.targetRange || loc.range;
    const rel = uri ? relFor(uri) : null;
    if (!rel || !range || !range.start) return null;
    return {
        rel,
        line: range.start.line,
        character: range.start.character,
        endLine: range.end ? range.end.line : range.start.line,
        endCharacter: range.end ? range.end.character : range.start.character
    };
}

/** WorkspaceEdit (changes ou documentChanges) → { files: [{ rel, edits: [{ range, newText }] }], skipped }. */
function simplifyWorkspaceEdit(edit, relFor) {
    const byRel = new Map();
    let skipped = 0;
    const add = (uri, edits) => {
        const rel = uri ? relFor(uri) : null;
        if (!rel) {
            skipped += 1;
            return;
        }
        if (!byRel.has(rel)) byRel.set(rel, []);
        for (const e of edits || []) {
            if (e && e.range) byRel.get(rel).push({ range: e.range, newText: String(e.newText ?? "") });
        }
    };
    if (edit && Array.isArray(edit.documentChanges)) {
        for (const change of edit.documentChanges) {
            if (change && change.textDocument && Array.isArray(change.edits)) add(change.textDocument.uri, change.edits);
            else skipped += 1;
        }
    } else if (edit && edit.changes && typeof edit.changes === "object") {
        for (const [uri, edits] of Object.entries(edit.changes)) add(uri, edits);
    }
    return { files: [...byRel].map(([rel, edits]) => ({ rel, edits })), skipped };
}

function offsetAt(lineStarts, text, pos) {
    const line = Math.max(0, Number(pos && pos.line) || 0);
    if (line >= lineStarts.length) return text.length;
    const start = lineStarts[line];
    const end = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
    return Math.min(start + Math.max(0, Number(pos && pos.character) || 0), end);
}

/** Applique des TextEdit LSP (positions en unités UTF-16, comme les chaînes JS). */
function applyTextEdits(text, edits) {
    const source = String(text ?? "");
    const lineStarts = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
    const resolved = (edits || [])
        .filter((e) => e && e.range)
        .map((e, index) => ({
            from: offsetAt(lineStarts, source, e.range.start),
            to: offsetAt(lineStarts, source, e.range.end),
            newText: String(e.newText ?? ""),
            index
        }))
        .sort((a, b) => b.from - a.from || b.index - a.index);
    let out = source;
    for (const e of resolved) out = out.slice(0, e.from) + e.newText + out.slice(Math.max(e.from, e.to));
    return out;
}

function simplifySignature(result) {
    if (!result || !Array.isArray(result.signatures) || result.signatures.length === 0) return null;
    const index = Math.min(Math.max(0, Number(result.activeSignature) || 0), result.signatures.length - 1);
    const sig = result.signatures[index];
    const label = String(sig.label || "");
    const doc = sig.documentation;
    let searchFrom = 0;
    const parameters = (sig.parameters || []).map((p) => {
        if (Array.isArray(p.label)) return { from: p.label[0], to: p.label[1] };
        const name = String(p.label || "");
        const from = label.indexOf(name, searchFrom);
        if (from === -1) return { from: 0, to: 0 };
        searchFrom = from + name.length;
        return { from, to: from + name.length };
    });
    const active = sig.activeParameter ?? result.activeParameter ?? 0;
    return {
        label,
        documentation: typeof doc === "string" ? doc : doc && doc.value ? String(doc.value) : "",
        parameters,
        activeParameter: Number(active) || 0,
        index,
        count: result.signatures.length
    };
}

function rangesOverlap(a, b) {
    const before = (p, q) => p.line < q.line || (p.line === q.line && p.character <= q.character);
    return before(a.start, b.end) && before(b.start, a.end);
}

function createLspClient({ workspace, onDiagnostics = () => {}, spawn = defaultSpawn, timeoutMs = 10000 } = {}) {
    if (!workspace) throw new Error("LSP : un projet est requis.");
    const root = path.resolve(String(workspace));
    const pending = new Map();
    const docs = new Map();
    const rawDiagnostics = new Map();
    let nextId = 1;
    let child = null;
    let ready = null;
    let stopped = false;

    const uriFor = (rel) => pathToFileURL(path.resolve(root, String(rel))).href;
    const relFor = (uri) => {
        try {
            const rel = path.relative(root, fileURLToPath(uri));
            if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
            return rel.split(path.sep).join("/");
        } catch {
            return null;
        }
    };

    function write(message) {
        if (child && child.stdin && child.stdin.writable) child.stdin.write(encodeMessage(message));
    }

    function notify(method, params) {
        write({ jsonrpc: "2.0", method, params });
    }

    function failAll(error) {
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(error);
        }
        pending.clear();
    }

    function request(method, params) {
        if (!child) return Promise.reject(new Error("Serveur LSP arrêté."));
        const id = nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`LSP : délai dépassé (${method}).`));
            }, timeoutMs);
            if (timer.unref) timer.unref();
            pending.set(id, { resolve, reject, timer });
            write({ jsonrpc: "2.0", id, method, params });
        });
    }

    function handleMessage(message) {
        if (!message || typeof message !== "object") return;
        if (message.id !== undefined && !message.method) {
            const entry = pending.get(message.id);
            if (!entry) return;
            pending.delete(message.id);
            clearTimeout(entry.timer);
            if (message.error) entry.reject(new Error(message.error.message || "Erreur LSP."));
            else entry.resolve(message.result ?? null);
            return;
        }
        if (message.method === "textDocument/publishDiagnostics") {
            const params = message.params || {};
            const rel = relFor(params.uri);
            if (rel) {
                rawDiagnostics.set(rel, Array.isArray(params.diagnostics) ? params.diagnostics : []);
                onDiagnostics(rel, (params.diagnostics || []).map(simplifyDiagnostic));
            }
            return;
        }
        if (message.id !== undefined && message.method) {
            let result = null;
            if (message.method === "workspace/configuration") {
                result = ((message.params && message.params.items) || []).map(() => ({}));
            }
            write({ jsonrpc: "2.0", id: message.id, result });
        }
    }

    function start() {
        if (stopped) return Promise.reject(new Error("Serveur LSP arrêté."));
        if (ready) return ready;
        child = spawn(root);
        const current = child;
        current.stdout.on("data", createMessageReader(handleMessage));
        if (current.stderr) current.stderr.on("data", () => {});
        if (current.stdin) current.stdin.on("error", () => {});
        const onGone = (error) => {
            if (child !== current) return;
            child = null;
            ready = null;
            docs.clear();
            failAll(error instanceof Error ? error : new Error("Serveur LSP arrêté."));
        };
        current.on("exit", () => onGone());
        current.on("error", (error) => onGone(new Error(`Serveur LSP indisponible : ${error.message}`)));

        const tsserver = tsserverPath();
        const rootUri = pathToFileURL(root).href;
        ready = request("initialize", {
            processId: process.pid,
            rootUri,
            workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
            capabilities: {
                textDocument: {
                    synchronization: { dynamicRegistration: false, didSave: false },
                    completion: {
                        completionItem: { snippetSupport: false, documentationFormat: ["plaintext", "markdown"] }
                    },
                    hover: { contentFormat: ["plaintext", "markdown"] },
                    publishDiagnostics: { relatedInformation: false },
                    definition: { linkSupport: false },
                    references: {},
                    rename: { prepareSupport: false },
                    signatureHelp: {
                        signatureInformation: {
                            documentationFormat: ["plaintext", "markdown"],
                            parameterInformation: { labelOffsetSupport: true }
                        }
                    },
                    codeAction: {
                        codeActionLiteralSupport: {
                            codeActionKind: { valueSet: ["quickfix", "refactor", "source", "source.organizeImports"] }
                        }
                    },
                    formatting: {}
                },
                workspace: { configuration: true, workspaceFolders: true, workspaceEdit: { documentChanges: true } }
            },
            initializationOptions: tsserver ? { tsserver: { path: tsserver } } : {}
        }).then((result) => {
            notify("initialized", {});
            return (result && result.capabilities) || {};
        });
        ready.catch(() => {
            ready = null;
        });
        return ready;
    }

    /** Ouvre le fichier côté serveur, ou envoie son nouveau contenu s'il a changé. */
    async function sync(rel, text) {
        const languageId = languageIdFor(rel);
        if (!languageId) return false;
        await start();
        const content = String(text ?? "");
        const doc = docs.get(rel);
        if (!doc) {
            docs.set(rel, { version: 1, text: content });
            notify("textDocument/didOpen", { textDocument: { uri: uriFor(rel), languageId, version: 1, text: content } });
        } else if (doc.text !== content) {
            doc.version += 1;
            doc.text = content;
            notify("textDocument/didChange", {
                textDocument: { uri: uriFor(rel), version: doc.version },
                contentChanges: [{ text: content }]
            });
        }
        return true;
    }

    function close(rel) {
        if (!docs.has(rel)) return false;
        docs.delete(rel);
        notify("textDocument/didClose", { textDocument: { uri: uriFor(rel) } });
        return true;
    }

    async function completion(rel, text, line, character) {
        if (!(await sync(rel, text))) return [];
        const result = await request("textDocument/completion", {
            textDocument: { uri: uriFor(rel) },
            position: { line: Number(line) || 0, character: Number(character) || 0 }
        });
        const items = Array.isArray(result) ? result : (result && result.items) || [];
        return items.slice(0, MAX_COMPLETIONS).map(simplifyCompletion);
    }

    async function hover(rel, text, line, character) {
        if (!(await sync(rel, text))) return null;
        const result = await request("textDocument/hover", {
            textDocument: { uri: uriFor(rel) },
            position: { line: Number(line) || 0, character: Number(character) || 0 }
        });
        const value = result ? hoverText(result.contents).trim() : "";
        return value || null;
    }

    const position = (line, character) => ({ line: Number(line) || 0, character: Number(character) || 0 });

    async function definition(rel, text, line, character) {
        if (!(await sync(rel, text))) return [];
        const result = await request("textDocument/definition", {
            textDocument: { uri: uriFor(rel) },
            position: position(line, character)
        });
        const list = Array.isArray(result) ? result : result ? [result] : [];
        return list.map((loc) => simplifyLocation(loc, relFor)).filter(Boolean);
    }

    async function references(rel, text, line, character) {
        if (!(await sync(rel, text))) return [];
        const result = await request("textDocument/references", {
            textDocument: { uri: uriFor(rel) },
            position: position(line, character),
            context: { includeDeclaration: true }
        });
        return (Array.isArray(result) ? result : []).map((loc) => simplifyLocation(loc, relFor)).filter(Boolean);
    }

    async function rename(rel, text, line, character, newName) {
        const name = String(newName ?? "").trim();
        if (!name) throw new Error("LSP : nouveau nom vide.");
        if (!(await sync(rel, text))) return { files: [], skipped: 0 };
        const result = await request("textDocument/rename", {
            textDocument: { uri: uriFor(rel) },
            position: position(line, character),
            newName: name
        });
        return simplifyWorkspaceEdit(result, relFor);
    }

    async function signatureHelp(rel, text, line, character) {
        if (!(await sync(rel, text))) return null;
        const result = await request("textDocument/signatureHelp", {
            textDocument: { uri: uriFor(rel) },
            position: position(line, character)
        });
        return simplifySignature(result);
    }

    /** Actions de code (corrections rapides, refactorisations) portant directement une modification. */
    async function codeActions(rel, text, fromLine, fromChar, toLine, toChar) {
        if (!(await sync(rel, text))) return [];
        const range = { start: position(fromLine, fromChar), end: position(toLine, toChar) };
        const diagnostics = (rawDiagnostics.get(rel) || []).filter((d) => d && d.range && rangesOverlap(d.range, range));
        const result = await request("textDocument/codeAction", {
            textDocument: { uri: uriFor(rel) },
            range,
            context: { diagnostics }
        });
        return (Array.isArray(result) ? result : [])
            .filter((a) => a && a.title && a.edit)
            .map((a) => ({
                title: String(a.title),
                kind: a.kind ? String(a.kind) : "",
                preferred: Boolean(a.isPreferred),
                edit: simplifyWorkspaceEdit(a.edit, relFor)
            }))
            .filter((a) => a.edit.files.length > 0);
    }

    /** Formate tout le document ; renvoie le texte formaté (null si langage non géré). */
    async function format(rel, text, tabSize = 4, insertSpaces = true) {
        if (!(await sync(rel, text))) return null;
        const result = await request("textDocument/formatting", {
            textDocument: { uri: uriFor(rel) },
            options: { tabSize: Number(tabSize) || 4, insertSpaces: insertSpaces !== false }
        });
        const edits = Array.isArray(result) ? result : [];
        return { changed: edits.length > 0, text: applyTextEdits(String(text ?? ""), edits) };
    }

    async function stop() {
        stopped = true;
        const current = child;
        if (!current) return;
        try {
            if (ready) {
                await Promise.race([request("shutdown", null), new Promise((resolve) => setTimeout(resolve, 1000))]);
                notify("exit", null);
            }
        } catch {
            // arrêt forcé ci-dessous
        }
        child = null;
        ready = null;
        docs.clear();
        failAll(new Error("Serveur LSP arrêté."));
        try {
            current.kill();
        } catch {
            // processus déjà terminé
        }
    }

    return {
        root,
        sync,
        close,
        completion,
        hover,
        definition,
        references,
        rename,
        signatureHelp,
        codeActions,
        format,
        stop,
        get running() {
            return Boolean(child);
        }
    };
}

/** Un client par projet : changer de projet arrête l'ancien serveur. */
function createLspManager({ onDiagnostics = () => {}, spawn = defaultSpawn, timeoutMs } = {}) {
    let client = null;

    function forWorkspace(workspace) {
        if (!workspace) throw new Error("Aucun projet ouvert.");
        const root = path.resolve(String(workspace));
        if (client && client.root === root) return client;
        if (client) client.stop().catch(() => {});
        client = createLspClient({ workspace: root, onDiagnostics, spawn, timeoutMs });
        return client;
    }

    async function stopAll() {
        const current = client;
        client = null;
        if (current) await current.stop();
    }

    return { forWorkspace, stopAll };
}

module.exports = {
    createLspClient,
    createLspManager,
    createMessageReader,
    encodeMessage,
    languageIdFor,
    hoverText,
    applyTextEdits,
    simplifyCompletion,
    simplifyDiagnostic,
    simplifyLocation,
    simplifySignature,
    simplifyWorkspaceEdit
};
