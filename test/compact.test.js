"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { compactConversation, buildCompactPrompt, cleanSummary } = require("../src/agent/compact");

function fakeState(history) {
    const log = { resets: [] };
    const state = { history: history.slice() };
    return {
        log,
        state,
        resetConversation(mode) {
            log.resets.push(mode);
            state.history = [];
        },
        record(role, content) {
            state.history.push({ role, content });
        }
    };
}

test("buildCompactPrompt : rôles, consigne et conversation", () => {
    const prompt = buildCompactPrompt([
        { role: "user", content: "corrige le login" },
        { role: "assistant", content: "fait dans src/app.js" }
    ], "les tests");
    assert.match(prompt, /Utilisateur : corrige le login/);
    assert.match(prompt, /Assistant : fait dans src\/app\.js/);
    assert.match(prompt, /Insiste en particulier sur : les tests/);
});

test("buildCompactPrompt : conversation trop longue tronquée au début", () => {
    const prompt = buildCompactPrompt([{ role: "user", content: "x".repeat(70000) }]);
    assert.match(prompt, /début omis/);
    assert.ok(prompt.length < 62000);
});

test("cleanSummary : extrait message d'un JSON et limite la taille", () => {
    assert.equal(cleanSummary(JSON.stringify({ type: "final", message: " résumé " })), "résumé");
    assert.equal(cleanSummary("  texte brut "), "texte brut");
    assert.ok(cleanSummary("a".repeat(5000)).length <= 4002);
});

test("compactConversation : remplace l'historique par le résumé", async () => {
    const st = fakeState([
        { role: "user", content: "q1" },
        { role: "assistant", content: "r1" },
        { role: "user", content: "q2" }
    ]);
    let sent = null;
    const api = {
        async requestModel(prompt, options) {
            sent = { prompt, options };
            return "Objectif : q2. Reste : rien.";
        }
    };

    const res = await compactConversation({ focus: "", mode: "chat" }, { api, stateModule: st });

    assert.equal(res.before, 3);
    assert.equal(res.summary, "Objectif : q2. Reste : rien.");
    assert.deepEqual(st.log.resets, ["chat"]);
    assert.equal(sent.options.fresh, true);
    assert.equal(st.state.history.length, 2);
    assert.match(st.state.history[1].content, /RÉSUMÉ DE LA CONVERSATION PRÉCÉDENTE/);
});

test("compactConversation : conversation vide ou résumé vide refusés sans réinitialiser", async () => {
    const empty = fakeState([]);
    await assert.rejects(
        compactConversation({}, { api: { async requestModel() { return "x"; } }, stateModule: empty }),
        /Conversation vide/
    );

    const st = fakeState([{ role: "user", content: "q" }]);
    await assert.rejects(
        compactConversation({}, { api: { async requestModel() { return "  "; } }, stateModule: st }),
        /aucun résumé/
    );
    assert.deepEqual(st.log.resets, []);
    assert.equal(st.state.history.length, 1);
});
