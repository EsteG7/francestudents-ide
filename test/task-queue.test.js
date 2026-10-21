"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTaskQueue } = require("../desktop/task-queue");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-queue-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(name) {
    let workspace = "project-a";
    let available = true;
    const calls = [];
    const resolvers = [];
    const file = path.join(dir, `${name}.json`);
    const options = { file, workspace: () => workspace, canRun: () => available, run: prompt => {
        calls.push(prompt);
        return new Promise(resolve => resolvers.push(resolve));
    } };
    const queue = createTaskQueue(options);
    return { queue, calls, resolvers, options, file, setWorkspace: v => { workspace = v; }, setAvailable: v => { available = v; } };
}

test("file : ordre, une seule tâche active et enchaînement", async () => {
    const h = setup("sequence");
    h.queue.action("add", { prompt: "Première" });
    h.queue.action("add", { prompt: "Deuxième" });
    h.queue.action("start");
    await tick();
    assert.deepEqual(h.calls, ["Première"]);
    assert.deepEqual(h.queue.snapshot().tasks.map(t => t.status), ["running", "pending"]);
    h.resolvers.shift()({ ok: true });
    await tick(); await tick();
    assert.deepEqual(h.calls, ["Première", "Deuxième"]);
    h.resolvers.shift()({ ok: true });
    await tick(); await tick();
    assert.deepEqual(h.queue.snapshot().tasks.map(t => t.status), ["done", "done"]);
    assert.equal(h.queue.snapshot().enabled, false);
});
test("file : erreur et interruption suspendent les tâches suivantes", async () => {
    const h = setup("failure");
    h.queue.action("add", { prompt: "A" });
    h.queue.action("add", { prompt: "B" });
    h.queue.action("start"); await tick();
    h.resolvers.shift()({ ok: false, message: "Information manquante" });
    await tick(); await tick();
    assert.deepEqual(h.calls, ["A"]);
    assert.equal(h.queue.snapshot().tasks[0].status, "failed");
    assert.equal(h.queue.snapshot().enabled, false);
    h.queue.action("retry", { id: h.queue.snapshot().tasks[0].id });
    h.queue.action("start"); await tick();
    h.queue.pause({ interrupt: true });
    h.resolvers.shift()({ ok: true });
    await tick(); await tick();
    assert.equal(h.queue.snapshot().tasks[0].status, "interrupted");
    assert.deepEqual(h.calls, ["A", "A"]);
});
test("file : pause, édition, réorganisation et séparation des projets", async () => {
    const h = setup("edit");
    h.queue.action("add", { prompt: "A" });
    h.queue.action("add", { prompt: "B" });
    const b = h.queue.snapshot().tasks[1].id;
    h.queue.action("edit", { id: b, prompt: "B modifiée" });
    h.queue.action("move", { id: b, direction: "up" });
    h.queue.action("start"); await tick();
    assert.deepEqual(h.calls, ["B modifiée"]);
    assert.throws(() => h.queue.action("remove", { id: b }));
    h.queue.action("pause");
    h.resolvers.shift()({ ok: true });
    await tick(); await tick();
    assert.equal(h.calls.length, 1);
    h.setWorkspace("project-b");
    assert.equal(h.queue.snapshot().tasks.length, 0);
    assert.throws(() => h.queue.action("retry", { id: b }));
    h.queue.action("add", { prompt: "Projet B" });
    h.setWorkspace("project-a");
    assert.equal(h.queue.snapshot().tasks.length, 2);
    h.queue.action("clear");
    assert.equal(h.queue.snapshot().tasks.length, 1);
});
test("file : reprise après redémarrage en pause, tâche active interrompue", async () => {
    const h = setup("restart");
    h.queue.action("add", { prompt: "A" });
    h.queue.action("start"); await tick();
    const restored = createTaskQueue(h.options);
    assert.equal(restored.snapshot().enabled, false);
    assert.equal(restored.snapshot().tasks[0].status, "interrupted");
    assert.throws(() => restored.action("add", { prompt: "/project autre" }));
    h.queue.pause();
    h.resolvers.shift()({ ok: true });
    await tick();
});
test("file : attend la fin d’une demande manuelle avant de démarrer", async () => {
    const h = setup("busy");
    h.setAvailable(false);
    h.queue.action("add", { prompt: "A" });
    h.queue.action("start"); await tick();
    assert.equal(h.calls.length, 0);
    h.setAvailable(true); h.queue.kick(); await tick();
    assert.deepEqual(h.calls, ["A"]);
    h.resolvers.shift()({ ok: true }); await tick(); await tick();
});

test("file : orienter transmet une fois, et une consigne non transmise reste en attente", () => {
    const h = setup("steering");
    h.queue.action("add", { prompt: "Consigne A" });
    h.queue.action("add", { prompt: "Consigne B" });
    const [a, b] = h.queue.snapshot().tasks;
    h.queue.action("steer", { id: a.id });
    assert.deepEqual(h.queue.takeSteering(), ["Consigne A"]);
    assert.deepEqual(h.queue.takeSteering(), []);
    assert.equal(h.queue.snapshot().tasks[0].status, "steered");
    h.queue.action("steer", { id: b.id });
    h.queue.releaseSteering();
    assert.equal(h.queue.snapshot().tasks[1].status, "pending");
    h.setWorkspace("");
    assert.doesNotThrow(() => h.queue.action("add", { prompt: "Sans projet" }));
});
