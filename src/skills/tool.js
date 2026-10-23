"use strict";

/**
 * Outil use_skill : renvoie les instructions complètes d'un skill (SKILL.md)
 * listé dans le catalogue SKILLS du prompt. Lecture seule : pas de confirmation.
 */

const { requireString } = require("../tools/core/args");

async function run(args) {
    const { state } = require("../state");
    const skills = require("./index");
const skill = await skills.getSkill(args.name, require("../motion-workspace").toolWorkspace() || null);
    if(state.motionDesign && skill.application!=="effectcraft")throw new Error("Ce skill n’est pas destiné à EffectCraft. Les skills du projet code restent dans l’espace code.");
    if(skill.application && skill.application!==(state.motionDesign?"effectcraft":"code"))throw new Error("Ce skill appartient à l’autre espace : utilise le chat Motion design pour EffectCraft et le chat code pour Remotion.");

    return {
        name: skill.name,
        scope: skill.scope,
        dir: skill.dir,
        description: skill.description,
        instructions: skill.instructions,
        files: skill.files,
        truncated: skill.truncated,
        changed: false,
        message: `Skill ${skill.name} chargé : applique ses instructions pour la suite de la tâche.`
    };
}

function check(args) {
    requireString(args.name, "name");
}

function describe(a) {
    return a.name ?? "?";
}

module.exports = { name: "use_skill", run, check, describe };
