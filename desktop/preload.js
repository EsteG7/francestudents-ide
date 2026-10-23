"use strict";

/**
 * Pont sécurisé entre la fenêtre (renderer, sans Node) et le processus principal.
 * Seules les actions listées ici sont exposées, sous window.frst.
 */

const { contextBridge, ipcRenderer } = require("electron");

function call(name, ...args) {
    return ipcRenderer.invoke(`frst:${name}`, ...args).then((res) => {
        if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Erreur inconnue.");
        return res.value;
    });
}

contextBridge.exposeInMainWorld("frst", {
    releaseHighlights: (action="get",version)=>call("releaseHighlights",action,version),
    bootstrap: () => call("bootstrap"),
    loginAccount: credentials => call("loginAccount", { email: String(credentials?.email ?? ""), password: String(credentials?.password ?? "") }),
    logoutAccount: () => call("logoutAccount"),
    projectStudio: (action,payload)=>call("projectStudio",String(action||"overview"),payload||{}),
    environmentDiagnostics: ()=>call("environmentDiagnostics"),
    formatDocument: payload=>call("formatDocument",payload||{}),
    localPreview: (action,payload)=>call("localPreview",String(action||"start"),payload||{}),
    editorPreferences: (action,payload)=>call("editorPreferences",String(action||"get"),payload||{}),
    openSourceLicenses: ()=>call("openSourceLicenses"),
    documentSymbols: (file,text)=>call("documentSymbols",String(file||""),String(text||"")),
    updates: (action,payload)=>call("updates",String(action||"status"),payload||{}),
    localBrowser: (action,payload)=>call("localBrowser",String(action||"status"),payload||{}),
    effectCraft: action=>call("effectCraft",String(action||"status")),
    effectCraftControl: request=>call("effectCraftControl",request),
    motionConversation: mode=>call("motionConversation",String(mode)),
    webResearch: (action,payload)=>call("webResearch",String(action||"list"),payload||{}),
    captureWebPage: payload=>call("captureWebPage",payload||{}),
    browserPermission: (action,value)=>call("browserPermission",String(action||"get"),String(value||"")),
    submit: (text, attachments) => call("submit", String(text ?? ""), Array.isArray(attachments) ? attachments : []),
    taskQueue: (action, payload) => call("taskQueue", String(action || "list"), payload || {}),
    agentActivity: () => call("agentActivity"),
    copyText: text => call("copyText", String(text ?? "")),
    exportConversation: text => call("exportConversation", String(text ?? "")),
    importConversation: (action, payload) => call("importConversation", String(action), payload || {}),
    setEcoMode: (enabled) => call("setEcoMode", enabled === true),
    serverHint: (text) => call("serverHint", String(text || "")),
    cancelAction: id => call("cancelAction", String(id || "")),
    backgroundJobs: (action, id) => call("backgroundJobs", String(action || "list"), id),
    checkpoints: (action, id) => call("checkpoints", String(action || "list"), id),
    resolvePrompt: (id, value) => call("resolvePrompt", id, value),
    interrupt: () => call("interrupt"),
    status: () => call("status"),
    models: () => call("models"),
    setModel: (id) => call("setModel", id),
    setEditorContext: (files, active) => call("setEditorContext", files, active),
    openProject: (dir) => call("openProject", dir ?? null),
    listDir: (rel) => call("listDir", rel ?? "."),
    readFile: (rel) => call("readFile", rel),
    writeFile: (rel, content,options) => call("writeFile", rel, content,options||{}),
    inspectFile: file=>call("inspectFile",String(file||"")),
    openFileInApp: file=>call("openFileInApp",String(file||"")),
    revealInExplorer: (rel) => call("revealInExplorer", rel),
    openExternal: (url, forceSystem=false) => call("openExternal", url, forceSystem===true),
    listAllFiles: () => call("listAllFiles"),
    searchText: (query, options) => call("searchText", String(query ?? ""), options ?? {}),
    createEntry: (rel, kind) => call("createEntry", rel, kind === "directory" ? "directory" : "file"),
    renameEntry: (from, to) => call("renameEntry", from, to),
    trashEntry: (rel) => call("trashEntry", rel),
    runTerminal: (line, cwd) => call("runTerminal", String(line ?? ""), String(cwd ?? ".")),
    terminalCd: (cwd, target) => call("terminalCd", String(cwd ?? "."), String(target ?? "")),
    conversationsOpen:id=>call("conversationsOpen",String(id)),
    killTerminal: (id) => call("killTerminal", id),
    ptyAvailable: () => call("ptyAvailable"),
    ptyCreate: (cwd, cols, rows) => call("ptyCreate", String(cwd ?? "."), Number(cols) || 80, Number(rows) || 24),
    ptyWrite: (id, data) => call("ptyWrite", Number(id), String(data ?? "")),
    ptyResize: (id, cols, rows) => call("ptyResize", Number(id), Number(cols) || 80, Number(rows) || 24),
    ptyKill: (id) => call("ptyKill", Number(id)),
    usage: () => call("usage"),
    setAutoApprove: (mode) => call("autoApprove", String(mode ?? "")),
    mcpList: (action) => call("mcpList", String(action ?? "")),
    mcpOpenConfig: () => call("mcpOpenConfig"),
    skillsList: () => call("skillsList"),
    extensionAction: (action, payload) => call("extensionAction", String(action || "list"), payload || {}),
    mcpManage: (action, payload) => call("mcpManage", String(action || ""), payload || {}),
    preferences: (action, payload) => call("preferences", String(action || "get"), payload || {}),
    marketplace: (action, payload) => call("marketplace", String(action || "search"), payload || {}),
    marketplaceKey: (action, key) => call("marketplaceKey", String(action || "status"), String(key || "")),
    skillsOpenDir: (scope) => call("skillsOpenDir", String(scope ?? "")),
    skillsCreate: (name, scope) => call("skillsCreate", String(name ?? ""), String(scope ?? "")),
    gitStatus: () => call("gitStatus"),
    gitDiff: (rel, staged) => call("gitDiff", String(rel ?? ""), staged === true),
    gitShowHead: (rel) => call("gitShowHead", String(rel ?? "")),
    gitLog: (limit) => call("gitLog", Number(limit) || 50),
    gitCommit: (message) => call("gitCommit", String(message || "")),
    githubStatus: () => call("githubStatus"),
    githubLoginToken: (token) => call("githubLoginToken", String(token || "")),
    githubLogout: () => call("githubLogout"),
    githubSetRemote: (spec) => call("githubSetRemote", String(spec || "")),
    githubCreateRepo: (name, isPublic) => call("githubCreateRepo", String(name || ""), Boolean(isPublic)),
    githubPush: () => call("githubPush"),
    githubPull: () => call("githubPull"),
    githubFetch: () => call("githubFetch"),
    githubConnector: args => call("githubConnector", args || {}),
    githubUploadAsset: id => call("githubUploadAsset", Number(id)),
    worktreeList: () => call("worktreeList"),
    worktreeCreate: (name, base) => call("worktreeCreate", String(name ?? ""), String(base || "HEAD")),
    worktreeStart: (name, prompt, options) => call("worktreeStart", String(name ?? ""), String(prompt ?? ""), {
        yes: Boolean(options && options.yes),
        readOnly: Boolean(options && options.readOnly)
    }),
    worktreeStop: (name) => call("worktreeStop", String(name ?? "")),
    worktreeChanges: (name) => call("worktreeChanges", String(name ?? "")),
    worktreeRemove: (name, force) => call("worktreeRemove", String(name ?? ""), force === true),
    undoList: () => call("undoList"),
    undoEntry: (index, at) => call("undoEntry", Number(index), at ? String(at) : null),
    undoDiff: (index, at) => call("undoDiff", Number(index), at ? String(at) : null),
    inlineComplete: (request) => call("inlineComplete", {
        path: String(request?.path ?? ""),
        language: String(request?.language ?? ""),
        prefix: String(request?.prefix ?? ""),
        suffix: String(request?.suffix ?? "")
    }),
    undoApplyContent: (index, at, content, expected) =>
        call("undoApplyContent", Number(index), at ? String(at) : null, String(content ?? ""), String(expected ?? "")),
    lspSync: (rel, text) => call("lspSync", String(rel ?? ""), String(text ?? "")),
    lspClose: (rel) => call("lspClose", String(rel ?? "")),
    lspCompletion: (rel, text, line, character) =>
        call("lspCompletion", String(rel ?? ""), String(text ?? ""), Number(line) || 0, Number(character) || 0),
    lspHover: (rel, text, line, character) =>
        call("lspHover", String(rel ?? ""), String(text ?? ""), Number(line) || 0, Number(character) || 0),
    lspDefinition: (rel, text, line, character) =>
        call("lspDefinition", String(rel ?? ""), String(text ?? ""), Number(line) || 0, Number(character) || 0),
    lspReferences: (rel, text, line, character) =>
        call("lspReferences", String(rel ?? ""), String(text ?? ""), Number(line) || 0, Number(character) || 0),
    lspRename: (rel, text, line, character, newName) =>
        call("lspRename", String(rel ?? ""), String(text ?? ""), Number(line) || 0, Number(character) || 0, String(newName ?? "")),
    lspSignatureHelp: (rel, text, line, character) =>
        call("lspSignatureHelp", String(rel ?? ""), String(text ?? ""), Number(line) || 0, Number(character) || 0),
    lspCodeActions: (rel, text, range) =>
        call("lspCodeActions", String(rel ?? ""), String(text ?? ""), {
            fromLine: Number(range?.fromLine) || 0,
            fromChar: Number(range?.fromChar) || 0,
            toLine: Number(range?.toLine) || 0,
            toChar: Number(range?.toChar) || 0
        }),
    lspFormat: (rel, text, tabSize) => call("lspFormat", String(rel ?? ""), String(text ?? ""), Number(tabSize) || 4),
    inlineEdit: (request) => call("inlineEdit", {
        path: String(request?.path ?? ""),
        language: String(request?.language ?? ""),
        instruction: String(request?.instruction ?? ""),
        selection: String(request?.selection ?? ""),
        prefix: String(request?.prefix ?? ""),
        suffix: String(request?.suffix ?? "")
    }),
    conversationsRecent: (limit) => call("conversationsRecent", Number(limit) || 30),
    conversationsRename: (id, title) => call("conversationsRename", String(id ?? ""), String(title ?? "")),
    conversationsRemove: (id) => call("conversationsRemove", String(id ?? "")),
    onEvent(handler) {
        const listener = (_event, message) => handler(message.channel, message.data);
        ipcRenderer.on("frst:event", listener);
        return () => ipcRenderer.removeListener("frst:event", listener);
    }
});
