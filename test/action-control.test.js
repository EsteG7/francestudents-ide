"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { state } = require("../src/state"), { setUiBackend } = require("../src/ui-bridge");
const { createDesktopBackend } = require("../desktop/backend");
const control = require("../src/tools/action-control");
test("Full access actions can be canceled before execution without a confirmation", async () => {
    const previous = state.fullAccess; state.fullAccess = true;
    const events = []; let calls = 0;
    const backend = createDesktopBackend((channel, value) => { if (channel === "actionControl") { events.push(value); if (value.state === "running") setImmediate(() => control.cancel(value.id)); } });
    setUiBackend(backend);
    try {
        await assert.rejects(control.run("read_file", "private.txt", async () => { calls++; return "private"; }), error => error.code === "ACTION_CANCELED");
        assert.equal(calls, 0); assert.equal(events.at(-1).state, "canceled");
        assert.equal(control.cancel(events[0].id), false);
    } finally { state.fullAccess = previous; setUiBackend(null); }
});
test("cancel interrupts only the selected operation and later actions still run", async () => {
    const previous = state.fullAccess; state.fullAccess = true;
    const events = []; const backend = createDesktopBackend((channel, value) => { if (channel === "actionControl") events.push(value); });
    setUiBackend(backend);
    try {
        let started;
        const ready = new Promise(resolve => { started = resolve; });
        const operation = control.run("run_command", "long task", () => new Promise(resolve => { const off = backend.onInterrupt(() => { off(); resolve("must not reach the model"); }); started(); }));
        const rejection = assert.rejects(operation, error => error.code === "ACTION_CANCELED");
        await ready; assert.equal(control.cancel(events[0].id), true); await rejection;
        assert.equal(await control.run("read_file", "safe.txt", async () => "next step"), "next step");
        assert.equal(events.at(-1).state, "done");
    } finally { state.fullAccess = previous; setUiBackend(null); }
});
