"use strict";

/**
 * Points de reprise (checkpoints) de la session : un par demande à l'agent.
 * Chacun retient l'horodatage de départ (les modifications du journal postérieures
 * sont annulables d'un coup avec journal.rewindTo) et la longueur de l'historique local.
 */

const MAX_CHECKPOINTS = 50;
const checkpoints = [];
let nextId = 1;

function addCheckpoint({ task, workspace, historyLength }) {
    const checkpoint = {
        id: nextId++,
        at: new Date().toISOString(),
        task: String(task ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
        workspace: workspace || null,
        historyLength: Number(historyLength) || 0
    };

    checkpoints.push(checkpoint);

    if (checkpoints.length > MAX_CHECKPOINTS) {
        checkpoints.splice(0, checkpoints.length - MAX_CHECKPOINTS);
    }

    return checkpoint;
}

/** Points de reprise du projet donné, du plus ancien au plus récent. */
function listCheckpoints(workspace) {
    return checkpoints.filter(cp => !workspace || cp.workspace === workspace);
}

function getCheckpoint(id) {
    return checkpoints.find(cp => cp.id === Number(id)) || null;
}

/** Retire le point de reprise `id` et tous les plus récents du même projet. */
function dropCheckpointsFrom(id) {
    const target = getCheckpoint(id);

    if (!target) return 0;

    let removed = 0;

    for (let i = checkpoints.length - 1; i >= 0; i--) {
        const cp = checkpoints[i];

        if (cp.workspace === target.workspace && cp.id >= target.id) {
            checkpoints.splice(i, 1);
            removed++;
        }
    }

    return removed;
}

function clearCheckpoints() {
    checkpoints.length = 0;
}

module.exports = { addCheckpoint, listCheckpoints, getCheckpoint, dropCheckpointsFrom, clearCheckpoints };
