"use strict";

/**
 * Réglages persistants de l'utilisateur (globaux, hors projet).
 *
 * Stockés dans CONFIG.dataDir/settings.json, écriture atomique (tmp + rename)
 * en mode 0o600. Sert notamment à mémoriser l'auto-approbation permanente
 * (écritures : autoApproveAlways; commandes : autoApproveCommandsAlways).
 */

const fs = require("fs");
const path = require("path");
const { CONFIG } = require("./config");

const FILE_NAME = "settings.json";
const DEFAULTS = { version: 1, autoApproveAlways: false, autoApproveCommandsAlways: false };

function file() {
    return path.join(CONFIG.dataDir, FILE_NAME);
}

function load() {
    try {
        const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
        if (!raw || typeof raw !== "object") return { ...DEFAULTS };
        return {
            ...DEFAULTS,
            ...raw,
            autoApproveAlways: raw.autoApproveAlways === true,
            autoApproveCommandsAlways: raw.autoApproveCommandsAlways === true
        };
    } catch {
        return { ...DEFAULTS };
    }
}

function save(patch) {
    const next = { ...load(), ...(patch || {}), version: 1 };
    const target = file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, target);
    return next;
}

function autoApproveAlways() {
    return load().autoApproveAlways === true;
}

function setAutoApproveAlways(value) {
    return save({ autoApproveAlways: value === true });
}

// Commandes run_command lancées sans question (les commandes interdites restent bloquées).
function autoApproveCommandsAlways() {
    return load().autoApproveCommandsAlways === true;
}

function setAutoApproveCommandsAlways(value) {
    return save({ autoApproveCommandsAlways: value === true });
}

// Skills et MCP : "auto" = l'agent décide seul s'il en a besoin ;
// "manual" = seuls les skills / serveurs MCP nommés par l'utilisateur dans sa demande sont proposés.
const EXTENSIONS_MODES = ["auto", "manual"];

function extensionsMode() {
    const mode = load().extensionsMode;
    return EXTENSIONS_MODES.includes(mode) ? mode : "auto";
}

function setExtensionsMode(value) {
    if (!EXTENSIONS_MODES.includes(value)) {
        throw new Error(`Mode invalide : ${value} (auto ou manual).`);
    }
    return save({ extensionsMode: value });
}

module.exports = {
    FILE_NAME,
    DEFAULTS,
    file,
    load,
    save,
    autoApproveAlways,
    setAutoApproveAlways,
    autoApproveCommandsAlways,
    setAutoApproveCommandsAlways,
    EXTENSIONS_MODES,
    extensionsMode,
    setExtensionsMode
};
