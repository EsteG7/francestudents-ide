"use strict";

/**
 * Sélection des skills et outils MCP proposés à l'agent selon le réglage extensionsMode :
 *   - "auto"   : catalogues complets, l'agent décide seul s'il en a besoin ;
 *   - "manual" : seuls les skills / serveurs / outils MCP nommés par l'utilisateur dans sa
 *                demande (ex. « utilise le skill pdf », « @rea ») restent dans les catalogues.
 */

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Vrai si la demande nomme explicitement `name` (mot entier, insensible à la casse, @ accepté). */
function mentions(task, name) {
    if (!name) return false;
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])@?${escapeRegExp(name)}(?=$|[^A-Za-z0-9_-])`, "i");
    return pattern.test(String(task || ""));
}

/** Garde les lignes du catalogue MCP dont le serveur ou l'outil est nommé dans la demande. */
function filterMcpCatalog(catalog, task) {
    return String(catalog || "")
        .split("\n")
        .filter(line => {
            const m = /^- server "([^"]+)", tool "([^"]+)"/.exec(line);
            return Boolean(m) && (mentions(task, m[1]) || mentions(task, m[2]));
        })
        .join("\n");
}

/** Garde les lignes du catalogue des skills dont le nom est cité dans la demande. */
function filterSkillsCatalog(catalog, task) {
    return String(catalog || "")
        .split("\n")
        .filter(line => {
            const m = /^- "([^"]+)"/.exec(line);
            return Boolean(m) && mentions(task, m[1]);
        })
        .join("\n");
}

/** Applique le mode aux deux catalogues. */
function selectExtensions({ mode = "auto", task = "", mcpCatalog = "", skillsCatalog = "" } = {}) {
    if (mode !== "manual") return { mcpCatalog, skillsCatalog };
    return {
        mcpCatalog: filterMcpCatalog(mcpCatalog, task),
        skillsCatalog: filterSkillsCatalog(skillsCatalog, task)
    };
}

module.exports = { mentions, filterMcpCatalog, filterSkillsCatalog, selectExtensions };
