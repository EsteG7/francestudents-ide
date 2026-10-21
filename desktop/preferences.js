"use strict";
const { CONFIG } = require("../src/config");
const settings = require("../src/settings");
const defaults = { contextMaxFiles: 500, contextBudgetChars: 400000, contextFileChars: 30000, agentContextChars: 30000 };
const bounds = { contextMaxFiles: [20, 20000], contextBudgetChars: [20000, 5000000], contextFileChars: [1000, 200000], agentContextChars: [5000, 200000] };
function get() {
    const saved = settings.load();
    return { ...defaults, ...(saved.projectContext || {}), defaultModel: saved.defaultModel ?? null };
}
function apply() {
    const values = get();
    for (const key of Object.keys(defaults)) {
        const value = values[key];
        if (Number.isInteger(value) && value >= bounds[key][0] && value <= bounds[key][1]) CONFIG[key] = value;
    }
    return values;
}
function save(input) {
    const values = {};
    for (const key of Object.keys(defaults)) {
        const value = Number(input[key]);
        if (!Number.isInteger(value) || value < bounds[key][0] || value > bounds[key][1]) throw new Error(`${key} : valeur attendue entre ${bounds[key].join(" et ")}.`);
        values[key] = value;
    }
    const defaultModel = input.defaultModel === "" || input.defaultModel == null ? null : Number(input.defaultModel);
    if (defaultModel !== null && (!Number.isSafeInteger(defaultModel) || defaultModel === 0)) throw new Error("Modèle invalide.");
    settings.save({ projectContext: values, defaultModel });
    return apply();
}
module.exports = { get, apply, save, defaults, bounds };
