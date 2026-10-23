"use strict";

// Translate provider function-call events into the existing local agent protocol.
// This module never executes tools or bypasses the agent's permission checks.
function createLocalToolCalls() {
    const calls = new Map();
    const indices = new Map();
    function item(data, done) {
        const value = data.item;
        if (value?.type !== "function_call") return;
        const key = value.id ?? value.call_id ?? `index:${data.output_index ?? calls.size}`;
        if (data.output_index !== undefined) indices.set(data.output_index, key);
        const previous = calls.get(key) || {};
        calls.set(key, { ...previous, name: value.name ?? previous.name,
            arguments: value.arguments ?? previous.arguments ?? "", done: done || previous.done });
    }
    function receive(name, data) {
        if (name === "response.output_item.added" || name === "response.output_item.done") {
            item(data, name.endsWith(".done"));
        } else if (name === "response.function_call_arguments.delta" || name === "response.function_call_arguments.done") {
            const key = data.item_id ?? indices.get(data.output_index);
            if (!key) return;
            const value = calls.get(key) || { arguments: "" };
            value.name = data.name ?? value.name;
            if (name.endsWith(".done")) {
                value.arguments = data.arguments ?? value.arguments;
                value.done = true;
            } else value.arguments += data.delta || "";
            calls.set(key, value);
        } else if (name === "response.completed") {
            for (const [index, value] of (data.response?.output || []).entries()) item({ item: value, output_index: index }, true);
        }
    }
    function action() {
        // Lazy import avoids the registry -> subagent -> API dependency cycle.
        const { TOOLS, validateToolCall } = require("../tools/registry");
        for (const call of calls.values()) {
            const name = String(call.name || "").replace(/^functions\./, "");
            if (!Object.hasOwn(TOOLS, name)) continue;
            if (!call.done) throw new Error(`Appel local incomplet : ${name}. Aucun outil exécuté.`);
            let args;
            try { args = JSON.parse(call.arguments); }
            catch (cause) { throw new Error(`Arguments JSON invalides pour l’outil local ${name}.`, { cause }); }
            const value = { type: "tool", name, args, reason: `Exécuter localement l’outil ${name}.` };
            validateToolCall(value);
            // One action per agent turn. Remaining calls must be requested again
            // after the agent has observed this action's real result.
            return value;
        }
        return null;
    }
    return { receive, action };
}

module.exports = { createLocalToolCalls };
