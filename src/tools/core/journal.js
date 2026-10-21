"use strict";

const fs = require("node:fs/promises");

const { state } = require("../../state");
const { resolveInWorkspace } = require("../security");
const memory = require("../../project/memory");
const {
    statOrNull,
    ensureParent,
    moveAcross,
    moveToTrash,
    cleanCreatedDirs
} = require("./fs-utils");

async function finishMutation(entry, journal) {
    memory.noteAction(journal);
    await memory.pushUndo(entry);
    await memory.save();
}

async function revert(entry) {
    const at = rel => resolveInWorkspace(state.workspace, rel);

    switch (entry.kind) {
        case "create": {
            const { target } = await at(entry.rel);

            if (!(await statOrNull(target))) {
                throw new Error(`${entry.rel} n'existe plus.`);
            }

            await fs.rm(target);
            memory.dropPath(entry.rel);
            await cleanCreatedDirs(entry);

            return `fichier ${entry.rel} supprimé.`;
        }

        case "write":
        case "edit": {
            const { target } = await at(entry.rel);

            if (!entry.backup || !(await statOrNull(entry.backup))) {
                throw new Error("Sauvegarde introuvable.");
            }

            await ensureParent(target);
            await fs.copyFile(entry.backup, target);
            memory.dropPath(entry.rel);

            return `${entry.rel} restauré.`;
        }

        case "mkdir": {
            await cleanCreatedDirs(entry);
            return `dossier ${entry.rel} retiré (s'il était vide).`;
        }

        case "move": {
            const from = await at(entry.to);
            const to = await at(entry.from);

            if (!(await statOrNull(from.target))) {
                throw new Error(`${entry.to} n'existe plus.`);
            }

            const caseOnly =
                from.target.toLowerCase() === to.target.toLowerCase();

            if (!caseOnly && (await statOrNull(to.target))) {
                throw new Error(`${entry.from} existe déjà.`);
            }

            await ensureParent(to.target);
            await moveAcross(from.target, to.target);
            memory.movePath(entry.to, entry.from);
            await cleanCreatedDirs(entry);

            return `${entry.to} remis en ${entry.from}.`;
        }

        case "delete": {
            const { target } = await at(entry.rel);

            if (await statOrNull(target)) {
                throw new Error(`${entry.rel} existe déjà : impossible de restaurer.`);
            }

            if (!entry.trash || !(await statOrNull(entry.trash))) {
                throw new Error("Élément introuvable dans la corbeille.");
            }

            await ensureParent(target);
            await moveAcross(entry.trash, target);

            return `${entry.rel} restauré.`;
        }

        case "copy": {
            const { target } = await at(entry.rel);

            if (!(await statOrNull(target))) {
                throw new Error(`${entry.rel} n'existe plus.`);
            }

            const trash = await moveToTrash(target);
            memory.dropPath(entry.rel);
            await cleanCreatedDirs(entry);

            return `copie ${entry.rel} retirée (conservée dans ${trash}).`;
        }

        default:
            throw new Error(`Type d'annulation inconnu : ${entry.kind}`);
    }
}

/** Annule la dernière modification enregistrée. Renvoie un message. */
async function undoLast() {
    if (!state.workspace) throw new Error("Aucun projet sélectionné.");

    const entry = memory.popUndo();

    if (!entry) throw new Error("Rien à annuler.");

    let message;

    try {
        message = await revert(entry);
    } catch (error) {
        memory.unpopUndo(entry);
        throw new Error(`Annulation impossible : ${error.message}`, { cause: error });
    }

    memory.noteAction(`annulé : ${entry.label}`);

    if (entry.kind !== "copy") await memory.discard(entry);

    await memory.save();

    return `Annulé : ${message}`;
}

/** Chemins touchés par une entrée de la pile d'annulation. */
function entryPaths(entry) {
    return [entry.rel, entry.from, entry.to].filter(Boolean).map(String);
}

/** Liste lisible de la pile (la plus récente en premier). */
function listUndoEntries() {
    if (!state.workspace) return [];

    return memory.listUndo()
        .map((entry, index) => ({
            index,
            at: entry.at || null,
            kind: entry.kind,
            label: entry.label || `${entry.kind} ${entryPaths(entry).join(" -> ")}`,
            paths: entryPaths(entry)
        }))
        .reverse();
}

/**
 * Annule une modification précise (index + horodatage pour éviter les décalages).
 * Refusé si une modification plus récente touche le même chemin : il faut
 * d'abord annuler celle-ci, sinon on écraserait du travail plus récent.
 */
async function undoEntry(index, at) {
    if (!state.workspace) throw new Error("Aucun projet sélectionné.");

    const stack = memory.listUndo();
    const entry = stack[Number(index)];

    if (!entry || (at && entry.at !== at)) {
        throw new Error("Modification introuvable (la liste a changé, rafraîchissez).");
    }

    const mine = new Set(entryPaths(entry));
    const later = stack.slice(Number(index) + 1).find(e => entryPaths(e).some(p => mine.has(p)));

    if (later) {
        throw new Error(`Annulez d'abord la modification plus récente : ${later.label || later.kind}.`);
    }

    const position = memory.removeUndo(entry);
    let message;

    try {
        message = await revert(entry);
    } catch (error) {
        memory.restoreUndo(entry, position);
        throw new Error(`Annulation impossible : ${error.message}`, { cause: error });
    }

    memory.noteAction(`annulé : ${entry.label}`);

    if (entry.kind !== "copy") await memory.discard(entry);

    await memory.save();

    return `Annulé : ${message}`;
}

const DIFF_MAX_BYTES = 512 * 1024;

/** Lit un fichier texte pour le diff (null si absent, dossier ou illisible). */
async function readForDiff(file) {
    if (!file) return null;

    const stat = await statOrNull(file);

    if (!stat || !stat.isFile()) return null;

    if (stat.size > DIFF_MAX_BYTES) {
        return `(fichier trop volumineux pour le diff : ${stat.size} octets)`;
    }

    try {
        return await fs.readFile(file, "utf8");
    } catch {
        return null;
    }
}

/**
 * Contenu avant/après d'une modification de la pile, pour l'affichage du diff.
 * « après » est l'état actuel du fichier sur le disque.
 */
async function entryDiff(index, at) {
    if (!state.workspace) throw new Error("Aucun projet sélectionné.");

    const stack = memory.listUndo();
    const entry = stack[Number(index)];

    if (!entry || (at && entry.at !== at)) {
        throw new Error("Modification introuvable (la liste a changé, rafraîchissez).");
    }

    const current = async rel => {
        if (!rel) return null;
        const { target } = await resolveInWorkspace(state.workspace, rel);
        return readForDiff(target);
    };

    let rel = entry.rel || entry.to || entry.from || "";
    let before = null;
    let after = null;

    switch (entry.kind) {
        case "create":
        case "copy":
            before = "";
            after = await current(entry.rel);
            break;
        case "write":
        case "edit":
            before = await readForDiff(entry.backup);
            after = await current(entry.rel);
            break;
        case "delete":
            before = await readForDiff(entry.trash);
            after = "";
            break;
        case "move":
            rel = `${entry.from} -> ${entry.to}`;
            after = await current(entry.to);
            before = after;
            break;
        default:
            break;
    }

    return {
        kind: entry.kind,
        rel,
        label: entry.label || entry.kind,
        before,
        after
    };
}

/**
 * Point de reprise (checkpoint) : annule, de la plus récente à la plus ancienne,
 * toutes les modifications enregistrées à partir de l'horodatage `at` (ISO).
 * S'arrête à la première erreur ; les entrées non annulées restent dans la pile.
 */
async function rewindTo(at) {
    if (!state.workspace) throw new Error("Aucun projet sélectionné.");

    const since = String(at || "");

    if (!since) throw new Error("Point de reprise manquant.");

    const targets = memory.listUndo().filter(entry => String(entry.at || "") >= since).reverse();
    const messages = [];

    for (const entry of targets) {
        const position = memory.removeUndo(entry);

        try {
            messages.push(await revert(entry));
        } catch (error) {
            memory.restoreUndo(entry, position);
            await memory.save();
            throw new Error(
                `Retour arrière interrompu (${messages.length}/${targets.length} annulée(s)) : ${error.message}`,
                { cause: error }
            );
        }

        memory.noteAction(`retour arrière : ${entry.label}`);

        if (entry.kind !== "copy") await memory.discard(entry);
    }

    if (targets.length) await memory.save();

    return { reverted: messages.length, messages };
}

/**
 * Rejet par bloc (hunk) : écrit le contenu recomposé par l'interface (blocs rejetés
 * remis à l'état d'origine, blocs acceptés gardés). Refuse si le fichier a changé
 * depuis l'affichage du diff (`expected` = contenu « après » vu par l'interface).
 * L'entrée reste dans le journal : /undo restaure toujours l'état d'origine complet.
 */
async function applyEntryContent(index, at, content, expected) {
    if (!state.workspace) throw new Error("Aucun projet sélectionné.");

    const stack = memory.listUndo();
    const entry = stack[Number(index)];

    if (!entry || (at && entry.at !== at)) {
        throw new Error("Modification introuvable (la liste a changé, rafraîchissez).");
    }

    if (!["create", "copy", "write", "edit"].includes(entry.kind) || !entry.rel) {
        throw new Error("Rejet par bloc impossible pour ce type de modification.");
    }

    if (typeof content !== "string" || typeof expected !== "string") {
        throw new Error("Contenu invalide.");
    }

    const { target } = await resolveInWorkspace(state.workspace, entry.rel);
    const current = await readForDiff(target);

    if (current !== expected) {
        throw new Error(`${entry.rel} a changé depuis l'affichage du diff : rouvrez le diff.`);
    }

    await fs.writeFile(target, content, "utf8");
    memory.dropPath(entry.rel);
    memory.noteAction(`blocs rejetés : ${entry.label || entry.rel}`);
    await memory.save();

    return `${entry.rel} : blocs rejetés restaurés.`;
}

module.exports = {
    finishMutation,
    revert,
    undoLast,
    listUndoEntries,
    undoEntry,
    entryDiff,
    rewindTo,
    applyEntryContent
};
