"use strict";

const { CONFIG } = require("./config");
const settings = require("./settings");

const state = {
    chatId: null,
    chatIds: { chat: null, agent: null },
    conversationSettings: { chat: null, agent: null },
    model: CONFIG.defaultAgentId,
    webSearch: false,
    ecoMode: settings.load().ecoMode === true,
    automaticWeb: settings.load().automaticWeb !== false,
    agentPlan: [],
    private: true,
    incognito: false,
    workspace: null,
    frProject: null,     // projet FranceStudent { id, name } rattaché aux nouvelles conversations
    history: [],
    mode: "auto",        // auto | agent | chat
    autoApprove: settings.autoApproveAlways(),  // true = plus de confirmation (session, ou toujours si mémorisé)
    autoApproveCommands: settings.autoApproveCommandsAlways(),  // true = run_command sans question (deny toujours bloqué)
    fullAccess: settings.load().fullAccessAlways === true,
    activeFile: null,    // fichier actif dans l'éditeur de l'application de bureau
    openFiles: [],       // onglets ouverts dans l'éditeur de l'application de bureau
    pendingImages: [],   // images (data URL) jointes au prochain message, consommées par l'API
    pendingFiles: []     // fichiers (PDF, Office, etc.) { name, dataUrl } ou ID Files v2, consommés par l'API
};

function activateConversation(mode) {
    const key = mode === "agent" ? "agent" : "chat";
    state.chatId = state.chatIds[key];

    const settings = state.conversationSettings[key];
    if (settings) {
        for (const name of ["model", "webSearch", "private", "incognito"]) {
            if (settings[name] !== undefined) state[name] = settings[name];
        }
    }

    return key;
}

function setConversation(mode, id, settings = null) {
    const key = mode === "agent" ? "agent" : "chat";
    state.chatIds[key] = id || null;
    state.conversationSettings[key] = settings ? { ...settings } : null;
    activateConversation(key);
}

function resetConversation(mode = null) {
    if (mode) {
        const key = mode === "agent" ? "agent" : "chat";
        state.chatIds[key] = null;
        state.conversationSettings[key] = null;
        activateConversation(key);
    } else {
        state.chatIds = { chat: null, agent: null };
        state.conversationSettings = { chat: null, agent: null };
        state.chatId = null;
    }

    state.history = [];
}

function record(role, content) {
    state.history.push({ role, content });

    if (state.history.length > 30) {
        state.history = state.history.slice(-30);
    }
}

module.exports = {
    state,
    activateConversation,
    setConversation,
    resetConversation,
    record
};
