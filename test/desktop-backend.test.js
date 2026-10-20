"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createDesktopBackend, clean } = require("../desktop/backend");
const { state } = require("../src/state");

function setup() {
    const events = [];
    const backend = createDesktopBackend((channel, data) => events.push({ channel, data }));
    return { events, backend };
}

test("clean retire les codes ANSI", () => {
    assert.equal(clean("\x1b[31mrouge\x1b[0m"), "rouge");
    assert.equal(clean(null), "");
});

test("createDesktopBackend exige une fonction send", () => {
    assert.throws(() => createDesktopBackend(null), TypeError);
});

test("info, warn, error et tool envoient des entrées nettoyées", () => {
    const { events, backend } = setup();
    backend.info("\x1b[32mbonjour\x1b[0m");
    backend.warn("attention");
    backend.error("erreur");
    backend.tool("read_file", "a.js");
    assert.deepEqual(events.map((e) => e.channel), ["entry", "entry", "entry", "entry"]);
    assert.deepEqual(events[0].data, { type: "info", text: "bonjour" });
    assert.equal(events[1].data.type, "warn");
    assert.equal(events[2].data.type, "error");
    assert.deepEqual(events[3].data, { type: "tool", name: "read_file", arg: "a.js" });
});

test("confirm se résout via resolvePrompt", async () => {
    const previous = state.autoApprove;
    state.autoApprove = false;
    try {
        const { events, backend } = setup();
        const pending = backend.confirm("Écrire le fichier ?");
        const prompt = events.find((e) => e.channel === "prompt");
        assert.ok(prompt);
        assert.equal(prompt.data.kind, "confirm");
        assert.equal(backend.resolvePrompt(prompt.data.id, "o"), true);
        assert.equal(await pending, true);
        assert.ok(events.some((e) => e.channel === "promptResolved"));
        assert.equal(backend.resolvePrompt(prompt.data.id, "o"), false);

        const refused = backend.confirm("Supprimer ?");
        const second = events.filter((e) => e.channel === "prompt").pop();
        backend.resolvePrompt(second.data.id, "n");
        assert.equal(await refused, false);
    } finally {
        state.autoApprove = previous;
    }
});

test("confirm avec « t » active l'auto-approbation (sauf force)", async () => {
    const previous = state.autoApprove;
    state.autoApprove = false;
    try {
        const { events, backend } = setup();
        const pending = backend.confirm("Lancer ?");
        const prompt = events.find((e) => e.channel === "prompt");
        backend.resolvePrompt(prompt.data.id, "t");
        assert.equal(await pending, true);
        assert.equal(state.autoApprove, true);
        assert.equal(await backend.confirm("Encore ?"), true);
    } finally {
        state.autoApprove = previous;
    }
});

test("ask et askSecret renvoient la valeur saisie", async () => {
    const { events, backend } = setup();
    const answer = backend.ask("Nom ?");
    const secret = backend.askSecret("Mot de passe ?");
    const prompts = events.filter((e) => e.channel === "prompt");
    assert.equal(prompts[1].data.kind, "secret");
    backend.resolvePrompt(prompts[0].data.id, "Alice");
    backend.resolvePrompt(prompts[1].data.id, "s3cret");
    assert.equal(await answer, "Alice");
    assert.equal(await secret, "s3cret");
});

test("interrupt appelle le dernier gestionnaire enregistré", () => {
    const { backend } = setup();
    assert.equal(backend.interrupt(), false);
    const calls = [];
    const off1 = backend.onInterrupt(() => calls.push(1));
    const off2 = backend.onInterrupt(() => calls.push(2));
    assert.equal(backend.interrupt(), true);
    off2();
    backend.interrupt();
    off1();
    assert.equal(backend.interrupt(), false);
    assert.deepEqual(calls, [2, 1]);
});

test("stream et spinner émettent les bons canaux", () => {
    const { events, backend } = setup();
    const stream = backend.stream();
    stream.write("Bon");
    stream.write("jour");
    stream.end();
    stream.write("ignoré");
    stream.end();
    const spin = backend.spinner("Réflexion");
    spin.update("Toujours");
    spin.stop();
    spin.stop();
    assert.deepEqual(events.map((e) => e.channel), [
        "liveStart", "liveAppend", "liveAppend", "liveEnd", "spinner", "spinner", "spinner"
    ]);
    assert.equal(events[6].data.stop, true);
});

test("diff renvoie les compteurs", () => {
    const { events, backend } = setup();
    const out = backend.diff({ added: 2, removed: 1, lines: ["+a", "-b"] });
    assert.deepEqual(out, { added: 2, removed: 1 });
    assert.equal(events[0].data.type, "diff");
});

test("status décrit l'état courant", () => {
    const { backend } = setup();
    const status = backend.status();
    assert.ok("mode" in status);
    assert.ok("workspace" in status);
    assert.equal(typeof status.jobs, "number");
});
