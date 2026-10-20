"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state } = require("../src/state");
const session = require("../src/core/session");
const agent = require("../src/agent/agent");
const chat = require("../src/core/chat");
const router = require("../src/cli/router");
const { setUiBackend, getUiBackend } = require("../src/ui-bridge");

const saved = { workspace: state.workspace, mode: state.mode, history: state.history };

test.before(() => {
    // Sortie silencieuse : ces tests n'examinent pas l'affichage.
    setUiBackend({ ...getUiBackend(), info() {}, warn() {}, error() {}, assistant() {} });
});

test.after(() => {
    setUiBackend(null);
});

test.afterEach(() => {
    state.workspace = saved.workspace;
    state.mode = saved.mode;
    state.history = saved.history;
});

test("preferAgent : l'agent traite toute demande dès qu'un projet est ouvert", async () => {
    const seen = [];
    const originalAgent = agent.runAgent;
    const originalChat = chat.send;
    agent.runAgent = async (task) => { seen.push(["agent", task]); };
    chat.send = async (task) => { seen.push(["chat", task]); };

    // Formulation volontairement absente de l'heuristique « auto ».
    const vague = "peux-tu rendre ce truc un peu plus clair ?";

    try {
        state.workspace = "C:/projet";
        state.mode = "auto";

        await session.handleInput(vague, { preferAgent: true });
        assert.deepEqual(seen, [["agent", vague]]);

        // Sans préférence, la même demande repart en chat simple.
        seen.length = 0;
        await session.handleInput(vague, {});
        assert.deepEqual(seen, [["chat", vague]]);

        // Mode « chat » explicite : l'agent n'est jamais forcé.
        seen.length = 0;
        state.mode = "chat";
        await session.handleInput("modifie src/app.js", { preferAgent: true });
        assert.deepEqual(seen, [["chat", "modifie src/app.js"]]);

        // Aucun projet ouvert : l'agent ne peut pas être utilisé, l'utilisateur
        // est invité à ouvrir un dossier (aucun envoi au modèle).
        seen.length = 0;
        state.mode = "agent";
        state.workspace = null;
        await session.handleInput("modifie src/app.js", { preferAgent: true });
        assert.deepEqual(seen, []);
    } finally {
        agent.runAgent = originalAgent;
        chat.send = originalChat;
    }
});

test("l'heuristique « auto » reconnaît « mets à jour ... »", () => {
    state.workspace = "C:/projet";
    state.mode = "auto";

    assert.equal(router.seemsToRequestLocalFiles("mets à jour la fonction formatDate"), true);
    assert.equal(router.shouldUseAgent("mets à jour la fonction formatDate"), true);
    assert.equal(router.seemsToRequestLocalFiles("applique le correctif au module de paiement"), true);
});
