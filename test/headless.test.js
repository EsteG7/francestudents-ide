"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const {
    parseHeadlessArgs,
    isHeadlessArgv,
    createHeadlessUi,
    runHeadless
} = require("../src/cli/headless");

function sink() {
    const chunks = [];
    return { write: text => { chunks.push(String(text)); return true; }, text: () => chunks.join("") };
}

test("parseHeadlessArgs : sans -p ni exec, renvoie null", () => {
    assert.equal(parseHeadlessArgs([]), null);
    assert.equal(parseHeadlessArgs(["--classic"]), null);
    assert.equal(isHeadlessArgv(["bonjour"]), false);
});

test("parseHeadlessArgs : -p avec demande et options", () => {
    const parsed = parseHeadlessArgs(["-p", "corrige les tests", "--yes", "--cwd", "/tmp/x"]);
    assert.deepEqual(parsed, { prompt: "corrige les tests", yes: true, readOnly: false, cwd: "/tmp/x", outputFormat: "text", error: null });
});

test("parseHeadlessArgs : --json et --output-format", () => {
    assert.equal(parseHeadlessArgs(["-p", "x", "--json"]).outputFormat, "json");
    assert.equal(parseHeadlessArgs(["-p", "x", "--output-format", "json"]).outputFormat, "json");
    assert.equal(parseHeadlessArgs(["-p", "x", "--output-format=text"]).outputFormat, "text");
    const parsed = parseHeadlessArgs(["-p", "x", "--output-format", "json", "--yes"]);
    assert.equal(parsed.prompt, "x");
    assert.equal(parsed.yes, true);
    assert.match(parseHeadlessArgs(["-p", "x", "--output-format", "xml"]).error, /text.*json/);
    assert.match(parseHeadlessArgs(["-p", "x", "--output-format"]).error, /--output-format/);
});

test("parseHeadlessArgs : exec, --plan et mots multiples", () => {
    const parsed = parseHeadlessArgs(["exec", "--plan", "explique", "le", "projet"]);
    assert.equal(parsed.prompt, "explique le projet");
    assert.equal(parsed.readOnly, true);
    assert.equal(parsed.yes, false);
});

test("parseHeadlessArgs : option inconnue ou --cwd sans valeur", () => {
    assert.match(parseHeadlessArgs(["-p", "x", "--zzz"]).error, /Option inconnue/);
    assert.match(parseHeadlessArgs(["-p", "x", "--cwd"]).error, /attend un dossier/);
});

test("createHeadlessUi : confirmations refusées sans --yes", async () => {
    const err = sink();
    const { ui } = createHeadlessUi({}, { yes: false, out: sink(), err });
    assert.equal(await ui.confirm("Écrire ?"), false);
    assert.equal(await ui.askCommand("Lancer ?", "npm"), "n");
    assert.match(err.text(), /non interactif/);
});

test("createHeadlessUi : --yes accepte, sauf confirmation forcée", async () => {
    const { ui } = createHeadlessUi({}, { yes: true, out: sink(), err: sink() });
    assert.equal(await ui.confirm("Écrire ?"), true);
    assert.equal(await ui.confirm("Action sensible ?", { force: true }), false);
    assert.equal(await ui.askCommand("Lancer ?", "npm"), "o");
});

test("createHeadlessUi : la réponse va sur stdout", () => {
    const out = sink();
    const { ui, output } = createHeadlessUi({}, { out, err: sink() });
    ui.assistant("Terminé.");
    assert.equal(out.text(), "Terminé.\n");
    assert.deepEqual(output.messages, ["Terminé."]);
    ui.spinner("x").stop();
});

function fakeDeps(overrides = {}) {
    const calls = { backends: [], project: null, agent: null };
    const deps = {
        session: { bootstrap: async () => ({ ok: true }) },
        tools: { setProject: async dir => { calls.project = dir; } },
        agent: {
            runAgent: async (task, options) => {
                calls.agent = { task, options };
                require("../src/ui-bridge").ui.assistant(`ok: ${task}`);
            }
        },
        bridge: {
            setUiBackend: impl => {
                calls.backends.push(impl);
                require("../src/ui-bridge").setUiBackend(impl);
            }
        },
        base: {},
        stdin: Readable.from([]),
        out: sink(),
        err: sink(),
        cwd: "/projet",
        ...overrides
    };
    return { deps, calls };
}

test("runHeadless : lance l'agent et renvoie 0", async () => {
    const { deps, calls } = fakeDeps();
    const code = await runHeadless({ prompt: "salut", yes: false, readOnly: true, cwd: null, error: null }, deps);
    assert.equal(code, 0);
    assert.equal(calls.project, "/projet");
    assert.deepEqual(calls.agent, { task: "salut", options: { readOnly: true } });
    assert.equal(deps.out.text(), "ok: salut\n");
    assert.equal(calls.backends[calls.backends.length - 1], null);
});

test("runHeadless : lit la demande sur stdin", async () => {
    const stdin = Readable.from(["depuis stdin\n"]);
    const { deps, calls } = fakeDeps({ stdin });
    const code = await runHeadless({ prompt: "", yes: false, readOnly: false, cwd: null, error: null }, deps);
    assert.equal(code, 0);
    assert.equal(calls.agent.task, "depuis stdin");
});

test("runHeadless : arguments invalides ou demande vide → 2", async () => {
    const { deps } = fakeDeps();
    assert.equal(await runHeadless({ prompt: "x", error: "Option inconnue : --z" }, deps), 2);
    assert.equal(await runHeadless({ prompt: "", error: null }, deps), 2);
});

test("runHeadless : échec de connexion ou erreur de l'agent → 1", async () => {
    const failedBoot = fakeDeps({ session: { bootstrap: async () => ({ ok: false, reason: "Pas de session" }) } });
    assert.equal(await runHeadless({ prompt: "x", error: null }, failedBoot.deps), 1);
    assert.match(failedBoot.deps.err.text(), /Pas de session/);

    const crash = fakeDeps({ agent: { runAgent: async () => { throw new Error("boom"); } } });
    assert.equal(await runHeadless({ prompt: "x", error: null }, crash.deps), 1);
    assert.match(crash.deps.err.text(), /boom/);
});

test("createHeadlessUi : en mode json, rien n'est écrit directement sur stdout", () => {
    const out = sink();
    const { ui, output } = createHeadlessUi({}, { out, err: sink(), json: true });
    ui.assistant("Un.");
    const s = ui.stream();
    s.write("De");
    s.write("ux");
    s.end();
    assert.equal(out.text(), "");
    assert.deepEqual(output.messages, ["Un.", "Deux"]);
});

test("runHeadless : --output-format json écrit un unique objet résultat", async () => {
    const { deps } = fakeDeps();
    const code = await runHeadless({ prompt: "salut", outputFormat: "json", error: null }, deps);
    assert.equal(code, 0);
    const lines = deps.out.text().trim().split("\n");
    assert.equal(lines.length, 1);
    const result = JSON.parse(lines[0]);
    assert.equal(result.type, "result");
    assert.equal(result.is_error, false);
    assert.equal(result.exit_code, 0);
    assert.equal(result.result, "ok: salut");
    assert.deepEqual(result.messages, ["ok: salut"]);
    assert.equal(result.error, null);
    assert.equal(typeof result.duration_ms, "number");
});

test("runHeadless : mode json, erreurs aussi au format JSON", async () => {
    const bad = fakeDeps();
    assert.equal(await runHeadless({ prompt: "x", outputFormat: "json", error: "Option inconnue : --z" }, bad.deps), 2);
    const badResult = JSON.parse(bad.deps.out.text());
    assert.equal(badResult.is_error, true);
    assert.equal(badResult.exit_code, 2);
    assert.match(badResult.error, /Option inconnue/);

    const crash = fakeDeps({ agent: { runAgent: async () => { throw new Error("boom"); } } });
    assert.equal(await runHeadless({ prompt: "x", outputFormat: "json", error: null }, crash.deps), 1);
    const crashResult = JSON.parse(crash.deps.out.text());
    assert.equal(crashResult.is_error, true);
    assert.equal(crashResult.exit_code, 1);
    assert.equal(crashResult.error, "boom");
});
